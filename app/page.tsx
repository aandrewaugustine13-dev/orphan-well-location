"use client";

import dynamic from "next/dynamic";
import { useState, useCallback } from "react";
import Sidebar from "@/components/Sidebar";
import LandingOverlay from "@/components/LandingOverlay";
import { Well } from "@/utils/supabase";

const Map = dynamic(() => import("@/components/Map"), { ssr: false });

const MILES_TO_METERS = 1609.34;

export default function Home() {
  const [showLanding, setShowLanding] = useState(true);
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
    <div className="scan-lines" style={{ position: "relative", width: "100vw", height: "100vh" }}>
      {/* Landing Overlay */}
      {showLanding && <LandingOverlay onEnter={() => setShowLanding(false)} />}

      {/* Status Bar */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: "36px",
          background: "var(--bg-panel)",
          borderBottom: "1px solid var(--border-amber)",
          zIndex: 999,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 16px",
          opacity: showLanding ? 0 : 1,
          transition: "opacity 0.5s ease-out 0.3s",
        }}
      >
        {/* Left */}
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
              <path d="M12 3L21 19H3L12 3Z" stroke="var(--amber)" strokeWidth="2" fill="var(--amber-dim)" />
            </svg>
            <span
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "12px",
                fontWeight: 700,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "var(--text-bright)",
              }}
            >
              OWL
            </span>
          </div>

          <div
            style={{
              width: "1px",
              height: "16px",
              background: "var(--border)",
            }}
          />

          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "10px",
              color: "var(--text-muted)",
              letterSpacing: "0.04em",
            }}
          >
            ORPHAN WELL LOCATOR — WEST TEXAS
          </span>
        </div>

        {/* Right */}
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          {/* Well count */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <div
              style={{
                width: "5px",
                height: "5px",
                borderRadius: "50%",
                background: loading ? "var(--text-muted)" : wells.length > 0 ? "var(--amber)" : "var(--green)",
                boxShadow: loading
                  ? "none"
                  : wells.length > 0
                  ? "0 0 6px var(--amber-glow)"
                  : "0 0 6px var(--green)",
              }}
            />
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "10px",
                color: "var(--text-secondary)",
              }}
            >
              {loading ? "SCANNING" : `${wells.length} DETECTED`}
            </span>
          </div>

          <div style={{ width: "1px", height: "16px", background: "var(--border)" }} />

          {/* Coordinates */}
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "10px",
              color: "var(--text-muted)",
            }}
          >
            {center.lat.toFixed(4)}°N {Math.abs(center.lng).toFixed(4)}°W
          </span>
        </div>
      </div>

      {/* Map */}
      <div
        style={{
          position: "absolute",
          top: "36px",
          left: 0,
          right: 0,
          bottom: 0,
          opacity: showLanding ? 0 : 1,
          transition: "opacity 0.8s ease-out",
        }}
      >
        <Map
          onWellsLoaded={handleWellsLoaded}
          onLoadingChange={handleLoadingChange}
          onCenterChange={handleCenterChange}
          onError={handleError}
          radiusMeters={Math.round(radiusMiles * MILES_TO_METERS)}
          selectedWellApi={selectedWellApi}
          onSelectWell={setSelectedWellApi}
        />
      </div>

      {/* Sidebar */}
      {!showLanding && (
        <div style={{ position: "absolute", top: "36px", left: 0, bottom: 0, zIndex: 1000 }}>
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
          />
        </div>
      )}
    </div>
  );
}
