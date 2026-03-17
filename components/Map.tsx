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
import {
  supabase,
  Well,
  ColorMode,
  getWellColor,
  getProximityColor,
  getInactivityRadius,
  formatInactivity,
  formatLiability,
} from "@/utils/supabase";

const DEFAULT_CENTER_LAT = 33.5779;
const DEFAULT_CENTER_LNG = -101.8552;

interface MapProps {
  onWellsLoaded: (wells: Well[]) => void;
  onLoadingChange: (loading: boolean) => void;
  onCenterChange: (lat: number, lng: number) => void;
  onError: (error: string | null) => void;
  radiusMeters: number;
  selectedWellApi: string | null;
  onSelectWell: (api: string | null) => void;
  colorMode: ColorMode;
}

function MapEventHandler({
  onWellsLoaded,
  onLoadingChange,
  onCenterChange,
  onError,
  radiusMeters,
  skipFetchRef,
}: Omit<MapProps, "selectedWellApi" | "onSelectWell" | "colorMode"> & {
  skipFetchRef: React.MutableRefObject<boolean>;
}) {
  const initRef = useRef(false);

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
      if (skipFetchRef.current) {
        skipFetchRef.current = false;
        const center = map.getCenter();
        onCenterChange(center.lat, center.lng);
        return;
      }
      const center = map.getCenter();
      onCenterChange(center.lat, center.lng);
      fetchWells(center.lat, center.lng);
    },
  });

  useEffect(() => {
    if (!initRef.current) {
      initRef.current = true;
      const center = map.getCenter();
      onCenterChange(center.lat, center.lng);
      fetchWells(center.lat, center.lng);
    }
  }, [map, fetchWells, onCenterChange]);

  return null;
}

function FlyToWell({
  apiNumber,
  wells,
  skipFetchRef,
}: {
  apiNumber: string | null;
  wells: Well[];
  skipFetchRef: React.MutableRefObject<boolean>;
}) {
  const map = useMap();

  useEffect(() => {
    if (apiNumber) {
      const well = wells.find((w) => w.api_number === apiNumber);
      if (well) {
        skipFetchRef.current = true;
        map.flyTo([well.latitude, well.longitude], 14, { duration: 0.8 });
      }
    }
  }, [apiNumber, wells, map, skipFetchRef]);

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
}: MapProps) {
  const [wells, setWells] = useState<Well[]>([]);
  const skipFetchRef = useRef(false);

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
        skipFetchRef={skipFetchRef}
      />
      <FlyToWell apiNumber={selectedWellApi} wells={wells} skipFetchRef={skipFetchRef} />

      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>'
      />

      {wells.map((well) => {
        const isSelected = well.api_number === selectedWellApi;
        const color = getWellColor(well, colorMode);
        const proximityColor = getProximityColor(well.miles_away);

        const radius =
          colorMode === "inactivity"
            ? getInactivityRadius(well, isSelected)
            : isSelected
            ? 10
            : well.miles_away <= 1
            ? 7
            : 5;

        return (
          <CircleMarker
            key={well.api_number}
            center={[well.latitude, well.longitude]}
            radius={radius}
            pathOptions={{
              fillColor: color,
              fillOpacity: isSelected ? 1 : 0.75,
              color: isSelected ? "#fff" : "transparent",
              weight: isSelected ? 2 : 0,
            }}
            eventHandlers={{
              click: () => onSelectWell(well.api_number),
            }}
          >
            <Popup>
              <div style={{ minWidth: "200px" }}>
                <div
                  style={{
                    fontFamily: "'IBM Plex Mono', monospace",
                    fontSize: "14px",
                    fontWeight: 500,
                    color: "#f0f2f5",
                    marginBottom: "2px",
                  }}
                >
                  {well.api_number}
                </div>

                {well.well_name && (
                  <div style={{ fontSize: "12px", color: "#8b95a8", marginBottom: "8px" }}>
                    {well.well_name}
                  </div>
                )}

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "6px 12px",
                    fontSize: "12px",
                  }}
                >
                  <div>
                    <div style={{ color: "#505c72", fontSize: "10px", marginBottom: "1px" }}>Distance</div>
                    <div style={{ color: proximityColor, fontWeight: 600 }}>
                      {well.miles_away.toFixed(2)} mi
                    </div>
                  </div>

                  <div>
                    <div style={{ color: "#505c72", fontSize: "10px", marginBottom: "1px" }}>Inactive</div>
                    <div style={{ color: "#f0f2f5", fontWeight: 500 }}>
                      {formatInactivity(well)}
                    </div>
                  </div>

                  {well.operator_name && (
                    <div style={{ gridColumn: "1 / -1" }}>
                      <div style={{ color: "#505c72", fontSize: "10px", marginBottom: "1px" }}>Operator</div>
                      <div style={{ color: "#8b95a8" }}>{well.operator_name}</div>
                    </div>
                  )}

                  {well.county && (
                    <div>
                      <div style={{ color: "#505c72", fontSize: "10px", marginBottom: "1px" }}>County</div>
                      <div style={{ color: "#8b95a8" }}>{well.county}</div>
                    </div>
                  )}

                  {well.field_name && (
                    <div>
                      <div style={{ color: "#505c72", fontSize: "10px", marginBottom: "1px" }}>Field</div>
                      <div style={{ color: "#8b95a8" }}>{well.field_name}</div>
                    </div>
                  )}

                  {well.liability_est != null && (
                    <div>
                      <div style={{ color: "#505c72", fontSize: "10px", marginBottom: "1px" }}>Est. Liability</div>
                      <div style={{ color: "#f0f2f5", fontWeight: 500 }}>
                        {formatLiability(well.liability_est)}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </Popup>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
