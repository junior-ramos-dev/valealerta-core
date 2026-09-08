/** Vale do Rio Tijucas: Open-Meteo rain + ANA gauges → lagged flood corridor. */

import type { Feature, FeatureCollection } from "geojson";

export type CityRain = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  lag_to_sjb_h: number;
  hourly_mm: number[];
  accum_3h_mm: number;
  accum_6h_mm: number;
  accum_12h_mm: number;
  accum_7d_mm: number;
};

export type GaugeReading = {
  id: string;
  name: string;
  code: string;
  tracks?: string;
  online: boolean;
  observed_at: string | null;
  stage_cm: number | null;
  flow_m3s: number | null;
  fallback?: boolean;
};

export type HydroSnapshot = {
  fetched_at: string;
  upstream_rain_12h_mm: number;
  upstream_rain_3h_mm: number;
  upstream_rain_7d_mm: number;
  gauge_flow_m3s: number;
  gauge_stage_cm: number | null;
  stage_rise_sjb_m: number;
  lag_major_gercino_to_sjb_h: number;
  rainfall: CityRain[];
  gauges: GaugeReading[];
};

export const UPSTREAM_CATCHMENT_IDS = ["rancho-queimado", "angelina", "major-gercino"] as const;

export const RAIN_COEFF = 0.05;
export const VALLEY_WIDTH_FACTOR = 250;
export const LAG_GERCINO_H = 4;
/** Hours after local peak for overbank water to return to the channel. */
export const OVERBANK_DRAIN_H = 12;
/** Half-life of stored rain in the catchment (dry hours drain the flood bucket). */
export const RAIN_STORAGE_HALFLIFE_H = 12;

export const VALLEY_CITIES = [
  { id: "rancho-queimado", name: "Rancho Queimado", lat: -27.6725, lon: -49.0217, lag_to_sjb_h: 8, role: "headwater" },
  { id: "angelina", name: "Angelina", lat: -27.57, lon: -48.988, lag_to_sjb_h: 6, role: "upper_catchment" },
  { id: "major-gercino", name: "Major Gercino", lat: -27.419, lon: -48.949, lag_to_sjb_h: 4, role: "surge_entry" },
  { id: "nova-trento", name: "Nova Trento", lat: -27.286, lon: -48.93, lag_to_sjb_h: 2, role: "tributary_alferes" },
  { id: "sao-joao-batista", name: "São João Batista", lat: -27.276, lon: -48.849, lag_to_sjb_h: 0, role: "target" },
  { id: "canelinha", name: "Canelinha", lat: -27.265, lon: -48.812, lag_to_sjb_h: -1, role: "downstream" },
  { id: "tijucas", name: "Tijucas", lat: -27.241, lon: -48.634, lag_to_sjb_h: -3, role: "estuary" },
] as const;

/** Cities along the SC-410 / Rio Tijucas runoff path, for map focus. */
export const VALLEY_MAP_CITIES = [
  {
    id: "rancho-queimado",
    name: "Rancho Queimado",
    lat: -27.6725,
    lon: -49.0217,
    zoom: 12.5,
    blurb: "Nascentes do Rio Tijucas (~800–1000 m)",
  },
  {
    id: "angelina",
    name: "Angelina",
    lat: -27.57,
    lon: -48.988,
    zoom: 12.8,
    blurb: "Captação do alto vale",
  },
  {
    id: "major-gercino",
    name: "Major Gercino",
    lat: -27.419,
    lon: -48.949,
    zoom: 13,
    blurb: "Posto de alerta a montante (SC-410)",
  },
  {
    id: "nova-trento",
    name: "Nova Trento",
    lat: -27.286,
    lon: -48.93,
    zoom: 13,
    blurb: "Ribeirão Alferes entra no vale acima de SJB",
  },
  {
    id: "sao-joao-batista",
    name: "São João Batista",
    lat: -27.2761,
    lon: -48.8494,
    zoom: 13.3,
    blurb: "Planície central — inflows combinados",
  },
  {
    id: "canelinha",
    name: "Canelinha",
    lat: -27.265,
    lon: -48.812,
    zoom: 13.1,
    blurb: "Planície intermediária a jusante",
  },
  {
    id: "tijucas",
    name: "Tijucas",
    lat: -27.241,
    lon: -48.634,
    zoom: 12.9,
    blurb: "Foz na BR-101 e no Atlântico",
  },
] as const;

