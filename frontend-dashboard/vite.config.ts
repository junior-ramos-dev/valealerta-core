import react from "@vitejs/plugin-react";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const rootDir = dirname(fileURLToPath(import.meta.url));
const REGIONS_DIR = resolve(rootDir, "../regions");
const LEGACY_PATCHES = resolve(rootDir, "../backend-satellite/topo_patches/patches.geojson");

function isSafeRegionFile(name: string): boolean {
  return /^[a-zA-Z0-9._-]+\.(json|geojson)$/.test(name) || name === "index.json";
}

function readRegionAsset(fileName: string): string | null {
  if (!isSafeRegionFile(fileName)) return null;
  const path = resolve(REGIONS_DIR, fileName);
  if (!path.startsWith(REGIONS_DIR + sep) && path !== REGIONS_DIR) return null;
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8");
}

function regionsPlugin(): Plugin {
  const send = (
    res: { statusCode: number; setHeader: (k: string, v: string) => void; end: (b: string) => void },
    fileName: string,
  ) => {
    const body = readRegionAsset(fileName);
    if (body == null) {
      res.statusCode = 404;
      res.end("not found");
      return;
    }
    const jsonType = fileName.endsWith(".geojson")
      ? "application/geo+json; charset=utf-8"
      : "application/json; charset=utf-8";
    res.setHeader("Content-Type", jsonType);
    res.end(body);
  };

  return {
    name: "valealerta-regions",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split("?")[0] ?? "";
        if (url === "/topo_patches.geojson") {
          send(res, "tijucas.patches.geojson");
          return;
        }
        if (url.startsWith("/regions/")) {
          send(res, url.slice("/regions/".length));
          return;
        }
        next();
      });
    },
    generateBundle() {
      const names = existsSync(REGIONS_DIR)
        ? readdirSync(REGIONS_DIR).filter((n) => isSafeRegionFile(n))
        : [];
      for (const name of names) {
        const source = readRegionAsset(name);
        if (source == null) continue;
        this.emitFile({ type: "asset", fileName: `regions/${name}`, source });
      }
      const patches =
        readRegionAsset("tijucas.patches.geojson") ??
        (existsSync(LEGACY_PATCHES)
          ? readFileSync(LEGACY_PATCHES, "utf8")
          : JSON.stringify({ type: "FeatureCollection", features: [] }));
      this.emitFile({ type: "asset", fileName: "topo_patches.geojson", source: patches });
    },
  };
}

export default defineConfig({
  plugins: [react(), regionsPlugin()],
  optimizeDeps: {
    exclude: ["maplibre-gl"],
  },
  server: {
    proxy: {
      "/copernicus-dem": {
        target: "https://copernicus-dem-30m.s3.eu-central-1.amazonaws.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/copernicus-dem/, ""),
      },
      "/ana-hidro": {
        target: "https://telemetriaws1.ana.gov.br",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ana-hidro/, ""),
      },
    },
  },
});
