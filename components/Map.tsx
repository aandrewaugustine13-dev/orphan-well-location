"use client";

import { useEffect, useCallback, useRef, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup, useMapEvents, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import {
  ColorMode,
  getWellColor,
  getInactivityRadius,
  fetchWellsNear,
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
  onError: (err: string | null) => void;
  radiusMeters: number;
  selectedWellApi: string | null;
  onSelectWell: (api: string | null) => void;
  colorMode: ColorMode;
  searchLocation: { lat: number; lng: number } | null;
}

function MapEvents({
  radiusMeters,
  onWellsLoaded,
  onLoadingChange,
  onCenterChange,
  onError,
}: {
  radiusMeters: number;
  onWellsLoaded: (wells: Well[]) => void;
  onLoadingChange: (loading: boolean) => void;
  onCenterChange: (lat: number, lng: number) => void;
  onError: (err: string | null) => void;
}) {
  const radiusRef = useRef(radiusMeters);
  radiusRef.current = radiusMeters;

  const load = useCallback(
    async (lat: number, lng: number) => {
      onLoadingChange(true);
      onError(null);
      try {
        const wells = await fetchWellsNear(lat, lng, radiusRef.current);
        onWellsLoaded(wells);
      } catch (err) {
        onError(err instanceof Error ? err.message : "Failed to load wells");
        onWellsLoaded([]);
      } finally {
        onLoadingChange(false);
      }
    },
    [onWellsLoaded, onLoadingChange, onError]
  );

  const map = useMapEvents({
    moveend: () => {
      const c = map.getCenter();
      onCenterChange(c.lat, c.lng);
      load(c.lat, c.lng);
    },
  });

  // Initial load on mount
  useEffect(() => {
    const c = map.getCenter();
    onCenterChange(c.lat, c.lng);
    load(c.lat, c.lng);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reload when radius changes
  useEffect(() => {
    const c = map.getCenter();
    load(c.lat, c.lng);
  }, [radiusMeters, load, map]);

  return null;
}

function FlyToLocation({
  searchLocation,
}: {
  searchLocation: { lat: number; lng: number } | null;
}) {
  const map = useMap();
  useEffect(() => {
    if (searchLocation) {
      map.flyTo([searchLocation.lat, searchLocation.lng], 12, { duration: 1.5 });
    }
  }, [searchLocation, map]);
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
  const [wells, setWells] = useState<Well[]>([]);

  const handleWellsLoaded = useCallback(
    (data: Well[]) => {
      setWells(data);
      onWellsLoaded(data);
    },
    [onWellsLoaded]
  );

  return (
    <MapContainer
      center={[39.8, -98.5]}
      zoom={9}
      style={{ width: "100%", height: "100%" }}
      zoomControl={true}
    >
      <TileLayer
        attribution='&copy; <a href="https://carto.com/attributions">CARTO</a>'
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
      />
      <MapEvents
        radiusMeters={radiusMeters}
        onWellsLoaded={handleWellsLoaded}
        onLoadingChange={onLoadingChange}
        onCenterChange={onCenterChange}
        onError={onError}
      />
      <FlyToLocation searchLocation={searchLocation} />
      {wells.map((well) => {
        const color = getWellColor(well, colorMode);
        const radius = getInactivityRadius(well, well.api_number === selectedWellApi);
        const isSelected = well.api_number === selectedWellApi;

        return (
          <CircleMarker
            key={well.api_number}
            center={[well.latitude, well.longitude]}
            radius={radius}
            pathOptions={{
              color: isSelected ? "#ffffff" : color,
              fillColor: color,
              fillOpacity: isSelected ? 1 : 0.85,
              weight: isSelected ? 2 : 1,
              opacity: 1,
            }}
            eventHandlers={{
              click: () => onSelectWell(isSelected ? null : well.api_number),
            }}
          >
            {isSelected && (
              <Popup>
                <div style={{ minWidth: "180px" }}>
                  <div style={{ fontWeight: 600, marginBottom: "4px", fontSize: "13px" }}>
                    {well.api_number}
                  </div>
                  {well.operator_name && (
                    <div style={{ fontSize: "12px", color: "#555", marginBottom: "2px" }}>
                      {well.operator_name}
                    </div>
                  )}
                  {(well.county || well.state) && (
                    <div style={{ fontSize: "12px", color: "#555", marginBottom: "6px" }}>
                      {[well.county, well.state].filter(Boolean).join(", ")}
                    </div>
                  )}
                  <div style={{ fontSize: "12px" }}>
                    <strong>Distance:</strong> {well.miles_away.toFixed(1)} mi
                  </div>
                  {well.months_inactive != null && (
                    <div style={{ fontSize: "12px" }}>
                      <strong>Inactive:</strong> {formatInactivity(well)}
                    </div>
                  )}
                  {well.liability_est != null && (
                    <div style={{ fontSize: "12px" }}>
                      <strong>Liability est.:</strong> {formatLiability(well.liability_est)}
                    </div>
                  )}
                </div>
              </Popup>
            )}
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