export const ANA_STATIONS = [
  { id: "major-gercino", name: "Estação Major Gercino", code: "84097760", tracks: "surto inicial" },
  { id: "nova-trento", name: "Estação Nova Trento", code: "84096000", tracks: "crista intermediária" },
  { id: "sao-joao-batista", name: "Estação São João Batista", code: "84095500", tracks: "telemetria RHN ativa" },
] as const;

/** Simplified Rio Tijucas thalweg through the valley towns. */
export const RIO_TIJUCAS: [number, number][] = [
  [-49.0217, -27.6725],
  [-49.02, -27.585],
  [-48.988, -27.57],
  [-48.97, -27.5],
  [-48.949, -27.419],
  [-48.94, -27.35],
  [-48.93, -27.286],
  [-48.9, -27.278],
  [-48.87, -27.276],
  [-48.849, -27.276],
  [-48.83, -27.27],
  [-48.812, -27.265],
  [-48.76, -27.255],
  [-48.7, -27.248],
  [-48.634, -27.241],
];

export const REACH_LAGS_H = [8, 6, 6, 4, 3, 2, 1.5, 1, 0.4, 0, -0.5, -1, -2, -3];

/** Typical low-flow staff at SJB (natural / in-bank), ~ANA 84095500. */
export const SJB_NORMAL_STAGE_CM = 30;
/** Régua max for simulation (cover a whole terrace even if 20 m is physically extreme). */
export const REGUA_MAX_M = 20;
export const REGUA_MAX_CM = REGUA_MAX_M * 100;

/**
 * Staff-gauge reading (m) at which the Rio Tijucas starts flooding streets in
 * São João Batista. The slider zero is the natural in-bank level, not this
 * cota. Prefeitura / Defesa Civil: alagamentos a partir de 6 m.
 * Peaks: 6,85 m (maio/2024), ~9 m (dez/2022).
 */
export const SJB_SPILL_STAGE_M = 6;
export const SPILL_STAGE_MIN_M = 6;
export const SPILL_STAGE_MAX_M = 8;
export const SPILL_STAGE_STEP_M = 0.5;
export const SPILL_STAGE_STOPS_M = [6, 6.5, 7, 7.5, 8] as const;

/** Shortest upstream burst used to translate inland depth → rainfall intensity. */
export const CRITICAL_RAIN_H = 3;

export function stageRiseM(rainMm: number, flowM3s: number): number {
  return Math.max(0, rainMm * RAIN_COEFF + flowM3s / VALLEY_WIDTH_FACTOR);
}

/**
 * Fraction of peak overbank water still on the floodplain.
 * Rising limb until the local lag (wave coming down the valley), then linear
 * drain back into the bed over OVERBANK_DRAIN_H hours.
 */
export function floodOccupancy(hour: number, lagH: number): number {
  const t = hour - lagH;
  if (t >= 0) {
    return Math.max(0, 1 - t / OVERBANK_DRAIN_H);
  }
  const riseH = Math.max(2, lagH > 0 ? lagH : LAG_GERCINO_H);
  return Math.max(0, Math.min(1, 1 + t / riseH));
}

export function riverArrival(hour: number, lagH: number): number {
  return floodOccupancy(hour, lagH);
}

/**
 * Peak stored rain (mm) over `hours`, decaying every hour (half-life
 * RAIN_STORAGE_HALFLIFE_H). Two dry days empty most of the bucket, so flood
 * potential is not the 7-day arithmetic sum.
 */
