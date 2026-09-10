/**
 * Heatmap de inundação no cliente.
 *
 * Profundidade = WSE − z_terreno. z_terreno pode incluir Δz de patches;
 * o talvegue (WSE) usa o GLO-30 cru para um aterro na margem não “subir o rio”.
 * (o canal no GLO-30 é raso): só a lâmina *acima do transbordo municipal*
 * (extraAboveSpillM) é espalhada a partir do talvegue.
 * A água só se propaga por células ligadas ao rio (flood-fill), não por lagos isolados.
 */
import { type LonLatBBox } from "./copernicusDem";
import { floodOccupancy, riverBranches } from "./hydro";

export const DEPTH_SCALE: { cm: number; color: string; rgba: [number, number, number, number] }[] = [
  { cm: 10, color: "#D6F6FF", rgba: [214, 246, 255, 120] },
  { cm: 25, color: "#7FDBFA", rgba: [127, 219, 250, 155] },
  { cm: 50, color: "#4EA8DE", rgba: [78, 168, 222, 175] },
  { cm: 75, color: "#2B6CB0", rgba: [43, 108, 176, 190] },
  { cm: 100, color: "#1E4E8C", rgba: [30, 78, 140, 205] },
  { cm: 125, color: "#1E3A8C", rgba: [30, 58, 140, 210] },
  { cm: 150, color: "#4338CA", rgba: [67, 56, 202, 215] },
  { cm: 175, color: "#6B21A8", rgba: [107, 33, 168, 220] },
  { cm: 200, color: "#9F2B68", rgba: [159, 43, 104, 225] },
  { cm: 225, color: "#BE185D", rgba: [190, 24, 93, 230] },
  { cm: 250, color: "#831843", rgba: [131, 24, 67, 235] },
];

function isNoData(value: number): boolean {
  return !Number.isFinite(value) || value < -1000 || value > 9000;
}

/** Faixa da legenda: o maior stop com cm ≤ profundidade (ex.: 190 cm usa o stop 175). */
export function depthScaleStop(
  depthM: number,
): (typeof DEPTH_SCALE)[number] | null {
  const cm = depthM * 100;
  if (cm < DEPTH_SCALE[0].cm) return null;
  let chosen = DEPTH_SCALE[0];
  for (const stop of DEPTH_SCALE) {
    if (cm >= stop.cm) chosen = stop;
  }
  return chosen;
}

export function colorForDepthM(depthM: number): [number, number, number, number] {
  return depthScaleStop(depthM)?.rgba ?? [0, 0, 0, 0];
}

function percentile(values: number[], p: number): number {
  if (!values.length) return Number.NaN;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (1 - (idx - lo)) + sorted[hi] * (idx - lo);
}

function lagAt(lags: number[], vertex: number): number {
  return lags[Math.min(Math.max(vertex, 0), lags.length - 1)] ?? 0;
}

function toPixel(
  lon: number,
  lat: number,
  bbox: LonLatBBox,
  width: number,
  height: number,
): { x: number; y: number } {
  return {
    x: ((lon - bbox.west) / Math.max(bbox.east - bbox.west, 1e-9)) * (width - 1),
    y: ((bbox.north - lat) / Math.max(bbox.north - bbox.south, 1e-9)) * (height - 1),
  };
}

/** Cohen–Sutherland em 2D: recorta o segmento do rio ao bbox do DEM. */
function clipSegmentToBbox(
  a: [number, number],
  b: [number, number],
  bbox: LonLatBBox,
): [[number, number], [number, number]] | null {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < 1e-14) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  if (
    !clip(-dx, a[0] - bbox.west) ||
    !clip(dx, bbox.east - a[0]) ||
    !clip(-dy, a[1] - bbox.south) ||
    !clip(dy, bbox.north - a[1])
  ) {
    return null;
  }
  return [
    [a[0] + t0 * dx, a[1] + t0 * dy],
    [a[0] + t1 * dx, a[1] + t1 * dy],
  ];
}

/** Raio do carimbo do rio em pixels ≈ 60 m no terreno (semente do flood-fill). */
function stampRadiusPx(bbox: LonLatBBox, width: number): number {
  const lat = ((bbox.north + bbox.south) / 2) * (Math.PI / 180);
  const mPerPx =
    ((bbox.east - bbox.west) / Math.max(width, 1)) * 111_320 * Math.max(0.2, Math.cos(lat));
  return Math.max(2, Math.min(16, Math.ceil(60 / Math.max(mPerPx, 1))));
}

/**
 * Rasteriza cada LineString do pacote na malha do DEM.
 * `branchIds` limita ao braço da cidade em foco (Açu vs Mirim) para um WSE
 * não inundar o outro vale. Sem filtro, todos os leitos viram semente.
 */
