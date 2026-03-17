"use client";

import { MutableRefObject, useCallback, useEffect, useRef, useState } from "react";
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

interface MapProps {
  onWellsLoaded: (wells: Well[]) => void;
  onLoadingChange: (loading: boolean) => void;
  onCenterChange: (lat: number, lng: number) => void;
  onError: (error: string | null) => void;
  radiusMeters: number;
  selectedWellApi: string | null;
  onSelectWell: (api: string | null) => void;
  colorMode: ColorMode;
  searchLocation: { lat: number; lng: number } | null;
}

interface ProgrammaticMove {
  lat: number;
  lng: number;
  zoom?: number;
  id: number;
}

const DEFAULT_CENTER: [number, number] = [39.8, -98.5];
const DEFAULT_ZOOM = 5;
const FETCH_DEBOUNCE_MS = 300;
const MIN_CENTER_CHANGE_METERS = 20;

function distanceMeters(a: [number, number], b: [number, number]) {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const dLat = lat2 - lat1;
  const dLng = toRad(b[1] - a[1]);

  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;

  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

function MapController({
  programmaticMove,
  suppressNextMoveEndRef,
  onUserMoveEnd,
}: {
  programmaticMove: ProgrammaticMove | null;
  suppressNextMoveEndRef: MutableRefObject<boolean>;
  onUserMoveEnd: (lat: number, lng: number) => void;
}) {
  const map = useMap();

  useEffect(() => {
    if (!programmaticMove) return;

    const current = map.getCenter();
    const target: [number, number] = [programmaticMove.lat, programmaticMove.lng];
    const currentTuple: [number, number] = [current.lat, current.lng];

    if (distanceMeters(currentTuple, target) < 1) return;

    suppressNextMoveEndRef.current = true;
    map.flyTo(target, programmaticMove.zoom ?? map.getZoom(), { duration: 0.6 });
  }, [map, programmaticMove, suppressNextMoveEndRef]);

  useMapEvents({
    moveend(e) {
      if (suppressNextMoveEndRef.current) {
        suppressNextMoveEndRef.current = false;
        return;
      }

      const c = e.target.getCenter();
      onUserMoveEnd(c.lat, c.lng);
    },
  });

  return null;
}

export default function Map({
  onWellsLoaded,
  onLoadingChange,
  onCenterChange,
  onError,
  radiusMeters,
  selectedWellApi,
  onSelectWell,
  colorMode,
  searchLocation,
}: MapProps) {
  const [mapCenter, setMapCenter] = useState<[number, number]>(DEFAULT_CENTER);
  const [queryCenter, setQueryCenter] = useState<[number, number]>(DEFAULT_CENTER);
  const [programmaticMove, setProgrammaticMove] = useState<ProgrammaticMove | null>(null);
  const [wells, setWells] = useState<Well[]>([]);

  const suppressNextMoveEndRef = useRef(false);
  const fetchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);
  const moveIdRef = useRef(0);

  const applyCenterUpdate = useCallback((next: [number, number], immediateFetch: boolean) => {
    setMapCenter((prev) => {
      const changed = distanceMeters(prev, next) >= MIN_CENTER_CHANGE_METERS;
      if (!changed) return prev;
      return next;
    });

    if (immediateFetch) {
      if (fetchDebounceRef.current) {
        clearTimeout(fetchDebounceRef.current);
        fetchDebounceRef.current = null;
      }
      setQueryCenter(next);
      return;
    }

    if (fetchDebounceRef.current) {
      clearTimeout(fetchDebounceRef.current);
    }

    fetchDebounceRef.current = setTimeout(() => {
      setQueryCenter(next);
      fetchDebounceRef.current = null;
    }, FETCH_DEBOUNCE_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (fetchDebounceRef.current) {
        clearTimeout(fetchDebounceRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const next: [number, number] = [position.coords.latitude, position.coords.longitude];
        applyCenterUpdate(next, true);
        moveIdRef.current += 1;
        setProgrammaticMove({ lat: next[0], lng: next[1], id: moveIdRef.current, zoom: 10 });
      },
      () => {
        // Keep default center on failure.
      },
      { enableHighAccuracy: false, timeout: 8000 }
    );
  }, [applyCenterUpdate]);

  useEffect(() => {
    if (!searchLocation) return;

    const next: [number, number] = [searchLocation.lat, searchLocation.lng];
    applyCenterUpdate(next, true);
    moveIdRef.current += 1;
    setProgrammaticMove({ lat: next[0], lng: next[1], id: moveIdRef.current, zoom: 11 });
  }, [applyCenterUpdate, searchLocation]);

  useEffect(() => {
    onCenterChange(mapCenter[0], mapCenter[1]);
  }, [mapCenter, onCenterChange]);

  useEffect(() => {
    const requestId = ++requestIdRef.current;

    async function loadWells() {
      onLoadingChange(true);
      onError(null);

      if (!supabase) {
        onError("Supabase environment variables are missing.");
        onWellsLoaded([]);
        setWells([]);
        onLoadingChange(false);
        return;
      }

      const { data, error } = await supabase.rpc("get_wells_in_radius", {
        user_lng: queryCenter[1],
        user_lat: queryCenter[0],
        radius_meters: radiusMeters,
      });

      if (requestId !== requestIdRef.current) {
        return;
      }

      if (error) {
        onError(error.message);
        setWells([]);
        onWellsLoaded([]);
        onLoadingChange(false);
        return;
      }

      const safeData = (data as Well[]) ?? [];
      setWells(safeData);
      onWellsLoaded(safeData);
      onLoadingChange(false);
    }

    loadWells();
  }, [queryCenter, radiusMeters, onError, onLoadingChange, onWellsLoaded]);

  return (
    <MapContainer
      center={DEFAULT_CENTER}
      zoom={DEFAULT_ZOOM}
      style={{ width: "100%", height: "100%" }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; CARTO'
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
      />

      <MapController
        programmaticMove={programmaticMove}
        suppressNextMoveEndRef={suppressNextMoveEndRef}
        onUserMoveEnd={(lat, lng) => applyCenterUpdate([lat, lng], false)}
      />

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
                <div>{well.miles_away.toFixed(2)} mi away</div>
                <div>Inactive: {formatInactivity(well)}</div>
                <div>Liability: {formatLiability(well.liability_est)}</div>
              </div>
            </Popup>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