export function effectiveRainMm(hourly: number[], hours: number): number {
  const n = Math.min(hourly.length, Math.max(0, Math.round(hours)));
  if (n <= 0) return 0;
  const decay = 0.5 ** (1 / RAIN_STORAGE_HALFLIFE_H);
  let store = 0;
  let peak = 0;
  for (let i = 0; i < n; i += 1) {
    store = store * decay + Math.max(0, hourly[i] || 0);
    if (store > peak) peak = store;
  }
  return round2(peak);
}

export function grossRainMm(hourly: number[], hours: number): number {
  const n = Math.min(hourly.length, Math.max(0, Math.round(hours)));
  return round2(hourly.slice(0, n).reduce((a, b) => a + b, 0));
}

/** Accumulated rain (mm) for a staff reading, given current valley flow. */
export function rainMmForStaffM(staffM: number, flowM3s: number): number {
  const fromFlow = Math.max(0, flowM3s) / VALLEY_WIDTH_FACTOR;
  return Math.max(0, (staffM - fromFlow) / RAIN_COEFF);
}

/**
 * mm/h sustained for CRITICAL_RAIN_H so first overbank ground
 * (spill cota + inlandCm) is under `inlandCm` of water.
 */
export function rainMmPerHourForInlandCm(
  inlandCm: number,
  flowM3s: number,
  spillStageM: number = SJB_SPILL_STAGE_M,
): number {
  const staffM = spillStageM + inlandCm / 100;
  return rainMmForStaffM(staffM, flowM3s) / CRITICAL_RAIN_H;
}

function parseAnaXml(xml: string): { nivel: number | null; vazao: number | null; at: string | null } {
  const blocks = [...xml.matchAll(/<DadosHidrometereologicos[\s\S]*?<\/DadosHidrometereologicos>/g)];
  const last = blocks.at(-1)?.[0];
  if (!last) return { nivel: null, vazao: null, at: null };
  const num = (tag: string): number | null => {
    const m = last.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
    if (!m) return null;
    const v = Number(m[1].replace(",", ".").trim());
    return Number.isFinite(v) ? v : null;
  };
  const at = last.match(/<DataHora>([^<]*)<\/DataHora>/)?.[1]?.trim() ?? null;
  return { nivel: num("Nivel"), vazao: num("Vazao"), at };
}

async function fetchAnaStation(code: string, signal?: AbortSignal): Promise<{
  online: boolean;
  stage_cm: number | null;
  flow_m3s: number | null;
  observed_at: string | null;
}> {
  const end = new Date();
  const start = new Date(end.getTime() - 48 * 3600 * 1000);
  const fmt = (d: Date) =>
    `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  const url =
    `/ana-hidro/ServiceANA.asmx/DadosHidrometeorologicos?codEstacao=${code}` +
    `&dataInicio=${encodeURIComponent(fmt(start))}&dataFim=${encodeURIComponent(fmt(end))}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`ANA ${code} ${res.status}`);
  const parsed = parseAnaXml(await res.text());
  return {
    online: parsed.vazao != null || parsed.nivel != null,
    stage_cm: parsed.nivel,
    flow_m3s: parsed.vazao,
    observed_at: parsed.at,
  };
}

