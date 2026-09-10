/**
 * Correções locais do DEM (aterro, corte) sobre o Copernicus GLO-30.
 * z_usado = z_GLO-30 + Δz só onde o polígono cobre a célula e o patch não foi absorvido.
 */

import type { Feature, FeatureCollection, Polygon } from "geojson";
import type { LonLatBBox } from "./copernicusDem";

export type DemPatchStatus = "active" | "absorbed" | "review";

export type TopoPatchProps = {
  id: string;
  delta_m: number;
  name?: string;
  source?: string;
  created_at?: string;
  origin?: "bundled" | "local" | "remote";
  created_by?: string;
  created_by_id?: string;
  validated_at?: string;
  consensus?: boolean;
  display_kind?: "solo" | "agree" | "diverge";
  report_count?: number;
  delta_spread_m?: number;
  authors?: string;
  /** Mean Copernicus z inside the polygon when the patch was recorded (unpatched DEM). */
  baseline_z_m?: number;
  last_dem_z_m?: number;
  dem_status?: DemPatchStatus;
  /** Keep summing Δz even if the DEM looks like it already includes the work. */
  force_active?: boolean;
  area_m2?: number;
  centroid?: [number, number];
  bbox?: [number, number, number, number];
};

export type PatchDemCheck = {
  id: string;
  baseline_z_m: number;
  last_dem_z_m: number;
  dem_status: DemPatchStatus;
};

export type TopoPatchFeature = Feature<Polygon, TopoPatchProps>;

const LEGACY_STORAGE_KEY = "valealerta-topo-patches";
const LEGACY_DELETED_KEY = "valealerta-topo-patches-deleted";

export function patchesStorageKey(regionId: string): string {
  return `valealerta-topo-patches:${regionId}`;
}

export function patchesDeletedKey(regionId: string): string {
  return `valealerta-topo-patches-deleted:${regionId}`;
}

export function bundledPatchesUrl(regionId: string): string {
  return `/regions/${encodeURIComponent(regionId)}.patches.geojson`;
}

export function emptyPatchCollection(): FeatureCollection<Polygon, TopoPatchProps> {
  return { type: "FeatureCollection", features: [] };
}

function asPolygonFeature(raw: Feature): TopoPatchFeature | null {
  if (raw.geometry?.type !== "Polygon") return null;
  const ring = raw.geometry.coordinates[0];
  if (!ring || ring.length < 4) return null;
  const props = (raw.properties ?? {}) as Record<string, unknown>;
  const delta = Number(props.delta_m);
  if (!Number.isFinite(delta) || delta === 0) return null;
  const id =
    typeof props.id === "string" && props.id
      ? props.id
      : typeof raw.id === "string"
        ? raw.id
        : crypto.randomUUID();
  return {
    type: "Feature",
    id,
    properties: {
      id,
      delta_m: delta,
      name: typeof props.name === "string" ? props.name : undefined,
      source: typeof props.source === "string" ? props.source : undefined,
      created_at: typeof props.created_at === "string" ? props.created_at : undefined,
      origin:
        props.origin === "local"
          ? "local"
          : props.origin === "remote"
            ? "remote"
            : "bundled",
      created_by: typeof props.created_by === "string" ? props.created_by : undefined,
      created_by_id:
        typeof props.created_by_id === "string" ? props.created_by_id : undefined,
      baseline_z_m: Number.isFinite(Number(props.baseline_z_m))
        ? Number(props.baseline_z_m)
        : undefined,
      last_dem_z_m: Number.isFinite(Number(props.last_dem_z_m))
        ? Number(props.last_dem_z_m)
        : undefined,
      dem_status:
        props.dem_status === "absorbed" || props.dem_status === "review"
          ? props.dem_status
          : props.dem_status === "active"
            ? "active"
            : undefined,
      force_active: props.force_active === true,
    },
    geometry: raw.geometry,
  };
}