function rasterizeRiver(
  width: number,
  height: number,
  bbox: LonLatBBox,
  branchIds?: string[],
): { x: number; y: number; i: number; lag: number }[] {
  const radius = stampRadiusPx(bbox, width);
  const seeds: { x: number; y: number; i: number; lag: number }[] = [];
  const seen = new Uint8Array(width * height);
  const stamp = (x: number, y: number, lag: number) => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (dx * dx + dy * dy > radius * radius) continue;
        const xx = xi + dx;
        const yy = yi + dy;
        if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
        const i = yy * width + xx;
        if (seen[i]) continue;
        seen[i] = 1;
        seeds.push({ x: xx, y: yy, i, lag });
      }
    }
  };

  for (const branch of riverBranches()) {
    if (branchIds?.length && !branchIds.includes(branch.id)) continue;
    const line = branch.coordinates;
    const lags = branch.lags;
    for (let s = 0; s < line.length - 1; s += 1) {
      const clipped = clipSegmentToBbox(line[s], line[s + 1], bbox);
      if (!clipped) continue;
      const a = toPixel(clipped[0][0], clipped[0][1], bbox, width, height);
      const b = toPixel(clipped[1][0], clipped[1][1], bbox, width, height);
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
      const lag0 = lagAt(lags, s);
      const lag1 = lagAt(lags, s + 1);
      for (let k = 0; k <= steps; k += 1) {
        const t = k / steps;
        stamp(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, lag0 + (lag1 - lag0) * t);
      }
    }
  }
  return seeds;
}

/** DSM noise / 30 m spikes: water may pass, but only cells below WSE are painted. */
const CONNECT_SLACK_M = 0.55;

/** Lag do vértice de rio mais próximo do centro da vista (onda local). */
function nearestRiverLag(lon: number, lat: number, branchIds?: string[]): number {
  let best = 0;
  let bestD = Infinity;
  for (const branch of riverBranches()) {
    if (branchIds?.length && !branchIds.includes(branch.id)) continue;
    const line = branch.coordinates;
    const lags = branch.lags;
    for (let i = 0; i < line.length; i += 1) {
      const d = Math.hypot(line[i][0] - lon, line[i][1] - lat);
      if (d < bestD) {
        bestD = d;
        best = lagAt(lags, i);
      }
    }
  }
  return best;
}

/** Cota do leito ≈ percentil 10 das células-semente (ignora margens altas no DSM). */
function channelThalwegM(
  elevations: Float32Array,
  seeds: { i: number }[],
): number {
  const riverZ: number[] = [];
  for (const seed of seeds) {
    const z = elevations[seed.i];
    if (!isNoData(z)) riverZ.push(z);
  }
  return percentile(riverZ, 0.1);
}

export function estimateChannelThalwegM(
  elevations: Float32Array,
  width: number,
  height: number,
  bbox: LonLatBBox,
  branchIds?: string[],
): number {
  return channelThalwegM(elevations, rasterizeRiver(width, height, bbox, branchIds));
}

function cellAreaM2(bbox: LonLatBBox, width: number, height: number): number {
  const lat = ((bbox.north + bbox.south) / 2) * (Math.PI / 180);
  const dx = ((bbox.east - bbox.west) / Math.max(width, 1)) * 111_320 * Math.cos(lat);
  const dy = ((bbox.north - bbox.south) / Math.max(height, 1)) * 110_574;
  return Math.abs(dx * dy);
}

function spillVolumeM3(
  assigned: Float32Array,
  landZ: Float32Array,
  cellM2: number,
): number {
  let v = 0;
  for (let i = 0; i < assigned.length; i += 1) {
    const wse = assigned[i];
    const z = landZ[i];
    if (!Number.isFinite(wse) || isNoData(z)) continue;
    const d = wse - z;
    if (d > 0) v += d * cellM2;
  }
  return v;
}

function floodAtWse(
  wse: number,
  landZ: Float32Array,
  riverZ: Float32Array,
  onRiver: Uint8Array,
  seeds: { i: number }[],
  width: number,
  n: number,
): Float32Array {
  const assigned = new Float32Array(n);
  assigned.fill(Number.NaN);
  const reached = new Uint8Array(n);
  const queue: number[] = [];
  let qHead = 0;
  const zFlow = (i: number) => (onRiver[i] ? riverZ[i] : landZ[i]);
  const enqueue = (i: number) => {
    if (reached[i]) return;
    const zf = zFlow(i);
    if (isNoData(zf) || zf >= wse + CONNECT_SLACK_M) return;
    reached[i] = 1;
    const z = landZ[i];
    if (!isNoData(z) && z < wse) assigned[i] = wse;
    queue.push(i);
  };
  for (const seed of seeds) enqueue(seed.i);
  const neighbors = [-1, 1, -width, width, -width - 1, -width + 1, width - 1, width + 1];
  while (qHead < queue.length) {
    const i = queue[qHead];
    qHead += 1;
    const col = i % width;
    for (const d of neighbors) {
      const j = i + d;
      if (j < 0 || j >= n) continue;
      const ncol = j % width;
      if (Math.abs(ncol - col) > 1) continue;
      enqueue(j);
    }
  }
  return assigned;
}

