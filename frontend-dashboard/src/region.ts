/** Region packs: one JSON per basin, loaded at runtime. */

export type CalibrationStatus = "calibrated" | "provisional";

export type RegionCity = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  zoom: number;
  role: string;
  lag_to_target_h: number;
  blurb: string;
  /** Street-flood staff (m above in-bank) for this municipality. Falls back to pack hydro. */
  spill_stage_m?: number;
  spill_stage_min_m?: number;
  spill_stage_max_m?: number;
  spill_stage_step_m?: number;
  spill_stage_stops_m?: number[];
  normal_stage_cm?: number;
  spill_note?: string;
};

export type CityStaff = {
  city_id: string;
  city_name: string;
  spill_stage_m: number;
  spill_stage_min_m: number;
  spill_stage_max_m: number;
  spill_stage_step_m: number;
  spill_stage_stops_m: number[];
  normal_stage_cm: number;
  spill_note: string;
};

export type RegionGauge = {
  id: string;
  name: string;
  code: string;
  tracks?: string;
};

export type RegionPack = {
  schema: number;
  id: string;
  title: string;
  subtitle: string;
  river_name: string;
  target_city_id: string;
  surge_city_id: string;
  live_gauge_id: string;
  calibration: {
    status: CalibrationStatus;
    benchmark_events: string[];
    note: string;
  };
  region: {
    name: string;
    valley: string;
    crs: string;
    bbox: { south: number; west: number; north: number; east: number };
    center: { lat: number; lon: number };
    default_zoom: number;
  };
  cities: RegionCity[];
  river_thalweg: [number, number][];
  reach_lags_h: number[];
  gauges: { provider: string; endpoint: string; stations: RegionGauge[] };
  hydro: {
    rain_runoff_coeff: number;
    valley_width_factor: number;
    overbank_drain_h: number;
    rain_storage_halflife_h: number;
    normal_stage_cm: number;
    spill_stage_m: number;
    spill_stage_min_m: number;
    spill_stage_max_m: number;
    spill_stage_step_m: number;
    spill_stage_stops_m: number[];
    regua_max_m: number;
    upstream_city_ids: string[];
  };
  copy: {
    cities_tip: string;
    reset_tip: string;
    spill_note: string;
    target_short: string;
    live_fallback: string;
    region_blurb: string;
  };
};

export type RegionIndexEntry = {
  id: string;
  name: string;
  state?: string;
  target?: string;
};

export type RegionCatalog = {
  default_region: string;
  regions: RegionIndexEntry[];
};

const STORAGE_KEY = "valealerta-region-id";

let active: RegionPack | null = null;

export function getRegion(): RegionPack {
  if (!active) {
    throw new Error("Pacote de região ainda não foi carregado.");
  }
  return active;
}

export function tryGetRegion(): RegionPack | null {
  return active;
}

export function setActiveRegion(pack: RegionPack): void {
  active = pack;
}

export function readStoredRegionId(): string | null {
  try {
    const id = localStorage.getItem(STORAGE_KEY);
    return id && id.trim() ? id.trim() : null;
  } catch {
    return null;
  }
}

export function storeRegionId(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* ignore quota */
  }
}

export function surgeLagH(pack: RegionPack = getRegion()): number {
  const city = pack.cities.find((c) => c.id === pack.surge_city_id);
  return city?.lag_to_target_h ?? 4;
}

function finiteOr(value: number | undefined, fallback: number): number {
  return value != null && Number.isFinite(value) ? value : fallback;
}

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values.map((n) => Math.round(n * 100) / 100))].sort((a, b) => a - b);
}

function stopsAround(spill: number, min: number, max: number, step: number, extra: number[]): number[] {
  const out: number[] = [...extra];
  const s = Math.max(0.1, step);
  for (let v = min; v <= max + 1e-9; v += s) out.push(v);
  if (!out.some((n) => Math.abs(n - spill) < 1e-6)) out.push(spill);
  return uniqueSorted(out);
}

/** Régua / transbordo of a municipality; basin hydro is only the fallback. */
export function staffForCity(pack: RegionPack, cityId: string): CityStaff {
  const h = pack.hydro;
  const city = pack.cities.find((c) => c.id === cityId) ?? pack.cities.find((c) => c.id === pack.target_city_id);
  const spill = finiteOr(city?.spill_stage_m, h.spill_stage_m);
  const min = finiteOr(city?.spill_stage_min_m, Math.min(h.spill_stage_min_m, spill));
  const max = finiteOr(city?.spill_stage_max_m, Math.max(h.spill_stage_max_m, spill));
  const step = finiteOr(city?.spill_stage_step_m, h.spill_stage_step_m);
  const stops = city?.spill_stage_stops_m?.length
    ? uniqueSorted(city.spill_stage_stops_m)
    : stopsAround(spill, min, max, step, h.spill_stage_stops_m);
  return {
    city_id: city?.id ?? cityId,
    city_name: city?.name ?? cityId,
    spill_stage_m: spill,
    spill_stage_min_m: min,
    spill_stage_max_m: max,
    spill_stage_step_m: step,
    spill_stage_stops_m: stops,
    normal_stage_cm: finiteOr(city?.normal_stage_cm, h.normal_stage_cm),
    spill_note: city?.spill_note || pack.copy.spill_note,
  };
}

