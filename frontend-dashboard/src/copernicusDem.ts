import { fromUrl, type GeoTIFF } from "geotiff";

export type LonLatBBox = {
  west: number;
  south: number;
  north: number;
  east: number;
};

export type CopernicusTopoOverlay = {
  image: ImageBitmap;
  elevations: Float32Array;
  width: number;
  height: number;
  bbox: LonLatBBox;
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
};

const MAX_CANVAS = 768;
const MAX_TILES = 16;
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

export function viewportCoordinates(map: {
  getBounds(): {
    getWest(): number;
    getSouth(): number;
    getEast(): number;
    getNorth(): number;
  };
}): CopernicusTopoOverlay["coordinates"] {
  const b = map.getBounds();
  return [
    [b.getWest(), b.getNorth()],
    [b.getEast(), b.getNorth()],
    [b.getEast(), b.getSouth()],
    [b.getWest(), b.getSouth()],
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

function canvasToBitmap(imageData: ImageData): Promise<ImageBitmap> {
  const canvas = document.createElement("canvas");
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  canvas.getContext("2d")?.putImageData(imageData, 0, 0);
  return createImageBitmap(canvas);
}

export async function loadCopernicusTopoOverlay(
  viewBbox: LonLatBBox,
  signal?: AbortSignal,
): Promise<CopernicusTopoOverlay> {
  const view = normalizeBbox(viewBbox);
  const tiles = tilesForBbox(view).slice(0, MAX_TILES);
  const { width, height } = canvasSize(view);
  const elevations = new Float32Array(width * height);
  elevations.fill(Number.NaN);

  const results = await Promise.all(
    tiles.map((tile) =>
      blitTile(elevations, width, height, view, tile.south, tile.west, signal),
    ),
  );
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const tileCount = results.filter(Boolean).length;
  if (tileCount === 0) {
    throw new Error("No Copernicus GLO-30 tiles available for this view.");
  }

  const imageData = renderHillshade(elevations, width, height, view);

  let elevationMinM = Infinity;
  let elevationMaxM = -Infinity;
  for (let i = 0; i < elevations.length; i += 1) {
    const z = elevations[i];
    if (isNoData(z)) continue;
    if (z < elevationMinM) elevationMinM = z;
    if (z > elevationMaxM) elevationMaxM = z;
  }

  return {
    image: await canvasToBitmap(imageData),
    elevations,
    width,
    height,
    bbox: view,
    coordinates: [
      [view.west, view.north],
      [view.east, view.north],
      [view.east, view.south],
      [view.west, view.south],
    ],
    productName: "COP-DEM GLO-30",
    tileCount,
    elevationMinM,
    elevationMaxM,
  };
}
