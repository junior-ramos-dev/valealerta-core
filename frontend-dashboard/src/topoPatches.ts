/** Local DEM corrections (aterro, corte) applied on top of Copernicus GLO-30. */

import type { Feature, FeatureCollection, Polygon } from "geojson";
import type { LonLatBBox } from "./copernicusDem";

export type DemPatchStatus = "active" | "absorbed" | "review";

export type TopoPatchProps = {
  id: string;
  delta_m: number;
  name?: string;
  source?: string;
  created_at?: string;
  origin?: "bundled" | "local";
  /** Mean Copernicus z inside the polygon when the patch was recorded (unpatched DEM). */
  baseline_z_m?: number;
  last_dem_z_m?: number;
  dem_status?: DemPatchStatus;
  /** Keep summing Δz even if the DEM looks like it already includes the work. */
  force_active?: boolean;
};

export type PatchDemCheck = {
  id: string;
  baseline_z_m: number;
  last_dem_z_m: number;
  dem_status: DemPatchStatus;
};

export type TopoPatchFeature = Feature<Polygon, TopoPatchProps>;

const STORAGE_KEY = "valealerta-topo-patches";
const DELETED_KEY = "valealerta-topo-patches-deleted";
export const BUNDLED_PATCHES_URL = "/topo_patches.geojson";

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
      origin: props.origin === "local" ? "local" : "bundled",
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

export function loadLocalPatches(): TopoPatchFeature[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return parsePatchCollection(JSON.parse(raw)).map((f) => ({
      ...f,
      properties: { ...f.properties, origin: "local" },
    }));
  } catch {
    return [];
  }
}

export function saveLocalPatches(features: TopoPatchFeature[]): void {
  const local = features.filter((f) => f.properties.origin === "local");
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      type: "FeatureCollection",
      features: local,
    } satisfies FeatureCollection<Polygon, TopoPatchProps>),
  );
}

export async function loadBundledPatches(signal?: AbortSignal): Promise<TopoPatchFeature[]> {
  try {
    const res = await fetch(BUNDLED_PATCHES_URL, { signal });
    if (!res.ok) return [];
    return parsePatchCollection(await res.json()).map((f) => ({
      ...f,
      properties: { ...f.properties, origin: "bundled" as const },
    }));
  } catch {
    return [];
  }
}

export function loadDeletedPatchIds(): string[] {
  try {
    const raw = localStorage.getItem(DELETED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function saveDeletedPatchIds(ids: string[]): void {
  localStorage.setItem(DELETED_KEY, JSON.stringify([...new Set(ids)]));
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

export function makeLocalPatch(
  points: [number, number][],
  deltaM: number,
  name: string,
  existingId?: string,
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

export function downloadPatchesGeoJSON(features: TopoPatchFeature[]): void {
  const blob = new Blob([JSON.stringify(patchesToCollection(features), null, 2)], {
    type: "application/geo+json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "topo_patches.geojson";
  a.click();
  URL.revokeObjectURL(url);
}
