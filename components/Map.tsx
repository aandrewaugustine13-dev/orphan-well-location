"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CircleMarker,
  GeoJSON,
  MapContainer,
  Popup,
  ScaleControl,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { DeckOverlay } from "@deck.gl-community/leaflet";
import { HeatmapLayer, HexagonLayer } from "@deck.gl/aggregation-layers";
import {
  ColorMode,
  Well,
  formatWellAge,
  formatLiability,
  getWellAgeRadius,
  getWellColor,
  regionsToDbStates,
  supabase,
  STATE_FIPS,
} from "@/utils/supabase";

interface MapBounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

interface MapProps {
  onWellsLoaded: (wells: Well[]) => void;
  onLoadingChange: (loading: boolean) => void;
  onCenterChange: (lat: number, lng: number) => void;
  onError: (error: string | null) => void;
  selectedWellApi: string | null;
  onSelectWell: (api: string | null) => void;
  colorMode: ColorMode;
  searchLocation: { lat: number; lng: number; zoom?: number } | null;
  searchedLocation: { lat: number; lng: number } | null;
  searchedLabel: string | null;
  showOrphanWells: boolean;
  showGroundwater: boolean;
  showEpaSites: boolean;
  showFloodZones: boolean;
  showFrackingSites: boolean;
  showRiskHeatmap: boolean;
  riskThreshold?: number;
  onRiskThresholdChange?: (v: number) => void;
  onRiskError?: (err: string | null) => void;
  activeRegions: string[];
  activeFips: string[];
}

export interface HeatmapPoint {
  longitude: number;
  latitude: number;
  intensity: number;
}

interface ProgrammaticMove {
  lat: number;
  lng: number;
  zoom?: number;
  id: number;
}

interface GroundwaterWell {
  well_id: string;
  latitude: number;
  longitude: number;
  state: string;
  county: string;
  well_depth_ft: number | null;
  well_capacity_gpm: number | null;
  water_use: string;
  status: string;
  year_constructed: number | null;
  miles_away?: number;
}

interface EpaSite {
  site_id: string;
  site_name: string;
  latitude: number;
  longitude: number;
  state: string;
  county: string;
  city: string;
  site_type: string;
  status: string;
  contamination_type: string | null;
  federal_facility: boolean;
  npl_status: string | null;
}

interface FemaZone {
  zone_id: string;
  zone_type: string;
  state_fips: string | null;
  geom: any;
}

interface FrackingSite {
  id: number;
  api_number: string;
  operator_name: string;
  latitude: number;
  longitude: number;
  well_type: string;
}

const DEFAULT_CENTER: [number, number] = [39.8, -98.5];
const DEFAULT_ZOOM = 5;
const FETCH_DEBOUNCE_MS = 400;

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Coarse grid at low zoom = way fewer cells sent to Deck.gl (big smoothness win).
function getAdaptiveGridSize(bounds: MapBounds | null, z: number): number {
  if (!bounds) return 0.02;
  // Base on zoom primarily; bbox span as fallback.
  if (z <= 5) return 0.08;
  if (z <= 6) return 0.045;
  if (z <= 7) return 0.022;
  if (z <= 9) return 0.009;
  if (z <= 11) return 0.0035;
  return 0.0012;
}

