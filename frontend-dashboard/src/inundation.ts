import type { LonLatBBox } from "./copernicusDem";
import { REACH_LAGS_H, RIO_TIJUCAS, riverArrival } from "./hydro";

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

export function colorForDepthM(depthM: number): [number, number, number, number] {
  const cm = depthM * 100;
  if (cm < DEPTH_SCALE[0].cm) return [0, 0, 0, 0];
  let chosen = DEPTH_SCALE[0];
  for (const stop of DEPTH_SCALE) {
    if (cm >= stop.cm) chosen = stop;
  }
  return chosen.rgba;
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

function lagAt(vertex: number): number {
  return REACH_LAGS_H[Math.min(Math.max(vertex, 0), REACH_LAGS_H.length - 1)] ?? 0;
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

function rasterizeRiver(
  width: number,
  height: number,
  bbox: LonLatBBox,
): { x: number; y: number; i: number; lag: number }[] {
  const pts = RIO_TIJUCAS.map(([lon, lat]) => toPixel(lon, lat, bbox, width, height));
  const seeds: { x: number; y: number; i: number; lag: number }[] = [];
  const seen = new Uint8Array(width * height);
  const stamp = (x: number, y: number, lag: number) => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
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

  for (let s = 0; s < pts.length - 1; s += 1) {
    const a = pts[s];
    const b = pts[s + 1];
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
    const lag0 = lagAt(s);
    const lag1 = lagAt(s + 1);
    for (let k = 0; k <= steps; k += 1) {
      const t = k / steps;
      stamp(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, lag0 + (lag1 - lag0) * t);
    }
  }
  return seeds;
}

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

export async function renderSpillHeatmap(
  elevations: Float32Array,
  width: number,
  height: number,
  bbox: LonLatBBox,
  extraAboveSpillM: number,
  hour: number,
  uniform = false,
): Promise<ImageBitmap> {
  const n = width * height;
  const assigned = new Float32Array(n);
  assigned.fill(Number.NaN);
  const queue: number[] = [];
  const seeds = rasterizeRiver(width, height, bbox);
  const thalweg = channelThalwegM(elevations, seeds);

  if (!Number.isFinite(thalweg)) {
    return createImageBitmap(new ImageData(width, height));
  }

  for (const seed of seeds) {
    const z = elevations[seed.i];
    const extra = uniform
      ? extraAboveSpillM
      : extraAboveSpillM * riverArrival(hour, seed.lag);
    if (isNoData(z)) continue;
    const wse = thalweg + Math.max(0, extra);
    if (z >= wse) continue;
    assigned[seed.i] = wse;
    queue.push(seed.i);
  }

  const neighbors = [
    -1,
    1,
    -width,
    width,
    -width - 1,
    -width + 1,
    width - 1,
    width + 1,
  ];
  while (queue.length) {
    const i = queue.pop() as number;
    const wse = assigned[i];
    const col = i % width;
    for (const d of neighbors) {
      const j = i + d;
      if (j < 0 || j >= n) continue;
      const ncol = j % width;
      if (Math.abs(ncol - col) > 1) continue;
      const z = elevations[j];
      if (isNoData(z) || z >= wse) continue;
      if (!Number.isFinite(assigned[j]) || wse > assigned[j] + 0.01) {
        assigned[j] = wse;
        queue.push(j);
      }
    }
  }

  const pixels = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i += 1) {
    const wse = assigned[i];
    const z = elevations[i];
    if (!Number.isFinite(wse) || isNoData(z)) continue;
    const depth = wse - z;
    const [r, g, b, a] = colorForDepthM(depth);
    if (a === 0) continue;
    const o = i * 4;
    pixels[o] = r;
    pixels[o + 1] = g;
    pixels[o + 2] = b;
    pixels[o + 3] = a;
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")?.putImageData(new ImageData(pixels, width, height), 0, 0);
  return createImageBitmap(canvas);
}