export function parsePatchCollection(body: unknown): TopoPatchFeature[] {
  if (!body || typeof body !== "object") return [];
  const fc = body as FeatureCollection;
  if (fc.type !== "FeatureCollection" || !Array.isArray(fc.features)) return [];
  return fc.features
    .map((f) => asPolygonFeature(f as Feature))
    .filter((f): f is TopoPatchFeature => f != null);
}

function readPatchList(key: string): TopoPatchFeature[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    return parsePatchCollection(JSON.parse(raw)).map((f) => ({
      ...f,
      properties: { ...f.properties, origin: "local" as const },
    }));
  } catch {
    return [];
  }
}

export function loadLocalPatches(regionId = "tijucas"): TopoPatchFeature[] {
  const scoped = readPatchList(patchesStorageKey(regionId));
  if (scoped.length || regionId !== "tijucas") return scoped;
  return readPatchList(LEGACY_STORAGE_KEY);
}

export function saveLocalPatches(features: TopoPatchFeature[], regionId = "tijucas"): void {
  const local = features.filter(
    (f) => f.properties.origin === "local" && !f.properties.consensus,
  );
  localStorage.setItem(
    patchesStorageKey(regionId),
    JSON.stringify({
      type: "FeatureCollection",
      features: local,
    } satisfies FeatureCollection<Polygon, TopoPatchProps>),
  );
}

export async function loadBundledPatches(
  signal?: AbortSignal,
  regionId = "tijucas",
): Promise<TopoPatchFeature[]> {
  try {
    const res = await fetch(bundledPatchesUrl(regionId), { signal });
    if (!res.ok) return [];
    return parsePatchCollection(await res.json()).map((f) => ({
      ...f,
      properties: { ...f.properties, origin: "bundled" as const },
    }));
  } catch {
    return [];
  }
}

