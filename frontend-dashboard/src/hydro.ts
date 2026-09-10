/**
 * Open-Meteo (chuva horária) × ANA HidroWeb (cota/vazão) → régua prevista e ΔH.
 * O pacote da bacia (`regions/*.json`) traz coeficientes, talvegue e estações.
 *
 * ΔH ≈ chuva_efetiva_mm × rain_runoff_coeff + Q / valley_width_factor.
 * Chuva efetiva ≠ soma bruta: balde com meia-vida (intervalos secos esvaziam).
 */

import type { Feature, FeatureCollection } from "geojson";
import { readCachedHydro, writeCachedHydro } from "./hydroCache";
import { getRegion, surgeLagH } from "./region";

export type CityRain = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  lag_to_target_h: number;
  /** @deprecated alias of lag_to_target_h */
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
  /** True when Open-Meteo/ANA failed and this is the last snapshot saved on the device. */
  from_cache?: boolean;
  region_id: string;
  upstream_rain_12h_mm: number;
  upstream_rain_3h_mm: number;
  upstream_rain_7d_mm: number;
  gauge_flow_m3s: number;
  gauge_stage_cm: number | null;
  stage_rise_m: number;
  /** @deprecated alias of stage_rise_m */
  stage_rise_sjb_m: number;
  lag_surge_to_target_h: number;
  /** @deprecated alias of lag_surge_to_target_h */
  lag_major_gercino_to_sjb_h: number;
  rainfall: CityRain[];
  gauges: GaugeReading[];
};

/** Shortest upstream burst used to translate inland depth → rainfall intensity. */
export const CRITICAL_RAIN_H = 3;
/** Near-term Open-Meteo walk: next 12 hourly steps from “now”. */
export const NEAR_FORECAST_H = 12;

export const HYDRO_TZ = "America/Sao_Paulo";

export function rainCoeff(): number {
  return getRegion().hydro.rain_runoff_coeff;
}

export function valleyWidthFactor(): number {
  return getRegion().hydro.valley_width_factor;
}

export function overbankDrainH(): number {
  return getRegion().hydro.overbank_drain_h;
}

export function rainStorageHalflifeH(): number {
  return getRegion().hydro.rain_storage_halflife_h;
}

export function riverThalweg(): [number, number][] {
  return getRegion().river_thalweg;
}

export function reachLagsH(): number[] {
  return getRegion().reach_lags_h;
}

/** Talvegue principal + tributários (LineStrings separados; sem atalho entre vales). */
export function riverBranches(): {
  id: string;
  name: string;
  coordinates: [number, number][];
  lags: number[];
}[] {
  const pack = getRegion();
  return [
    {
      id: "main",
      name: pack.river_name,
      coordinates: pack.river_thalweg,
      lags: pack.reach_lags_h,
    },
    ...pack.river_branches.map((b) => ({
      id: b.id,
      name: b.name,
      coordinates: b.coordinates,
      lags: b.reach_lags_h,
    })),
  ];
}

/** Subida da régua (m): chuva efetiva × coeff da bacia + vazão diluída na planície. */
export function stageRiseM(rainMm: number, flowM3s: number): number {
  return Math.max(0, rainMm * rainCoeff() + flowM3s / valleyWidthFactor());
}

/**
 * Fraction of peak overbank water still on the floodplain.
 * Rising limb until the local lag (wave coming down the valley), then linear
 * drain back into the bed over overbank_drain_h hours.
 */
export function floodOccupancy(hour: number, lagH: number): number {
  const drain = overbankDrainH();
  const surge = surgeLagH();
  const t = hour - lagH;
  if (t >= 0) {
    return Math.max(0, 1 - t / drain);
  }
  const riseH = Math.max(2, lagH > 0 ? lagH : surge);
  return Math.max(0, Math.min(1, 1 + t / riseH));
}

export function riverArrival(hour: number, lagH: number): number {
  return floodOccupancy(hour, lagH);
}

/**
 * Peak stored rain (mm) over `hours`, decaying every hour (half-life
 * from the region pack). Two dry days empty most of the bucket.
 */
export function effectiveRainMm(hourly: number[], hours: number): number {
  const n = Math.min(hourly.length, Math.max(0, Math.round(hours)));
  if (n <= 0) return 0;
  const decay = 0.5 ** (1 / rainStorageHalflifeH());
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
  const fromFlow = Math.max(0, flowM3s) / valleyWidthFactor();
  return Math.max(0, (staffM - fromFlow) / rainCoeff());
}

/**
 * mm/h sustained for CRITICAL_RAIN_H so first overbank ground
 * (spill cota + inlandCm) is under `inlandCm` of water.
 */
