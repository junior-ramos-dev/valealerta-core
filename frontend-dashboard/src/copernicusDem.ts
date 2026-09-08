import { fromUrl, type GeoTIFF } from "geotiff";
import type { TopoPatchFeature } from "./topoPatches";
import {
  applyPatchesToElevations,
  assessPatchAgainstDem,
  meanElevationInPatch,
  patchesToApply,
  type PatchDemCheck,
} from "./topoPatches";

export type LonLatBBox = {
  west: number;
  south: number;
  north: number;
  east: number;
};

export type CopernicusTopoOverlay = {
  image: HTMLCanvasElement;
  elevations: Float32Array;
  width: number;
  height: number;
  bbox: LonLatBBox;
  viewBbox: LonLatBBox;
  coordinates: [
    [number, number],
    [number, number],
    [number, number],
    [number, number],
  ];
  productName: string;
  tileCount: number;
  elevationMinM: number;
  elevationMaxM: number;
  rawElevations: Float32Array;
  patchChecks: PatchDemCheck[];
};

const MAX_CANVAS = 768;
const MAX_TILES = 16;
/** Keep the river inside the flood grid when the camera is tight on a neighborhood. */
const FLOOD_PAD_M = 2000;
const TIFF_CACHE = new Map<string, Promise<GeoTIFF | null>>();

function pad(value: number, size: number): string {
  return String(value).padStart(size, "0");
}

export function normalizeBbox(bbox: LonLatBBox): LonLatBBox {
  return {
    west: Math.max(-180, Math.min(bbox.west, bbox.east)),
    east: Math.min(180, Math.max(bbox.west, bbox.east)),
    south: Math.max(-90, Math.min(bbox.south, bbox.north)),
    north: Math.min(90, Math.max(bbox.south, bbox.north)),
  };
}

export function bboxToCoordinates(bbox: LonLatBBox): CopernicusTopoOverlay["coordinates"] {
  return [
    [bbox.west, bbox.north],
    [bbox.east, bbox.north],
    [bbox.east, bbox.south],
    [bbox.west, bbox.south],
  ];
}

export function bboxFromViewport(map: {
  getBounds(): {
    getWest(): number;
    getSouth(): number;
    getEast(): number;
    getNorth(): number;
  };
}): LonLatBBox {
  const b = map.getBounds();
  return normalizeBbox({
    west: b.getWest(),
    south: b.getSouth(),
    east: b.getEast(),
    north: b.getNorth(),
  });
}

