import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