export function nearestCity(pack: RegionPack, lon: number, lat: number): RegionCity {
  let best = pack.cities[0];
  let bestD = Infinity;
  for (const city of pack.cities) {
    const d = Math.hypot(city.lon - lon, city.lat - lat);
    if (d < bestD) {
      bestD = d;
      best = city;
    }
  }
  return best;
}

function asCoord(pair: unknown): [number, number] | null {
  if (!Array.isArray(pair) || pair.length < 2) return null;
  const lon = Number(pair[0]);
  const lat = Number(pair[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return [lon, lat];
}

function asCity(raw: Record<string, unknown>): RegionCity | null {
  const id = String(raw.id ?? "");
  const name = String(raw.name ?? "");
  const lat = Number(raw.lat);
  const lon = Number(raw.lon);
  if (!id || !name || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const lag = Number(raw.lag_to_target_h ?? raw.lag_to_sjb_h ?? 0);
  const optNum = (key: string): number | undefined => {
    const n = Number(raw[key]);
    return Number.isFinite(n) ? n : undefined;
  };
  const stopsRaw = Array.isArray(raw.spill_stage_stops_m)
    ? raw.spill_stage_stops_m.map(Number).filter((n) => Number.isFinite(n))
    : undefined;
  return {
    id,
    name,
    lat,
    lon,
    zoom: Number.isFinite(Number(raw.zoom)) ? Number(raw.zoom) : 13,
    role: String(raw.role ?? ""),
    lag_to_target_h: Number.isFinite(lag) ? lag : 0,
    blurb: String(raw.blurb ?? ""),
    spill_stage_m: optNum("spill_stage_m"),
    spill_stage_min_m: optNum("spill_stage_min_m"),
    spill_stage_max_m: optNum("spill_stage_max_m"),
    spill_stage_step_m: optNum("spill_stage_step_m"),
    spill_stage_stops_m: stopsRaw?.length ? stopsRaw : undefined,
    normal_stage_cm: optNum("normal_stage_cm"),
    spill_note: typeof raw.spill_note === "string" ? raw.spill_note : undefined,
  };
}

export function parseRegionPack(body: unknown): RegionPack {
  if (!body || typeof body !== "object") throw new Error("Pacote de região inválido.");
  const raw = body as Record<string, unknown>;
  const citiesRaw = Array.isArray(raw.cities) ? raw.cities : [];
  const cities = citiesRaw
    .map((c) => (c && typeof c === "object" ? asCity(c as Record<string, unknown>) : null))
    .filter((c): c is RegionCity => c != null);
  if (cities.length < 2) throw new Error("O pacote precisa de pelo menos duas cidades.");

  const thalweg = (Array.isArray(raw.river_thalweg) ? raw.river_thalweg : [])
    .map(asCoord)
    .filter((c): c is [number, number] => c != null);
  if (thalweg.length < 2) throw new Error("O pacote precisa de um talvegue (river_thalweg).");

  const lags = (Array.isArray(raw.reach_lags_h) ? raw.reach_lags_h : [])
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n));
  if (!lags.length) throw new Error("O pacote precisa de reach_lags_h.");

  const hydroRaw = (raw.hydro && typeof raw.hydro === "object" ? raw.hydro : {}) as Record<
    string,
    unknown
  >;
  const gaugesRaw = (raw.gauges && typeof raw.gauges === "object" ? raw.gauges : {}) as Record<
    string,
    unknown
  >;
  const stations: RegionGauge[] = [];
  for (const s of Array.isArray(gaugesRaw.stations) ? gaugesRaw.stations : []) {
    if (!s || typeof s !== "object") continue;
    const g = s as Record<string, unknown>;
    const id = String(g.id ?? "");
    const code = String(g.code ?? "");
    if (!id || !code) continue;
    stations.push({
      id,
      name: String(g.name ?? id),
      code,
      tracks: typeof g.tracks === "string" ? g.tracks : undefined,
    });
  }

  const copyRaw = (raw.copy && typeof raw.copy === "object" ? raw.copy : {}) as Record<
    string,
    unknown
  >;
  const regionRaw = (raw.region && typeof raw.region === "object" ? raw.region : {}) as Record<
    string,
    unknown
  >;
  const bboxRaw = (regionRaw.bbox && typeof regionRaw.bbox === "object" ? regionRaw.bbox : {}) as Record<
    string,
    unknown
  >;
  const centerRaw = (regionRaw.center && typeof regionRaw.center === "object"
    ? regionRaw.center
    : {}) as Record<string, unknown>;
  const calRaw = (raw.calibration && typeof raw.calibration === "object"
    ? raw.calibration
    : {}) as Record<string, unknown>;

  const target = String(raw.target_city_id ?? cities.find((c) => c.role === "target")?.id ?? cities[0].id);
  const stops = (Array.isArray(hydroRaw.spill_stage_stops_m) ? hydroRaw.spill_stage_stops_m : [])
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n));
  const spill = Number(hydroRaw.spill_stage_m ?? hydroRaw.sjb_spill_stage_m ?? 6);
  const upstream = (Array.isArray(hydroRaw.upstream_city_ids)
    ? hydroRaw.upstream_city_ids
    : []
  ).map(String);

  const pack: RegionPack = {
    schema: Number(raw.schema ?? 1),
    id: String(raw.id ?? "region"),
    title: String(raw.title ?? "Vale Alerta para Enchentes"),
    subtitle: String(raw.subtitle ?? regionRaw.name ?? ""),
    river_name: String(raw.river_name ?? regionRaw.valley ?? "Rio"),
    target_city_id: target,
    surge_city_id: String(raw.surge_city_id ?? cities.find((c) => c.role === "surge_entry")?.id ?? cities[0].id),
    live_gauge_id: String(raw.live_gauge_id ?? target),
    calibration: {
      status: calRaw.status === "provisional" ? "provisional" : "calibrated",
      benchmark_events: Array.isArray(calRaw.benchmark_events)
        ? calRaw.benchmark_events.map(String)
        : [],
      note: String(calRaw.note ?? ""),
    },
    region: {
      name: String(regionRaw.name ?? ""),
      valley: String(regionRaw.valley ?? ""),
      crs: String(regionRaw.crs ?? "EPSG:4326"),
      bbox: {
        south: Number(bboxRaw.south),
        west: Number(bboxRaw.west),
        north: Number(bboxRaw.north),
        east: Number(bboxRaw.east),
      },
      center: {
        lat: Number(centerRaw.lat ?? cities.find((c) => c.id === target)?.lat ?? 0),
        lon: Number(centerRaw.lon ?? cities.find((c) => c.id === target)?.lon ?? 0),
      },
      default_zoom: Number(regionRaw.default_zoom ?? 13),
    },
    cities,
    river_thalweg: thalweg,
    reach_lags_h: lags,
    gauges: {
      provider: String(gaugesRaw.provider ?? "ANA HidroWeb"),
      endpoint: String(gaugesRaw.endpoint ?? ""),
      stations,
    },
    hydro: {
      rain_runoff_coeff: Number(hydroRaw.rain_runoff_coeff ?? 0.05),
      valley_width_factor: Number(hydroRaw.valley_width_factor ?? 250),
      overbank_drain_h: Number(hydroRaw.overbank_drain_h ?? 12),
      rain_storage_halflife_h: Number(hydroRaw.rain_storage_halflife_h ?? 12),
      normal_stage_cm: Number(hydroRaw.normal_stage_cm ?? 30),
      spill_stage_m: spill,
      spill_stage_min_m: Number(hydroRaw.spill_stage_min_m ?? spill),
      spill_stage_max_m: Number(hydroRaw.spill_stage_max_m ?? spill + 2),
      spill_stage_step_m: Number(hydroRaw.spill_stage_step_m ?? 0.5),
      spill_stage_stops_m: stops.length ? stops : [spill],
      regua_max_m: Number(hydroRaw.regua_max_m ?? 20),
      upstream_city_ids: upstream.length
        ? upstream
        : cities.filter((c) => c.lag_to_target_h > 0).map((c) => c.id),
    },
    copy: {
      cities_tip: String(copyRaw.cities_tip ?? "Cidades do vale. Ao escolher, o mapa recarrega relevo e heatmap."),
      reset_tip: String(copyRaw.reset_tip ?? "Volta a régua ao nível natural e zera a chuva simulada."),
      spill_note: String(copyRaw.spill_note ?? ""),
      target_short: String(copyRaw.target_short ?? cities.find((c) => c.id === target)?.name ?? "alvo"),
      live_fallback: String(copyRaw.live_fallback ?? "sem telemetria — usando baseline do município-alvo"),
      region_blurb: String(copyRaw.region_blurb ?? ""),
    },
  };
  return pack;
}

export async function loadRegionCatalog(signal?: AbortSignal): Promise<RegionCatalog> {
  const res = await fetch("/regions/index.json", { signal });
  if (!res.ok) throw new Error(`Catálogo de regiões ${res.status}`);
  const body = (await res.json()) as RegionCatalog;
  return {
    default_region: body.default_region || "tijucas",
    regions: Array.isArray(body.regions) ? body.regions : [],
  };
}

export async function loadRegionPack(id: string, signal?: AbortSignal): Promise<RegionPack> {
  const res = await fetch(`/regions/${encodeURIComponent(id)}.json`, { signal });
  if (!res.ok) throw new Error(`Pacote ${id}: ${res.status}`);
  return parseRegionPack(await res.json());
}

export async function bootstrapRegion(signal?: AbortSignal): Promise<{
  catalog: RegionCatalog;
  pack: RegionPack;
}> {
  const catalog = await loadRegionCatalog(signal);
  const wanted = readStoredRegionId() || catalog.default_region;
  const known = catalog.regions.some((r) => r.id === wanted);
  const id = known ? wanted : catalog.default_region;
  const pack = await loadRegionPack(id, signal);
  setActiveRegion(pack);
  storeRegionId(pack.id);
  return { catalog, pack };
}
