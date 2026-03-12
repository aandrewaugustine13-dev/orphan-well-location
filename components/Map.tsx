"use client";

import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import { supabase } from "@/lib/supabase";

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon.src,
  iconRetinaUrl: markerIcon2x.src,
  shadowUrl: markerShadow.src,
});

interface Well {
  well_name: string;
  api_number: string;
  latitude: number;
  longitude: number;
  miles_away: number;
}

const CENTER_LAT = 33.5779;
const CENTER_LON = -101.8552;
const RADIUS_METERS = 16093;

export default function Map() {
  const [wells, setWells] = useState<Well[]>([]);

  useEffect(() => {
    async function fetchWells() {
      if (!supabase) {
        console.warn(
          "Supabase client not initialized. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."
        );
        return;
      }

      const { data, error } = await supabase.rpc("get_wells_in_radius", {
        center_lon: CENTER_LON,
        center_lat: CENTER_LAT,
        radius_meters: RADIUS_METERS,
      });

      if (error) {
        console.error("Error fetching wells:", error);
        return;
      }

      if (data) {
        setWells(data as Well[]);
      }
    }

    fetchWells();
  }, []);

  return (
    <MapContainer
      center={[CENTER_LAT, CENTER_LON]}
      zoom={10}
      style={{ width: "100vw", height: "100vh" }}
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      />
      {wells.map((well) => (
        <Marker key={well.api_number} position={[well.latitude, well.longitude]}>
          <Popup>
            <strong>Well Name:</strong> {well.well_name}
            <br />
            <strong>API Number:</strong> {well.api_number}
            <br />
            <strong>Distance:</strong> {well.miles_away.toFixed(2)} miles
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