function readDeleted(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function loadDeletedPatchIds(regionId = "tijucas"): string[] {
  const scoped = readDeleted(patchesDeletedKey(regionId));
  if (scoped.length || regionId !== "tijucas") return scoped;
  return readDeleted(LEGACY_DELETED_KEY);
}

export function saveDeletedPatchIds(ids: string[], regionId = "tijucas"): void {
  localStorage.setItem(patchesDeletedKey(regionId), JSON.stringify([...new Set(ids)]));
}

export function mergePatches(
  bundled: TopoPatchFeature[],
  local: TopoPatchFeature[],
  deletedIds: string[] = [],
): TopoPatchFeature[] {
  const hidden = new Set(deletedIds);
  const byId = new Map<string, TopoPatchFeature>();
  for (const f of bundled) {
    if (!hidden.has(f.properties.id)) byId.set(f.properties.id, f);
  }
  for (const f of local) {
    if (!hidden.has(f.properties.id)) byId.set(f.properties.id, f);
  }
  return [...byId.values()];
}

export function drawPointsFromPatch(feature: TopoPatchFeature): [number, number][] {
  const ring = feature.geometry.coordinates[0] ?? [];
  const pts = ring.map((c) => [c[0], c[1]] as [number, number]);
  if (pts.length >= 2) {
    const a = pts[0];
    const b = pts[pts.length - 1];
    if (a[0] === b[0] && a[1] === b[1]) pts.pop();
  }
  return pts;
}

export function closeRing(points: [number, number][]): [number, number][] {
  if (points.length < 3) return points;
  const first = points[0];
  const last = points[points.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return points;
  return [...points, [first[0], first[1]]];
}

/** Área plana no elipsoide local (shoelace em metros). */
export function polygonAreaM2(points: [number, number][]): number {
  const ring = closeRing(points);
  if (ring.length < 4) return 0;
  let lat0 = 0;
  for (let i = 0; i < ring.length - 1; i += 1) lat0 += ring[i][1];
  lat0 /= ring.length - 1;
  const mLat = 110_574;
  const mLon = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const x1 = ring[i][0] * mLon;
    const y1 = ring[i][1] * mLat;
    const x2 = ring[i + 1][0] * mLon;
    const y2 = ring[i + 1][1] * mLat;
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

export function patchAreaM2(feature: TopoPatchFeature): number {
  const ring = feature.geometry.coordinates[0];
  if (!ring?.length) return 0;
  return polygonAreaM2(ring.map((c) => [c[0], c[1]] as [number, number]));
}

const FIFA_FIELD_M2 = 105 * 68;

export function formatAreaM2(m2: number): string {
  if (!Number.isFinite(m2) || m2 <= 0) return "—";
  const m2Label = `${Math.round(m2).toLocaleString("pt-BR")} m²`;
  const campos = m2 / FIFA_FIELD_M2;
  const camposLabel = `${campos.toLocaleString("pt-BR", {
    maximumFractionDigits: 1,
  })} campo${campos >= 1.05 ? "s" : ""} de futebol em área`;
  return `${m2Label} · ≈ ${camposLabel}`;
}

export function makeLocalPatch(
  points: [number, number][],
  deltaM: number,
  name: string,
  existingId?: string,
  createdBy?: string,
): TopoPatchFeature | null {
  const ring = closeRing(points);
  if (ring.length < 4 || !Number.isFinite(deltaM) || deltaM === 0) return null;
  const id = existingId || crypto.randomUUID();
  return {
    type: "Feature",
    id,
    properties: {
      id,
      delta_m: deltaM,
      name: name.trim() || `Aterro ${deltaM > 0 ? "+" : ""}${deltaM.toFixed(1)} m`,
      source: "usuario",
      created_at: new Date().toISOString(),
      origin: "local",
      created_by: createdBy?.trim() || undefined,
    },
    geometry: { type: "Polygon", coordinates: [ring] },
  };
}

function pointInRing(lon: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-18) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function elevationDeltaM(lon: number, lat: number, patches: TopoPatchFeature[]): number {
  // Soma Δz de todos os polígonos que cobrem o ponto (aterros sobrepostos).
  let delta = 0;
  for (const feature of patches) {
    const ring = feature.geometry.coordinates[0];
    if (ring && pointInRing(lon, lat, ring)) delta += feature.properties.delta_m;
  }
  return delta;
}

function ringBBox(ring: number[][]): LonLatBBox | null {
  if (!ring.length) return null;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [x, y] of ring) {
    if (x < west) west = x;
    if (x > east) east = x;
    if (y < south) south = y;
    if (y > north) north = y;
  }
  if (!Number.isFinite(west)) return null;
  return { west, south, east, north };
}

function uniqueRing(ring: number[][]): number[][] {
  if (ring.length < 2) return ring;
  const a = ring[0];
  const b = ring[ring.length - 1];
  if (a[0] === b[0] && a[1] === b[1]) return ring.slice(0, -1);
  return ring;
}

export function ringCentroidLonLat(ring: number[][]): [number, number] | null {
  const pts = uniqueRing(ring);
  if (pts.length < 3) return null;
  const mLat = 110_574;
  const mLon = 111_320 * Math.cos((pts[0][1] * Math.PI) / 180);
  let sum = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const j = (i + 1) % pts.length;
    const x1 = (pts[i][0] - pts[0][0]) * mLon;
    const y1 = (pts[i][1] - pts[0][1]) * mLat;
    const x2 = (pts[j][0] - pts[0][0]) * mLon;
    const y2 = (pts[j][1] - pts[0][1]) * mLat;
    const cross = x1 * y2 - x2 * y1;
    sum += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  if (Math.abs(sum) < 1e-9) {
    const lon = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const lat = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    return [lon, lat];
  }
  cx /= 3 * sum;
  cy /= 3 * sum;
  return [pts[0][0] + cx / mLon, pts[0][1] + cy / mLat];
}

/** Fração da união coberta pelos dois polígonos (1 = idênticos, 0 = sem sobreposição). */
export function polygonIou(ringA: number[][], ringB: number[][]): number {
  const ba = ringBBox(ringA);
  const bb = ringBBox(ringB);
  if (!ba || !bb) return 0;
  const west = Math.min(ba.west, bb.west);
  const south = Math.min(ba.south, bb.south);
  const east = Math.max(ba.east, bb.east);
  const north = Math.max(ba.north, bb.north);
  const latMid = (south + north) / 2;
  const mLat = 110_574;
  const mLon = 111_320 * Math.max(0.2, Math.cos((latMid * Math.PI) / 180));
  const spanM = Math.max((east - west) * mLon, (north - south) * mLat, 1);
  const stepM = Math.max(8, Math.min(25, spanM / 60));
  const dLon = stepM / mLon;
  const dLat = stepM / mLat;
  let inter = 0;
  let union = 0;
  for (let lat = south + dLat / 2; lat < north; lat += dLat) {
    for (let lon = west + dLon / 2; lon < east; lon += dLon) {
      const a = pointInRing(lon, lat, ringA);
      const b = pointInRing(lon, lat, ringB);
      if (a || b) union += 1;
      if (a && b) inter += 1;
    }
  }
  return union ? inter / union : 0;
}

export type PatchMatchVerdict = "same" | "review" | "different";

export type PatchMatch = {
  aName: string;
  bName: string;
  iou: number;
  areaA: number;
  areaB: number;
  deltaA: number;
  deltaB: number;
  verdict: PatchMatchVerdict;
};

function patchLabel(f: TopoPatchFeature): string {
  return f.properties.name ?? f.properties.id.slice(0, 8);
}

function iouVerdict(iou: number): PatchMatchVerdict {
  if (iou >= 0.75) return "same";
  if (iou >= 0.45) return "review";
  return "different";
}

/** Emparelha polígonos de dois arquivos pela sobreposição, não pelo UUID. */
export function matchPatchCollections(
  fileA: TopoPatchFeature[],
  fileB: TopoPatchFeature[],
): { matches: PatchMatch[]; unmatchedA: string[]; unmatchedB: string[] } {
  const usedB = new Set<number>();
  const matches: PatchMatch[] = [];
  const unmatchedA: string[] = [];
  for (const a of fileA) {
    const ringA = a.geometry.coordinates[0] ?? [];
    let best = -1;
    let bestIou = 0;
    for (let i = 0; i < fileB.length; i += 1) {
      if (usedB.has(i)) continue;
      const iou = polygonIou(ringA, fileB[i].geometry.coordinates[0] ?? []);
      if (iou > bestIou) {
        bestIou = iou;
        best = i;
      }
    }
    if (best < 0 || bestIou < 0.15) {
      unmatchedA.push(patchLabel(a));
      continue;
    }
    usedB.add(best);
    const b = fileB[best];
    matches.push({
      aName: patchLabel(a),
      bName: patchLabel(b),
      iou: bestIou,
      areaA: patchAreaM2(a),
      areaB: patchAreaM2(b),
      deltaA: a.properties.delta_m,
      deltaB: b.properties.delta_m,
      verdict: iouVerdict(bestIou),
    });
  }
  const unmatchedB = fileB.filter((_, i) => !usedB.has(i)).map(patchLabel);
  return { matches, unmatchedA, unmatchedB };
}

export function formatPatchMatch(m: PatchMatch): string {
  const pct = Math.round(m.iou * 100);
  const sameDelta = Math.abs(m.deltaA - m.deltaB) < 0.15;
  const head =
    m.verdict === "same"
      ? `Mesma área (${pct}% de sobreposição)`
      : m.verdict === "review"
        ? `Conferir (${pct}% de sobreposição)`
        : `Áreas distintas (${pct}% de sobreposição)`;
  const dz = sameDelta
    ? `Δz iguais (${m.deltaA > 0 ? "+" : ""}${m.deltaA.toFixed(1)} m)`
    : `Δz diferentes (${m.deltaA > 0 ? "+" : ""}${m.deltaA.toFixed(1)} m vs ${m.deltaB > 0 ? "+" : ""}${m.deltaB.toFixed(1)} m)`;
  return `${head}: «${m.aName}» ↔ «${m.bName}». ${dz}. Área ${formatAreaM2(m.areaA)} vs ${formatAreaM2(m.areaB)}.`;
}

export const SITE_IOU = 0.45;
export const DELTA_DIVERGE_M = 1;

export function clusterPatchReports(
  features: TopoPatchFeature[],
): TopoPatchFeature[][] {
  const n = features.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => {
    let x = i;
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const unite = (a: number, b: number) => {
    const pa = find(a);
    const pb = find(b);
    if (pa !== pb) parent[pa] = pb;
  };
  for (let i = 0; i < n; i += 1) {
    const ringA = features[i].geometry.coordinates[0] ?? [];
    for (let j = i + 1; j < n; j += 1) {
      if (polygonIou(ringA, features[j].geometry.coordinates[0] ?? []) >= SITE_IOU) {
        unite(i, j);
      }
    }
  }
  const groups = new Map<number, TopoPatchFeature[]>();
  for (let i = 0; i < n; i += 1) {
    const root = find(i);
    const list = groups.get(root) ?? [];
    list.push(features[i]);
    groups.set(root, list);
  }
  return [...groups.values()];
}

export function consensusFromCluster(
  cluster: TopoPatchFeature[],
): TopoPatchFeature {
  const n = cluster.length;
  if (n <= 1) {
    const f = cluster[0];
    return {
      ...f,
      properties: {
        ...f.properties,
        consensus: false,
        display_kind: "solo",
        report_count: 1,
        delta_spread_m: 0,
      },
    };
  }
  const mean =
    cluster.reduce((s, f) => s + f.properties.delta_m, 0) / Math.max(n, 1);
  const deltas = cluster.map((f) => f.properties.delta_m);
  const spread = Math.max(...deltas) - Math.min(...deltas);
  const representative = cluster.reduce((best, f) =>
    Math.abs(f.properties.delta_m - mean) < Math.abs(best.properties.delta_m - mean)
      ? f
      : best,
  );
  const authors = [
    ...new Set(
      cluster
        .map((f) => f.properties.created_by?.trim())
        .filter((x): x is string => Boolean(x)),
    ),
  ];
  const display_kind: TopoPatchProps["display_kind"] =
    spread >= DELTA_DIVERGE_M ? "diverge" : "agree";
  const delta = Math.round(mean * 10) / 10;
  return {
    ...representative,
    id: `valealerta-consensus-${cluster.map((f) => f.properties.id).sort().join("-")}`,
    properties: {
      ...representative.properties,
      id: `valealerta-consensus-${cluster.map((f) => f.properties.id).sort().join("-")}`,
      delta_m: delta,
      name: `Consenso (${n} relatos, Δz ${delta > 0 ? "+" : ""}${delta.toFixed(1)} m)`,
      consensus: true,
      display_kind,
      report_count: n,
      delta_spread_m: Math.round(spread * 10) / 10,
      authors: authors.join(", ") || undefined,
    },
  };
}

export type PatchMapView = "mine" | "all";

export function patchesForMapView(
  all: TopoPatchFeature[],
  view: PatchMapView,
  username: string | null,
  userId: string | null = null,
): TopoPatchFeature[] {
  const bundled = all.filter((p) => p.properties.origin === "bundled");
  const reports = all.filter(
    (p) =>
      (p.properties.origin === "local" || p.properties.origin === "remote") &&
      !p.properties.consensus,
  );
  if (view === "mine") {
    const mine = reports.filter((p) => {
      if (userId && p.properties.created_by_id) {
        return p.properties.created_by_id === userId;
      }
      if (username && p.properties.created_by) {
        return p.properties.created_by === username;
      }
      return !p.properties.created_by && !p.properties.created_by_id;
    });
    return [
      ...bundled,
      ...mine.map((p) => ({
        ...p,
        properties: { ...p.properties, display_kind: "solo" as const },
      })),
    ];
  }
  return [...bundled, ...clusterPatchReports(reports).map(consensusFromCluster)];
}

/** Stable key so DEM reloads only when geometry or Δz actually change. */
export function patchesContentKey(features: TopoPatchFeature[]): string {
  return features
    .map(
      (f) =>
        `${f.properties.id}:${f.properties.delta_m}:${f.properties.force_active ? 1 : 0}:${JSON.stringify(f.geometry.coordinates)}`,
    )
    .sort()
    .join("|");
}

/** GLO-30 vertical noise is often 2–4 m; require a clear shift toward Δz. */
export function demAbsorbToleranceM(deltaM: number): number {
  return Math.max(1.2, 0.35 * Math.abs(deltaM));
}

/** Média do GLO-30 cru dentro do polígono — baseline para saber se o DEM já “comeu” o aterro. */
export function meanElevationInPatch(
  elevations: Float32Array,
  width: number,
  height: number,
  bbox: LonLatBBox,
  feature: TopoPatchFeature,
): number | null {
  const ring = feature.geometry.coordinates[0];
  const pb = ring ? ringBBox(ring) : null;
  const lonSpan = bbox.east - bbox.west;
  const latSpan = bbox.north - bbox.south;
  if (!ring || !pb || lonSpan <= 0 || latSpan <= 0) return null;
  const x0 = Math.max(0, Math.floor(((pb.west - bbox.west) / lonSpan) * width) - 1);
  const x1 = Math.min(width - 1, Math.ceil(((pb.east - bbox.west) / lonSpan) * width) + 1);
  const y0 = Math.max(0, Math.floor(((bbox.north - pb.north) / latSpan) * height) - 1);
  const y1 = Math.min(height - 1, Math.ceil(((bbox.north - pb.south) / latSpan) * height) + 1);
  if (x0 > x1 || y0 > y1) return null;
  let sum = 0;
  let n = 0;
  for (let y = y0; y <= y1; y += 1) {
    const lat = bbox.north - ((y + 0.5) / height) * latSpan;
    for (let x = x0; x <= x1; x += 1) {
      const lon = bbox.west + ((x + 0.5) / width) * lonSpan;
      if (!pointInRing(lon, lat, ring)) continue;
      const z = elevations[y * width + x];
      if (!Number.isFinite(z) || z < -1000 || z > 9000) continue;
      sum += z;
      n += 1;
    }
  }
  return n > 0 ? sum / n : null;
}

/**
 * Compara z atual vs z gravado na criação.
 * Absorvido: o DEM subiu ~Δz (não somar de novo). Review: o terreno mudou de outro jeito.
 */
export function assessPatchAgainstDem(
  feature: TopoPatchFeature,
  currentZ: number,
): PatchDemCheck {
  const delta = feature.properties.delta_m;
  const baseline = feature.properties.baseline_z_m ?? currentZ;
  const tol = demAbsorbToleranceM(delta);
  const moved = currentZ - baseline;
  let dem_status: DemPatchStatus = "active";
  if (!feature.properties.force_active) {
    if (Math.abs(moved - delta) <= tol && Math.abs(moved) > tol) {
      dem_status = "absorbed";
    } else if (Math.abs(moved) > tol) {
      dem_status = "review";
    }
  }
  return {
    id: feature.properties.id,
    baseline_z_m: baseline,
    last_dem_z_m: currentZ,
    dem_status,
  };
}

/** Patches ainda ativos: absorvidos saem; force_active ignora o GLO-30. */
export function patchesToApply(
  patches: TopoPatchFeature[],
  checks: PatchDemCheck[] = [],
): TopoPatchFeature[] {
  const byId = new Map(checks.map((c) => [c.id, c]));
  return patches.filter((p) => {
    if (p.properties.force_active) return true;
    const status = byId.get(p.properties.id)?.dem_status ?? p.properties.dem_status;
    return status !== "absorbed";
  });
}

export function mergePatchChecks(
  patches: TopoPatchFeature[],
  checks: PatchDemCheck[],
): TopoPatchFeature[] {
  if (!checks.length) return patches;
  const byId = new Map(checks.map((c) => [c.id, c]));
  let changed = false;
  const next = patches.map((p) => {
    const c = byId.get(p.properties.id);
    if (!c) return p;
    if (
      p.properties.baseline_z_m === c.baseline_z_m &&
      p.properties.last_dem_z_m === c.last_dem_z_m &&
      p.properties.dem_status === c.dem_status
    ) {
      return p;
    }
    changed = true;
    return {
      ...p,
      properties: {
        ...p.properties,
        baseline_z_m: c.baseline_z_m,
        last_dem_z_m: c.last_dem_z_m,
        dem_status: c.dem_status,
      },
    };
  });
  return changed ? next : patches;
}

export function applyPatchesToElevations(
  elevations: Float32Array,
  width: number,
  height: number,
  bbox: LonLatBBox,
  patches: TopoPatchFeature[],
): number {
  // z_usado = z_Copernicus + Δz só nas células cujo centro cai no polígono.
  if (!patches.length) return 0;
  const lonSpan = bbox.east - bbox.west;
  const latSpan = bbox.north - bbox.south;
  if (lonSpan <= 0 || latSpan <= 0) return 0;
  let touched = 0;
  for (const feature of patches) {
    const ring = feature.geometry.coordinates[0];
    const delta = feature.properties.delta_m;
    const pb = ring ? ringBBox(ring) : null;
    if (!ring || !pb || !Number.isFinite(delta) || delta === 0) continue;
    const x0 = Math.max(
      0,
      Math.floor(((pb.west - bbox.west) / lonSpan) * width) - 1,
    );
    const x1 = Math.min(
      width - 1,
      Math.ceil(((pb.east - bbox.west) / lonSpan) * width) + 1,
    );
    const y0 = Math.max(
      0,
      Math.floor(((bbox.north - pb.north) / latSpan) * height) - 1,
    );
    const y1 = Math.min(
      height - 1,
      Math.ceil(((bbox.north - pb.south) / latSpan) * height) + 1,
    );
    if (x0 > x1 || y0 > y1) continue;
    for (let y = y0; y <= y1; y += 1) {
      const lat = bbox.north - ((y + 0.5) / height) * latSpan;
      for (let x = x0; x <= x1; x += 1) {
        const lon = bbox.west + ((x + 0.5) / width) * lonSpan;
        if (!pointInRing(lon, lat, ring)) continue;
        const i = y * width + x;
        const z = elevations[i];
        if (!Number.isFinite(z) || z < -1000 || z > 9000) continue;
        elevations[i] = z + delta;
        touched += 1;
      }
    }
  }
  return touched;
}

export function patchesToCollection(features: TopoPatchFeature[]): FeatureCollection<Polygon, TopoPatchProps> {
  return { type: "FeatureCollection", features };
}

export function featureForExport(feature: TopoPatchFeature): TopoPatchFeature {
  const ring = feature.geometry.coordinates[0] ?? [];
  const bbox = ringBBox(ring);
  const centroid = ringCentroidLonLat(ring);
  return {
    ...feature,
    properties: {
      ...feature.properties,
      area_m2: Math.round(patchAreaM2(feature)),
      centroid: centroid ?? undefined,
      bbox: bbox
        ? [bbox.west, bbox.south, bbox.east, bbox.north]
        : undefined,
    },
  };
}

export function downloadPatchesGeoJSON(features: TopoPatchFeature[]): void {
  const body = {
    type: "FeatureCollection" as const,
    valealerta: {
      compare:
        "Não use o campo id (UUID). Duas marcações da mesma obra comparam-se por sobreposição dos polígonos (IoU) e pelo delta_m, não pelos vértices. area_m2 e centroid ajudam a conferir no mapa.",
    },
    features: features.map(featureForExport),
  };
  const blob = new Blob([JSON.stringify(body, null, 2)], {
    type: "application/geo+json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "topo_patches.geojson";
  a.click();
  URL.revokeObjectURL(url);
}