export function expandBboxMeters(bbox: LonLatBBox, meters: number): LonLatBBox {
  const lat = (bbox.north + bbox.south) / 2;
  const dLat = meters / 111_320;
  const dLon = meters / (111_320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  return normalizeBbox({
    west: bbox.west - dLon,
    east: bbox.east + dLon,
    south: bbox.south - dLat,
    north: bbox.north + dLat,
  });
}

export function viewCropRect(
  work: LonLatBBox,
  view: LonLatBBox,
  width: number,
  height: number,
): { x0: number; y0: number; cw: number; ch: number } {
  const lonSpan = Math.max(work.east - work.west, 1e-9);
  const latSpan = Math.max(work.north - work.south, 1e-9);
  const x0 = Math.max(0, Math.floor(((view.west - work.west) / lonSpan) * width));
  const x1 = Math.min(width, Math.ceil(((view.east - work.west) / lonSpan) * width));
  const y0 = Math.max(0, Math.floor(((work.north - view.north) / latSpan) * height));
  const y1 = Math.min(height, Math.ceil(((work.north - view.south) / latSpan) * height));
  return {
    x0,
    y0,
    cw: Math.max(1, x1 - x0),
    ch: Math.max(1, y1 - y0),
  };
}

function cropImageData(
  src: ImageData,
  x0: number,
  y0: number,
  cw: number,
  ch: number,
): ImageData {
  const out = new ImageData(cw, ch);
  for (let y = 0; y < ch; y += 1) {
    const srcOff = ((y0 + y) * src.width + x0) * 4;
    out.data.set(src.data.subarray(srcOff, srcOff + cw * 4), y * cw * 4);
  }
  return out;
}

export function sampleElevationM(
  overlay: CopernicusTopoOverlay,
  lon: number,
  lat: number,
): number | null {
  const { bbox, width, height, elevations } = overlay;
  const lonSpan = bbox.east - bbox.west;
  const latSpan = bbox.north - bbox.south;
  if (lonSpan <= 1e-12 || latSpan <= 1e-12) return null;
  const x = ((lon - bbox.west) / lonSpan) * (width - 1);
  const y = ((bbox.north - lat) / latSpan) * (height - 1);
  if (x < 0 || y < 0 || x > width - 1 || y > height - 1) return null;

  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const at = (cx: number, cy: number) => elevations[cy * width + cx];
  const z00 = at(x0, y0);
  const z10 = at(x1, y0);
  const z01 = at(x0, y1);
  const z11 = at(x1, y1);
  const valid = [z00, z10, z01, z11].filter((z) => Number.isFinite(z) && z > -1000 && z < 9000);
  if (!valid.length) return null;
  if (valid.length < 4) return valid.reduce((a, b) => a + b, 0) / valid.length;
  return z00 * (1 - tx) * (1 - ty) + z10 * tx * (1 - ty) + z01 * (1 - tx) * ty + z11 * tx * ty;
}

function cogKey(south: number, west: number): string {
  const ns = south < 0 ? `S${pad(Math.abs(south), 2)}` : `N${pad(south, 2)}`;
  const ew = west < 0 ? `W${pad(Math.abs(west), 3)}` : `E${pad(west, 3)}`;
  const folder = `Copernicus_DSM_COG_10_${ns}_00_${ew}_00_DEM`;
  return `${folder}/${folder}.tif`;
}

function tilesForBbox(bbox: LonLatBBox): { south: number; west: number }[] {
  const tiles: { south: number; west: number }[] = [];
  const west0 = Math.floor(bbox.west);
  const east0 = Math.floor(bbox.east - 1e-10);
  const south0 = Math.floor(bbox.south);
  const north0 = Math.floor(bbox.north - 1e-10);
  for (let lat = south0; lat <= north0; lat += 1) {
    for (let lon = west0; lon <= east0; lon += 1) {
      tiles.push({ south: lat, west: lon });
    }
  }
  return tiles;
}

function intersectBbox(a: LonLatBBox, b: LonLatBBox): LonLatBBox | null {
  const west = Math.max(a.west, b.west);
  const east = Math.min(a.east, b.east);
  const south = Math.max(a.south, b.south);
  const north = Math.min(a.north, b.north);
  if (east - west <= 1e-10 || north - south <= 1e-10) return null;
  return { west, south, east, north };
}

function canvasSize(bbox: LonLatBBox): { width: number; height: number } {
  const lonSpan = Math.max(bbox.east - bbox.west, 1e-6);
  const latSpan = Math.max(bbox.north - bbox.south, 1e-6);
  if (lonSpan >= latSpan) {
    return {
      width: MAX_CANVAS,
      height: Math.max(64, Math.round(MAX_CANVAS * (latSpan / lonSpan))),
    };
  }
  return {
    width: Math.max(64, Math.round(MAX_CANVAS * (lonSpan / latSpan))),
    height: MAX_CANVAS,
  };
}

function getTiff(key: string): Promise<GeoTIFF | null> {
  let pending = TIFF_CACHE.get(key);
  if (!pending) {
    pending = fromUrl(`/copernicus-dem/${key}`).catch((error: unknown) => {
      TIFF_CACHE.delete(key);
      console.warn(`Copernicus COG unavailable: ${key}`, error);
      return null;
    });
    TIFF_CACHE.set(key, pending);
  }
  return pending;
}

function isNoData(value: number): boolean {
  return !Number.isFinite(value) || value < -1000 || value > 9000;
}

function renderHillshade(
  elevations: ArrayLike<number>,
  width: number,
  height: number,
  bbox: LonLatBBox,
): ImageData {
  const meanLat = ((bbox.north + bbox.south) / 2) * (Math.PI / 180);
  const metersPerDegLat = 111_320;
  const metersPerDegLon = 111_320 * Math.cos(meanLat);
  const dx = ((bbox.east - bbox.west) / Math.max(width - 1, 1)) * metersPerDegLon;
  const dy = ((bbox.north - bbox.south) / Math.max(height - 1, 1)) * metersPerDegLat;

  const zenith = (90 - 45) * (Math.PI / 180);
  const azimuth = (360 - 315 + 90) * (Math.PI / 180);
  const pixels = new Uint8ClampedArray(width * height * 4);

  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < elevations.length; i += 1) {
    const z = elevations[i];
    if (isNoData(z)) continue;
    if (z < min) min = z;
    if (z > max) max = z;
  }
  if (!Number.isFinite(min)) {
    min = 0;
    max = 1;
  }

  const at = (x: number, y: number): number =>
    elevations[
      Math.min(height - 1, Math.max(0, y)) * width +
        Math.min(width - 1, Math.max(0, x))
    ];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      const z = elevations[i];
      const o = i * 4;
      if (isNoData(z)) {
        pixels[o] = 28;
        pixels[o + 1] = 36;
        pixels[o + 2] = 32;
        pixels[o + 3] = 180;
        continue;
      }

      const dzdx = ((at(x + 1, y) - at(x - 1, y)) / (2 * dx)) * 1.2;
      const dzdy = ((at(x, y + 1) - at(x, y - 1)) / (2 * dy)) * 1.2;
      const slope = Math.atan(Math.hypot(dzdx, dzdy));
      const aspect = Math.atan2(dzdy, -dzdx);
      const shade = Math.max(
        0,
        Math.sin(zenith) * Math.cos(slope) +
          Math.cos(zenith) * Math.sin(slope) * Math.cos(azimuth - aspect),
      );
      const t = max === min ? 0.5 : (z - min) / (max - min);
      pixels[o] = Math.round(40 + shade * 150 + t * 40);
      pixels[o + 1] = Math.round(55 + shade * 160 + t * 20);
      pixels[o + 2] = Math.round(48 + shade * 140);
      pixels[o + 3] = 255;
    }
  }

  return new ImageData(pixels, width, height);
}

