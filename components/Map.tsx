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
import { HeatmapLayer } from "@deck.gl/aggregation-layers";
import {
  ColorMode,
  Well,
  formatWellAge,
  formatLiability,
  getWellAgeRadius,
  getWellColor,
  supabase,
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

function MapController({
  programmaticMove,
  onMoveEnd,
}: {
  programmaticMove: ProgrammaticMove | null;
  onMoveEnd: (bounds: MapBounds, center: [number, number]) => void;
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
      [c.lat, c.lng]
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
        [c.lat, c.lng]
      );
    },
  });

  return null;
}

function DeckGLOverlay({
  showRiskHeatmap,
  heatmapData,
}: {
  showRiskHeatmap: boolean;
  heatmapData: HeatmapPoint[];
}) {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());

  useEffect(() => {
    const handleZoom = () => {
      setZoom(map.getZoom());
    };
    map.on("zoomend", handleZoom);
    return () => {
      map.off("zoomend", handleZoom);
    };
  }, [map]);

  useEffect(() => {
    if (!showRiskHeatmap) return;

    // Radius scaling based on zoom: roughly representing 1/4 mile to 150 feet in real world
    const radiusPixels = Math.max(3, Math.min(100, 3 * Math.pow(1.35, zoom - 5)));

    const layers = [
      new HeatmapLayer({
        id: "liability-heatmap",
        data: heatmapData,
        getPosition: (d: any) => [d.longitude, d.latitude],
        getWeight: (d: any) => d.intensity,
        radiusPixels,
        colorRange: [
          [0, 34, 150],    // deep blue
          [0, 150, 214],   // cyan-blue
          [120, 214, 0],   // green-yellow
          [255, 230, 0],   // yellow
          [255, 100, 0],   // orange
          [255, 0, 0],     // glowing red
        ],
        intensity: 1,
        threshold: 0.03,
      }),
    ];

    const deckOverlay = new DeckOverlay({ layers });
    map.addLayer(deckOverlay);

    return () => {
      map.removeLayer(deckOverlay);
    };
  }, [map, zoom, showRiskHeatmap, heatmapData]);

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
}: MapProps) {
  const [queryBounds, setQueryBounds] = useState<MapBounds | null>(null);
  const [programmaticMove, setProgrammaticMove] = useState<ProgrammaticMove | null>(null);
  const [rawWells, setRawWells] = useState<Well[]>([]);
  const [wells, setWells] = useState<Well[]>([]);
  const [groundwaterWells, setGroundwaterWells] = useState<GroundwaterWell[]>([]);
  const [epaSites, setEpaSites] = useState<EpaSite[]>([]);
  const [femaData, setFemaData] = useState<FemaZone[]>([]);
  const [frackingSites, setFrackingSites] = useState<FrackingSite[]>([]);

  const heatmapData = useMemo<HeatmapPoint[]>(() => {
    if (!showRiskHeatmap || wells.length === 0) return [];

    return wells.map((well) => {
      let score = 2; // Baseline score

      // 1. Proximity to groundwater wells
      if (groundwaterWells.length > 0) {
        let minDistance = Infinity;
        for (const gw of groundwaterWells) {
          const dist = haversineMiles(well.latitude, well.longitude, gw.latitude, gw.longitude);
          if (dist < minDistance) {
            minDistance = dist;
          }
        }
        if (minDistance <= 1.0) {
          score += 5;
        } else if (minDistance <= 3.0) {
          score += 3;
        } else if (minDistance <= 5.0) {
          score += 1;
        }
      }

      // 2. Proximity to FEMA flood zones
      if (femaData.length > 0) {
        let closeToFlood = false;
        for (const zone of femaData) {
          if (zone.geom && zone.geom.coordinates) {
            const coords = zone.geom.coordinates[0];
            if (Array.isArray(coords)) {
              for (let i = 0; i < Math.min(coords.length, 10); i++) {
                const pt = coords[i];
                if (Array.isArray(pt) && pt.length >= 2) {
                  const dist = haversineMiles(well.latitude, well.longitude, pt[1], pt[0]);
                  if (dist <= 0.75) {
                    closeToFlood = true;
                    break;
                  }
                }
              }
            }
          }
          if (closeToFlood) break;
        }
        if (closeToFlood) {
          score += 3;
        }
      }

      return {
        longitude: well.longitude,
        latitude: well.latitude,
        intensity: Math.min(10, Math.max(1, score)),
      };
    });
  }, [showRiskHeatmap, wells, groundwaterWells, femaData]);

  const fetchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);
  const gwRequestIdRef = useRef(0);
  const epaRequestIdRef = useRef(0);
  const femaRequestIdRef = useRef(0);
  const frackingRequestIdRef = useRef(0);
  const moveIdRef = useRef(0);

  const handleMoveEnd = useCallback(
    (bounds: MapBounds, center: [number, number]) => {
      onCenterChange(center[0], center[1]);
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
  }, [queryBounds, onError, onLoadingChange]);

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
  }, [queryBounds, showGroundwater, searchedLocation]);

  // Fetch EPA sites within the current viewport bounds
  useEffect(() => {
    if (!showEpaSites || !queryBounds) {
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
        .limit(2000);

      if (requestId !== epaRequestIdRef.current) return;
      if (error) {
        console.error("Error fetching EPA sites:", error);
        return;
      }

      setEpaSites((data as EpaSite[]) ?? []);
    }

    loadEpaSites();
  }, [queryBounds, showEpaSites]);

  // Fetch FEMA flood zones within the current viewport bounds
  useEffect(() => {
    if (!showFemaFloodZones || !queryBounds) {
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
  }, [queryBounds, showFemaFloodZones]);

  // Fetch Fracking Sites within the current viewport bounds
  useEffect(() => {
    if (!showFrackingSites || !queryBounds) {
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
  }, [queryBounds, showFrackingSites]);

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

        {showRiskHeatmap && (
          <DeckGLOverlay showRiskHeatmap={showRiskHeatmap} heatmapData={heatmapData} />
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
