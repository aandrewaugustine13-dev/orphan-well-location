"use client";

import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import { supabase } from "@/utils/supabase";

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

const DEFAULT_CENTER_LAT = 33.5779;
const DEFAULT_CENTER_LNG = -101.8552;
const RADIUS_METERS = 16093;

function MapUpdater({ setWells }: { setWells: React.Dispatch<React.SetStateAction<Well[]>> }) {
  async function fetchWellsAt(lat: number, lng: number) {
    if (!supabase) {
      console.warn(
        "Supabase client not initialized. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."
      );
      return;
    }
    console.log("Fetching new center:", lng, lat);
    const { data, error } = await supabase.rpc("get_wells_in_radius", {
      user_lng: lng,
      user_lat: lat,
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

  const map = useMapEvents({
    moveend() {
      const center = map.getCenter();
      fetchWellsAt(center.lat, center.lng);
    },
  });

  useEffect(() => {
    fetchWellsAt(DEFAULT_CENTER_LAT, DEFAULT_CENTER_LNG);
  }, [setWells]);

  return null;
}

export default function Map() {
  const [wells, setWells] = useState<Well[]>([]);

  return (
    <MapContainer
      center={[DEFAULT_CENTER_LAT, DEFAULT_CENTER_LNG]}
      zoom={10}
      style={{ width: "100vw", height: "100vh" }}
    >
      <MapUpdater setWells={setWells} />
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      />
      {wells.map((well) => (
        <Marker key={well.api_number} position={[well.latitude, well.longitude]}>
          <Popup>
            <strong>API Number:</strong> {well.api_number}
            <br />
            <strong>Distance:</strong> {well.miles_away.toFixed(2)} miles
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