async function blitTile(
  dest: Float32Array,
  destW: number,
  destH: number,
  view: LonLatBBox,
  tileSouth: number,
  tileWest: number,
  signal?: AbortSignal,
): Promise<boolean> {
  const tileBbox: LonLatBBox = {
    west: tileWest,
    south: tileSouth,
    east: tileWest + 1,
    north: tileSouth + 1,
  };
  const slice = intersectBbox(view, tileBbox);
  if (!slice) return false;

  const tiff = await getTiff(cogKey(tileSouth, tileWest));
  if (!tiff || signal?.aborted) return false;

  const lonSpan = view.east - view.west;
  const latSpan = view.north - view.south;
  const x0 = Math.max(0, Math.floor(((slice.west - view.west) / lonSpan) * destW));
  const x1 = Math.min(destW, Math.ceil(((slice.east - view.west) / lonSpan) * destW));
  const y0 = Math.max(0, Math.floor(((view.north - slice.north) / latSpan) * destH));
  const y1 = Math.min(destH, Math.ceil(((view.north - slice.south) / latSpan) * destH));
  const tw = Math.max(1, x1 - x0);
  const th = Math.max(1, y1 - y0);

  try {
    const rasters = await tiff.readRasters({
      bbox: [slice.west, slice.south, slice.east, slice.north],
        width: tw,
        height: th,
        samples: [0],
        interleave: true,
        resampleMethod: "bilinear",
        signal,
    });
    const band = rasters as unknown as ArrayLike<number>;
    for (let y = 0; y < th; y += 1) {
      for (let x = 0; x < tw; x += 1) {
        dest[(y0 + y) * destW + (x0 + x)] = band[y * tw + x];
      }
    }
    return true;
  } catch {
    return false;
  }
}

function imageDataToCanvas(imageData: ImageData): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  canvas.getContext("2d")?.putImageData(imageData, 0, 0);
  return canvas;
}

export async function loadCopernicusTopoOverlay(
  viewBbox: LonLatBBox,
  signal?: AbortSignal,
  patches: TopoPatchFeature[] = [],
): Promise<CopernicusTopoOverlay> {
  const view = normalizeBbox(viewBbox);
  const work = expandBboxMeters(view, FLOOD_PAD_M);
  const tiles = tilesForBbox(work).slice(0, MAX_TILES);
  const { width, height } = canvasSize(work);
  const elevations = new Float32Array(width * height);
  elevations.fill(Number.NaN);

  const results = await Promise.all(
    tiles.map((tile) =>
      blitTile(elevations, width, height, work, tile.south, tile.west, signal),
    ),
  );
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const tileCount = results.filter(Boolean).length;
  if (tileCount === 0) {
    throw new Error("No Copernicus GLO-30 tiles available for this view.");
  }

  const rawElevations = new Float32Array(elevations);
  const patchChecks: PatchDemCheck[] = [];
  for (const feature of patches) {
    const z = meanElevationInPatch(rawElevations, width, height, work, feature);
    if (z == null) continue;
    patchChecks.push(assessPatchAgainstDem(feature, z));
  }
  applyPatchesToElevations(
    elevations,
    width,
    height,
    work,
    patchesToApply(patches, patchChecks),
  );

  const hillshade = renderHillshade(elevations, width, height, work);
  const crop = viewCropRect(work, view, width, height);
  const imageData = cropImageData(hillshade, crop.x0, crop.y0, crop.cw, crop.ch);

  let elevationMinM = Infinity;
  let elevationMaxM = -Infinity;
  for (let i = 0; i < elevations.length; i += 1) {
    const z = elevations[i];
    if (isNoData(z)) continue;
    if (z < elevationMinM) elevationMinM = z;
    if (z > elevationMaxM) elevationMaxM = z;
  }

  return {
    image: imageDataToCanvas(imageData),
    elevations,
    width,
    height,
    bbox: work,
    viewBbox: view,
    coordinates: bboxToCoordinates(view),
    productName: "COP-DEM GLO-30",
    tileCount,
    elevationMinM,
    elevationMaxM,
    rawElevations,
    patchChecks,
  };
}