export function rainMmPerHourForInlandCm(
  inlandCm: number,
  flowM3s: number,
  spillStageM: number = getRegion().hydro.spill_stage_m,
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
  const cities = getRegion().cities;
  // Um request: uma série horária de precipitação por município do pacote (7 dias, fuso SP).
  const latitude = cities.map((c) => c.lat).join(",");
  const longitude = cities.map((c) => c.lon).join(",");
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
    `&hourly=precipitation&forecast_days=7&timezone=America%2FSao_Paulo`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const body: unknown = await res.json();
  const blocks = Array.isArray(body) ? body : [body];
  return cities.map((city, i) => {
    const block = blocks[i] as { hourly?: { precipitation?: (number | null)[] } };
    const hourly = (block.hourly?.precipitation ?? []).map((v) => Number(v || 0));
    return {
      id: city.id,
      name: city.name,
      lat: city.lat,
      lon: city.lon,
      lag_to_target_h: city.lag_to_target_h,
      lag_to_sjb_h: city.lag_to_target_h,
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

function upstreamRain(rainfall: CityRain[]): CityRain[] {
  // Média só nas cidades a montante do alvo (ex.: alto Açu + Mirim), não na foz.
  const ids = new Set(getRegion().hydro.upstream_city_ids);
  const upstream = rainfall.filter((r) => ids.has(r.id));
  return upstream.length ? upstream : rainfall;
}

function meanUpstreamMetric(
  snapshot: HydroSnapshot,
  metric: (city: CityRain) => number,
): number {
  const upstream = upstreamRain(snapshot.rainfall);
  if (!upstream.length) return 0;
  return round2(upstream.reduce((s, r) => s + metric(r), 0) / upstream.length);
}

export function formatHydroClock(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: HYDRO_TZ,
  });
}

/** Label when the saved forecast is not from today (São Paulo calendar). */
export function hydroForecastAgeLabel(iso: string): string | null {
  const dayKey = (value: Date) =>
    value.toLocaleDateString("en-CA", { timeZone: HYDRO_TZ });
  const fetched = new Date(iso);
  const now = new Date();
  if (dayKey(fetched) === dayKey(now)) return null;
  const [fy, fm, fd] = dayKey(fetched).split("-").map(Number);
  const [ny, nm, nd] = dayKey(now).split("-").map(Number);
  const days = Math.round(
    (Date.UTC(ny, nm - 1, nd) - Date.UTC(fy, fm - 1, fd)) / 86_400_000,
  );
  if (days === 1) return "Previsão de ontem";
  return `Previsão de ${fetched.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    timeZone: HYDRO_TZ,
  })}`;
}

export async function loadHydroSnapshot(signal?: AbortSignal): Promise<HydroSnapshot> {
  const pack = getRegion();
  try {
    const snap = await fetchLiveHydroSnapshot(signal);
    try {
      await writeCachedHydro(pack.id, snap);
    } catch (error) {
      console.warn("Não gravou o retrato hidrológico no aparelho.", error);
    }
    return { ...snap, from_cache: false };
  } catch (error) {
    if (signal?.aborted) throw error;
    const cached = await readCachedHydro(pack.id);
    if (cached) return { ...cached, from_cache: true };
    throw error;
  }
}

async function fetchLiveHydroSnapshot(signal?: AbortSignal): Promise<HydroSnapshot> {
  const pack = getRegion();
  const rainfall = await fetchOpenMeteo(signal);
  const gauges: GaugeReading[] = [];
  // Uma leitura ANA por estação do pacote; offline entra no snapshot sem derrubar o resto.
  for (const station of pack.gauges.stations) {
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
  const targetGauge = gauges.find((g) => g.id === pack.live_gauge_id);
  // Vazão: última estação online; cota: última com stage_cm (piso da régua em Tempo Real).
  const flow = live.at(-1)?.flow_m3s ?? targetGauge?.flow_m3s ?? 0;
  const stageCm = [...live].reverse().find((g) => g.stage_cm != null)?.stage_cm ?? null;

  const upstream = upstreamRain(rainfall);
  const rain12 =
    upstream.reduce((s, r) => s + r.accum_12h_mm, 0) / Math.max(upstream.length, 1);
  const rain3 =
    upstream.reduce((s, r) => s + r.accum_3h_mm, 0) / Math.max(upstream.length, 1);
  const rain7 =
    upstream.reduce((s, r) => s + effectiveRainMm(r.hourly_mm, 168), 0) / Math.max(upstream.length, 1);

  const rise = round2(stageRiseM(rain12, flow));
  const lag = surgeLagH(pack);
  return {
    fetched_at: new Date().toISOString(),
    region_id: pack.id,
    upstream_rain_12h_mm: round2(rain12),
    upstream_rain_3h_mm: round2(rain3),
    upstream_rain_7d_mm: round2(rain7),
    gauge_flow_m3s: flow,
    gauge_stage_cm: stageCm,
    stage_rise_m: rise,
    stage_rise_sjb_m: rise,
    lag_surge_to_target_h: lag,
    lag_major_gercino_to_sjb_h: lag,
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

/** Média da chuva efetiva a montante na janela (h). Slider 1–7 dias usa forecastHorizonHours. */
export function rainForHorizon(
  snapshot: HydroSnapshot | null,
  hours: number,
  overrideMm?: number,
): number {
  if (overrideMm != null && Number.isFinite(overrideMm)) return overrideMm;
  if (!snapshot) return 0;
  const upstream = upstreamRain(snapshot.rainfall);
  if (!upstream.length) return snapshot.upstream_rain_12h_mm;
  return round2(upstream.reduce((s, r) => s + accumHours(r, hours), 0) / upstream.length);
}

/** Peak effective rain (mm) in the upstream catchment over the next `days`. */
export function rainForForecastDays(snapshot: HydroSnapshot | null, days: number): number {
  const hours = forecastHorizonHours(days);
  return rainForHorizon(snapshot, hours);
}

/** Mean upstream precipitation per Open-Meteo hour (mm in that hour ≈ mm/h). */
export function upstreamHourlyMm(
  snapshot: HydroSnapshot | null,
  hours: number = NEAR_FORECAST_H,
): number[] {
  const n = Math.max(0, Math.round(hours));
  if (!snapshot || n === 0) return [];
  const cities = upstreamRain(snapshot.rainfall);
  const rows = cities.length ? cities : snapshot.rainfall;
  if (!rows.length) return Array.from({ length: n }, () => 0);
  return Array.from({ length: n }, (_, h) =>
    round2(rows.reduce((sum, city) => sum + (city.hourly_mm[h] ?? 0), 0) / rows.length),
  );
}

export function grossRainForHorizon(snapshot: HydroSnapshot | null, hours: number): number {
  if (!snapshot) return 0;
  return meanUpstreamMetric(snapshot, (r) => grossRainMm(r.hourly_mm, hours));
}

/** Arithmetic sum of forecast rain (mm), ignoring drainage between storms. */
export function grossRainForForecastDays(snapshot: HydroSnapshot | null, days: number): number {
  return grossRainForHorizon(snapshot, forecastHorizonHours(days));
}

/**
 * Cota prevista (m acima do leito) = régua atual (ANA ou slider) + ΔH da chuva efetiva.
 * 32 mm × 0,05 = +1,6 m na régua, não 32 cm de água no mapa.
 */
export function forecastStaffFromHours(
  snapshot: HydroSnapshot | null,
  hours: number,
  baselineCm?: number,
): number {
  const rainMm = rainForHorizon(snapshot, hours);
  const currentM =
    (baselineCm ?? snapshot?.gauge_stage_cm ?? getRegion().hydro.normal_stage_cm) / 100;
  return Math.max(0, currentM + rainMm * rainCoeff());
}

export function forecastStaffM(
  snapshot: HydroSnapshot | null,
  days: number,
  baselineCm?: number,
): number {
  return forecastStaffFromHours(snapshot, forecastHorizonHours(days), baselineCm);
}

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
 * Day 1 = restante de hoje; day 7 = hoje até o 7º dia.
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

/** Clock in São Paulo for Open-Meteo step 1 = current hour. */
export function forecastHourClock(step: number, from = new Date()): string {
  const hour = (saoPauloHour(from) + Math.max(0, Math.round(step) - 1)) % 24;
  return `${String(hour).padStart(2, "0")}h`;
}

/** Buffer ao longo do talvegue (legado/debug): largura ≈ ΔH × ocupação do trecho. */
export function buildFloodGeoJSON(
  stageRiseMValue: number,
  hour: number,
  uniform = false,
): FeatureCollection {
  const features: Feature[] = [];
  for (const branch of riverBranches()) {
    const line = branch.coordinates;
    const lags = branch.lags;
    for (let i = 0; i < line.length - 1; i += 1) {
      const lag = lags[i] ?? 0;
      const depth = uniform
        ? stageRiseMValue
        : stageRiseMValue * riverArrival(hour, lag);
      if (depth < 0.04) continue;
      const half = 0.00028 + Math.min(depth, 6) * 0.00115;
      const depthBand = depth < 0.3 ? "wade" : depth < 1 ? "stall" : "evacuate";
      features.push({
        type: "Feature",
        properties: {
          depth_m: round2(depth),
          depth_band: depthBand,
          lag_h: lag,
          river: branch.name,
        },
        geometry: { type: "Polygon", coordinates: [offsetPolygon(line[i], line[i + 1], half)] },
      });
    }
  }
  return { type: "FeatureCollection", features };
}

export function riverLineGeoJSON(): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: riverBranches().map((branch) => ({
      type: "Feature" as const,
      properties: { name: branch.name, id: branch.id },
      geometry: { type: "LineString" as const, coordinates: branch.coordinates },
    })),
  };
}

export function cityPointsGeoJSON(): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: getRegion().cities.map((c) => ({
      type: "Feature",
      properties: { name: c.name, lag_h: c.lag_to_target_h, role: c.role },
      geometry: { type: "Point", coordinates: [c.lon, c.lat] },
    })),
  };
}
