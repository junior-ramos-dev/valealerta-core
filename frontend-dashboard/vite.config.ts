import react from "@vitejs/plugin-react";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const rootDir = dirname(fileURLToPath(import.meta.url));
const PATCHES_FILE = resolve(rootDir, "../backend-satellite/topo_patches/patches.geojson");

function topoPatchesPlugin(): Plugin {
  const send = (res: { setHeader: (k: string, v: string) => void; end: (b: string) => void }) => {
    res.setHeader("Content-Type", "application/geo+json; charset=utf-8");
    const body = existsSync(PATCHES_FILE)
      ? readFileSync(PATCHES_FILE, "utf8")
      : JSON.stringify({ type: "FeatureCollection", features: [] });
    res.end(body);
  };
  return {
    name: "valealerta-topo-patches",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split("?")[0] === "/topo_patches.geojson") {
          send(res);
          return;
        }
        next();
      });
    },
    generateBundle() {
      const source = existsSync(PATCHES_FILE)
        ? readFileSync(PATCHES_FILE, "utf8")
        : JSON.stringify({ type: "FeatureCollection", features: [] });
      this.emitFile({ type: "asset", fileName: "topo_patches.geojson", source });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), topoPatchesPlugin()],
  optimizeDeps: {
    // 🔴 ADD THIS BLOCK TO UNBLOCK MAPLIBRE WORKER THREAD LOADING
    exclude: ["maplibre-gl"],
  },
  server: {
    proxy: {
      // S3 COGs have no CORS; same Copernicus GLO-30 DEM catalogued by CDSE OData.
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
