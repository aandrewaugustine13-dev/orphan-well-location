"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CircleMarker,
  MapContainer,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import {
  ColorMode,
  Well,
  formatInactivity,
  formatLiability,
  getInactivityRadius,
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
}: MapProps) {
  const [queryBounds, setQueryBounds] = useState<MapBounds | null>(null);
  const [programmaticMove, setProgrammaticMove] = useState<ProgrammaticMove | null>(null);
  const [rawWells, setRawWells] = useState<Well[]>([]);
  const [wells, setWells] = useState<Well[]>([]);
  const [groundwaterWells, setGroundwaterWells] = useState<GroundwaterWell[]>([]);
  const [showGroundwater, setShowGroundwater] = useState(false);

  const fetchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);
  const gwRequestIdRef = useRef(0);
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
        .from("wells")
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

        <MapController programmaticMove={programmaticMove} onMoveEnd={handleMoveEnd} />

        {wells.map((well) => {
          const isSelected = selectedWellApi === well.api_number;
          const color = getWellColor(well, colorMode);

          return (
            <CircleMarker
              key={well.api_number}
              center={[well.latitude, well.longitude]}
              radius={getInactivityRadius(well, isSelected)}
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
                  {well.miles_away != null && (
                    <div>{well.miles_away.toFixed(2)} mi from search point</div>
                  )}
                  <div>Inactive: {formatInactivity(well)}</div>
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
                  {well.miles_away != null && (
                    <div>{well.miles_away.toFixed(2)} mi from search point</div>
                  )}
                </div>
              </Popup>
            </CircleMarker>
          ))}
      </MapContainer>

      <div style={{ position: "absolute", bottom: 24, right: 12, zIndex: 1000 }}>
        <button
          onClick={() => setShowGroundwater((v) => !v)}
          className={`px-3 py-2 rounded shadow text-sm font-medium transition-colors ${
            showGroundwater
              ? "bg-blue-600 text-white hover:bg-blue-700"
              : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-50"
          }`}
        >
          {showGroundwater ? "Hide Groundwater Wells" : "Show Groundwater Wells"}
        </button>
      </div>
    </div>
  );
}
