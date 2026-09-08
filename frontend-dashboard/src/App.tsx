import { useState, useEffect, useRef, useCallback } from "react";
import {
  Map as MaplibreMap,
  NavigationControl,
  type ImageSource,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  bboxFromViewport,
  loadCopernicusTopoOverlay,
  viewportCoordinates,
  type CopernicusTopoOverlay,
} from "./copernicusDem";
import {
  cityPointsGeoJSON,
  loadHydroSnapshot,
  rainForForecastDays,
  rainMmPerHourForInlandCm,
  forecastStaffM,
  riverLineGeoJSON,
  SJB_SPILL_STAGE_M,
  SJB_NORMAL_STAGE_CM,
  CRITICAL_RAIN_H,
  VALLEY_MAP_CITIES,
  type HydroSnapshot,
} from "./hydro";
import { renderSpillHeatmap, DEPTH_SCALE } from "./inundation";
import { InfoTip } from "./InfoTip";

const SJB_COORDS: [number, number] = [-48.8494, -27.2761];
const VIEWPORT_SETTLE_MS = 1000;

const ESRI_IMAGERY_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const TERRAIN_RGB_URL =
  "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const CARTO_LABEL_URLS = [
  "https://a.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png",
  "https://b.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png",
  "https://c.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png",
];

