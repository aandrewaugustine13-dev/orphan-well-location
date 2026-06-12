"use client";

import dynamic from "next/dynamic";
import { useState, useCallback, useMemo } from "react";
import Sidebar from "@/components/Sidebar";
import LandingOverlay from "@/components/LandingOverlay";
import { Well, ColorMode } from "@/utils/supabase";
import { NLResult } from "@/components/NLSearchBar";

const Map = dynamic(() => import("@/components/Map"), { ssr: false });

function radiusToZoom(miles: number): number {
  if (miles <= 10) return 12;
  if (miles <= 50) return 10;
  if (miles <= 200) return 8;
  return 7;
}

const STATE_FIPS: Record<string, string> = { "TX": "48", "CO": "08", "NM": "35", "WY": "56" };

export default function Home() {
  const [showLanding, setShowLanding] = useState(true);
  const [activeRegions, setActiveRegions] = useState<string[]>(["TX"]);

  const handleToggleRegion = useCallback((region: string) => {
    setActiveRegions((prev) =>
      prev.includes(region) ? prev.filter((r) => r !== region) : [...prev, region]
    );
  }, []);

  const activeFips = useMemo(() => {
    return activeRegions.map((r) => STATE_FIPS[r]).filter(Boolean);
  }, [activeRegions]);
  const [wells, setWells] = useState<Well[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [center, setCenter] = useState({ lat: 39.8, lng: -98.5 });
  const [selectedWellApi, setSelectedWellApi] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [colorMode, setColorMode] = useState<ColorMode>("age");
  const [searchLocation, setSearchLocation] = useState<{ lat: number; lng: number; zoom?: number; label?: string } | null>(null);
  const [nlSummary, setNlSummary] = useState<string | null>(null);

  // Map layer toggle states
  const [showOrphanWells, setShowOrphanWells] = useState(true);
  const [showGroundwater, setShowGroundwater] = useState(false);
  const [showEpaSites, setShowEpaSites] = useState(false);
  const [showFloodZones, setShowFloodZones] = useState(false);
  const [showFrackingSites, setShowFrackingSites] = useState(false);
  const [showRiskHeatmap, setShowRiskHeatmap] = useState(false);

  const handleWellsLoaded = useCallback((data: Well[]) => setWells(data), []);
  const handleLoadingChange = useCallback((state: boolean) => setLoading(state), []);
  const handleCenterChange = useCallback((lat: number, lng: number) => setCenter({ lat, lng }), []);
  const handleError = useCallback((err: string | null) => setError(err), []);

  const handleSearchLocation = useCallback((lat: number, lng: number, label: string) => {
    setSearchLocation({ lat, lng, zoom: 13, label });
  }, []);

  const handleColorModeChange = useCallback((mode: ColorMode) => {
    // Proximity mode only makes sense when there's a searched address
    if (mode === "proximity" && !searchLocation?.label) return;
    setColorMode(mode);
  }, [searchLocation]);

  const handleToggleOrphanWells = useCallback(() => setShowOrphanWells((v) => !v), []);
  const handleToggleGroundwater = useCallback(() => setShowGroundwater((v) => !v), []);
  const handleToggleEpaSites = useCallback(() => setShowEpaSites((v) => !v), []);
  const handleToggleFloodZones = useCallback(() => setShowFloodZones((v) => !v), []);
  const handleToggleFrackingSites = useCallback(() => setShowFrackingSites((v) => !v), []);
  const handleToggleRiskHeatmap = useCallback(() => setShowRiskHeatmap((v) => !v), []);

  const handleNLResult = useCallback((result: NLResult) => {
    // NL results navigate the map but don't set a reference address — reset to age
    setColorMode("age");
    setSearchLocation({
      lat: result.center.lat,
      lng: result.center.lng,
      zoom: radiusToZoom(result.radiusMiles),
    });
    setNlSummary(result.summary);

    // Automatically enable corresponding map layers for the user
    if (result.target_layer === "groundwater_wells") {
      setShowGroundwater(true);
    } else if (result.target_layer === "epa_sites") {
      setShowEpaSites(true);
    }
  }, []);

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh", fontFamily: "var(--font-mono)" }}>
      {showLanding && <LandingOverlay onEnter={() => setShowLanding(false)} />}

      {/* ── Top bar ── */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: "36px",
          background: "#111",
          borderBottom: "1px solid #222",
          zIndex: 999,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 16px",
          opacity: showLanding ? 0 : 1,
          transition: "opacity 0.3s ease-out",
        }}
      >
        <span
          style={{
            fontSize: "10px",
            fontWeight: 700,
            letterSpacing: "0.18em",
            color: "#e0e0e0",
            fontFamily: "var(--font-mono)",
          }}
        >
          ORPHAN WELL LOCATOR
        </span>

        <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
          <span
            style={{
              fontSize: "10px",
              color: loading ? "#555" : "#888",
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.06em",
            }}
          >
            {loading ? "LOADING..." : `${wells.length} WELLS IN VIEW`}
          </span>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "10px",
              color: "#444",
              letterSpacing: "0.04em",
            }}
          >
            {center.lat.toFixed(4)}, {center.lng.toFixed(4)}
          </span>
        </div>
      </div>

      {/* ── Map area ── */}
      <div
        style={{
          position: "absolute",
          top: "36px",
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
          searchedLabel={searchLocation?.label ?? null}
          showOrphanWells={showOrphanWells}
          showGroundwater={showGroundwater}
          showEpaSites={showEpaSites}
          showFloodZones={showFloodZones}
          showFrackingSites={showFrackingSites}
          showRiskHeatmap={showRiskHeatmap}
          activeRegions={activeRegions}
          activeFips={activeFips}
        />

        {/* NL summary toast */}
        {!showLanding && nlSummary && (
          <div
            style={{
              position: "absolute",
              bottom: "28px",
              left: "50%",
              transform: "translateX(-50%)",
              width: "min(520px, calc(100vw - 48px))",
              background: "#111",
              border: "1px solid #444",
              padding: "10px 14px",
              zIndex: 800,
              display: "flex",
              alignItems: "flex-start",
              gap: "10px",
              fontFamily: "var(--font-mono)",
            }}
          >
            <span
              style={{
                fontSize: "9px",
                color: "#d4a017",
                letterSpacing: "0.12em",
                flexShrink: 0,
                marginTop: "2px",
              }}
            >
              ▶
            </span>
            <span style={{ fontSize: "11px", color: "#888", flex: 1, lineHeight: 1.6 }}>
              {nlSummary}
            </span>
            <button
              onClick={() => setNlSummary(null)}
              style={{
                background: "none",
                border: "none",
                color: "#444",
                cursor: "pointer",
                padding: "0",
                fontSize: "14px",
                flexShrink: 0,
                fontFamily: "var(--font-mono)",
                lineHeight: 1,
              }}
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        )}
      </div>

      {/* ── Sidebar ── */}
      {!showLanding && (
        <div style={{ position: "absolute", top: "36px", left: 0, bottom: 0, zIndex: 1000 }}>
          <Sidebar
            wells={wells}
            loading={loading}
            error={error}
            selectedWellApi={selectedWellApi}
            onSelectWell={setSelectedWellApi}
            isOpen={sidebarOpen}
            onToggle={() => setSidebarOpen(!sidebarOpen)}
            center={center}
            colorMode={colorMode}
            onColorModeChange={handleColorModeChange}
            onSearchLocation={handleSearchLocation}
            searchedLocation={searchLocation}
            searchedLabel={searchLocation?.label ?? null}
            showOrphanWells={showOrphanWells}
            onToggleOrphanWells={handleToggleOrphanWells}
            showGroundwater={showGroundwater}
            onToggleGroundwater={handleToggleGroundwater}
            showEpaSites={showEpaSites}
            onToggleEpaSites={handleToggleEpaSites}
            showFloodZones={showFloodZones}
            onToggleFloodZones={handleToggleFloodZones}
            showFrackingSites={showFrackingSites}
            onToggleFrackingSites={handleToggleFrackingSites}
            showRiskHeatmap={showRiskHeatmap}
            onToggleRiskHeatmap={handleToggleRiskHeatmap}
            activeRegions={activeRegions}
            onToggleRegion={handleToggleRegion}
            onNLResult={handleNLResult}
          />
        </div>
      )}
    </div>
  );
}
