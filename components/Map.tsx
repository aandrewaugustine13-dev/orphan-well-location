"use client";

import { useEffect, useRef, useState } from "react";
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
  Well,
  ColorMode,
  getWellColor,
  formatInactivity,
  formatLiability,
  supabase,
  getInactivityRadius,
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

const DEFAULT_CENTER: [number, number] = [39.8, -98.5];
const DEFAULT_ZOOM = 5;

function CenterSync({ center }: { center: [number, number] }) {
  const map = useMap();

  useEffect(() => {
    map.flyTo(center, Math.max(map.getZoom(), 10), { duration: 0.75 });
  }, [center, map]);

  return null;
}

function MapMoveListener({
  onMoveEnd,
}: {
  onMoveEnd: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    moveend(e) {
      const c = e.target.getCenter();
      onMoveEnd(c.lat, c.lng);
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
  const [center, setCenter] = useState<[number, number]>(DEFAULT_CENTER);
  const [wells, setWells] = useState<Well[]>([]);
  const [mapReady, setMapReady] = useState(false);
  const hasSearchRef = useRef(false);

  useEffect(() => {
    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (hasSearchRef.current) return;
        const next: [number, number] = [
          position.coords.latitude,
          position.coords.longitude,
        ];
        setCenter(next);
      },
      () => {
        // Keep default center on failure.
      },
      { enableHighAccuracy: false, timeout: 8000 }
    );
  }, []);

  useEffect(() => {
    if (!searchLocation) return;
    hasSearchRef.current = true;
    setCenter([searchLocation.lat, searchLocation.lng]);
  }, [searchLocation]);

  useEffect(() => {
    onCenterChange(center[0], center[1]);
  }, [center, onCenterChange]);

  useEffect(() => {
    let cancelled = false;

    async function loadWells() {
      onLoadingChange(true);
      onError(null);

      if (!supabase) {
        onError("Supabase environment variables are missing.");
        onLoadingChange(false);
        return;
      }

      const { data, error } = await supabase.rpc("get_wells_in_radius", {
        user_lng: center[1],
        user_lat: center[0],
        radius_meters: radiusMeters,
      });

      if (cancelled) return;

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

    return () => {
      cancelled = true;
    };
  }, [center, radiusMeters, onError, onLoadingChange, onWellsLoaded]);


  return (
    <MapContainer
      center={center}
      zoom={DEFAULT_ZOOM}
      style={{ width: "100%", height: "100%" }}
      whenReady={() => setMapReady(true)}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; CARTO'
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
      />

      {mapReady && <CenterSync center={center} />}
      <MapMoveListener onMoveEnd={(lat, lng) => setCenter([lat, lng])} />

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