function MapController({
  programmaticMove,
  onMoveEnd,
}: {
  programmaticMove: ProgrammaticMove | null;
  onMoveEnd: (bounds: MapBounds, center: [number, number], zoom: number) => void;
}) {
  const map = useMap();
  const onMoveEndRef = useRef(onMoveEnd);
  onMoveEndRef.current = onMoveEnd;

  // Fire initial bounds once map is mounted
  useEffect(() => {
    const b = map.getBounds();
    const c = map.getCenter();
    onMoveEndRef.current(
      { minLat: b.getSouth(), maxLat: b.getNorth(), minLng: b.getWest(), maxLng: b.getEast() },
      [c.lat, c.lng],
      map.getZoom()
    );
  }, [map]);

  useEffect(() => {
    if (!programmaticMove) return;
    map.flyTo(
      [programmaticMove.lat, programmaticMove.lng],
      programmaticMove.zoom ?? map.getZoom(),
      { duration: 0.6 }
    );
  }, [map, programmaticMove]);

  useMapEvents({
    moveend(e) {
      const b = e.target.getBounds();
      const c = e.target.getCenter();
      onMoveEndRef.current(
        { minLat: b.getSouth(), maxLat: b.getNorth(), minLng: b.getWest(), maxLng: b.getEast() },
        [c.lat, c.lng],
        e.target.getZoom()
      );
    },
  });

  return null;
}

function DeckGLOverlay({
  showRiskHeatmap,
  heatmapData,
  riskThreshold = 0,
  zoom = 5,
}: {
  showRiskHeatmap: boolean;
  heatmapData: HeatmapPoint[];
  riskThreshold?: number;
  zoom?: number;
}) {
  const map = useMap();
  const deckRef = useRef<any>(null);

  // Create the DeckOverlay once when the layer is enabled.
  // Then use setProps() for subsequent data/zoom changes instead of
  // expensive addLayer/removeLayer on every tick. This is the key to smoothness.
  useEffect(() => {
    if (!showRiskHeatmap) {
      if (deckRef.current) {
        try {
          map.removeLayer(deckRef.current);
        } catch {}
        deckRef.current = null;
      }
      return;
    }

    const z = zoom ?? 5;

    // Hexagonal binning for clear "areas of substantial hazard".
    // The upstream RPC already snaps + scores cells (square grid). HexagonLayer
    // turns those weighted points into explicit polygonal zones — far better
    // than Gaussian blur for delineating contiguous ecological/environmental
    // hazard areas (less directional bias, crisp boundaries, easy to reason
    // about "this zone here is substantial risk").
    // We emphasize the upper end of the intensity scale (the "substantial"
    // part) via lowerPercentile + a danger-weighted color ramp.
    const hexRadiusMeters = z <= 6 ? 2200 : z <= 8 ? 1450 : z <= 10 ? 950 : 620;

    // Filter is applied here *only* to the hex zones layer.
  // The classic HeatmapLayer underlay always receives the full raw data so the
  // density/glow is visible whenever the toggle is on (this fixes the "heatmap doesn't show" case).
  const zonesData = (riskThreshold && riskThreshold > 0)
    ? heatmapData.filter((d) => (d.intensity || 0) >= riskThreshold)
    : heatmapData;

  console.log(`[Deck Risk] Building layers | raw cells=${heatmapData.length} | zones after threshold=${zonesData.length} | zoom=${z} | riskThreshold=${riskThreshold}`);

  const layers = [
    // Classic heatmap underlay — full raw data → smooth density glow always appears
    new HeatmapLayer({
      id: "hazard-underlay",
      data: heatmapData,
      getPosition: (d: any) => [d.longitude, d.latitude],
      getWeight: (d: any) => Number(d.intensity || 1),
      radiusPixels: z <= 6 ? 160 : z <= 9 ? 95 : 60,
      intensity: z <= 7 ? 1.4 : 1.0,
      threshold: 0.015,
      colorRange: [
        [0, 34, 150],
        [0, 150, 214],
        [120, 214, 0],
        [255, 230, 0],
        [255, 100, 0],
        [255, 0, 0],
      ],
      updateTriggers: {
        getPosition: [heatmapData],
        getWeight: [heatmapData],
      },
    }),

    // Hex zones on top — only the cells that pass the current "MIN HAZARD LEVEL"
    new HexagonLayer({
      id: "hazard-zones-hex",
      data: zonesData,
      getPosition: (d: any) => [d.longitude, d.latitude],
      getColorValue: (d: any) => Number(d.intensity || 0),
      lowerPercentile: 5,
      upperPercentile: 100,
      radius: hexRadiusMeters,
      colorRange: [
        [30, 55, 95],
        [45, 95, 130],
        [140, 160, 45],
        [235, 175, 30],
        [245, 115, 25],
        [230, 45, 25],
      ],
      stroked: true,
      filled: true,
      lineWidthMinPixels: 0.7,
      extruded: false,
      updateTriggers: {
        getPosition: [zonesData],
        getColorValue: [zonesData],
        radius: [z],
      },
    }),
  ];

    if (!deckRef.current) {
      deckRef.current = new DeckOverlay({ layers });
      map.addLayer(deckRef.current);
    } else {
      // Fast path: mutate the existing overlay instead of full teardown + rebuild.
      deckRef.current.setProps({ layers });
    }

    // We intentionally do NOT remove in this return — the removal
    // happens in the !showRiskHeatmap branch above or on unmount.
  }, [showRiskHeatmap, heatmapData, riskThreshold, zoom]);

  // Final cleanup when the component is unmounted (toggle off or page nav).
  useEffect(() => {
    return () => {
      if (deckRef.current) {
        try {
          map.removeLayer(deckRef.current);
        } catch {}
        deckRef.current = null;
      }
    };
  }, [map]);

  return null;
}