async function fetchOpenMeteo(signal?: AbortSignal): Promise<CityRain[]> {
  const latitude = VALLEY_CITIES.map((c) => c.lat).join(",");
  const longitude = VALLEY_CITIES.map((c) => c.lon).join(",");
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
    `&hourly=precipitation&forecast_days=7&timezone=America%2FSao_Paulo`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const body: unknown = await res.json();
  const blocks = Array.isArray(body) ? body : [body];
  return VALLEY_CITIES.map((city, i) => {
    const block = blocks[i] as { hourly?: { precipitation?: (number | null)[] } };
    const hourly = (block.hourly?.precipitation ?? []).map((v) => Number(v || 0));
    return {
      id: city.id,
      name: city.name,
      lat: city.lat,
      lon: city.lon,
      lag_to_sjb_h: city.lag_to_sjb_h,
      hourly_mm: hourly,
      accum_3h_mm: round2(hourly.slice(0, 3).reduce((a, b) => a + b, 0)),
      accum_6h_mm: round2(hourly.slice(0, 6).reduce((a, b) => a + b, 0)),
      accum_12h_mm: round2(hourly.slice(0, 12).reduce((a, b) => a + b, 0)),
      accum_7d_mm: round2(hourly.slice(0, 168).reduce((a, b) => a + b, 0)),
    };
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function accumHours(city: CityRain, hours: number): number {
  return effectiveRainMm(city.hourly_mm, hours);
}

function meanUpstreamMetric(
  snapshot: HydroSnapshot,
  metric: (city: CityRain) => number,
): number {
  const upstream = snapshot.rainfall.filter((r) =>
    (UPSTREAM_CATCHMENT_IDS as readonly string[]).includes(r.id),
  );
  if (!upstream.length) return 0;
  return round2(upstream.reduce((s, r) => s + metric(r), 0) / upstream.length);
}

export async function loadHydroSnapshot(signal?: AbortSignal): Promise<HydroSnapshot> {
  const rainfall = await fetchOpenMeteo(signal);
  const gauges: GaugeReading[] = [];
  for (const station of ANA_STATIONS) {
    try {
      const reading = await fetchAnaStation(station.code, signal);
      gauges.push({ ...station, ...reading });
    } catch {
      gauges.push({
        ...station,
        online: false,
        observed_at: null,
        stage_cm: null,
        flow_m3s: null,
      });
    }
  }

  const live = gauges.filter((g) => g.online && g.flow_m3s != null);
  const sjb = gauges.find((g) => g.id === "sao-joao-batista");
  const flow = live.at(-1)?.flow_m3s ?? sjb?.flow_m3s ?? 0;
  const stageCm = [...live].reverse().find((g) => g.stage_cm != null)?.stage_cm ?? null;

  const upstream = rainfall.filter((r) =>
    (UPSTREAM_CATCHMENT_IDS as readonly string[]).includes(r.id),
  );
  const rain12 =
    upstream.reduce((s, r) => s + r.accum_12h_mm, 0) / Math.max(upstream.length, 1);
  const rain3 =
    upstream.reduce((s, r) => s + r.accum_3h_mm, 0) / Math.max(upstream.length, 1);

  const rain7 =
    upstream.reduce((s, r) => s + effectiveRainMm(r.hourly_mm, 168), 0) / Math.max(upstream.length, 1);

  return {
    fetched_at: new Date().toISOString(),
    upstream_rain_12h_mm: round2(rain12),
    upstream_rain_3h_mm: round2(rain3),
    upstream_rain_7d_mm: round2(rain7),
    gauge_flow_m3s: flow,
    gauge_stage_cm: stageCm,
    stage_rise_sjb_m: round2(stageRiseM(rain12, flow)),
    lag_major_gercino_to_sjb_h: LAG_GERCINO_H,
    rainfall,
    gauges,
  };
}

function offsetPolygon(
  a: [number, number],
  b: [number, number],
  halfWidthDeg: number,
): [number, number][] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1e-9;
  const nx = (-dy / len) * halfWidthDeg;
  const ny = (dx / len) * halfWidthDeg;
  return [
    [a[0] + nx, a[1] + ny],
    [b[0] + nx, b[1] + ny],
    [b[0] - nx, b[1] - ny],
    [a[0] - nx, a[1] - ny],
    [a[0] + nx, a[1] + ny],
  ];
}

export function rainForHorizon(snapshot: HydroSnapshot | null, hours: number, overrideMm?: number): number {
  if (overrideMm != null && Number.isFinite(overrideMm)) return overrideMm;
  if (!snapshot) return 0;
  const upstream = snapshot.rainfall.filter((r) =>
    (UPSTREAM_CATCHMENT_IDS as readonly string[]).includes(r.id),
  );
  if (!upstream.length) return snapshot.upstream_rain_12h_mm;
  return round2(upstream.reduce((s, r) => s + accumHours(r, hours), 0) / upstream.length);
}

/** Peak effective rain (mm) in the upstream catchment over the next `days`. */
export function rainForForecastDays(snapshot: HydroSnapshot | null, days: number): number {
  const hours = forecastHorizonHours(days);
  return rainForHorizon(snapshot, hours);
}

/** Arithmetic sum of forecast rain (mm), ignoring drainage between storms. */
export function grossRainForForecastDays(snapshot: HydroSnapshot | null, days: number): number {
  if (!snapshot) return 0;
  const hours = forecastHorizonHours(days);
  return meanUpstreamMetric(snapshot, (r) => grossRainMm(r.hourly_mm, hours));
}

/** Predicted staff (m above bed) after `days` of forecast rain, from current ANA stage. */
export function forecastStaffM(snapshot: HydroSnapshot | null, days: number): number {
  const rainMm = rainForForecastDays(snapshot, days);
  const currentM = (snapshot?.gauge_stage_cm ?? SJB_NORMAL_STAGE_CM) / 100;
  return Math.max(0, currentM + rainMm * RAIN_COEFF);
}

export const HYDRO_TZ = "America/Sao_Paulo";

function saoPauloYmd(from: Date): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: HYDRO_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(from);
  const num = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { y: num("year"), m: num("month"), d: num("day") };
}

/** Calendar day in São Paulo: today + `offsetDays` (0 = hoje). */
export function horizonDate(offsetDays: number, from = new Date()): Date {
  const { y, m, d } = saoPauloYmd(from);
  return new Date(Date.UTC(y, m - 1, d + offsetDays, 12, 0, 0));
}

function saoPauloHour(from: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: HYDRO_TZ,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(from),
  );
}

