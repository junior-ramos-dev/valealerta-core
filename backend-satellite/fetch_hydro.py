"""Fetch Open-Meteo rainfall and ANA HidroWeb telemetry for Vale do Rio Tijucas.

Cron example (hourly):
    python3 backend-satellite/fetch_hydro.py
"""

from __future__ import annotations

import json
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CONFIG_PATH = ROOT / "config.json"
OUT_PATH = ROOT / "data" / "hydro_now.json"
FRONTEND_PUBLIC = ROOT.parent / "frontend-dashboard" / "public" / "hydro_now.json"

OPEN_METEO = "https://api.open-meteo.com/v1/forecast"
ANA_DADOS = "https://telemetriaws1.ana.gov.br/ServiceANA.asmx/DadosHidrometeorologicos"
TZ = "America/Sao_Paulo"


def load_config() -> dict:
    with CONFIG_PATH.open(encoding="utf-8") as fh:
        return json.load(fh)


def http_get(url: str, timeout: int = 25) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "vale-alerta/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", "replace")


def effective_rain_mm(precip: list[float], hours: int, half_life_h: float = 12) -> float:
    """Peak stored rain; dry hours drain the bucket (not a 7-day arithmetic sum)."""
    n = min(len(precip), max(0, hours))
    decay = 0.5 ** (1 / half_life_h)
    store = 0.0
    peak = 0.0
    for i in range(n):
        store = store * decay + max(0.0, precip[i])
        peak = max(peak, store)
    return round(peak, 2)


def fetch_open_meteo(cities: list[dict], hours: int = 12) -> list[dict]:
    lats = ",".join(str(c["lat"]) for c in cities)
    lons = ",".join(str(c["lon"]) for c in cities)
    query = urllib.parse.urlencode(
        {
            "latitude": lats,
            "longitude": lons,
            "hourly": "precipitation",
            "forecast_days": "7",
            "timezone": TZ,
        }
    )
    payload = json.loads(http_get(f"{OPEN_METEO}?{query}"))
    blocks = payload if isinstance(payload, list) else [payload]
    out = []
    for city, block in zip(cities, blocks):
        precip = [float(v or 0) for v in block.get("hourly", {}).get("precipitation", [])]
        times = block.get("hourly", {}).get("time", [])
        acc = []
        running = 0.0
        for mm in precip:
            running += mm
            acc.append(round(running, 2))
        out.append(
            {
                "id": city["id"],
                "name": city["name"],
                "lat": city["lat"],
                "lon": city["lon"],
                "lag_to_sjb_h": city.get("lag_to_sjb_h", 0),
                "hourly_mm": precip,
                "times": times,
                "accum_3h_mm": round(sum(precip[:3]), 2),
                "accum_6h_mm": round(sum(precip[:6]), 2),
                "accum_12h_mm": round(sum(precip[:12]), 2),
                "accum_7d_mm": round(sum(precip[:168]), 2),
                "accum_7d_effective_mm": effective_rain_mm(precip, 168),
                "accum_curve_mm": acc,
            }
        )
    return out


def _parse_ana_xml(xml_text: str) -> list[dict]:
    rows = []
    root = ET.fromstring(xml_text)
    for node in root.iter():
        if not node.tag.endswith("DadosHidrometereologicos"):
            continue
        rec = {}
        for child in list(node):
            key = child.tag.split("}")[-1]
            rec[key] = (child.text or "").strip()
        if rec:
            rows.append(rec)
    return rows


def fetch_ana_station(code: str, days: int = 2) -> dict:
    end = datetime.now()
    start = end - timedelta(days=days)
    query = urllib.parse.urlencode(
        {
            "codEstacao": code,
            "dataInicio": start.strftime("%d/%m/%Y"),
            "dataFim": end.strftime("%d/%m/%Y"),
        }
    )
    xml_text = http_get(f"{ANA_DADOS}?{query}")
    rows = _parse_ana_xml(xml_text)
    latest = rows[-1] if rows else None
    nivel = None
    vazao = None
    observed_at = None
    if latest:
        observed_at = latest.get("DataHora")
        try:
            nivel = float(str(latest.get("Nivel", "")).replace(",", "."))
        except ValueError:
            nivel = None
        try:
            vazao = float(str(latest.get("Vazao", "")).replace(",", "."))
        except ValueError:
            vazao = None
    return {
        "code": code,
        "online": latest is not None,
        "observed_at": observed_at,
        "stage_cm": nivel,
        "flow_m3s": vazao,
        "samples": len(rows),
    }


def route_stage_rise(rain_mm: float, flow_m3s: float, coeff: float, width_factor: float) -> float:
    rain_term = rain_mm * coeff
    flow_term = flow_m3s / width_factor if width_factor else 0.0
    return round(max(0.0, rain_term + flow_term), 3)


def combine(config: dict, rainfall: list[dict], gauges: list[dict]) -> dict:
    hydro = config["hydro"]
    upstream_ids = {"rancho-queimado", "angelina", "major-gercino"}
    upstream = [r for r in rainfall if r["id"] in upstream_ids]
    rain_12 = sum(r["accum_12h_mm"] for r in upstream) / max(len(upstream), 1)
    rain_3 = sum(r["accum_3h_mm"] for r in upstream) / max(len(upstream), 1)
    rain_7 = sum(r.get("accum_7d_mm", 0) for r in upstream) / max(len(upstream), 1)

    live = [g for g in gauges if g["online"] and g.get("flow_m3s") is not None]
    flow = live[-1]["flow_m3s"] if live else 0.0
    stage_cm = next((g["stage_cm"] for g in reversed(live) if g.get("stage_cm") is not None), None)

    rise = route_stage_rise(
        rain_12,
        flow,
        hydro["rain_runoff_coeff"],
        hydro["valley_width_factor"],
    )
    return {
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "upstream_rain_12h_mm": round(rain_12, 2),
        "upstream_rain_3h_mm": round(rain_3, 2),
        "upstream_rain_7d_mm": round(rain_7, 2),
        "gauge_flow_m3s": flow,
        "gauge_stage_cm": stage_cm,
        "stage_rise_sjb_m": rise,
        "lag_major_gercino_to_sjb_h": hydro["sjb_lag_from_major_gercino_h"],
        "formula": hydro["depth_formula"],
        "rainfall": rainfall,
        "gauges": gauges,
        "escape_window_h": hydro["sjb_lag_from_major_gercino_h"],
    }


def main() -> None:
    config = load_config()
    cities = config["hydro"]["cities"]
    rainfall = fetch_open_meteo(cities, hours=12)
    gauges = []
    for station in config["gauges"]["stations"]:
        reading = fetch_ana_station(station["code"])
        reading.update(
            {
                "id": station["id"],
                "name": station["name"],
                "tracks": station.get("tracks"),
            }
        )
        gauges.append(reading)

    snapshot = combine(config, rainfall, gauges)
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(snapshot, ensure_ascii=False, indent=2)
    OUT_PATH.write_text(text, encoding="utf-8")
    if FRONTEND_PUBLIC.parent.exists():
        FRONTEND_PUBLIC.write_text(text, encoding="utf-8")
    print(f"Wrote {OUT_PATH}")
    print(
        f"rain12={snapshot['upstream_rain_12h_mm']} mm  "
        f"Q={snapshot['gauge_flow_m3s']} m3/s  "
        f"ΔH={snapshot['stage_rise_sjb_m']} m"
    )


if __name__ == "__main__":
    main()
