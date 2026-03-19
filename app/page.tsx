"use client";

import dynamic from "next/dynamic";
import { useState, useCallback } from "react";
import Sidebar from "@/components/Sidebar";
import LandingOverlay from "@/components/LandingOverlay";
import { Well, ColorMode } from "@/utils/supabase";

const Map = dynamic(() => import("@/components/Map"), { ssr: false });

const MILES_TO_METERS = 1609.34;

export default function Home() {
  const [showLanding, setShowLanding] = useState(true);
  const [wells, setWells] = useState<Well[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [center, setCenter] = useState({ lat: 39.8, lng: -98.5 });
  const [radiusMiles, setRadiusMiles] = useState(10);
  const [selectedWellApi, setSelectedWellApi] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [colorMode, setColorMode] = useState<ColorMode>("proximity");
  const [searchLocation, setSearchLocation] = useState<{ lat: number; lng: number } | null>(null);

  const handleWellsLoaded = useCallback((data: Well[]) => setWells(data), []);
  const handleLoadingChange = useCallback((state: boolean) => setLoading(state), []);
  const handleCenterChange = useCallback((lat: number, lng: number) => setCenter({ lat, lng }), []);
  const handleError = useCallback((err: string | null) => setError(err), []);
  const handleSearchLocation = useCallback((lat: number, lng: number) => {
    setSearchLocation({ lat, lng });
  }, []);

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh" }}>
      {showLanding && <LandingOverlay onEnter={() => setShowLanding(false)} />}

      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: "40px",
          background: "var(--bg-card)",
          borderBottom: "1px solid var(--border)",
          zIndex: 999,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 20px",
          opacity: showLanding ? 0 : 1,
          transition: "opacity 0.3s ease-out",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div
            style={{
              width: "24px",
              height: "24px",
              borderRadius: "6px",
              background: "var(--accent-soft)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="10" r="3" stroke="var(--accent)" strokeWidth="2" />
              <path d="M12 2C7.58 2 4 5.58 4 10c0 5.25 8 12 8 12s8-6.75 8-12c0-4.42-3.58-8-8-8z" stroke="var(--accent)" strokeWidth="2" fill="none" />
            </svg>
          </div>
          <span style={{ fontSize: "14px", fontWeight: 600, letterSpacing: "-0.01em" }}>
            Orphan Well Locator
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <div
              style={{
                width: "6px",
                height: "6px",
                borderRadius: "50%",
                background: loading ? "var(--text-tertiary)" : "var(--green)",
              }}
            />
            <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
              {loading ? "Scanning..." : `${wells.length} wells`}
            </span>
          </div>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-tertiary)" }}>
            {center.lat.toFixed(4)}, {center.lng.toFixed(4)}
          </span>
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          top: "40px",
          left: 0,
          right: 0,
          bottom: 0,
          opacity: showLanding ? 0 : 1,
          transition: "opacity 0.5s ease-out",
        }}
      >
        <Map
          onWellsLoaded={handleWellsLoaded}
          onLoadingChange={handleLoadingChange}
          onCenterChange={handleCenterChange}
          onError={handleError}
          selectedWellApi={selectedWellApi}
          onSelectWell={setSelectedWellApi}
          colorMode={colorMode}
          searchLocation={searchLocation}
          searchedLocation={searchLocation}
        />
      </div>

      {!showLanding && (
        <div style={{ position: "absolute", top: "40px", left: 0, bottom: 0, zIndex: 1000 }}>
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
            center={center}
            colorMode={colorMode}
            onColorModeChange={setColorMode}
            onSearchLocation={handleSearchLocation}
          />
        </div>
      )}
    </div>
  );
}