/**
 * Hours of Open-Meteo series to include for a 1–7 slider that starts today.
 * Day 1 = restante de hoje; day 7 = hoje até o 7º dia (ex.: terça 8 → segunda 14).
 */
export function forecastHorizonHours(days: number, from = new Date()): number {
  const n = Math.max(1, Math.round(days));
  const remainingToday = Math.max(1, 24 - saoPauloHour(from));
  return remainingToday + (n - 1) * 24;
}

export function formatWeekdayDatePt(date: Date): string {
  const weekday = date.toLocaleDateString("pt-BR", { weekday: "long", timeZone: "UTC" });
  const numbered = date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${numbered}`;
}

/** Last calendar day included in the 7-day box (slider 1 = hoje). */
export function forecastHorizonLabel(days: number, from = new Date()): string {
  return formatWeekdayDatePt(horizonDate(Math.max(0, days - 1), from));
}

export function todayHorizonLabel(from = new Date()): string {
  return formatWeekdayDatePt(horizonDate(0, from));
}

export function buildFloodGeoJSON(
  stageRiseMValue: number,
  hour: number,
  uniform = false,
): FeatureCollection {
  const features: Feature[] = [];
  for (let i = 0; i < RIO_TIJUCAS.length - 1; i += 1) {
    const lag = REACH_LAGS_H[i] ?? 0;
    const depth = uniform
      ? stageRiseMValue
      : stageRiseMValue * riverArrival(hour, lag);
    if (depth < 0.04) continue;
    const half = 0.00028 + Math.min(depth, 6) * 0.00115;
    const depthBand = depth < 0.3 ? "wade" : depth < 1 ? "stall" : "evacuate";
    features.push({
      type: "Feature",
      properties: { depth_m: round2(depth), depth_band: depthBand, lag_h: lag },
      geometry: { type: "Polygon", coordinates: [offsetPolygon(RIO_TIJUCAS[i], RIO_TIJUCAS[i + 1], half)] },
    });
  }
  return { type: "FeatureCollection", features };
}

export function riverLineGeoJSON(): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { name: "Rio Tijucas" },
        geometry: { type: "LineString", coordinates: RIO_TIJUCAS },
      },
    ],
  };
}

export function cityPointsGeoJSON(): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: VALLEY_CITIES.map((c) => ({
      type: "Feature",
      properties: { name: c.name, lag_h: c.lag_to_sjb_h, role: c.role },
      geometry: { type: "Point", coordinates: [c.lon, c.lat] },
    })),
  };
}
