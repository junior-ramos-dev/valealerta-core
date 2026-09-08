import { useState, useEffect, useRef, useCallback } from "react";
import {
  Map as MaplibreMap,
  NavigationControl,
  type GeoJSONSource,
  type ImageSource,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  bboxFromViewport,
  bboxToCoordinates,
  loadCopernicusTopoOverlay,
  sampleElevationM,
  type CopernicusTopoOverlay,
} from "./copernicusDem";
import {
  cityPointsGeoJSON,
  loadHydroSnapshot,
  formatHydroClock,
  hydroForecastAgeLabel,
  rainForForecastDays,
  rainForHorizon,
  grossRainForForecastDays,
  grossRainForHorizon,
  rainMmPerHourForInlandCm,
  forecastStaffM,
  floodOccupancy,
  effectiveRainMm,
  riverLineGeoJSON,
  CRITICAL_RAIN_H,
  forecastHorizonLabel,
  forecastHorizonHours,
  todayHorizonLabel,
  type HydroSnapshot,
} from "./hydro";
import {
  bootstrapRegion,
  getRegion,
  loadRegionPack,
  nearestCity,
  riverBranchIdsForCity,
  setActiveRegion,
  staffForCity,
  storeRegionId,
  surgeLagH,
  type RegionCatalog,
  type RegionPack,
} from "./region";
import { prepareBasinOffline } from "./offlineBasin";
import { PwaGuideDialog } from "./PwaGuide";
import {
  renderSpillHeatmap,
  DEPTH_SCALE,
  depthScaleStop,
  estimateChannelThalwegM,
} from "./inundation";
import {
  downloadPatchesGeoJSON,
  loadBundledPatches,
  loadLocalPatches,
  loadDeletedPatchIds,
  saveDeletedPatchIds,
  drawPointsFromPatch,
  makeLocalPatch,
  meanElevationInPatch,
  mergePatchChecks,
  mergePatches,
  patchesContentKey,
  patchesToCollection,
  saveLocalPatches,
  type TopoPatchFeature,
} from "./topoPatches";
import { SidebarDock, SidebarSection } from "./SidebarSection";
import { PatchLoginForm } from "./PatchLoginForm";
import { dummyLogout, readDummySession } from "./dummyAuth";
import "./App.css";

function depthLabelColor(rgba: [number, number, number, number]): string {
  const luminance = (0.299 * rgba[0] + 0.587 * rgba[1] + 0.114 * rgba[2]) / 255;
  return luminance > 0.55 ? "#0b1b2b" : "#fff";
}

function fmtLatLon(lat: number, lon: number): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "L" : "O";
  return `${Math.abs(lat).toFixed(5)}° ${ns}  ${Math.abs(lon).toFixed(5)}° ${ew}`;
}

function patchDemCaption(p: {
  properties: {
    dem_status?: "active" | "absorbed" | "review";
    force_active?: boolean;
    baseline_z_m?: number;
    last_dem_z_m?: number;
  };
}): string {
  const { dem_status: status, force_active, baseline_z_m: base, last_dem_z_m: now } =
    p.properties;
  const zBit =
    base != null && now != null
      ? ` · DEM ${now.toFixed(1)} m (base ${base.toFixed(1)} m)`
      : "";
  if (force_active) return `forçado no modelo${zBit}`;
  if (status === "absorbed")
    return `Copernicus já inclui o Δz — não somado${zBit}`;
  if (status === "review") return `DEM mudou de outro jeito — conferir${zBit}`;
  return `ativo no modelo${zBit}`;
}

type MapProbe = {
  lon: number;
  lat: number;
  zM: number | null;
  pinned: boolean;
  origin: "cursor" | "center" | "pin";
  x: number;
  y: number;
};

function MapProbeFields({
  probe,
  staffNowM,
  thalwegM,
  waterSurfaceM,
  onFollowMap,
}: {
  probe: MapProbe;
  staffNowM: number;
  thalwegM: number | null;
  waterSurfaceM: number | null;
  onFollowMap: () => void;
}) {
  return (
    <>
      <div className="map-probe-coords">{fmtLatLon(probe.lat, probe.lon)}</div>
      <div className="map-probe-meta">
        Terreno{" "}
        {probe.zM != null && Number.isFinite(probe.zM)
          ? `${probe.zM.toFixed(1)} m`
          : "—"}{" "}
        <span className="map-probe-hint map-probe-hint-detail">
          (Copernicus GLO-30 ~30 m · aterro recente pode não estar no relevo)
        </span>
      </div>
      <div className="map-probe-meta">
        Régua {staffNowM.toFixed(2)} m
        {thalwegM != null && Number.isFinite(thalwegM)
          ? ` · leito ~${thalwegM.toFixed(1)} m`
          : ""}
        {waterSurfaceM != null
          ? ` · superfície d’água ~${waterSurfaceM.toFixed(1)} m`
          : ""}
      </div>
      {probe.zM != null && waterSurfaceM != null && (
        <div className="map-probe-rel">
          {probe.zM - waterSurfaceM >= 0
            ? `${(probe.zM - waterSurfaceM).toFixed(1)} m acima da água`
            : `${(waterSurfaceM - probe.zM).toFixed(1)} m abaixo da água (inundado)`}
        </div>
      )}
      <div className="map-probe-actions">
        {probe.pinned ? (
          <button type="button" onClick={onFollowMap}>
            Seguir o mapa
          </button>
        ) : (
          <span className="map-probe-hint">
            {probe.origin === "center"
              ? "Centro da vista · toque no mapa para fixar"
              : "Clique no mapa para fixar o ponto"}
          </span>
        )}
      </div>
    </>
  );
}

function liveStageCm(hydro: HydroSnapshot | null): number | null {
  const v = hydro?.gauge_stage_cm;
  if (v == null || !Number.isFinite(v) || v < 0) return null;
  return Math.round(v);
}

function hydroStatusBanner(
  online: boolean,
  hydro: HydroSnapshot | null,
): string | null {
  if (online && !hydro?.from_cache) return null;
  const clock = hydro ? formatHydroClock(hydro.fetched_at) : null;
  const age = hydro ? hydroForecastAgeLabel(hydro.fetched_at) : null;
  const base = online
    ? clock
      ? `Sem dados ao vivo · última cota ${clock}`
      : "Sem dados ao vivo"
    : clock
      ? `Offline · cota ANA de ${clock}`
      : "Offline";
  return age ? `${base} · ${age}` : base;
}

