import { prefetchDemTiles } from "./copernicusDem";
import { loadHydroSnapshot, type HydroSnapshot } from "./hydro";
import type { RegionPack } from "./region";

export type BasinOfflinePrep = {
  tiles: number;
  hydro: HydroSnapshot;
};

async function warmPackUrls(pack: RegionPack, signal?: AbortSignal): Promise<void> {
  if (typeof caches === "undefined") return;
  const urls = [
    `/regions/${pack.id}.json`,
    `/regions/${pack.id}.patches.geojson`,
    "/regions/index.json",
    "/topo_patches.geojson",
  ];
  const cache = await caches.open("valealerta-basin-packs");
  await Promise.all(
    urls.map(async (url) => {
      try {
        const res = await fetch(url, { signal });
        if (res.ok) await cache.put(url, res.clone());
      } catch {
        /* precache do PWA já cobre o pacote após o install */
      }
    }),
  );
}

/** Pacote + último retrato hidro + COGs Copernicus da bbox da bacia. */
export async function prepareBasinOffline(
  pack: RegionPack,
  signal?: AbortSignal,
): Promise<BasinOfflinePrep> {
  await warmPackUrls(pack, signal);
  const hydro = await loadHydroSnapshot(signal);
  const tiles = await prefetchDemTiles(pack.region.bbox, signal);
  return { hydro, tiles };
}