export default function Map({
  onWellsLoaded,
  onLoadingChange,
  onCenterChange,
  onError,
  selectedWellApi,
  onSelectWell,
  colorMode,
  searchLocation,
  searchedLocation,
  searchedLabel,
  showOrphanWells,
  showGroundwater,
  showEpaSites,
  showFloodZones: showFemaFloodZones,
  showFrackingSites,
  showRiskHeatmap,
  riskThreshold = 0,
  onRiskError,
  activeRegions,
}: MapProps) {
  const [queryBounds, setQueryBounds] = useState<MapBounds | null>(null);
  const [programmaticMove, setProgrammaticMove] = useState<ProgrammaticMove | null>(null);
  const [rawWells, setRawWells] = useState<Well[]>([]);
  const [wells, setWells] = useState<Well[]>([]);
  const [groundwaterWells, setGroundwaterWells] = useState<GroundwaterWell[]>([]);
  const [epaSites, setEpaSites] = useState<EpaSite[]>([]);
  const [femaData, setFemaData] = useState<FemaZone[]>([]);
  const [frackingSites, setFrackingSites] = useState<FrackingSite[]>([]);
  const [heatmapData, setHeatmapData] = useState<HeatmapPoint[]>([]);
  const [zoom, setZoom] = useState<number>(DEFAULT_ZOOM);
  const [riskError, setRiskError] = useState<string | null>(null);

  // Report risk error up to parent for UI display
  useEffect(() => {
    onRiskError?.(riskError);
  }, [riskError, onRiskError]);

  // Client filter for "substantial hazard" focus. Purely visual — does not
  // affect any other layer, the RPC, or the raw data we keep for the layer.
  const displayHeatmapData = (riskThreshold && riskThreshold > 0)
    ? heatmapData.filter((d) => (d.intensity || 0) >= riskThreshold)
    : heatmapData;

  const fetchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);
  const gwRequestIdRef = useRef(0);
  const epaRequestIdRef = useRef(0);
  const femaRequestIdRef = useRef(0);
  const frackingRequestIdRef = useRef(0);
  const heatmapRequestIdRef = useRef(0);
  const moveIdRef = useRef(0);

  // The DB stores full state names ("Texas"), the UI tracks codes ("TX");
  // every Supabase state filter must go through this translation.
  const dbStates = useMemo(() => regionsToDbStates(activeRegions), [activeRegions]);

  const activeStateNames = useMemo(() => {
    return activeRegions.map(abbr => STATE_FIPS[abbr]?.name).filter(Boolean);
  }, [activeRegions]);

  const activeFips = useMemo(() => {
    return activeRegions.map(regionAbbr => STATE_FIPS[regionAbbr]?.fips).filter(Boolean);
  }, [activeRegions]);

  // Clear risk error when the layer is toggled off
  useEffect(() => {
    if (!showRiskHeatmap) {
      setRiskError(null);
    }
  }, [showRiskHeatmap]);

  // Fetch risk heatmap data from Supabase RPC using PostGIS spatial logic
  useEffect(() => {
    async function loadRiskHeatmap() {
      // 1. The Guardrail: If no regions are active, clear the map and stop.
      if (!showRiskHeatmap || !queryBounds || activeRegions.length === 0) {
        setHeatmapData([]);
        setRiskError(null);
        return;
      }

      // 2. Zoom guard: wide viewports (low zoom) pull too many wells and timeout even with indexes.
      // The adaptive grid helps, but the initial scan + subqueries are expensive.
      // Raise this threshold if you still see timeouts at medium zooms.
      if (zoom < 6) {
        setHeatmapData([]);
        setRiskError("Zoom in more (zoom level 6+) to load the risk heatmap — prevents DB timeout on large areas");
        return;
      }

      const requestId = ++heatmapRequestIdRef.current;

      try {
        if (!supabase) return;

        const gridSize = getAdaptiveGridSize(queryBounds, zoom);

        // Pass active regions (for state filtering) + adaptive grid size.
        // The SQL now uses the grid_size to produce far fewer output cells at overview zooms.
        const { data, error } = await supabase.rpc("get_risk_heatmap_data", {
          min_lng: queryBounds.minLng,
          min_lat: queryBounds.minLat,
          max_lng: queryBounds.maxLng,
          max_lat: queryBounds.maxLat,
          active_states: activeStateNames,
          active_fips: activeFips,
          grid_size: gridSize,
        });

        if (requestId !== heatmapRequestIdRef.current) return;

        if (error) {
          const msg = error.message || JSON.stringify(error);
          console.error("Supabase RPC Error for get_risk_heatmap_data:", error);
          setRiskError(msg);
          setHeatmapData([]);
          return;
        }

        setRiskError(null);
        setHeatmapData((data as HeatmapPoint[]) ?? []);
        console.log(`[Risk] RPC returned ${(data as any[] || []).length} cells. raw heatmapData len=${(data as any[] || []).length}, threshold=${riskThreshold}, display will be filtered for zones only.`);
      } catch (err) {
        console.error("Network or parsing error:", err);
      }
    }

    loadRiskHeatmap();
  }, [showRiskHeatmap, queryBounds, activeStateNames, activeFips, riskThreshold, zoom]);

  const handleMoveEnd = useCallback(
    (bounds: MapBounds, center: [number, number], zoom: number) => {
      onCenterChange(center[0], center[1]);
      setZoom(zoom);
      if (fetchDebounceRef.current) clearTimeout(fetchDebounceRef.current);
      fetchDebounceRef.current = setTimeout(() => {
        setQueryBounds(bounds);
        fetchDebounceRef.current = null;
      }, FETCH_DEBOUNCE_MS);
    },
    [onCenterChange]
  );

  useEffect(() => {
    return () => {
      if (fetchDebounceRef.current) clearTimeout(fetchDebounceRef.current);
    };
  }, []);

  // Geolocation on mount
  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        moveIdRef.current += 1;
        setProgrammaticMove({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          id: moveIdRef.current,
          zoom: 10,
        });
      },
      () => {},
      { enableHighAccuracy: false, timeout: 8000 }
    );
  }, []);

  // Fly to searched location when it changes
  useEffect(() => {
    if (!searchLocation) return;
    moveIdRef.current += 1;
    setProgrammaticMove({
      lat: searchLocation.lat,
      lng: searchLocation.lng,
      id: moveIdRef.current,
      zoom: searchLocation.zoom ?? 11,
    });
  }, [searchLocation]);

  // Fetch wells within the current viewport bounds
  useEffect(() => {
    if (!queryBounds) return;

    // Zero State Guardrail
    if (activeRegions.length === 0) {
      setRawWells([]);
      return;
    }

    const requestId = ++requestIdRef.current;
    const bounds = queryBounds;

    async function loadWells() {
      onLoadingChange(true);
      onError(null);

      if (!supabase) {
        onError("Supabase environment variables are missing.");
        setRawWells([]);
        onLoadingChange(false);
        return;
      }

      const { data, error } = await supabase
        .from("orphan_wells")
        .select("*")
        .gte("latitude", bounds.minLat)
        .lte("latitude", bounds.maxLat)
        .gte("longitude", bounds.minLng)
        .lte("longitude", bounds.maxLng)
        .in("state", activeStateNames)
        .limit(5000);

      if (requestId !== requestIdRef.current) return;

      if (error) {
        onError(error.message);
        setRawWells([]);
        onLoadingChange(false);
        return;
      }

      setRawWells((data as Well[]) ?? []);
      onLoadingChange(false);
    }

    loadWells();
  }, [queryBounds, onError, onLoadingChange, activeStateNames]);

  // Enrich wells with distance from the searched location (cheap, no re-fetch)
  useEffect(() => {
    const enriched: Well[] = rawWells.map((w) => ({
      ...w,
      miles_away: searchedLocation
        ? haversineMiles(searchedLocation.lat, searchedLocation.lng, w.latitude, w.longitude)
        : undefined,
    }));
    setWells(enriched);
    onWellsLoaded(enriched);
  }, [rawWells, searchedLocation, onWellsLoaded]);

  // Fetch groundwater wells within the current viewport bounds
  useEffect(() => {
    if (!showGroundwater || !queryBounds) {
      setGroundwaterWells([]);
      return;
    }

    // Zero State Guardrail
    if (activeRegions.length === 0) {
      setGroundwaterWells([]);
      return;
    }

    const requestId = ++gwRequestIdRef.current;
    const bounds = queryBounds;

    async function loadGroundwater() {
      if (!supabase) return;

      const { data, error } = await supabase
        .from("groundwater_wells")
        .select("*")
        .gte("latitude", bounds.minLat)
        .lte("latitude", bounds.maxLat)
        .gte("longitude", bounds.minLng)
        .lte("longitude", bounds.maxLng)
        .in("state", activeStateNames)
        .limit(5000);

      if (requestId !== gwRequestIdRef.current) return;
      if (error) {
        console.error("Error fetching groundwater wells:", error);
        return;
      }

      const gw = (data as GroundwaterWell[]) ?? [];
      setGroundwaterWells(
        gw.map((w) => ({
          ...w,
          miles_away: searchedLocation
            ? haversineMiles(searchedLocation.lat, searchedLocation.lng, w.latitude, w.longitude)
            : undefined,
        }))
      );
    }

    loadGroundwater();
  }, [queryBounds, showGroundwater, searchedLocation, activeStateNames]);

  // Fetch EPA sites within the current viewport bounds
  useEffect(() => {
    if (!showEpaSites || !queryBounds) {
      setEpaSites([]);
      return;
    }

    // Zero State Guardrail
    if (activeRegions.length === 0) {
      setEpaSites([]);
      return;
    }

    const requestId = ++epaRequestIdRef.current;
    const bounds = queryBounds;

    async function loadEpaSites() {
      if (!supabase) return;

      const { data, error } = await supabase
        .from("epa_sites")
        .select("*")
        .gte("latitude", bounds.minLat)
        .lte("latitude", bounds.maxLat)
        .gte("longitude", bounds.minLng)
        .lte("longitude", bounds.maxLng)
        .in("state", activeStateNames)
        .limit(2000);

      if (requestId !== epaRequestIdRef.current) return;
      if (error) {
        console.error("Error fetching EPA sites:", error);
        return;
      }

      setEpaSites((data as EpaSite[]) ?? []);
    }

    loadEpaSites();
  }, [queryBounds, showEpaSites, activeStateNames]);

  // Fetch FEMA flood zones within the current viewport bounds
  useEffect(() => {
    if (!showFemaFloodZones || !queryBounds) {
      setFemaData([]);
      return;
    }

    // Zero State Guardrail
    if (activeRegions.length === 0) {
      setFemaData([]);
      return;
    }

    const requestId = ++femaRequestIdRef.current;
    const bounds = queryBounds;

    async function loadFemaZones() {
      if (!supabase) return;

      const { data, error } = await supabase.rpc('get_fema_zones_in_bbox', {
        min_lng: bounds.minLng,
        min_lat: bounds.minLat,
        max_lng: bounds.maxLng,
        max_lat: bounds.maxLat
      });

      if (requestId !== femaRequestIdRef.current) return;
      if (error) {
        console.error("Error fetching FEMA flood zones:", error);
        return;
      }

      setFemaData((data as FemaZone[]) ?? []);
    }

    loadFemaZones();
  }, [queryBounds, showFemaFloodZones, activeRegions]);

  // Fetch Fracking Sites within the current viewport bounds
  useEffect(() => {
    if (!showFrackingSites || !queryBounds) {
      setFrackingSites([]);
      return;
    }

    // Zero State Guardrail
    if (activeRegions.length === 0) {
      setFrackingSites([]);
      return;
    }

    const requestId = ++frackingRequestIdRef.current;
    const bounds = queryBounds;

    async function loadFrackingSites() {
      if (!supabase) return;

      const { data, error } = await supabase.rpc('get_fracking_sites_in_bounds', {
        min_lng: bounds.minLng,
        min_lat: bounds.minLat,
        max_lng: bounds.maxLng,
        max_lat: bounds.maxLat
      });

      console.log("Fracking sites fetch result:", { data, error });

      if (requestId !== frackingRequestIdRef.current) return;
      if (error) {
        console.error("Error fetching fracking sites:", error);
        return;
      }

      setFrackingSites((data as FrackingSite[]) ?? []);
    }

    loadFrackingSites();
  }, [queryBounds, showFrackingSites, activeRegions]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <MapContainer
        center={DEFAULT_CENTER}
        zoom={DEFAULT_ZOOM}
        style={{ width: "100%", height: "100%" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; CARTO'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />

        {showRiskHeatmap && !riskError && (
          <DeckGLOverlay
            showRiskHeatmap={showRiskHeatmap}
            heatmapData={heatmapData} // raw from RPC — underlay always gets full density
            riskThreshold={riskThreshold}
            zoom={zoom}
          />
        )}

        {showFemaFloodZones && femaData.map((zone) => (
          <GeoJSON
            key={zone.zone_id}
            data={zone.geom} // Directly passing the PostGIS GeoJSON geometry object
            style={() => ({
              color: '#38bdf8',       // Clean light blue border
              weight: 1,             // Thin line weight so it isn't blocky
              fillColor: '#0284c7',   // Slightly deeper blue fill
              fillOpacity: 0.25,     // Translucent so underlying streets stay visible
            })}
          />
        ))}

        <MapController programmaticMove={programmaticMove} onMoveEnd={handleMoveEnd} />

        {showOrphanWells &&
          wells.map((well) => {
            const isSelected = selectedWellApi === well.api_number;
            const color = getWellColor(well, colorMode);

            return (
              <CircleMarker
                key={well.api_number}
                center={[well.latitude, well.longitude]}
                radius={getWellAgeRadius(well, isSelected)}
                pathOptions={{
                  color,
                  fillColor: color,
                  fillOpacity: isSelected ? 0.9 : 0.7,
                  weight: isSelected ? 2 : 1,
                }}
                eventHandlers={{
                  click: () => onSelectWell(isSelected ? null : well.api_number),
                }}
              >
                <Popup>
                  <div style={{ minWidth: 220 }}>
                    <div style={{ fontWeight: 700, marginBottom: 6 }}>
                      {well.well_name || well.api_number}
                    </div>
                    <div>API: {well.api_number}</div>
                    {well.miles_away != null && searchedLabel && (
                      <div>{well.miles_away.toFixed(2)} mi from {searchedLabel}</div>
                    )}
                    <div>Age: {formatWellAge(well)}</div>
                    <div>Liability: {formatLiability(well.liability_est)}</div>
                  </div>
                </Popup>
              </CircleMarker>
            );
          })}

        {showGroundwater &&
          groundwaterWells.map((well) => (
            <CircleMarker
              key={well.well_id}
              center={[well.latitude, well.longitude]}
              radius={4}
              pathOptions={{
                color: "#1d4ed8",
                fillColor: "#3b82f6",
                fillOpacity: 0.7,
                weight: 1,
              }}
            >
              <Popup>
                <div style={{ minWidth: 200 }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>Domestic Water Well</div>
                  <div>ID: {well.well_id}</div>
                  <div>
                    {well.county}, {well.state}
                  </div>
                  {well.well_depth_ft != null && <div>Depth: {well.well_depth_ft} ft</div>}
                  {well.well_capacity_gpm != null && (
                    <div>Capacity: {well.well_capacity_gpm} GPM</div>
                  )}
                  <div>Status: {well.status}</div>
                  {well.year_constructed != null && (
                    <div>Constructed: {well.year_constructed}</div>
                  )}
                  {well.miles_away != null && searchedLabel && (
                    <div>{well.miles_away.toFixed(2)} mi from {searchedLabel}</div>
                  )}
                </div>
              </Popup>
            </CircleMarker>
          ))}

        {showEpaSites &&
          epaSites.map((site) => {
            const color =
              site.site_type === "Superfund"
                ? "#f97316"   // orange — most hazardous
                : site.site_type === "TRI"
                ? "#a855f7"   // purple — industrial releases
                : "#eab308";  // yellow — brownfields
            return (
              <CircleMarker
                key={site.site_id}
                center={[site.latitude, site.longitude]}
                radius={site.site_type === "Superfund" ? 7 : 5}
                pathOptions={{
                  color,
                  fillColor: color,
                  fillOpacity: 0.75,
                  weight: site.site_type === "Superfund" ? 2 : 1,
                }}
              >
                <Popup>
                  <div style={{ minWidth: 220 }}>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>
                      {site.site_name || site.site_id}
                    </div>
                    <div style={{ fontSize: "0.85em", marginBottom: 4, color: "#666" }}>
                      {site.site_type}
                      {site.federal_facility ? " · Federal Facility" : ""}
                    </div>
                    {site.city && site.county && (
                      <div>{site.city}, {site.county} Co., {site.state}</div>
                    )}
                    <div>Status: {site.status}</div>
                    {site.npl_status && <div>NPL: {site.npl_status}</div>}
                    {site.contamination_type && (
                      <div>Contamination: {site.contamination_type}</div>
                    )}
                  </div>
                </Popup>
              </CircleMarker>
            );
          })}

        {showFrackingSites &&
          frackingSites.map((site) => (
            <CircleMarker
              key={site.id}
              center={[site.latitude, site.longitude]}
              radius={5}
              pathOptions={{
                color: "#be185d", // Deep pink/rose border
                fillColor: "#ec4899", // Vibrant pink fill
                fillOpacity: 0.8,
                weight: 1,
              }}
            >
              <Popup>
                <div style={{ minWidth: 200 }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>Active Fracking Site</div>
                  <div>API: {site.api_number}</div>
                  <div>Operator: <span style={{ fontWeight: 600 }}>{site.operator_name || "Unknown"}</span></div>
                  <div>Type: {site.well_type}</div>
                </div>
              </Popup>
            </CircleMarker>
          ))}

        <ScaleControl position="bottomright" imperial={true} metric={true} />
      </MapContainer>

    </div>
  );
}