function LayerLamp({ on, liveLabel }: { on: boolean; liveLabel: string }) {
  return (
    <span
      className="layer-lamp"
      title={on ? `${liveLabel} no mapa` : "Outra camada no mapa"}
    >
      <span className={`layer-lamp-dot ${on ? "on" : "off"}`} />
      {on ? `💡 ${liveLabel}` : "○ pausado"}
    </span>
  );
}

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
  const [region, setRegion] = useState<RegionPack | null>(null);
  const [catalog, setCatalog] = useState<RegionCatalog | null>(null);
  const [regionError, setRegionError] = useState<string | null>(null);

  const [timeWindow, setTimeWindow] = useState<number>(4);
  const [forecastDays, setForecastDays] = useState<number>(3);
  const [heatmapMode, setHeatmapMode] = useState<"now" | "forecast">("now");
  const [topoOpacity, setTopoOpacity] = useState<number>(45);
  const [topoStatus, setTopoStatus] = useState<
    "settling" | "loading" | "ready" | "error"
  >("loading");
  const [topoMeta, setTopoMeta] = useState<string | null>(null);
  const [liveRiver, setLiveRiver] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [hydro, setHydro] = useState<HydroSnapshot | null>(null);
  const [hydroError, setHydroError] = useState<string | null>(null);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [basinPrep, setBasinPrep] = useState<"idle" | "working" | "done" | "error">(
    "idle",
  );
  const [basinPrepNote, setBasinPrepNote] = useState<string | null>(null);
  const [pwaGuideOpen, setPwaGuideOpen] = useState(false);
  const [waterLevelCm, setWaterLevelCm] = useState(30);
  const [spillStageM, setSpillStageM] = useState(6);
  const [focusCityId, setFocusCityId] = useState<string>("");
  const [heatmapEpoch, setHeatmapEpoch] = useState(0);
  const [probe, setProbe] = useState<MapProbe | null>(null);
  const [hudHeld, setHudHeld] = useState(false);
  const [sheetLayout, setSheetLayout] = useState(
    () => window.matchMedia("(max-width: 768px)").matches,
  );
  const [thalwegM, setThalwegM] = useState<number | null>(null);
  const probePinnedRef = useRef(false);
  const drawingRef = useRef(false);
  const flyingToCityRef = useRef(false);
  const reguaTouchedRef = useRef(false);
  const focusCityIdRef = useRef("");
  const applyCityStaffRef = useRef<(cityId: string, resetRegua: boolean) => void>(
    () => {},
  );
  const drawPointsRef = useRef<[number, number][]>([]);
  const patchesRef = useRef<TopoPatchFeature[]>([]);
  const patchesHydratedRef = useRef(false);
  const patchesDemKeyRef = useRef<string | null>(null);
  const [patches, setPatches] = useState<TopoPatchFeature[]>([]);
  const [drawingPatch, setDrawingPatch] = useState(false);
  const [drawPoints, setDrawPoints] = useState<[number, number][]>([]);
  const [editingPatchId, setEditingPatchId] = useState<string | null>(null);
  const [deletedPatchIds, setDeletedPatchIds] = useState<string[]>([]);
  const [patchDeltaM, setPatchDeltaM] = useState(2);
  const [patchName, setPatchName] = useState("");
  const [canEditPatches, setCanEditPatches] = useState(readDummySession);
  const topoOpacityRef = useRef(topoOpacity);
  const waterLevelCmRef = useRef(waterLevelCm);
  const heatmapModeRef = useRef(heatmapMode);
  const forecastDaysRef = useRef(forecastDays);
  const timeWindowRef = useRef(timeWindow);
  const hydroRef = useRef(hydro);
  const liveRiverRef = useRef(liveRiver);
  const spillStageMRef = useRef(spillStageM);

  const topoOverlayRef = useRef<CopernicusTopoOverlay | null>(null);

  const applyTopoOverlay = useCallback(
    (map: MaplibreMap, overlay: CopernicusTopoOverlay) => {
      const coordinates = overlay.coordinates;
      const existing = map.getSource("copernicus-topo") as
        | ImageSource
        | undefined;
      if (!existing) {
        map.addSource("copernicus-topo", {
          type: "image",
          coordinates,
        });
      }
      (map.getSource("copernicus-topo") as ImageSource).updateImage({
        image: overlay.image,
        coordinates,
      });
      (map.getSource("copernicus-topo") as ImageSource).setCoordinates(coordinates);
      if (!map.getLayer("topo-overlay")) {
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
      }
      map.triggerRepaint();
    },
    [],
  );

  const applyInundationOverlay = useCallback(
    (
      map: MaplibreMap,
      image: HTMLCanvasElement,
      coordinates: CopernicusTopoOverlay["coordinates"],
    ) => {
      if (map.getLayer("inundation-layer")) {
        map.removeLayer("inundation-layer");
      }
      if (map.getSource("inundation-spill")) {
        map.removeSource("inundation-spill");
      }
      map.addSource("inundation-spill", {
        type: "image",
        coordinates,
      });
      (map.getSource("inundation-spill") as ImageSource).updateImage({
        image,
        coordinates,
      });
      map.addLayer(
        {
          id: "inundation-layer",
          type: "raster",
          source: "inundation-spill",
          layout: { visibility: "visible" },
          paint: {
            "raster-opacity": 0.85,
            "raster-resampling": "linear",
            "raster-fade-duration": 0,
          },
        },
        "labels-overlay",
      );
      map.triggerRepaint();
    },
    [],
  );

  const paintSpill = useCallback(
    async (demOverride?: CopernicusTopoOverlay | null) => {
      const map = mapRef.current;
      const dem = demOverride ?? topoOverlayRef.current;
      if (!map?.isStyleLoaded() || !dem) return;
      // Agora: régua. Previsão: régua (piso ANA) + chuva efetiva × coeff.
      const staffM =
        heatmapModeRef.current === "forecast"
          ? forecastStaffM(
              hydroRef.current,
              forecastDaysRef.current,
              waterLevelCmRef.current,
            )
          : waterLevelCmRef.current / 100;
      // Só o excesso sobre o transbordo vira lâmina no DEM (evita 5 m ANA = 2 m de rua).
      const extraAboveSpillM = Math.max(0, staffM - spillStageMRef.current);
      const branchIds = riverBranchIdsForCity(
        getRegion(),
        focusCityIdRef.current,
      );
      // Sementes só no braço da cidade; extraAboveSpillM = 0 → sem mancha nas ruas.
      try {
        const image = await renderSpillHeatmap(
          dem.elevations,
          dem.width,
          dem.height,
          dem.bbox,
          extraAboveSpillM,
          timeWindowRef.current,
          false,
          dem.viewBbox,
          branchIds,
        );
        if (!mapRef.current) return;
        if (topoOverlayRef.current !== dem) return;
        applyInundationOverlay(map, image, bboxToCoordinates(dem.bbox));
      } catch (error) {
        console.error(error);
      }
    },
    [applyInundationOverlay],
  );

  const paintSpillRef = useRef(paintSpill);
  const setHeatmapEpochRef = useRef(setHeatmapEpoch);
  const refreshViewportRef = useRef<() => void>(() => {});
  const scheduleViewportRef = useRef<() => void>(() => {});
  useEffect(() => {
    paintSpillRef.current = paintSpill;
  }, [paintSpill]);
  useEffect(() => {
    setHeatmapEpochRef.current = setHeatmapEpoch;
  }, []);

  useEffect(() => {
    focusCityIdRef.current = focusCityId;
  }, [focusCityId]);

  useEffect(() => {
    applyCityStaffRef.current = (cityId, resetRegua) => {
      const pack = region;
      if (!pack) return;
      const staff = staffForCity(pack, cityId);
      focusCityIdRef.current = staff.city_id;
      setFocusCityId(staff.city_id);
      setSpillStageM(staff.spill_stage_m);
      if (resetRegua) {
        reguaTouchedRef.current = false;
        const live = liveRiverRef.current ? liveStageCm(hydroRef.current) : null;
        setWaterLevelCm(live ?? staff.normal_stage_cm);
      }
    };
  }, [region]);

  useEffect(() => {
    const abort = new AbortController();
    bootstrapRegion(abort.signal)
      .then(({ catalog: nextCatalog, pack }) => {
        if (abort.signal.aborted) return;
        setCatalog(nextCatalog);
        setRegion(pack);
        const staff = staffForCity(pack, pack.target_city_id);
        setFocusCityId(staff.city_id);
        setWaterLevelCm(staff.normal_stage_cm);
        setSpillStageM(staff.spill_stage_m);
        reguaTouchedRef.current = false;
        setTimeWindow(Math.max(1, Math.min(12, Math.round(surgeLagH(pack)))));
        setRegionError(null);
      })
      .catch((error: unknown) => {
        if (abort.signal.aborted) return;
        console.error(error);
        setRegionError("Falha ao carregar o pacote de região.");
      });
    return () => abort.abort();
  }, []);

  const applyRegionPack = (pack: RegionPack) => {
    setActiveRegion(pack);
    storeRegionId(pack.id);
    setRegion(pack);
    const staff = staffForCity(pack, pack.target_city_id);
    setFocusCityId(staff.city_id);
    setWaterLevelCm(staff.normal_stage_cm);
    setSpillStageM(staff.spill_stage_m);
    reguaTouchedRef.current = false;
    setTimeWindow(Math.max(1, Math.min(12, Math.round(surgeLagH(pack)))));
    setForecastDays(1);
    setHeatmapMode("now");
    setHydro(null);
    patchesHydratedRef.current = false;
    setPatches([]);
    setDeletedPatchIds([]);
  };

  const switchRegion = (id: string) => {
    if (!id || id === region?.id) return;
    void loadRegionPack(id)
      .then(applyRegionPack)
      .catch((error: unknown) => {
        console.error(error);
        setRegionError("Falha ao trocar de bacia.");
      });
  };

  useEffect(() => {
    if (!region || mapRef.current || !mapContainerRef.current) return;

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
      center: [region.region.center.lon, region.region.center.lat],
      zoom: region.region.default_zoom,
      maxPitch: 60,
    });

    mapRef.current = map;
    map.addControl(
      new NavigationControl({ visualizePitch: true }),
      "top-right",
    );

    let abort = new AbortController();
    let settleTimer: number | undefined;
    let fetchGen = 0;
    let inFlightDemKey = "";

    const refreshViewport = () => {
      if (!flyingToCityRef.current) {
        try {
          const pack = getRegion();
          const center = map.getCenter();
          const near = nearestCity(pack, center.lng, center.lat);
          if (near.id !== focusCityIdRef.current) {
            applyCityStaffRef.current(near.id, !reguaTouchedRef.current);
          }
        } catch {
          /* pack still loading */
        }
      }
      const bbox = bboxFromViewport(map);
      const demKey = `${bbox.west.toFixed(5)},${bbox.south.toFixed(5)},${bbox.east.toFixed(5)},${bbox.north.toFixed(5)}|${patchesContentKey(patchesRef.current)}`;
      if (demKey === inFlightDemKey) return;
      abort.abort();
      abort = new AbortController();
      const { signal } = abort;
      const gen = (fetchGen += 1);
      inFlightDemKey = demKey;
      setTopoStatus("loading");
      setTopoMeta("Atualizando relevo e transbordo para a vista…");

      loadCopernicusTopoOverlay(bbox, signal, patchesRef.current)
        .then(async (overlay) => {
          if (gen !== fetchGen || signal.aborted) return;
          topoOverlayRef.current = overlay;
          applyTopoOverlay(map, overlay);
          const bed = estimateChannelThalwegM(
            overlay.elevations,
            overlay.width,
            overlay.height,
            overlay.bbox,
            riverBranchIdsForCity(getRegion(), focusCityIdRef.current),
          );
          setThalwegM(Number.isFinite(bed) ? bed : null);
          setProbe((prev) => {
            if (!prev) {
              const c = map.getCenter();
              const point = map.project(c);
              return {
                lon: c.lng,
                lat: c.lat,
                zM: sampleElevationM(overlay, c.lng, c.lat),
                pinned: false,
                origin: "center",
                x: point.x,
                y: point.y,
              };
            }
            return { ...prev, zM: sampleElevationM(overlay, prev.lon, prev.lat) };
          });
          if (gen !== fetchGen) return;
          setPatches((prev) => mergePatchChecks(prev, overlay.patchChecks));
          setTopoStatus("ready");
          setTopoMeta(
            `COP-DEM GLO-30 · ${overlay.tileCount} tile${overlay.tileCount === 1 ? "" : "s"} · ${Math.round(overlay.elevationMinM)}–${Math.round(overlay.elevationMaxM)} m`,
          );
          setHeatmapEpochRef.current((n) => n + 1);
        })
        .catch((error: unknown) => {
          if (signal.aborted || gen !== fetchGen) return;
          if (error instanceof DOMException && error.name === "AbortError")
            return;
          if (inFlightDemKey === demKey) inFlightDemKey = "";
          console.error(error);
          setTopoStatus("error");
          setTopoMeta(
            "Falha ao carregar relevo Copernicus para a vista atual.",
          );
        });
    };

    const scheduleViewportSync = () => {
      const bbox = bboxFromViewport(map);
      const demKey = `${bbox.west.toFixed(5)},${bbox.south.toFixed(5)},${bbox.east.toFixed(5)},${bbox.north.toFixed(5)}|${patchesContentKey(patchesRef.current)}`;
      if (demKey === inFlightDemKey) return;
      window.clearTimeout(settleTimer);
      setTopoStatus("settling");
      setTopoMeta(
        `Vista alterada — atualizando relevo e transbordo em ${VIEWPORT_SETTLE_MS / 1000} s…`,
      );
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

      map.addSource("probe-point", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer(
        {
          id: "probe-point",
          type: "circle",
          source: "probe-point",
          paint: {
            "circle-radius": 6,
            "circle-color": "#00b4d8",
            "circle-stroke-width": 2,
            "circle-stroke-color": "#fff",
          },
        },
        "labels-overlay",
      );

      map.addSource("topo-patches", {
        type: "geojson",
        data: patchesToCollection(patchesRef.current),
      });
      map.addSource("topo-patch-draw", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer(
        {
          id: "topo-patches-fill",
          type: "fill",
          source: "topo-patches",
          paint: {
            "fill-color": "#f4d35e",
            "fill-opacity": 0.28,
          },
        },
        "labels-overlay",
      );
      map.addLayer(
        {
          id: "topo-patches-line",
          type: "line",
          source: "topo-patches",
          paint: {
            "line-color": "#f4d35e",
            "line-width": 2,
          },
        },
        "labels-overlay",
      );
      map.addLayer(
        {
          id: "topo-patch-draw-line",
          type: "line",
          source: "topo-patch-draw",
          paint: {
            "line-color": "#00b4d8",
            "line-width": 2,
            "line-dasharray": [2, 1],
          },
        },
        "labels-overlay",
      );
      map.addLayer(
        {
          id: "topo-patch-draw-points",
          type: "circle",
          source: "topo-patch-draw",
          paint: {
            "circle-radius": 7,
            "circle-color": "#00b4d8",
            "circle-stroke-width": 1,
            "circle-stroke-color": "#fff",
          },
        },
        "labels-overlay",
      );

      refreshViewport();
    });

    map.on("moveend", scheduleViewportSync);
    map.on("zoomend", scheduleViewportSync);

    let probeRaf = 0;
    const applyProbe = (
      lon: number,
      lat: number,
      pinned: boolean,
      point: { x: number; y: number },
      origin: "cursor" | "center" | "pin",
    ) => {
      const dem = topoOverlayRef.current;
      const zM = dem ? sampleElevationM(dem, lon, lat) : null;
      setProbe({ lon, lat, zM, pinned, origin, x: point.x, y: point.y });
      const src = map.getSource("probe-point") as GeoJSONSource | undefined;
      src?.setData(
        pinned
          ? {
              type: "FeatureCollection",
              features: [
                {
                  type: "Feature",
                  properties: {},
                  geometry: { type: "Point", coordinates: [lon, lat] },
                },
              ],
            }
          : { type: "FeatureCollection", features: [] },
      );
    };

    const followMapCenter = () => {
      if (probePinnedRef.current || drawingRef.current) return;
      const c = map.getCenter();
      applyProbe(c.lng, c.lat, false, map.project(c), "center");
    };

    map.on("mousemove", (event) => {
      if (drawingRef.current || probePinnedRef.current) return;
      if (window.matchMedia("(max-width: 768px)").matches) return;
      const { lng, lat } = event.lngLat;
      if (probeRaf) return;
      probeRaf = window.requestAnimationFrame(() => {
        probeRaf = 0;
        applyProbe(lng, lat, false, event.point, "cursor");
      });
    });

    map.on("move", () => {
      if (probePinnedRef.current || drawingRef.current) return;
      if (probeRaf) return;
      probeRaf = window.requestAnimationFrame(() => {
        probeRaf = 0;
        followMapCenter();
      });
    });

    map.on("mouseout", () => {
      followMapCenter();
    });

    map.on("click", (event) => {
      if (drawingRef.current) {
        const hits = map.queryRenderedFeatures(event.point, {
          layers: ["topo-patch-draw-points"],
        });
        const raw = hits[0]?.properties?.vertex;
        const vertex = typeof raw === "number" ? raw : Number(raw);
        if (Number.isInteger(vertex) && vertex >= 0) {
          const pts = drawPointsRef.current.filter((_, i) => i !== vertex);
          drawPointsRef.current = pts;
          setDrawPoints(pts);
          return;
        }
        const next: [number, number] = [event.lngLat.lng, event.lngLat.lat];
        const pts = [...drawPointsRef.current, next];
        drawPointsRef.current = pts;
        setDrawPoints(pts);
        return;
      }
      probePinnedRef.current = true;
      applyProbe(event.lngLat.lng, event.lngLat.lat, true, event.point, "pin");
    });

    map.on("moveend", followMapCenter);
    if (map.loaded()) followMapCenter();
    else map.once("load", followMapCenter);

    return () => {
      abort.abort();
      window.clearTimeout(settleTimer);
      window.cancelAnimationFrame(probeRaf);
      map.remove();
      mapRef.current = null;
    };
  }, [applyTopoOverlay, region]);

  useEffect(() => {
    const min = liveRiver ? liveStageCm(hydro) ?? 0 : 0;
    waterLevelCmRef.current = Math.max(min, waterLevelCm);
  }, [waterLevelCm, liveRiver, hydro]);

  useEffect(() => {
    heatmapModeRef.current = heatmapMode;
  }, [heatmapMode]);

  useEffect(() => {
    spillStageMRef.current = spillStageM;
  }, [spillStageM]);

  useEffect(() => {
    forecastDaysRef.current = forecastDays;
  }, [forecastDays]);

  useEffect(() => {
    timeWindowRef.current = timeWindow;
  }, [timeWindow]);

  useEffect(() => {
    hydroRef.current = hydro;
  }, [hydro]);

  useEffect(() => {
    liveRiverRef.current = liveRiver;
  }, [liveRiver]);

  useEffect(() => {
    if (!liveRiver) return;
    const min = liveStageCm(hydro);
    if (min == null) return;
    setWaterLevelCm((w) => (w < min ? min : w));
  }, [liveRiver, hydro]);

  useEffect(() => {
    if (!region) return;
    const abort = new AbortController();
    const id = region.id;
    patchesHydratedRef.current = false;
    Promise.all([
      loadBundledPatches(abort.signal, id),
      Promise.resolve(loadLocalPatches(id)),
    ])
      .then(([bundled, local]) => {
        if (abort.signal.aborted) return;
        const deleted = loadDeletedPatchIds(id);
        patchesHydratedRef.current = true;
        setDeletedPatchIds(deleted);
        setPatches(mergePatches(bundled, local, deleted));
      })
      .catch(() => {
        if (!abort.signal.aborted) {
          const deleted = loadDeletedPatchIds(id);
          patchesHydratedRef.current = true;
          setDeletedPatchIds(deleted);
          setPatches(mergePatches([], loadLocalPatches(id), deleted));
        }
      });
    return () => abort.abort();
  }, [region?.id]);

  useEffect(() => {
    if (!region || !patchesHydratedRef.current) return;
    saveDeletedPatchIds(deletedPatchIds, region.id);
  }, [deletedPatchIds, region]);

  useEffect(() => {
    patchesRef.current = patches;
    const map = mapRef.current;
    const src = map?.getSource("topo-patches") as GeoJSONSource | undefined;
    src?.setData(patchesToCollection(patches));
    if (!patchesHydratedRef.current || !region) return;
    saveLocalPatches(patches, region.id);
    const key = patchesContentKey(patches);
    const prev = patchesDemKeyRef.current;
    if (prev === key) return;
    patchesDemKeyRef.current = key;
    if (prev === null && key === "") return;
    if (map?.isStyleLoaded()) refreshViewportRef.current();
  }, [patches]);

  useEffect(() => {
    drawingRef.current = drawingPatch && canEditPatches;
    drawPointsRef.current = drawPoints;
    const map = mapRef.current;
    const src = map?.getSource("topo-patch-draw") as GeoJSONSource | undefined;
    if (!src) return;
    if (!canEditPatches || !drawingPatch || drawPoints.length === 0) {
      src.setData({ type: "FeatureCollection", features: [] });
      return;
    }
    const line = {
      type: "Feature" as const,
      properties: {},
      geometry: {
        type: "LineString" as const,
        coordinates: drawPoints,
      },
    };
    const dots = drawPoints.map((coordinates, index) => ({
      type: "Feature" as const,
      properties: { vertex: index },
      geometry: { type: "Point" as const, coordinates },
    }));
    src.setData({ type: "FeatureCollection", features: [line, ...dots] });
  }, [canEditPatches, drawingPatch, drawPoints]);

  useEffect(() => {
    if (!helpOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (drawingRef.current) return;
      if (pwaGuideOpen) return;
      setHelpOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [helpOpen, pwaGuideOpen]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const onChange = () => setSheetLayout(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (!drawingPatch || !canEditPatches) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if (event.key === "Backspace" || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z")) {
        event.preventDefault();
        setDrawPoints((pts) => {
          const next = pts.slice(0, -1);
          drawPointsRef.current = next;
          return next;
        });
      }
      if (event.key === "Escape") {
        setDrawingPatch(false);
        setDrawPoints([]);
        drawPointsRef.current = [];
        drawingRef.current = false;
        setEditingPatchId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canEditPatches, drawingPatch]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void paintSpill();
    }, 80);
    return () => window.clearTimeout(timer);
  }, [
    paintSpill,
    waterLevelCm,
    heatmapMode,
    forecastDays,
    hydro,
    timeWindow,
    heatmapEpoch,
    liveRiver,
    spillStageM,
    focusCityId,
  ]);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  useEffect(() => {
    setBasinPrep("idle");
    setBasinPrepNote(null);
  }, [region?.id]);

  useEffect(() => {
    if (!region) return;
    const abort = new AbortController();
    loadHydroSnapshot(abort.signal)
      .then((snapshot) => {
        setHydro(snapshot);
        setHydroError(null);
      })
      .catch((error: unknown) => {
        if (abort.signal.aborted) return;
        console.error(error);
        setHydroError(
          "Sem Open-Meteo/ANA e sem retrato hidrológico salvo neste aparelho.",
        );
      });
    return () => abort.abort();
  }, [region?.id]);

  useEffect(() => {
    topoOpacityRef.current = topoOpacity;
    const map = mapRef.current;
    if (!map?.getLayer("topo-overlay")) return;
    map.setPaintProperty("topo-overlay", "raster-opacity", topoOpacity / 100);
  }, [topoOpacity]);

  if (!region) {
    return (
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          background: "#111",
          color: "#aaa",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "sans-serif",
          fontSize: 14,
        }}
      >
        {regionError ?? "Carregando bacia…"}
      </div>
    );
  }

  const cities = region.cities;
  const hydroCfg = region.hydro;
  const statusBanner = hydroStatusBanner(online, hydro);
  const cityStaff = staffForCity(region, focusCityId || region.target_city_id);
  const liveMinCm = liveRiver ? liveStageCm(hydro) : null;
  const reguaMinCm = liveMinCm ?? 0;
  const REGUA_MAX_M = hydroCfg.regua_max_m;
  const REGUA_MAX_CM = REGUA_MAX_M * 100;
  const waterLevelEffectiveCm = Math.max(
    reguaMinCm,
    Math.min(REGUA_MAX_CM, waterLevelCm),
  );
  const displayFlow = hydro?.gauge_flow_m3s ?? 0;
  const forecastRainMm = rainForForecastDays(hydro, forecastDays);
  const forecastRainGrossMm = grossRainForForecastDays(hydro, forecastDays);
  const rain24Mm = rainForHorizon(hydro, 24);
  const rain24GrossMm = grossRainForHorizon(hydro, 24);
  const rise24M = rain24Mm * hydroCfg.rain_runoff_coeff;
  const armLiveFromForecast = () => {
    liveRiverRef.current = true;
    setLiveRiver(true);
    const min = liveStageCm(hydro);
    if (min != null) {
      waterLevelCmRef.current = Math.max(waterLevelCmRef.current, min);
      setWaterLevelCm((w) => Math.max(w, min));
    }
    setHeatmapMode("forecast");
  };
  const displayRise = forecastRainMm * hydroCfg.rain_runoff_coeff;
  const forecastRise = forecastStaffM(
    hydro,
    forecastDays,
    waterLevelEffectiveCm,
  );
  const targetOccupancy = floodOccupancy(timeWindow, 0);
  const surge = cities.find((c) => c.id === region.surge_city_id);
  const legendMmhExample = rainMmPerHourForInlandCm(
    DEPTH_SCALE[0].cm,
    displayFlow || 40,
    spillStageM,
  );
  const legendRainTotalExample = Math.round(legendMmhExample * CRITICAL_RAIN_H);
  const forecastDayLabel = forecastHorizonLabel(forecastDays);
  const todayLabel = todayHorizonLabel();
  const staffNowM =
    heatmapMode === "forecast" ? forecastRise : waterLevelEffectiveCm / 100;
  const overbankM = Math.max(0, staffNowM - spillStageM);
  const waterSurfaceM =
    thalwegM != null && Number.isFinite(thalwegM)
      ? thalwegM + overbankM * floodOccupancy(timeWindow, 0)
      : null;
  const followMapProbe = () => {
    probePinnedRef.current = false;
    const map = mapRef.current;
    const src = map?.getSource("probe-point") as GeoJSONSource | undefined;
    src?.setData({ type: "FeatureCollection", features: [] });
    if (!map) {
      setProbe(null);
      return;
    }
    const c = map.getCenter();
    const point = map.project(c);
    const dem = topoOverlayRef.current;
    setProbe({
      lon: c.lng,
      lat: c.lat,
      zM: dem ? sampleElevationM(dem, c.lng, c.lat) : null,
      pinned: false,
      origin: "center",
      x: point.x,
      y: point.y,
    });
  };
  const floodDepthM =
    probe?.zM != null && waterSurfaceM != null
      ? waterSurfaceM - probe.zM
      : null;
  const floodStop =
    floodDepthM != null && Number.isFinite(floodDepthM)
      ? depthScaleStop(floodDepthM)
      : null;
  const floodMmh =
    floodStop != null && floodDepthM != null
      ? rainMmPerHourForInlandCm(
          floodDepthM * 100,
          displayFlow || 40,
          spillStageM,
        )
      : null;

  return (
    <div className="app-shell">
      <SidebarDock helpOpen={helpOpen}>
        <SidebarSection
          id="titulo"
          slot="peek"
          title={region.title}
          help="O botão Ajuda abre o painel de textos. Esc fecha. No computador, passe o mouse num bloco para ver o par. No celular, a barra vira uma folha baixa na base da tela — o mapa continua visível. Role a folha para overlay, escala e patches."
        >
          <div className="sidebar-title-row">
            <div>
              <h2
                style={{ color: "#00b4d8", margin: "2px 0 5px 0", fontSize: "20px" }}
              >
                {region.title}
              </h2>
              <p style={{ color: "#aaa", fontSize: "12px", margin: 0 }}>
                {region.subtitle}
              </p>
            </div>
            <button
              type="button"
              className="sidebar-help-btn"
              aria-expanded={helpOpen}
              aria-controls="sidebar-help-rail"
              onClick={() => setHelpOpen((open) => !open)}
            >
              {helpOpen ? "Fechar" : "Ajuda"}
            </button>
          </div>
        </SidebarSection>

        <SidebarSection
          id="bacia"
          slot="more"
          title="Bacia"
          help="Troca o pacote da bacia (cidades, estações ANA, cotas e textos). Cada vale tem calibração própria — não copie cotas de transbordo entre bacias. Baixar esta bacia grava o pacote, o último retrato Open-Meteo/ANA e os tiles Copernicus da bbox — sem isso o PWA instalado é só o casco do app."
        >
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label
            style={{
              fontSize: "11px",
              textTransform: "uppercase",
              color: "#888",
              fontWeight: "bold",
            }}
          >
            Bacia
          </label>
          <select
            value={region.id}
            onChange={(e) => switchRegion(e.target.value)}
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
            {(catalog?.regions ?? [{ id: region.id, name: region.region.valley }]).map(
              (entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                  {entry.target ? ` · ${entry.target}` : ""}
                </option>
              ),
            )}
          </select>
          {region.calibration.status === "provisional" && (
            <p
              style={{
                margin: 0,
                fontSize: 11,
                color: "#ffd166",
                lineHeight: 1.4,
              }}
            >
              Pacote provisório — {region.calibration.note}
            </p>
          )}
          <div className="basin-offline-row">
          <button
            type="button"
            className="basin-offline-btn"
            disabled={basinPrep === "working"}
            onClick={() => {
              const pack = region;
              const abort = new AbortController();
              setBasinPrep("working");
              setBasinPrepNote("Baixando pacote, cota ANA e relevo Copernicus…");
              void prepareBasinOffline(pack, abort.signal)
                .then((result) => {
                  setHydro(result.hydro);
                  setHydroError(null);
                  setBasinPrep("done");
                  const clock = formatHydroClock(result.hydro.fetched_at);
                  setBasinPrepNote(
                    `Pronto: ${result.tiles} tile${result.tiles === 1 ? "" : "s"} DEM · cota ANA de ${clock}. Instale o app pelo menu do navegador.`,
                  );
                })
                .catch((error: unknown) => {
                  console.error(error);
                  setBasinPrep("error");
                  setBasinPrepNote(
                    "Não deu para preparar o offline. Conecte-se e tente de novo.",
                  );
                });
            }}
          >
            {basinPrep === "working"
              ? "Baixando…"
              : "Baixar esta bacia para o celular"}
          </button>
          <button
            type="button"
            className="basin-offline-help"
            aria-label="O que significa baixar esta bacia para o celular"
            aria-expanded={pwaGuideOpen}
            aria-haspopup="dialog"
            title="O que significa baixar esta bacia"
            onClick={() => setPwaGuideOpen(true)}
          >
            ?
          </button>
          </div>
          {basinPrepNote && (
            <p className="basin-offline-note">{basinPrepNote}</p>
          )}
        </div>
        </SidebarSection>

        <SidebarSection
          id="municipio"
          slot="peek"
          title="Município do vale"
          help={
            <>
              <p>{region.copy.cities_tip}</p>
              <p style={{ marginTop: 8 }}>
                {liveRiver
                  ? "Resetar: com Tempo Real ligado, a régua volta à cota ANA ao vivo (o piso atual do rio). Previsão no dia 1 e heatmap Agora."
                  : "Resetar: com Tempo Real desligado, a régua volta ao nível natural no leito deste município (sem usar a cota ANA). Previsão no dia 1 e heatmap Agora."}
              </p>
            </>
          }
        >
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label
            style={{
              fontSize: "11px",
              textTransform: "uppercase",
              color: "#888",
              fontWeight: "bold",
            }}
          >
            Município do vale
          </label>
          <select
            value={focusCityId}
            onChange={(e) => {
              const id = e.target.value;
              const city = cities.find((c) => c.id === id);
              flyingToCityRef.current = true;
              applyCityStaffRef.current(id, true);
              const map = mapRef.current;
              if (!city || !map) {
                flyingToCityRef.current = false;
                return;
              }
              map.stop();
              map.flyTo({
                center: [city.lon, city.lat],
                zoom: city.zoom,
                duration: 1200,
                essential: true,
              });
              map.once("moveend", () => {
                flyingToCityRef.current = false;
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
            {cities.map((city) => (
              <option key={city.id} value={city.id}>
                {city.name}
              </option>
            ))}
          </select>
          <div className="sheet-expanded-only">
          <p
            style={{ margin: 0, fontSize: 11, color: "#888", lineHeight: 1.4 }}
          >
            {cities.find((c) => c.id === focusCityId)?.blurb}
          </p>
          {region.copy.region_blurb ? (
            <p
              style={{ margin: 0, fontSize: 11, color: "#888", lineHeight: 1.4 }}
            >
              {region.copy.region_blurb}
            </p>
          ) : null}
          </div>
          <button
            type="button"
            onClick={() => {
              const staff = staffForCity(region, focusCityId);
              setSpillStageM(staff.spill_stage_m);
              const live = liveRiver ? liveStageCm(hydro) : null;
              setWaterLevelCm(
                live != null
                  ? Math.round(Math.min(REGUA_MAX_CM, Math.max(0, live)))
                  : staff.normal_stage_cm,
              );
              reguaTouchedRef.current = false;
              setTimeWindow(Math.max(1, Math.min(12, Math.round(surgeLagH(region)))));
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
          </button>
        </div>
        </SidebarSection>

        <SidebarSection
          id="overlay"
          slot="more"
          title="Overlay de relevo (Copernicus)"
          help="Hillshade do Copernicus DEM GLO-30 (30 m) na área visível. Após mover o mapa ou trocar de cidade, espera 1 s e recarrega relevo + heatmap. O slider só muda a opacidade."
        >
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
          </label>
          <input
            type="range"
            min="0"
            max="100"
            value={topoOpacity}
            onChange={(e) => setTopoOpacity(Number(e.target.value))}
            style={{ width: "100%", cursor: "pointer" }}
          />
          <p
            style={{
              margin: 0,
              fontSize: "11px",
              color: "#888",
              lineHeight: 1.4,
            }}
          >
            {topoStatus === "settling" && topoMeta}
            {topoStatus === "loading" &&
              (topoMeta ?? "Carregando relevo Copernicus para a vista…")}
            {topoStatus === "ready" && topoMeta}
            {topoStatus === "error" && topoMeta}
          </p>
        </div>
        </SidebarSection>

        <SidebarSection
          id="escala"
          slot="more"
          title="Escala de profundidade (cm)"
          help={`O número azul é intensidade (mm por hora), não o total da chuva. Ex.: ${legendMmhExample.toFixed(0)} mm/h durante ${CRITICAL_RAIN_H} h seguidas = cerca de ${legendRainTotalExample} mm no total. Isso leva a água até a cota de transbordo (${spillStageM.toFixed(1)} m) mais a profundidade do quadrado (ΔH = chuva×${hydroCfg.rain_runoff_coeff} + Q/${hydroCfg.valley_width_factor}).`}
        >
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div
            style={{
              fontSize: 11,
              color: "#888",
              fontWeight: "bold",
              textTransform: "uppercase",
            }}
          >
            Escala de profundidade (cm)
          </div>
          <div className="depth-scale">
            {DEPTH_SCALE.map((stop) => {
              const mmh = rainMmPerHourForInlandCm(
                stop.cm,
                displayFlow || 40,
                spillStageM,
              );
              return (
                <div key={stop.cm} className="depth-scale-cell">
                  <div
                    className="depth-scale-swatch"
                    style={{
                      background: stop.color,
                      color: depthLabelColor(stop.rgba),
                    }}
                  >
                    {stop.cm}
                  </div>
                  <div className="depth-scale-mmh">{mmh.toFixed(0)}</div>
                </div>
              );
            })}
          </div>
          <p
            style={{
              margin: 0,
              fontSize: 11,
              color: "#888",
              fontWeight: 600,
              lineHeight: 1.45,
            }}
          >
            Azul = milímetros <b style={{ color: "#7fdbfa" }}>por hora</b>,
            chovendo assim durante {CRITICAL_RAIN_H} h. Ex.:{" "}
            {legendMmhExample.toFixed(0)} mm/h × {CRITICAL_RAIN_H} h ≈{" "}
            {legendRainTotalExample} mm no total — não{" "}
            {legendMmhExample.toFixed(0)} mm somados em {CRITICAL_RAIN_H} h.
          </p>
        </div>
        </SidebarSection>

        <SidebarSection
          id="regua"
          slot="peek"
          title="Nível do rio (régua)"
          help={`Arrastar este slider coloca no mapa só o heatmap Agora (régua × DEM). Zero = nível natural no leito. Transbordo de ${cityStaff.city_name}: ${cityStaff.spill_stage_min_m} a ${cityStaff.spill_stage_max_m} m. ${cityStaff.spill_note}`}
        >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            padding: "10px",
            borderRadius: 8,
            border:
              heatmapMode === "now" ? "1px solid #3ecf4c" : "1px solid #333",
            background:
              heatmapMode === "now" ? "rgba(62, 207, 76, 0.08)" : "transparent",
          }}
        >
          <label
            style={{
              fontSize: "11px",
              textTransform: "uppercase",
              color: "#888",
              fontWeight: "bold",
              display: "flex",
              alignItems: "center",
              gap: 6,
              flexWrap: "wrap",
            }}
          >
            🌊 Nível do rio (régua)
            <LayerLamp on={heatmapMode === "now"} liveLabel="agora" />
            <span
              style={{ color: "#00b4d8", width: "100%", textAlign: "right" }}
            >
              {(waterLevelEffectiveCm / 100).toFixed(2)} m
              {liveRiver && liveMinCm != null
                ? ` · piso ANA ${(liveMinCm / 100).toFixed(2)} m`
                : ""}
              {waterLevelEffectiveCm / 100 >= spillStageM
                ? " · saiu da calha"
                : " · na calha"}
            </span>
          </label>
          <div>
            <div
              style={{
                fontSize: 10,
                color: "#888",
                fontWeight: 800,
                textTransform: "uppercase",
                marginBottom: 6,
              }}
            >
              Sai da calha em {spillStageM.toFixed(1).replace(".", ",")} m ·{" "}
              {cityStaff.city_name}
            </div>
            <div
              className="spill-stops"
              role="radiogroup"
              aria-label="Cota em que o rio sai da calha"
            >
              {cityStaff.spill_stage_stops_m.map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={spillStageM === m}
                  className={`spill-stop${spillStageM === m ? " is-on" : ""}`}
                  onClick={() => setSpillStageM(m)}
                >
                  {m.toFixed(1).replace(".", ",")}
                </button>
              ))}
            </div>
          </div>
          <div className="regua-track">
            <div
              className="regua-spill-mark"
              style={{ left: `${(spillStageM / REGUA_MAX_M) * 100}%` }}
              title={`Sai da calha: ${spillStageM} m`}
            />
            <input
              type="range"
              min={reguaMinCm}
              max={REGUA_MAX_CM}
              step="5"
              value={Math.max(reguaMinCm, waterLevelCm)}
              onPointerDown={() => {
                if (!liveRiver) reguaTouchedRef.current = true;
                setHeatmapMode("now");
              }}
              onChange={(e) => {
                setHeatmapMode("now");
                const next = Number(e.target.value);
                setWaterLevelCm(Math.max(reguaMinCm, next));
              }}
              style={{ width: "100%", cursor: "pointer" }}
            />
          </div>
        </div>
        </SidebarSection>

        <SidebarSection
          id="tempo-real"
          slot="peek"
          title="Tempo Real"
          help="Ligado: mostra a cota ANA atual e ela vira o mínimo da régua — dá para simular acima, não abaixo. Desligado: a régua vai de 0 até o teto, livre. Arrastar a previsão de chuva liga este modo sozinho, para a mancha não partir de um rio “normal” se a ANA já estiver um metro acima. Resetar segue o mesmo modo."
        >
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: liveRiver ? "rgba(230, 57, 70, 0.12)" : "#2d2d2d",
            border: liveRiver ? "1px solid #e63946" : "1px solid #333",
            borderRadius: 6,
            padding: "8px 10px",
            cursor: "pointer",
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          <input
            type="checkbox"
            checked={liveRiver}
            onChange={(e) => {
              const on = e.target.checked;
              setLiveRiver(on);
              setHeatmapMode("now");
              if (on) {
                const min = liveStageCm(hydro);
                if (min != null) {
                  setWaterLevelCm((w) => Math.max(w, min));
                }
              }
            }}
            style={{ width: 16, height: 16, accentColor: "#e63946", cursor: "pointer" }}
          />
          <span>🛰️ Tempo Real</span>
        </label>
        </SidebarSection>

        <SidebarSection
          id="chuva-24h"
          slot="more"
          title="Próximas 24 h"
          help="Volume previsto nas próximas 24 horas a montante — não é o mesmo que o dia 1 do slider (resto de hoje no fuso de São Paulo). A subida usa chuva efetiva × coeficiente da bacia, sobre a cota da régua. Mover o slider de previsão liga Tempo Real para essa cota não ficar abaixo da ANA."
        >
        <p
          style={{
            background: "#2a2a2a",
            padding: "12px",
            borderRadius: "6px",
            fontSize: "12px",
            color: "#ccc",
            lineHeight: "1.45",
            borderLeft: "4px solid #7fdbfa",
            margin: 0,
          }}
        >
          Próximas 24 h (Open-Meteo, janela rolante) · bruto{" "}
          <b>{rain24GrossMm.toFixed(0)} mm</b> · efetivo{" "}
          <b>{rain24Mm.toFixed(0)} mm</b> · subida ≈{" "}
          <b>+{rise24M.toFixed(2)} m</b> sobre a régua atual
          {liveMinCm != null
            ? ` (piso ANA ${(liveMinCm / 100).toFixed(2)} m)`
            : liveRiver
              ? " (Tempo Real ligado, ANA ainda sem cota)"
              : ""}
          .
        </p>
        </SidebarSection>

        <SidebarSection
          id="acumulo"
          slot="peek"
          title="Acúmulo previsto (Open-Meteo)"
          help={`A semana começa hoje (não amanhã): 1 = restante de hoje, 7 = até o mesmo dia da semana que vem menos um (ex.: terça 8 → segunda 14). Arrastar liga Tempo Real e pinta o heatmap Previsão. A chuva efetiva (mm) sobe a régua em mm × ${hydroCfg.rain_runoff_coeff} — 32 mm ≈ +1,6 m na cota, não 32 cm nem 2 m de rua. A mancha só aparece quando a cota prevista passa do transbordo deste município. Sem a cota ao vivo, a mancha pode parecer leve se o rio já estiver cheio. Meia-vida do balde: ${hydroCfg.rain_storage_halflife_h} h.`}
        >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            padding: "10px",
            borderRadius: 8,
            border:
              heatmapMode === "forecast"
                ? "1px solid #3ecf4c"
                : "1px solid #333",
            background:
              heatmapMode === "forecast"
                ? "rgba(62, 207, 76, 0.08)"
                : "transparent",
          }}
        >
          <label
            style={{
              fontSize: "11px",
              textTransform: "uppercase",
              color: "#888",
              fontWeight: "bold",
              display: "flex",
              alignItems: "center",
              gap: 6,
              flexWrap: "wrap",
            }}
          >
            🌧️ Acúmulo previsto (Open-Meteo)
            <LayerLamp on={heatmapMode === "forecast"} liveLabel="previsão" />
            <span
              style={{
                color: "#7fdbfa",
                width: "100%",
                textAlign: "right",
                textTransform: "none",
                fontSize: 13,
                fontWeight: 800,
                letterSpacing: 0,
              }}
            >
              {forecastDayLabel}
            </span>
            <span
              style={{
                color: "#00b4d8",
                width: "100%",
                textAlign: "right",
                textTransform: "none",
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              {forecastDays === 1
                ? `hoje · ${forecastRainMm.toFixed(0)} mm efetivos → +${displayRise.toFixed(2)} m na régua`
                : `hoje → ${forecastDays}º dia · ${forecastRainMm.toFixed(0)} mm efetivos → +${displayRise.toFixed(2)} m na régua`}
            </span>
          </label>
          <input
            type="range"
            min="1"
            max="7"
            step="1"
            value={forecastDays}
            onPointerDown={() => armLiveFromForecast()}
            onChange={(e) => {
              armLiveFromForecast();
              setForecastDays(Number(e.target.value));
            }}
            style={{ width: "100%", cursor: "pointer" }}
          />
          <p className="sheet-expanded-only" style={{ margin: 0, fontSize: 11, color: "#888", lineHeight: 1.45 }}>
            Bruto {forecastRainGrossMm.toFixed(0)} mm · efetivo{" "}
            {forecastRainMm.toFixed(0)} mm → subida +{displayRise.toFixed(2)} m
            na régua (não são {forecastRainMm.toFixed(0)} cm de lâmina). Cota{" "}
            {forecastRise.toFixed(2)} m
            {forecastRise >= spillStageM
              ? ` · ${overbankM.toFixed(2)} m fora da calha (transbordo ${spillStageM.toFixed(1)} m)`
              : ` · ainda na calha (sai em ${spillStageM.toFixed(1)} m) — a mancha só pinta rua acima do transbordo`}
            .
          </p>
        </div>
        </SidebarSection>

        <SidebarSection
          id="janela"
          slot="more"
          title="Janela de escape"
          help={`Vale para os dois heatmaps. A onda sobe até o pico local (ex.: ${surge?.name ?? "montante"} em ~${surgeLagH(region)} h) e depois a água volta ao leito em cerca de ${hydroCfg.overbank_drain_h} h. Em ${region.copy.target_short}, +${timeWindow} h deixa cerca de ${Math.round(targetOccupancy * 100)}% da lâmina de pico ainda na planície.`}
        >
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
            ⏱️ Janela de escape
            <span style={{ marginLeft: "auto", color: "#00b4d8" }}>
              +{timeWindow}h · {Math.round(targetOccupancy * 100)}%
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
          <p
            style={{ margin: 0, fontSize: 11, color: "#888", lineHeight: 1.4 }}
          >
            Recuo ao rio na vista atual — a mancha encolhe rumo ao talvegue
            depois do pico.
          </p>
        </div>
        </SidebarSection>

        <SidebarSection
          id="delta-h"
          slot="more"
          title="ΔH chuva efetiva"
          help={`Subida pela chuva efetiva (não a soma bruta): mm do balde × ${hydroCfg.rain_runoff_coeff}. Intervalos secos esvaziam o balde. A janela de escape aplica o recuo ao leito nos dois heatmaps.`}
        >
        <div
          style={{ display: "flex", flexDirection: "column", gap: "20px" }}
        >
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
            }}
          >
            ΔH chuva efetiva (Open-Meteo {forecastDays}d) ≈{" "}
            <b>{displayRise.toFixed(2)} m</b>
          </p>
          {hydro && (
            <p
              style={{
                margin: 0,
                fontSize: "11px",
                color: "#888",
                lineHeight: 1.5,
              }}
            >
              {hydro.rainfall
                .map((r) => {
                  const eff = effectiveRainMm(
                    r.hourly_mm,
                    forecastHorizonHours(forecastDays),
                  );
                  return `${r.name} ${eff.toFixed(0)} mm efetivos (${r.accum_7d_mm} mm/7d bruto)`;
                })
                .join(" · ")}
            </p>
          )}
        </div>
        </SidebarSection>

        {liveRiver && (
          <SidebarSection
            id="agora-no-rio"
            slot="more"
            title="Agora no rio"
            help="Telemetria ANA HidroWeb das estações do pacote. Sem rede, o app usa o último retrato gravado neste aparelho (não é cota ao vivo). A cota da ANA é o piso da régua em Tempo Real."
          >
          <div style={{ fontSize: "12px", color: "#bbb", lineHeight: "1.45" }}>
            {hydroError && <p style={{ color: "#e63946" }}>{hydroError}</p>}
            {!hydro && !hydroError && (
              <p>Cruzando Open-Meteo × ANA HidroWeb…</p>
            )}
            {hydro && (
              <>
                <p style={{ margin: "0 0 8px" }}>
                  Agora no rio:{" "}
                  {liveMinCm != null
                    ? `${(liveMinCm / 100).toFixed(2)} m (piso da régua)`
                    : "sem cota ANA — régua livre até haver telemetria"}
                  {" · "}
                  chuva efetiva {forecastDays}d {forecastRainMm.toFixed(1)} mm
                  (bruto {forecastRainGrossMm.toFixed(0)} mm) · Q{" "}
                  {hydro.gauge_flow_m3s.toFixed(1)} m³/s
                </p>
                {hydro.gauges.map((g) => (
                  <p key={g.id} style={{ margin: "0 0 4px", color: "#999" }}>
                    {g.online ? "●" : "○"} {g.name} ({g.code}){" "}
                    {g.online
                      ? `${g.flow_m3s?.toFixed(1) ?? "—"} m³/s${g.stage_cm != null ? ` · ${g.stage_cm.toFixed(0)} cm` : ""}`
                      : region.copy.live_fallback}
                  </p>
                ))}
              </>
            )}
          </div>
          </SidebarSection>
        )}

        {sheetLayout ? (
        <SidebarSection
          id="sonda"
          slot="more"
          title="Sonda do mapa"
          help="No celular a cota e as coordenadas ficam nesta lista, junto da correção de relevo — quem demarca um aterro precisa do ponto. No computador elas ficam no card do mapa, com a data. Toque no mapa para fixar; Seguir o mapa volta ao centro da vista."
        >
          <div className="sidebar-probe">
            <label
              style={{
                fontSize: "11px",
                textTransform: "uppercase",
                color: "#888",
                fontWeight: "bold",
              }}
            >
              Sonda do mapa
            </label>
            {probe ? (
              <MapProbeFields
                probe={probe}
                staffNowM={staffNowM}
                thalwegM={thalwegM}
                waterSurfaceM={waterSurfaceM}
                onFollowMap={followMapProbe}
              />
            ) : (
              <p className="map-probe-meta">
                Carregando cota do centro da vista…
              </p>
            )}
          </div>
        </SidebarSection>
        ) : null}

        <SidebarSection
          id="correcao-relevo"
          slot="more"
          title="Correção de relevo (aterro)"
          help="O Copernicus não vê obra recente. Só contas autorizadas demarcam o polígono e o Δz. Login dummy até existir autenticação de verdade (usuário usuario). Se uma revisão futura do GLO-30 já incluir a obra, o Vale Alerta compara a cota atual com a cota gravada na criação e deixa de somar o patch (absorvido). Δz pequeno perto do ruído de 2–4 m do DEM pede conferência manual."
        >
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label
            style={{
              fontSize: "11px",
              textTransform: "uppercase",
              color: "#888",
              fontWeight: "bold",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            Correção de relevo (aterro)
            {canEditPatches && (
              <button
                type="button"
                onClick={() => {
                  dummyLogout();
                  setCanEditPatches(false);
                  setDrawingPatch(false);
                  setDrawPoints([]);
                  drawPointsRef.current = [];
                  drawingRef.current = false;
                  setEditingPatchId(null);
                }}
                style={{
                  marginLeft: "auto",
                  background: "transparent",
                  border: 0,
                  color: "#7fdbfa",
                  cursor: "pointer",
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: "none",
                }}
              >
                Sair
              </button>
            )}
          </label>
          {!canEditPatches ? (
            <PatchLoginForm onLoggedIn={() => setCanEditPatches(true)} />
          ) : (
            <>
              <p
                style={{
                  margin: 0,
                  fontSize: 11,
                  color: "#888",
                  lineHeight: 1.4,
                }}
              >
                {drawingPatch
                  ? `Clique no mapa para os vértices (${drawPoints.length}). Clique num ponto para removê-lo. Desfazer: último ponto. Mínimo 3.`
                  : "Desenhe a área alterada e a elevação relativa recente."}
              </p>
              <label style={{ fontSize: 11, color: "#aaa" }}>
                Δz (m), positivo = aterro
                <input
                  type="number"
                  step="0.1"
                  value={patchDeltaM}
                  onChange={(e) => setPatchDeltaM(Number(e.target.value))}
                  style={{
                    width: "100%",
                    marginTop: 4,
                    background: "#2d2d2d",
                    color: "#fff",
                    border: "1px solid #444",
                    borderRadius: 6,
                    padding: "8px 10px",
                  }}
                />
              </label>
              <input
                type="text"
                placeholder="Nome (opcional)"
                value={patchName}
                onChange={(e) => setPatchName(e.target.value)}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  background: "#2d2d2d",
                  color: "#fff",
                  border: "1px solid #444",
                  borderRadius: 6,
                  padding: "8px 10px",
                  fontSize: 12,
                }}
              />
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => {
                    if (drawingPatch) {
                      setDrawingPatch(false);
                      setDrawPoints([]);
                      drawPointsRef.current = [];
                      drawingRef.current = false;
                      setEditingPatchId(null);
                      return;
                    }
                    setDrawingPatch(true);
                    setDrawPoints([]);
                    drawPointsRef.current = [];
                    drawingRef.current = true;
                    setEditingPatchId(null);
                  }}
                  style={{
                    flex: 1,
                    background: drawingPatch ? "#0077b6" : "#2d2d2d",
                    border: "1px solid #444",
                    color: "#fff",
                    borderRadius: 6,
                    padding: "8px 10px",
                    cursor: "pointer",
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  {drawingPatch ? "Cancelar desenho" : "Demarcar área"}
                </button>
                <button
                  type="button"
                  disabled={!drawingPatch || drawPoints.length === 0}
                  onClick={() => {
                    setDrawPoints((pts) => {
                      const next = pts.slice(0, -1);
                      drawPointsRef.current = next;
                      return next;
                    });
                  }}
                  style={{
                    flex: 1,
                    background: "#2d2d2d",
                    border: "1px solid #444",
                    color:
                      !drawingPatch || drawPoints.length === 0 ? "#666" : "#fff",
                    borderRadius: 6,
                    padding: "8px 10px",
                    cursor:
                      !drawingPatch || drawPoints.length === 0
                        ? "not-allowed"
                        : "pointer",
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  Desfazer ponto
                </button>
                <button
                  type="button"
                  disabled={drawPoints.length < 3 || !drawingPatch}
                  onClick={() => {
                const patch = makeLocalPatch(
                  drawPoints,
                  patchDeltaM,
                  patchName,
                  editingPatchId ?? undefined,
                );
                if (!patch) return;
                const dem = topoOverlayRef.current;
                if (dem?.rawElevations) {
                  const z = meanElevationInPatch(
                    dem.rawElevations,
                    dem.width,
                    dem.height,
                    dem.bbox,
                    patch,
                  );
                  if (z != null) patch.properties.baseline_z_m = z;
                }
                patch.properties.dem_status = "active";
                    setPatches((prev) => {
                      const without = prev.filter(
                        (x) => x.properties.id !== patch.properties.id,
                      );
                      return [...without, patch];
                    });
                    setDeletedPatchIds((ids) =>
                      ids.filter((id) => id !== patch.properties.id),
                    );
                    setDrawingPatch(false);
                    setDrawPoints([]);
                    drawPointsRef.current = [];
                    drawingRef.current = false;
                    setEditingPatchId(null);
                    setPatchName("");
                  }}
                  style={{
                    flex: 1,
                    background: "#2d2d2d",
                    border: "1px solid #444",
                    color:
                      drawPoints.length < 3 || !drawingPatch ? "#666" : "#fff",
                    borderRadius: 6,
                    padding: "8px 10px",
                    cursor:
                      drawPoints.length < 3 || !drawingPatch
                        ? "not-allowed"
                        : "pointer",
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  {editingPatchId ? "Salvar alteração" : "Aplicar Δz"}
                </button>
              </div>
              {drawingPatch && drawPoints.length > 0 && (
                <ol
                  style={{
                    margin: 0,
                    padding: "0 0 0 18px",
                    fontSize: 11,
                    color: "#bbb",
                  }}
                >
                  {drawPoints.map((pt, index) => (
                    <li
                      key={`${pt[0]}-${pt[1]}-${index}`}
                      style={{ marginBottom: 2 }}
                    >
                      {index + 1}. {Math.abs(pt[1]).toFixed(5)}° S{" "}
                      {Math.abs(pt[0]).toFixed(5)}° O{" "}
                      <button
                        type="button"
                        onClick={() => {
                          setDrawPoints((pts) => {
                            const next = pts.filter((_, i) => i !== index);
                            drawPointsRef.current = next;
                            return next;
                          });
                        }}
                        style={{
                          background: "transparent",
                          border: 0,
                          color: "#e63946",
                          cursor: "pointer",
                          fontSize: 11,
                        }}
                      >
                        remover
                      </button>
                    </li>
                  ))}
                </ol>
              )}
              {patches.length > 0 && (
                <ul
                  style={{
                    margin: 0,
                    padding: "0 0 0 16px",
                    fontSize: 11,
                    color: "#bbb",
                  }}
                >
                  {patches.map((p) => (
                    <li key={p.properties.id} style={{ marginBottom: 8 }}>
                      {p.properties.name ?? p.properties.id} (
                      {p.properties.delta_m > 0 ? "+" : ""}
                      {p.properties.delta_m.toFixed(1)} m)
                      <div style={{ color: "#888", fontSize: 10, marginTop: 2 }}>
                        {patchDemCaption(p)}
                      </div>
                      <div style={{ display: "flex", gap: 8, marginTop: 2, flexWrap: "wrap" }}>
                        <button
                          type="button"
                          onClick={() => {
                            const pts = drawPointsFromPatch(p);
                            setEditingPatchId(p.properties.id);
                            setPatchDeltaM(p.properties.delta_m);
                            setPatchName(p.properties.name ?? "");
                            setDrawPoints(pts);
                            drawPointsRef.current = pts;
                            setDrawingPatch(true);
                            drawingRef.current = true;
                          }}
                          style={{
                            background: "transparent",
                            border: 0,
                            color: "#7fdbfa",
                            cursor: "pointer",
                            fontSize: 11,
                            padding: 0,
                          }}
                        >
                          modificar
                        </button>
                        {(p.properties.dem_status === "absorbed" ||
                          p.properties.dem_status === "review" ||
                          p.properties.force_active) && (
                          <button
                            type="button"
                            onClick={() => {
                              setPatches((prev) =>
                                prev.map((x) =>
                                  x.properties.id === p.properties.id
                                    ? {
                                        ...x,
                                        properties: {
                                          ...x.properties,
                                          force_active: !x.properties.force_active,
                                          dem_status: !x.properties.force_active
                                            ? "active"
                                            : x.properties.dem_status,
                                        },
                                      }
                                    : x,
                                ),
                              );
                            }}
                            style={{
                              background: "transparent",
                              border: 0,
                              color: "#ffd166",
                              cursor: "pointer",
                              fontSize: 11,
                              padding: 0,
                            }}
                          >
                            {p.properties.force_active
                              ? "parar de forçar"
                              : "somar mesmo assim"}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setPatches((prev) =>
                              prev.filter(
                                (x) => x.properties.id !== p.properties.id,
                              ),
                            );
                            setDeletedPatchIds((ids) =>
                              ids.includes(p.properties.id)
                                ? ids
                                : [...ids, p.properties.id],
                            );
                            if (editingPatchId === p.properties.id) {
                              setEditingPatchId(null);
                              setDrawingPatch(false);
                              setDrawPoints([]);
                              drawPointsRef.current = [];
                              drawingRef.current = false;
                            }
                          }}
                          style={{
                            background: "transparent",
                            border: 0,
                            color: "#e63946",
                            cursor: "pointer",
                            fontSize: 11,
                            padding: 0,
                          }}
                        >
                          remover
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <button
                type="button"
                onClick={() => downloadPatchesGeoJSON(patches)}
                disabled={patches.length === 0}
                style={{
                  background: "#2d2d2d",
                  border: "1px solid #444",
                  color: patches.length === 0 ? "#666" : "#fff",
                  borderRadius: 6,
                  padding: "8px 10px",
                  cursor: patches.length === 0 ? "not-allowed" : "pointer",
                  fontSize: 12,
                }}
              >
                Baixar GeoJSON dos patches
              </button>
            </>
          )}
        </div>
        </SidebarSection>
      </SidebarDock>

      <div className="map-stage">
        <div
          className={`map-hud${hudHeld ? " is-held" : ""}`}
          aria-live="polite"
          onPointerDown={() => setHudHeld(true)}
          onPointerUp={() => setHudHeld(false)}
          onPointerCancel={() => setHudHeld(false)}
          onPointerLeave={() => setHudHeld(false)}
        >
          {statusBanner ? (
            <div className="map-hud-offline" role="status">
              {statusBanner}
            </div>
          ) : null}
          <div className="map-hud-status">
            <span className="layer-lamp-dot on" />
            <span className="map-layer-flag-text">
              <span className="map-layer-flag-date">
                {heatmapMode === "now" ? todayLabel : forecastDayLabel}
              </span>
              <span className="map-layer-flag-meta">
                {heatmapMode === "now"
                  ? overbankM > 0
                    ? `Agora · ${overbankM.toFixed(2)} m fora da calha · +${timeWindow}h`
                    : `Agora · na calha · +${timeWindow}h`
                  : overbankM > 0
                    ? `Previsão · cota ${forecastRise.toFixed(2)} m · ${overbankM.toFixed(2)} m fora da calha · +${timeWindow}h`
                    : `Previsão · cota ${forecastRise.toFixed(2)} m · na calha (sai em ${spillStageM.toFixed(1)} m)`}
              </span>
            </span>
          </div>
          {!sheetLayout && probe ? (
            <div className="map-hud-probe">
              <MapProbeFields
                probe={probe}
                staffNowM={staffNowM}
                thalwegM={thalwegM}
                waterSurfaceM={waterSurfaceM}
                onFollowMap={followMapProbe}
              />
            </div>
          ) : null}
        </div>
        <div
          ref={mapContainerRef}
          className="map-canvas"
        />
        {probe &&
          probe.origin !== "center" &&
          !drawingPatch &&
          floodStop != null &&
          floodDepthM != null &&
          floodMmh != null && (
            <div
              className="map-flood-tip"
              style={{
                left: Math.max(
                  8,
                  Math.min(
                    probe.x + 14,
                    (mapContainerRef.current?.clientWidth ?? 320) - 168,
                  ),
                ),
                top: Math.max(
                  8,
                  Math.min(
                    probe.y + 14,
                    (mapContainerRef.current?.clientHeight ?? 200) - 88,
                  ),
                ),
              }}
            >
              <div
                className="map-flood-tip-swatch"
                style={{
                  background: floodStop.color,
                  color: depthLabelColor(floodStop.rgba),
                }}
              >
                {Math.round(floodDepthM * 100)} cm
              </div>
              <div className="map-flood-tip-mmh">
                {floodMmh.toFixed(0)} mm/h
                <span>faixa {floodStop.cm} cm</span>
              </div>
            </div>
          )}
      </div>
      <PwaGuideDialog open={pwaGuideOpen} onClose={() => setPwaGuideOpen(false)} />
    </div>
  );
}