export type SpillPaint = {
  canvas: HTMLCanvasElement;
  wseLiftM: number;
  displacedM3: number;
};

const MAX_WSE_LIFT_M = 4;
const VOLUME_ITERS = 12;

/**
 * Pinta a mancha.
 * extraAboveSpillM = max(0, régua − transbordo), em metros: zero = rio na calha.
 * WSE = talvegue_GLO-30 (sem Δz) + extra × ocupação da janela de escape.
 * CONNECT_SLACK deixa a água passar ruído de ~0,55 m do DSM sem pintar teto/copa.
 * channelElevations: cota do leito sem patches; a mancha nas ruas usa `elevations`.
 * Se o aterro ocupar volume inundável, a lâmina sobe até repor esse volume ao redor.
 */
export async function renderSpillHeatmap(
  elevations: Float32Array,
  width: number,
  height: number,
  bbox: LonLatBBox,
  extraAboveSpillM: number,
  hour: number,
  uniform = false,
  viewBbox?: LonLatBBox,
  branchIds?: string[],
  channelElevations?: Float32Array,
  redistributeVolume = false,
): Promise<SpillPaint> {
  const n = width * height;
  const canvas = document.createElement("canvas");
  const empty = (): SpillPaint => {
    canvas.width = 1;
    canvas.height = 1;
    return { canvas, wseLiftM: 0, displacedM3: 0 };
  };
  const seeds = rasterizeRiver(width, height, bbox, branchIds);
  const riverZ = channelElevations ?? elevations;
  const onRiver = new Uint8Array(n);
  for (const seed of seeds) onRiver[seed.i] = 1;
  const thalweg = channelThalwegM(riverZ, seeds);

  if (!Number.isFinite(thalweg)) return empty();

  const view = viewBbox ?? bbox;
  const occ = uniform
    ? 1
    : floodOccupancy(hour, nearestRiverLag((view.west + view.east) / 2, (view.south + view.north) / 2, branchIds));
  const wse0 = thalweg + Math.max(0, extraAboveSpillM) * occ;

  let wse = wse0;
  let displacedM3 = 0;
  const cellM2 = cellAreaM2(bbox, width, height);
  const hasPatch =
    redistributeVolume &&
    channelElevations != null &&
    channelElevations.length === elevations.length &&
    extraAboveSpillM > 0;

  if (hasPatch) {
    const assignedRaw = floodAtWse(wse0, riverZ, riverZ, onRiver, seeds, width, n);
    const assignedPatch = floodAtWse(wse0, elevations, riverZ, onRiver, seeds, width, n);
    const targetM3 = spillVolumeM3(assignedRaw, riverZ, cellM2);
    const v0 = spillVolumeM3(assignedPatch, elevations, cellM2);
    displacedM3 = Math.max(0, targetM3 - v0);
    if (displacedM3 > cellM2 * 0.05) {
      let lo = wse0;
      let hi = wse0 + MAX_WSE_LIFT_M;
      for (let k = 0; k < VOLUME_ITERS; k += 1) {
        const mid = (lo + hi) / 2;
        const v = spillVolumeM3(
          floodAtWse(mid, elevations, riverZ, onRiver, seeds, width, n),
          elevations,
          cellM2,
        );
        if (v < targetM3) lo = mid;
        else hi = mid;
      }
      wse = hi;
    }
  }

  const assigned = floodAtWse(wse, elevations, riverZ, onRiver, seeds, width, n);
  const pixels = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i += 1) {
    const surface = assigned[i];
    const z = elevations[i];
    if (!Number.isFinite(surface) || isNoData(z)) continue;
    const depth = surface - z;
    const [r, g, b, a] = colorForDepthM(depth);
    if (a === 0) continue;
    const o = i * 4;
    pixels[o] = r;
    pixels[o + 1] = g;
    pixels[o + 2] = b;
    pixels[o + 3] = a;
  }

  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")?.putImageData(new ImageData(pixels, width, height), 0, 0);
  return { canvas, wseLiftM: Math.max(0, wse - wse0), displacedM3 };
}
