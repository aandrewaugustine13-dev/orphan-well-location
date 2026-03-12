"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Popup,
  useMapEvents,
  useMap,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { supabase, Well } from "@/utils/supabase";

const DEFAULT_CENTER_LAT = 33.5779;
const DEFAULT_CENTER_LNG = -101.8552;
const DEFAULT_RADIUS = 16093; // ~10 miles in meters

interface MapProps {
  onWellsLoaded: (wells: Well[]) => void;
  onLoadingChange: (loading: boolean) => void;
  onCenterChange: (lat: number, lng: number) => void;
  onError: (error: string | null) => void;
  radiusMeters: number;
  selectedWellApi: string | null;
  onSelectWell: (api: string | null) => void;
}

function MapEventHandler({
  onWellsLoaded,
  onLoadingChange,
  onCenterChange,
  onError,
  radiusMeters,
}: Omit<MapProps, "selectedWellApi" | "onSelectWell">) {
  const fetchRef = useRef(false);

  const fetchWells = useCallback(
    async (lat: number, lng: number) => {
      if (!supabase) {
        onError(
          "Supabase not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to your environment."
        );
        onLoadingChange(false);
        return;
      }

      onLoadingChange(true);
      onError(null);

      try {
        const { data, error } = await supabase.rpc("get_wells_in_radius", {
          user_lng: lng,
          user_lat: lat,
          radius_meters: radiusMeters,
        });

        if (error) {
          console.error("Supabase RPC error:", error);
          onError(`Database error: ${error.message}`);
          onWellsLoaded([]);
        } else {
          onWellsLoaded((data as Well[]) || []);
        }
      } catch (err) {
        console.error("Fetch error:", err);
        onError("Network error — could not reach database.");
        onWellsLoaded([]);
      } finally {
        onLoadingChange(false);
      }
    },
    [radiusMeters, onWellsLoaded, onLoadingChange, onError]
  );

  const map = useMapEvents({
    moveend() {
      const center = map.getCenter();
      onCenterChange(center.lat, center.lng);
      fetchWells(center.lat, center.lng);
    },
  });

  // Initial load
  useEffect(() => {
    if (!fetchRef.current) {
      fetchRef.current = true;
      const center = map.getCenter();
      onCenterChange(center.lat, center.lng);
      fetchWells(center.lat, center.lng);
    }
  }, [map, fetchWells, onCenterChange]);

  return null;
}

function FlyToWell({ apiNumber, wells }: { apiNumber: string | null; wells: Well[] }) {
  const map = useMap();

  useEffect(() => {
    if (apiNumber) {
      const well = wells.find((w) => w.api_number === apiNumber);
      if (well) {
        map.flyTo([well.latitude, well.longitude], 14, { duration: 0.8 });
      }
    }
  }, [apiNumber, wells, map]);

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
      center={[DEFAULT_CENTER_LAT, DEFAULT_CENTER_LNG]}
      zoom={10}
      style={{ width: "100%", height: "100%" }}
      zoomControl={true}
    >
      <MapEventHandler
        onWellsLoaded={handleWellsLoaded}
        onLoadingChange={onLoadingChange}
        onCenterChange={onCenterChange}
        onError={onError}
        radiusMeters={radiusMeters}
      />
      <FlyToWell apiNumber={selectedWellApi} wells={wells} />

      {/* Dark tile layer — CartoDB Dark Matter */}
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>'
      />

      {wells.map((well) => {
        const isSelected = well.api_number === selectedWellApi;
        const isClose = well.miles_away <= 1;
        const isMedium = well.miles_away <= 5;

        return (
          <CircleMarker
            key={well.api_number}
            center={[well.latitude, well.longitude]}
            radius={isSelected ? 10 : isClose ? 7 : 5}
            pathOptions={{
              fillColor: isClose ? "#ef4444" : isMedium ? "#f59e0b" : "#22c55e",
              fillOpacity: isSelected ? 1 : 0.75,
              color: isSelected ? "#fff" : "transparent",
              weight: isSelected ? 2 : 0,
            }}
            eventHandlers={{
              click: () => onSelectWell(well.api_number),
            }}
          >
            <Popup>
              <div style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                <div
                  style={{
                    fontSize: "11px",
                    color: "#9ba1b0",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    marginBottom: "4px",
                  }}
                >
                  Orphan Well
                </div>
                <div
                  style={{
                    fontSize: "14px",
                    fontWeight: 600,
                    color: "#e8eaed",
                    marginBottom: "8px",
                  }}
                >
                  {well.api_number}
                </div>
                <div style={{ fontSize: "12px", color: "#9ba1b0" }}>
                  <span
                    style={{
                      color: isClose ? "#ef4444" : isMedium ? "#f59e0b" : "#22c55e",
                      fontWeight: 600,
                    }}
                  >
                    {well.miles_away.toFixed(2)} mi
                  </span>{" "}
                  from center
                </div>
                {well.operator_name && (
                  <div
                    style={{
                      fontSize: "11px",
                      color: "#636a7e",
                      marginTop: "4px",
                    }}
                  >
                    {well.operator_name}
                  </div>
                )}
              </div>
            </Popup>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
