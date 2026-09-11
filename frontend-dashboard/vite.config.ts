import react from "@vitejs/plugin-react";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";

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

function pwaDocPlugin(): Plugin {
  const docPath = resolve(rootDir, "../PWA.md");
  const send = (res: {
    statusCode: number;
    setHeader: (k: string, v: string) => void;
    end: (b: string) => void;
  }) => {
    if (!existsSync(docPath)) {
      res.statusCode = 404;
      res.end("not found");
      return;
    }
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.end(readFileSync(docPath, "utf8"));
  };
  return {
    name: "valealerta-pwa-md",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split("?")[0] ?? "";
        if (url === "/PWA.md") {
          send(res);
          return;
        }
        next();
      });
    },
    generateBundle() {
      if (!existsSync(docPath)) return;
      this.emitFile({ type: "asset", fileName: "PWA.md", source: readFileSync(docPath, "utf8") });
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    regionsPlugin(),
    pwaDocPlugin(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: [
        "favicon.svg",
        "apple-touch-icon.png",
        "pwa-192x192.png",
        "pwa-512x512.png",
        "pwa-512-maskable.png",
        "hydro_now.json",
      ],
      manifest: {
        name: "Vale Alerta SC - Enchentes",
        short_name: "Vale Alerta SC",
        description: "Simulador cidadão de inundação no vale.",
        lang: "pt-BR",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#111111",
        theme_color: "#1f1f1f",
        icons: [
          {
            src: "pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "pwa-512-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,json,geojson,png,webmanifest,woff2,md}"],
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/^\/copernicus-dem\//, /^\/ana-hidro\//, /\.md$/],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/api\.open-meteo\.com\/.*/i,
            handler: "NetworkFirst",
            options: {
              cacheName: "open-meteo",
              networkTimeoutSeconds: 8,
              expiration: { maxEntries: 32, maxAgeSeconds: 6 * 3600 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /\/ana-hidro\//,
            handler: "NetworkFirst",
            options: {
              cacheName: "ana-hidro",
              networkTimeoutSeconds: 8,
              expiration: { maxEntries: 32, maxAgeSeconds: 6 * 3600 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /\/copernicus-dem\//,
            handler: "CacheFirst",
            options: {
              cacheName: "copernicus-dem",
              rangeRequests: true,
              expiration: { maxEntries: 24, maxAgeSeconds: 30 * 24 * 3600 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            urlPattern: /^https:\/\/.*(?:arcgisonline|arcgis)\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "esri-basemap",
              expiration: { maxEntries: 400, maxAgeSeconds: 14 * 24 * 3600 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/.*cartocdn\.com\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "carto-labels",
              expiration: { maxEntries: 400, maxAgeSeconds: 14 * 24 * 3600 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/demotiles\.maplibre\.org\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "maplibre-glyphs",
              expiration: { maxEntries: 64, maxAgeSeconds: 30 * 24 * 3600 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/s3\.amazonaws\.com\/elevation-tiles-prod\/.*/i,
            handler: "CacheFirst",
            options: {
              cacheName: "terrain-rgb",
              expiration: { maxEntries: 200, maxAgeSeconds: 14 * 24 * 3600 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
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
