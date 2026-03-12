"use client";

import dynamic from "next/dynamic";
import { useState, useCallback } from "react";
import Sidebar from "@/components/Sidebar";
import { Well } from "@/utils/supabase";

const Map = dynamic(() => import("@/components/Map"), { ssr: false });

const MILES_TO_METERS = 1609.34;

export default function Home() {
  const [wells, setWells] = useState<Well[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [center, setCenter] = useState({ lat: 33.5779, lng: -101.8552 });
  const [radiusMiles, setRadiusMiles] = useState(10);
  const [selectedWellApi, setSelectedWellApi] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const handleWellsLoaded = useCallback((data: Well[]) => {
    setWells(data);
  }, []);

  const handleLoadingChange = useCallback((state: boolean) => {
    setLoading(state);
  }, []);

  const handleCenterChange = useCallback((lat: number, lng: number) => {
    setCenter({ lat, lng });
  }, []);

  const handleError = useCallback((err: string | null) => {
    setError(err);
  }, []);

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh" }}>
      <Map
        onWellsLoaded={handleWellsLoaded}
        onLoadingChange={handleLoadingChange}
        onCenterChange={handleCenterChange}
        onError={handleError}
        radiusMeters={Math.round(radiusMiles * MILES_TO_METERS)}
        selectedWellApi={selectedWellApi}
        onSelectWell={setSelectedWellApi}
      />
      <Sidebar
        wells={wells}
        loading={loading}
        error={error}
        radiusMiles={radiusMiles}
        onRadiusChange={setRadiusMiles}
        selectedWellApi={selectedWellApi}
        onSelectWell={setSelectedWellApi}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
      />

      {/* Coordinate display */}
      <div
        style={{
          position: "absolute",
          bottom: "8px",
          right: "8px",
          zIndex: 1000,
          background: "rgba(15, 17, 23, 0.85)",
          border: "1px solid var(--border)",
          borderRadius: "6px",
          padding: "6px 10px",
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: "10px",
          color: "var(--text-muted)",
        }}
      >
        {center.lat.toFixed(4)}, {center.lng.toFixed(4)}
      </div>
    </div>
  );
}
