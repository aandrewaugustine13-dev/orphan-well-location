"use client";

import { useEffect, useCallback, useRef, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Popup, useMapEvents, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import {
  ColorMode,
  Well,
  getWellColor,
  getInactivityRadius,
  formatInactivity,
  formatLiability,
  supabase,
} from "@/utils/supabase";

interface MapBounds {
  south: number;
  north: number;
  west: number;
  east: number;
}

interface MapProps {
  onWellsLoaded: (wells: Well[]) => void;
  onLoadingChange: (loading: boolean) => void;
  onCenterChange: (lat: number, lng: number) => void;
  onError: (err: string | null) => void;
  selectedWellApi: string | null;
  onSelectWell: (api: string | null) => void;
  colorMode: ColorMode;
  searchLocation: { lat: number; lng: number; zoom?: number } | null;
  searchedLocation: { lat: number; lng: number } | null;
}

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function MapEvents({
  onWellsLoaded,
  onLoadingChange,
  onCenterChange,
  onError,
  searchedLocation,
}: {
  onWellsLoaded: (wells: Well[]) => void;
  onLoadingChange: (loading: boolean) => void;
  onCenterChange: (lat: number, lng: number) => void;
  onError: (err: string | null) => void;
  searchedLocation: { lat: number; lng: number } | null;
}) {
  const searchedLocationRef = useRef(searchedLocation);
  searchedLocationRef.current = searchedLocation;

  const load = useCallback(
    async (bounds: MapBounds, center: { lat: number; lng: number }) => {
      onLoadingChange(true);
      onError(null);
      if (!supabase) {
        onError("Supabase environment variables are missing.");
        onWellsLoaded([]);
        onLoadingChange(false);
        return;
      }
      try {
        const { data, error } = await supabase
          .from("wells")
          .select("*")
          .gte("latitude", bounds.south)
          .lte("latitude", bounds.north)
          .gte("longitude", bounds.west)
          .lte("longitude", bounds.east)
          .limit(5000);
        if (error) throw new Error(error.message);
        const rawWells = (data as Well[]) ?? [];
        const loc = searchedLocationRef.current;
        const enriched = rawWells.map((w) => ({
          ...w,
          miles_away: loc
            ? haversineMiles(loc.lat, loc.lng, w.latitude, w.longitude)
            : undefined,
        }));
        onWellsLoaded(enriched);
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
      const b = map.getBounds();
      onCenterChange(c.lat, c.lng);
      load(
        { south: b.getSouth(), north: b.getNorth(), west: b.getWest(), east: b.getEast() },
        { lat: c.lat, lng: c.lng }
      );
    },
  });

  // Initial load on mount
  useEffect(() => {
    const c = map.getCenter();
    const b = map.getBounds();
    onCenterChange(c.lat, c.lng);
    load(
      { south: b.getSouth(), north: b.getNorth(), west: b.getWest(), east: b.getEast() },
      { lat: c.lat, lng: c.lng }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

function FlyToLocation({
  searchLocation,
}: {
  searchLocation: { lat: number; lng: number; zoom?: number } | null;
}) {
  const map = useMap();
  useEffect(() => {
    if (searchLocation) {
      map.flyTo([searchLocation.lat, searchLocation.lng], searchLocation.zoom ?? 12, { duration: 1.5 });
    }
  }, [searchLocation, map]);
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
        onWellsLoaded={handleWellsLoaded}
        onLoadingChange={onLoadingChange}
        onCenterChange={onCenterChange}
        onError={onError}
        searchedLocation={searchedLocation}
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
                  {well.miles_away != null && (
                    <div style={{ fontSize: "12px" }}>
                      <strong>Distance:</strong> {well.miles_away.toFixed(1)} mi
                    </div>
                  )}
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