export default function App() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MaplibreMap | null>(null);

  const [timeWindow, setTimeWindow] = useState<number>(4);
  const [forecastDays, setForecastDays] = useState<number>(3);
  const [heatmapMode, setHeatmapMode] = useState<"off" | "now" | "forecast">("now");
  const [topoOpacity, setTopoOpacity] = useState<number>(45);
  const [topoStatus, setTopoStatus] = useState<
    "settling" | "loading" | "ready" | "error"
  >("loading");
  const [topoMeta, setTopoMeta] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"simulador" | "live">("simulador");
  const [hydro, setHydro] = useState<HydroSnapshot | null>(null);
  const [hydroError, setHydroError] = useState<string | null>(null);
  const [waterLevelCm, setWaterLevelCm] = useState(SJB_NORMAL_STAGE_CM);
  const [focusCityId, setFocusCityId] = useState<string>("sao-joao-batista");
  const topoOpacityRef = useRef(topoOpacity);
  const waterLevelCmRef = useRef(waterLevelCm);
  const heatmapModeRef = useRef(heatmapMode);
  const forecastDaysRef = useRef(forecastDays);
  const hydroRef = useRef(hydro);
  const paintGenRef = useRef(0);

  const topoOverlayRef = useRef<CopernicusTopoOverlay | null>(null);

  const applyTopoOverlay = useCallback((map: MaplibreMap, overlay: CopernicusTopoOverlay) => {
    const coordinates = overlay.coordinates;
    const existing = map.getSource("copernicus-topo") as ImageSource | undefined;
    if (existing) {
      existing.updateImage({ image: overlay.image, coordinates });
      return;
    }

    map.addSource("copernicus-topo", {
      type: "image",
      coordinates,
    });
    (map.getSource("copernicus-topo") as ImageSource).updateImage({
      image: overlay.image,
      coordinates,
    });

    map.addLayer(
      {
        id: "topo-overlay",
        type: "raster",
        source: "copernicus-topo",
        paint: {
          "raster-opacity": topoOpacityRef.current / 100,
          "raster-resampling": "linear",
          "raster-fade-duration": 0,
        },
      },
      map.getLayer("inundation-layer")
        ? "inundation-layer"
        : "labels-overlay",
    );
  }, []);

  const applyInundationOverlay = useCallback(
    (map: MaplibreMap, image: ImageBitmap, coordinates: CopernicusTopoOverlay["coordinates"]) => {
      const existing = map.getSource("inundation-spill") as ImageSource | undefined;
      if (existing) {
        existing.updateImage({ image, coordinates });
        if (map.getLayer("inundation-layer")) {
          map.setLayoutProperty(
            "inundation-layer",
            "visibility",
            heatmapModeRef.current !== "off" ? "visible" : "none",
          );
        }
        return;
      }

      map.addSource("inundation-spill", { type: "image", coordinates });
      (map.getSource("inundation-spill") as ImageSource).updateImage({ image, coordinates });
      map.addLayer(
        {
          id: "inundation-layer",
          type: "raster",
          source: "inundation-spill",
          layout: { visibility: heatmapModeRef.current !== "off" ? "visible" : "none" },
          paint: {
            "raster-opacity": 0.85,
            "raster-resampling": "linear",
            "raster-fade-duration": 0,
          },
        },
        "labels-overlay",
      );
    },
    [],
  );

  const paintSpill = useCallback(async (demOverride?: CopernicusTopoOverlay | null) => {
    const map = mapRef.current;
    const dem = demOverride ?? topoOverlayRef.current;
    if (!map?.isStyleLoaded() || !dem) return;
    if (heatmapModeRef.current === "off") {
      if (map.getLayer("inundation-layer")) {
        map.setLayoutProperty("inundation-layer", "visibility", "none");
      }
      return;
    }
    const rise =
      heatmapModeRef.current === "forecast"
        ? forecastStaffM(hydroRef.current, forecastDaysRef.current)
        : waterLevelCmRef.current / 100;
    const gen = (paintGenRef.current += 1);
    try {
      const image = await renderSpillHeatmap(
        dem.elevations,
        dem.width,
        dem.height,
        dem.bbox,
        rise,
        0,
        true,
      );
      if (!mapRef.current || gen !== paintGenRef.current) return;
      applyInundationOverlay(map, image, dem.coordinates);
    } catch (error) {
      console.error(error);
    }
  }, [applyInundationOverlay]);

  const paintSpillRef = useRef(paintSpill);
  const refreshViewportRef = useRef<() => void>(() => {});
  const scheduleViewportRef = useRef<() => void>(() => {});
  useEffect(() => {
    paintSpillRef.current = paintSpill;
  }, [paintSpill]);

  useEffect(() => {
    if (mapRef.current || !mapContainerRef.current) return;

    const map = new MaplibreMap({
      container: mapContainerRef.current,
      style: {
        version: 8,
        glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
        sources: {
          "esri-satellite": {
            type: "raster",
            tiles: [ESRI_IMAGERY_URL],
            tileSize: 256,
            attribution: "Tiles © Esri",
            maxzoom: 19,
          },
          "terrain-dem": {
            type: "raster-dem",
            tiles: [TERRAIN_RGB_URL],
            encoding: "terrarium",
            tileSize: 256,
            maxzoom: 15,
          },
          "carto-labels": {
            type: "raster",
            tiles: CARTO_LABEL_URLS,
            tileSize: 256,
            attribution: "© OpenStreetMap contributors © CARTO",
            maxzoom: 19,
          },
        },
        layers: [
          { id: "satellite-base", type: "raster", source: "esri-satellite" },
          {
            id: "labels-overlay",
            type: "raster",
            source: "carto-labels",
            paint: { "raster-opacity": 0.95 },
          },
        ],
      },
      center: SJB_COORDS,
      zoom: 13.2,
      maxPitch: 60,
    });

    mapRef.current = map;
    map.addControl(new NavigationControl({ visualizePitch: true }), "top-right");

    let abort = new AbortController();
    let settleTimer: number | undefined;
    let fetchGen = 0;

    const pinOverlayToViewport = () => {
      const coords = viewportCoordinates(map);
      const topo = map.getSource("copernicus-topo") as ImageSource | undefined;
      topo?.setCoordinates(coords);
      const spill = map.getSource("inundation-spill") as ImageSource | undefined;
      spill?.setCoordinates(coords);
    };

    const refreshViewport = () => {
      abort.abort();
      abort = new AbortController();
      const { signal } = abort;
      const gen = (fetchGen += 1);
      const bbox = bboxFromViewport(map);
      setTopoStatus("loading");
      setTopoMeta("Atualizando relevo e transbordo para a vista…");

      loadCopernicusTopoOverlay(bbox, signal)
        .then(async (overlay) => {
          if (gen !== fetchGen || signal.aborted) return;
          topoOverlayRef.current = overlay;
          applyTopoOverlay(map, overlay);
          await paintSpillRef.current(overlay);
          if (gen !== fetchGen) return;
          setTopoStatus("ready");
          setTopoMeta(
            `COP-DEM GLO-30 · ${overlay.tileCount} tile${overlay.tileCount === 1 ? "" : "s"} · ${Math.round(overlay.elevationMinM)}–${Math.round(overlay.elevationMaxM)} m`,
          );
        })
        .catch((error: unknown) => {
          if (signal.aborted || gen !== fetchGen) return;
          if (error instanceof DOMException && error.name === "AbortError") return;
          console.error(error);
          setTopoStatus("error");
          setTopoMeta("Falha ao carregar relevo Copernicus para a vista atual.");
        });
    };

    const scheduleViewportSync = () => {
      window.clearTimeout(settleTimer);
      setTopoStatus("settling");
      setTopoMeta(`Vista alterada — atualizando relevo e transbordo em ${VIEWPORT_SETTLE_MS / 1000} s…`);
      settleTimer = window.setTimeout(() => {
        refreshViewport();
      }, VIEWPORT_SETTLE_MS);
    };

    refreshViewportRef.current = refreshViewport;
    scheduleViewportRef.current = scheduleViewportSync;

    map.on("load", () => {
      map.resize();

      map.addSource("river-line", {
        type: "geojson",
        data: riverLineGeoJSON(),
      });
      map.addSource("city-points", {
        type: "geojson",
        data: cityPointsGeoJSON(),
      });

      map.addLayer(
        {
          id: "river-line",
          type: "line",
          source: "river-line",
          paint: {
            "line-color": "#56cfe1",
            "line-width": 2.2,
            "line-opacity": 0.95,
          },
        },
        "labels-overlay",
      );

      map.addLayer(
        {
          id: "city-dots",
          type: "circle",
          source: "city-points",
          paint: {
            "circle-radius": 4,
            "circle-color": "#ffd166",
            "circle-stroke-width": 1,
            "circle-stroke-color": "#111",
          },
        },
        "labels-overlay",
      );

      map.addLayer(
        {
          id: "city-labels",
          type: "symbol",
          source: "city-points",
          layout: {
            "text-field": ["get", "name"],
            "text-size": 11,
            "text-offset": [0, 1.1],
            "text-anchor": "top",
          },
          paint: {
            "text-color": "#f8f9fa",
            "text-halo-color": "#111",
            "text-halo-width": 1.2,
          },
        },
        "labels-overlay",
      );

      refreshViewport();
    });

    map.on("move", pinOverlayToViewport);
    map.on("moveend", scheduleViewportSync);
    map.on("zoomend", scheduleViewportSync);

    return () => {
      abort.abort();
      window.clearTimeout(settleTimer);
      map.remove();
      mapRef.current = null;
    };
  }, [applyTopoOverlay]);

  useEffect(() => {
    waterLevelCmRef.current = waterLevelCm;
  }, [waterLevelCm]);

  useEffect(() => {
    heatmapModeRef.current = heatmapMode;
  }, [heatmapMode]);

  useEffect(() => {
    forecastDaysRef.current = forecastDays;
  }, [forecastDays]);

  useEffect(() => {
    hydroRef.current = hydro;
  }, [hydro]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void paintSpill();
    }, 80);
    return () => window.clearTimeout(timer);
  }, [paintSpill, waterLevelCm, heatmapMode, forecastDays, hydro]);

  useEffect(() => {
    const abort = new AbortController();
    loadHydroSnapshot(abort.signal)
      .then((snapshot) => {
        setHydro(snapshot);
        setHydroError(null);
      })
      .catch((error: unknown) => {
        if (abort.signal.aborted) return;
        console.error(error);
        setHydroError("Falha ao cruzar Open-Meteo e ANA HidroWeb.");
      });
    return () => abort.abort();
  }, []);

  useEffect(() => {
    topoOpacityRef.current = topoOpacity;
    const map = mapRef.current;
    if (!map?.getLayer("topo-overlay")) return;
    map.setPaintProperty("topo-overlay", "raster-opacity", topoOpacity / 100);
  }, [topoOpacity]);

  const displayFlow = hydro?.gauge_flow_m3s ?? 0;
  const forecastRainMm = rainForForecastDays(hydro, forecastDays);
  const forecastRise = forecastStaffM(hydro, forecastDays);
  const displayRise = forecastRainMm * 0.05;

  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        background: "#111",
        color: "#fff",
        overflow: "hidden",
        fontFamily: "sans-serif",
      }}
    >
      <div
        style={{
          width: "350px",
          flexShrink: 0,
          background: "#1f1f1f",
          padding: "24px",
          display: "flex",
          flexDirection: "column",
          gap: "20px",
          borderRight: "1px solid #333",
          zIndex: 10,
          overflowY: "auto",
        }}
      >
        <div>
          <h2
            style={{ color: "#00b4d8", margin: "0 0 5px 0", fontSize: "20px" }}
          >
            Refúgio: Vale Alerta
          </h2>
          <p style={{ color: "#aaa", fontSize: "12px", margin: 0 }}>
            Simulador Regional de Escoamento e Inundação
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label
            style={{
              fontSize: "11px",
              textTransform: "uppercase",
              color: "#888",
              fontWeight: "bold",
              display: "flex",
              alignItems: "center",
            }}
          >
            Município do vale
            <InfoTip text="Cidades do caminho de escoamento do Rio Tijucas (SC-410): Rancho Queimado (nascentes), Angelina, Major Gercino, Nova Trento (Ribeirão Alferes), São João Batista, Canelinha e Tijucas (foz). Ao escolher, o mapa voa até o município e, após 1 s, recarrega relevo e heatmap com os sliders atuais." />
          </label>
          <select
            value={focusCityId}
            onChange={(e) => {
              const id = e.target.value;
              const city = VALLEY_MAP_CITIES.find((c) => c.id === id);
              setFocusCityId(id);
              const map = mapRef.current;
              if (!city || !map) return;
              map.stop();
              map.flyTo({
                center: [city.lon, city.lat],
                zoom: city.zoom,
                duration: 1200,
                essential: true,
              });
              map.once("moveend", () => {
                scheduleViewportRef.current();
              });
            }}
            style={{
              width: "100%",
              background: "#2d2d2d",
              color: "#fff",
              border: "1px solid #444",
              borderRadius: 6,
              padding: "8px 10px",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            {VALLEY_MAP_CITIES.map((city) => (
              <option key={city.id} value={city.id}>
                {city.name}
              </option>
            ))}
          </select>
          <p style={{ margin: 0, fontSize: 11, color: "#888", lineHeight: 1.4 }}>
            {VALLEY_MAP_CITIES.find((c) => c.id === focusCityId)?.blurb}
          </p>
          <button
            type="button"
            onClick={() => {
              const live = hydro?.gauge_stage_cm;
              setWaterLevelCm(
                live != null && Number.isFinite(live)
                  ? Math.round(Math.min(1200, Math.max(0, live)))
                  : SJB_NORMAL_STAGE_CM,
              );
              setTimeWindow(4);
              setForecastDays(1);
              setHeatmapMode("now");
            }}
            style={{
              background: "#2d2d2d",
              border: "1px solid #444",
              color: "#fff",
              borderRadius: 6,
              padding: "8px 10px",
              cursor: "pointer",
              fontSize: 12,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            Resetar para condições normais
            <InfoTip text="Volta a régua ao nível natural (cota ANA ao vivo, ou ~30 cm), zera a chuva simulada e põe a janela em +4 h — o tempo típico da onda de Major Gercino até SJB." />
          </button>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            background: "#2d2d2d",
            borderRadius: "6px",
            padding: "2px",
            gap: 4,
          }}
        >
          <button
            onClick={() => setActiveTab("simulador")}
            style={{
              flex: 1,
              padding: "8px",
              border: 0,
              borderRadius: "4px",
              background: activeTab === "simulador" ? "#0077b6" : "transparent",
              color: "#fff",
              cursor: "pointer",
              fontSize: "13px",
              fontWeight: "bold",
            }}
          >
            🔮 Simulador
          </button>
          <button
            onClick={() => setActiveTab("live")}
            style={{
              flex: 1,
              padding: "8px",
              border: 0,
              borderRadius: "4px",
              background: activeTab === "live" ? "#e63946" : "transparent",
              color: "#fff",
              cursor: "pointer",
              fontSize: "13px",
              fontWeight: "bold",
            }}
          >
            🛰️ Tempo Real
          </button>
          <InfoTip
            text={
              activeTab === "simulador"
                ? "Simulador: a régua (Agora) ou a previsão de 7 dias cruzam o DEM. Open-Meteo alimenta o acúmulo de chuva da captação a montante."
                : "Tempo Real: chuva Open-Meteo 7 dias e vazão/cota ANA. Troque a camada para Previsão 7d para ver a inundação prevista no relevo."
            }
          />
        </div>

        <hr style={{ border: 0, borderTop: "1px solid #333", margin: 0 }} />

        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <label
            style={{
              fontSize: "11px",
              textTransform: "uppercase",
              color: "#888",
              fontWeight: "bold",
              display: "flex",
              alignItems: "center",
            }}
          >
            ⛰️ Overlay de relevo (Copernicus):{" "}
            <span style={{ marginLeft: "auto", color: "#00b4d8" }}>
              {topoOpacity}%
            </span>
            <InfoTip text="Hillshade do Copernicus DEM GLO-30 (30 m) na área visível. Após mover o mapa ou trocar de cidade, espera 1 s e recarrega relevo + heatmap. O slider só muda a opacidade." />
          </label>
          <input
            type="range"
            min="0"
            max="100"
            value={topoOpacity}
            onChange={(e) => setTopoOpacity(Number(e.target.value))}
            style={{ width: "100%", cursor: "pointer" }}
          />
          <p style={{ margin: 0, fontSize: "11px", color: "#888", lineHeight: 1.4 }}>
            {topoStatus === "settling" && topoMeta}
            {topoStatus === "loading" && (topoMeta ?? "Carregando relevo Copernicus para a vista…")}
            {topoStatus === "ready" && topoMeta}
            {topoStatus === "error" && topoMeta}
          </p>
        </div>

        <div>
          <div style={{ display: "flex", alignItems: "center", fontSize: 11, color: "#888", fontWeight: "bold", textTransform: "uppercase", marginBottom: 8 }}>
            Camada de inundação
            <InfoTip text="Agora: heatmap da régua cruzada com o DEM. Previsão 7d: mesma escala de cores, mas a cota é a etapa ANA atual mais a subida pela chuva Open-Meteo acumulada até o dia do slider (Rancho Queimado, Angelina e Major Gercino). Ocultar desliga o overlay." />
          </div>
          <div style={{ display: "flex", background: "#2d2d2d", borderRadius: 6, padding: 2, gap: 2 }}>
            {(
              [
                ["off", "Ocultar"],
                ["now", "Agora"],
                ["forecast", "Previsão 7d"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setHeatmapMode(id)}
                style={{
                  flex: 1,
                  padding: "7px 4px",
                  border: 0,
                  borderRadius: 4,
                  background: heatmapMode === id ? "#0077b6" : "transparent",
                  color: "#fff",
                  cursor: "pointer",
                  fontSize: 11,
                  fontWeight: "bold",
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 10, color: "#aaa" }}>
          <div style={{ display: "flex", alignItems: "center", fontSize: 11, color: "#888", fontWeight: "bold", textTransform: "uppercase" }}>
            Escala de profundidade
            <InfoTip text={`Cada cor é a altura da água sobre o terreno nas primeiras áreas alagadas (cota de transbordo ${SJB_SPILL_STAGE_M} m + essa profundidade). A linha em mm/h é a chuva upstream sustentada por ${CRITICAL_RAIN_H} h para chegar naquele nível: ΔH = chuva×0,05 + Q/250.`} />
          </div>
          <div style={{ display: "flex", height: 10, borderRadius: 4, overflow: "hidden" }}>
            {DEPTH_SCALE.map((stop) => (
              <div key={stop.cm} style={{ flex: 1, background: stop.color }} />
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 2 }}>
            {DEPTH_SCALE.map((stop) => (
              <span key={stop.cm} style={{ flex: 1, textAlign: "center", fontSize: 9 }}>
                {stop.cm}
              </span>
            ))}
            <span style={{ width: 28, fontSize: 8, color: "#666" }}>cm</span>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 2, color: "#7FDBFA" }}>
            {DEPTH_SCALE.map((stop) => {
              const mmh = rainMmPerHourForInlandCm(stop.cm, displayFlow || 40);
              return (
                <span key={stop.cm} style={{ flex: 1, textAlign: "center", fontSize: 8, lineHeight: 1.2 }}>
                  {mmh.toFixed(0)}
                </span>
              );
            })}
            <span style={{ width: 28, fontSize: 8, color: "#666" }}>mm/h</span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <label
            style={{
              fontSize: "11px",
              textTransform: "uppercase",
              color: "#888",
              fontWeight: "bold",
              display: "flex",
              alignItems: "center",
            }}
          >
            🌊 Nível do rio (régua)
            <InfoTip text="Zero = nível natural no leito (DEM local), não o nível do mar. Em SJB a Defesa Civil registra ruas alagadas a partir de 6 m nesta régua. Picos: 6,85 m (maio/2024) e ~9 m (dez/2022). A ANA 84095500 em cm é o mesmo zero em estiagem. O heatmap usa este valor contra o relevo visível." />
            <span style={{ marginLeft: "auto", color: "#00b4d8" }}>
              {(waterLevelCm / 100).toFixed(2)} m
            </span>
          </label>
          <input
            type="range"
            min="0"
            max="1200"
            step="5"
            value={waterLevelCm}
            onChange={(e) => setWaterLevelCm(Number(e.target.value))}
            style={{ width: "100%", cursor: "pointer" }}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <label
            style={{
              fontSize: "11px",
              textTransform: "uppercase",
              color: "#888",
              fontWeight: "bold",
              display: "flex",
              alignItems: "center",
            }}
          >
            🌧️ Acúmulo previsto (Open-Meteo)
            <InfoTip text="Chuva horária Open-Meteo (GFS/ECMWF e outros), sem chave de API, nos pontos de captação a montante. O slider escolhe quantos dos próximos 7 dias somar. A camada Previsão 7d usa essa soma para subir o rio no relevo, com as mesmas cores de profundidade." />
            <span style={{ marginLeft: "auto", color: "#00b4d8" }}>
              {forecastDays}d · {forecastRainMm.toFixed(0)} mm
            </span>
          </label>
          <input
            type="range"
            min="1"
            max="7"
            step="1"
            value={forecastDays}
            onChange={(e) => setForecastDays(Number(e.target.value))}
            style={{ width: "100%", cursor: "pointer" }}
          />
          <p style={{ margin: 0, fontSize: 11, color: "#888" }}>
            Subida estimada +{displayRise.toFixed(2)} m · cota prevista {forecastRise.toFixed(2)} m
          </p>
        </div>

        {activeTab === "simulador" ? (
          <div
            style={{ display: "flex", flexDirection: "column", gap: "20px" }}
          >
            <div
              style={{ display: "flex", flexDirection: "column", gap: "8px" }}
            >
              <label
                style={{
                  fontSize: "11px",
                  textTransform: "uppercase",
                  color: "#888",
                  fontWeight: "bold",
                  display: "flex",
                  alignItems: "center",
                }}
              >
                ⏱️ Janela de escape
                <InfoTip text="Horas até o pico estimado em São João Batista. A onda de Major Gercino leva ~4 h. Não muda sozinha o heatmap; serve para o cenário de chuva/tempo real." />
                <span style={{ marginLeft: "auto", color: "#00b4d8" }}>
                  +{timeWindow}h
                </span>
              </label>
              <input
                type="range"
                min="1"
                max="12"
                value={timeWindow}
                onChange={(e) => setTimeWindow(Number(e.target.value))}
                style={{ width: "100%", cursor: "pointer" }}
              />
            </div>

            <p
              style={{
                background: "#2a2a2a",
                padding: "12px",
                borderRadius: "6px",
                fontSize: "12px",
                color: "#ccc",
                lineHeight: "1.4",
                borderLeft: "4px solid #00b4d8",
                margin: 0,
                display: "flex",
                alignItems: "flex-start",
                gap: 6,
              }}
            >
              <span>
                ΔH chuva (Open-Meteo {forecastDays}d) ≈ <b>{displayRise.toFixed(2)} m</b>
              </span>
              <InfoTip text="Subida só pela chuva prevista: mm acumulados × 0,05. A cota no mapa (Previsão 7d) é a régua ANA atual mais esse ΔH. Pico de Major Gercino chega a SJB em ~4 h." />
            </p>
            {hydro && (
              <p style={{ margin: 0, fontSize: "11px", color: "#888", lineHeight: 1.5 }}>
                {hydro.rainfall.map((r) => `${r.name} 7d ${r.accum_7d_mm} mm`).join(" · ")}
              </p>
            )}
          </div>
        ) : (
          <div style={{ fontSize: "12px", color: "#bbb", lineHeight: "1.45" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: 12 }}>
              <label style={{ fontSize: "11px", textTransform: "uppercase", color: "#888", fontWeight: "bold", display: "flex", alignItems: "center" }}>
                ⏱️ Horizonte da onda
                <InfoTip text="No modo ao vivo, recorta a chuva Open-Meteo neste horizonte para estimar o ΔH que ainda pode chegar a SJB." />
                <span style={{ marginLeft: "auto", color: "#00b4d8" }}>+{timeWindow}h</span>
              </label>
              <input
                type="range"
                min="1"
                max="12"
                value={timeWindow}
                onChange={(e) => setTimeWindow(Number(e.target.value))}
                style={{ width: "100%", cursor: "pointer" }}
              />
            </div>
            {hydroError && <p style={{ color: "#e63946" }}>{hydroError}</p>}
            {!hydro && !hydroError && <p>Cruzando Open-Meteo × ANA HidroWeb…</p>}
            {hydro && (
              <>
                <p style={{ margin: "0 0 8px" }}>
                  Chuva prevista {forecastDays}d {forecastRainMm.toFixed(1)} mm ·
                  subida +{displayRise.toFixed(2)} m · cota {forecastRise.toFixed(2)} m ·
                  lag {hydro.lag_major_gercino_to_sjb_h} h
                </p>
                <p style={{ margin: "0 0 8px" }}>
                  Telemetria ANA: Q {hydro.gauge_flow_m3s.toFixed(1)} m³/s
                  {hydro.gauge_stage_cm != null
                    ? ` · cota ${hydro.gauge_stage_cm.toFixed(0)} cm`
                    : ""}
                </p>
                {hydro.gauges.map((g) => (
                  <p key={g.id} style={{ margin: "0 0 4px", color: "#999" }}>
                    {g.online ? "●" : "○"} {g.name} ({g.code}){" "}
                    {g.online
                      ? `${g.flow_m3s?.toFixed(1) ?? "—"} m³/s`
                      : "sem telemetria — usando baseline SJB"}
                  </p>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      <div
        style={{ flex: 1, position: "relative", width: "100%", height: "100%" }}
      >
        <div
          ref={mapContainerRef}
          style={{
            width: "100%",
            height: "100%",
            position: "absolute",
            top: 0,
            left: 0,
          }}
        />
      </div>
    </div>
  );
}
