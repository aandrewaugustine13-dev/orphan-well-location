"use client";

import { useState } from "react";
import {
  Well,
  ColorMode,
  getWellColor,
  getWellAgeYears,
  formatWellAge,
  STATE_FIPS,
} from "@/utils/supabase";
import AddressSearch from "@/components/AddressSearch";
import NLSearchBar, { NLResult } from "@/components/NLSearchBar";

interface SidebarProps {
  wells: Well[];
  loading: boolean;
  error: string | null;
  selectedWellApi: string | null;
  onSelectWell: (api: string | null) => void;
  isOpen: boolean;
  onToggle: () => void;
  center: { lat: number; lng: number };
  colorMode: ColorMode;
  onColorModeChange: (mode: ColorMode) => void;
  onSearchLocation: (lat: number, lng: number, label: string) => void;
  searchedLocation: { lat: number; lng: number } | null;
  searchedLabel: string | null;
  
  // Layer states & toggles
  showOrphanWells: boolean;
  onToggleOrphanWells: () => void;
  showGroundwater: boolean;
  onToggleGroundwater: () => void;
  showEpaSites: boolean;
  onToggleEpaSites: () => void;
  showFloodZones: boolean;
  onToggleFloodZones: () => void;
  showFrackingSites: boolean;
  onToggleFrackingSites: () => void;
  showRiskHeatmap: boolean;
  onToggleRiskHeatmap: () => void;
  riskThreshold?: number;
  onRiskThresholdChange?: (v: number) => void;
  riskError?: string | null;
  onRiskErrorClear?: () => void;
  activeRegions: string[];
  onToggleRegion: (region: string) => void;
  onNLResult: (result: NLResult) => void;
}

export default function Sidebar({
  wells,
  loading,
  error,
  selectedWellApi,
  onSelectWell,
  isOpen,
  onToggle,
  center,
  colorMode,
  onColorModeChange,
  onSearchLocation,
  searchedLocation,
  searchedLabel,
  showOrphanWells,
  onToggleOrphanWells,
  showGroundwater,
  onToggleGroundwater,
  showEpaSites,
  onToggleEpaSites,
  showFloodZones,
  onToggleFloodZones,
  showFrackingSites,
  onToggleFrackingSites,
  showRiskHeatmap,
  onToggleRiskHeatmap,
  riskThreshold = 0,
  onRiskThresholdChange,
  riskError,
  onRiskErrorClear,
  activeRegions,
  onToggleRegion,
  onNLResult,
}: SidebarProps) {
  // Local UI-only filter for the regions list. All 50 toggles and the
  // activeRegions state machine continue to work exactly as before.
  const [regionFilter, setRegionFilter] = useState("");
  const oldWells = wells.filter((w) => (getWellAgeYears(w) ?? 0) >= 20);

  const sortedWells =
    colorMode === "age" || !searchedLocation
      ? [...wells].sort((a, b) => {
          const ageA = getWellAgeYears(a) ?? -Infinity;
          const ageB = getWellAgeYears(b) ?? -Infinity;
          return ageB - ageA;
        })
      : [...wells].sort((a, b) => (a.miles_away ?? Infinity) - (b.miles_away ?? Infinity));

  const oldestWell = [...wells].sort((a, b) => {
    const ageA = getWellAgeYears(a) ?? -Infinity;
    const ageB = getWellAgeYears(b) ?? -Infinity;
    return ageB - ageA;
  })[0];

  const stats = [
    {
      label: "IN VIEW",
      value: loading ? "—" : String(wells.length),
      color: "text-zinc-200",
    },
    {
      label: "20+ YR OLD",
      value: loading ? "—" : String(oldWells.length),
      color: oldWells.length > 0 ? "text-red-500" : "text-zinc-500",
    },
    {
      label: "OLDEST WELL",
      value: loading || !oldestWell ? "—" : formatWellAge(oldestWell).toUpperCase(),
      color:
        oldestWell && (getWellAgeYears(oldestWell) ?? 0) >= 20 ? "text-red-500" : "text-amber-500",
    },
  ];

  const closestWell = searchedLocation
    ? [...wells].sort((a, b) => (a.miles_away ?? Infinity) - (b.miles_away ?? Infinity))[0]
    : undefined;

  const closeWells = searchedLocation
    ? wells.filter((w) => (w.miles_away ?? Infinity) <= 1)
    : [];

  if (searchedLocation) {
    stats.push(
      {
        label: "WITHIN 1 MI",
        value: loading ? "—" : String(closeWells.length),
        color: closeWells.length > 0 ? "text-red-500" : "text-zinc-500",
      },
      {
        label: "NEAREST MI",
        value:
          loading || !closestWell || closestWell.miles_away == null
            ? "—"
            : closestWell.miles_away.toFixed(1),
        color:
          closestWell?.miles_away != null
            ? closestWell.miles_away <= 1
              ? "text-red-500"
              : closestWell.miles_away <= 5
              ? "text-amber-500"
              : "text-emerald-500"
            : "text-zinc-500",
      }
    );
  }

  return (
    <>
      {/* Collapsed toggle */}
      {!isOpen && (
        <button
          onClick={onToggle}
          className="absolute top-14 left-3 z-[1000] bg-zinc-900 border border-zinc-800 px-3 py-2 text-zinc-400 hover:text-zinc-200 cursor-pointer flex items-center gap-2 text-xs font-mono tracking-wider rounded-sm shadow-md transition-colors"
        >
          ≡
          {wells.length > 0 && (
            <span className="text-zinc-200 font-bold">{wells.length}</span>
          )}
        </button>
      )}

      {/* Panel */}
      <div
        className="absolute top-0 left-0 w-[340px] h-full bg-zinc-950 border-r border-zinc-900 z-[1000] flex flex-col transition-transform duration-200 ease-out shadow-lg"
        style={{
          transform: isOpen ? "translateX(0)" : "translateX(-100%)",
        }}
      >
        {/* ── Header ── */}
        <div className="p-4 px-5 border-b border-zinc-900 flex-shrink-0 flex justify-between items-start">
          <div>
            <div className="text-[10px] font-mono tracking-widest text-zinc-500 font-bold mb-1">
              ORPHAN WELL LOCATOR
            </div>
            <div className="text-xs font-mono text-zinc-400">
              {center.lat.toFixed(4)}, {center.lng.toFixed(4)}
            </div>
          </div>
          <button
            onClick={onToggle}
            className="bg-transparent border border-zinc-900 hover:border-zinc-700 text-zinc-500 hover:text-zinc-300 cursor-pointer px-2 py-0.5 text-xs font-mono leading-none rounded-sm transition-colors"
          >
            ×
          </button>
        </div>

        {/* ── Search & Query ── */}
        <div className="p-4 px-5 border-b border-zinc-900 flex-shrink-0 flex flex-col gap-3 ui-panel">
          <div>
            <div className="ui-section flex items-center gap-1.5">
              <span>⌖</span> GEOGRAPHIC SEARCH
            </div>
            <AddressSearch onSelect={(lat, lng, label) => onSearchLocation(lat, lng, label)} />
          </div>
          <div>
            <div className="ui-section flex items-center gap-1.5">
              <span>✱</span> NATURAL LANGUAGE QUERY
            </div>
            <NLSearchBar onResult={onNLResult} onError={() => {}} />
          </div>
        </div>

        {/* ── Map Layers & Toggles ── */}
        <div className="p-4 px-5 border-b border-zinc-900 flex-shrink-0 flex flex-col gap-3">
          {/* Color Mode Select */}
          {searchedLocation && (
            <div>
              <div className="text-[9px] font-mono tracking-widest text-zinc-500 font-bold mb-2">COLOR BY</div>
              <div className="flex gap-2">
                <button
                  onClick={() => onColorModeChange("age")}
                  className={`flex-1 py-1.5 text-[10px] font-mono tracking-wider font-medium cursor-pointer rounded-sm border transition-colors ${
                    colorMode === "age"
                      ? "text-zinc-100 bg-zinc-900 border-zinc-700"
                      : "text-zinc-500 bg-transparent border-zinc-900 hover:border-zinc-800"
                  }`}
                >
                  WELL AGE
                </button>
                <button
                  onClick={() => onColorModeChange("proximity")}
                  className={`flex-1 py-1.5 text-[10px] font-mono tracking-wider font-medium cursor-pointer rounded-sm border transition-colors ${
                    colorMode === "proximity"
                      ? "text-zinc-100 bg-zinc-900 border-zinc-700"
                      : "text-zinc-500 bg-transparent border-zinc-900 hover:border-zinc-800"
                  }`}
                >
                  PROXIMITY
                </button>
              </div>
            </div>
          )}

          {/* Layer Toggles */}
          <div>
            <div className="ui-section flex items-center gap-1.5">
              <span>◉</span> MAP LAYERS
            </div>
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono tracking-wider text-zinc-400">ORPHAN WELLS</span>
                <button
                  onClick={onToggleOrphanWells}
                  className={`relative inline-flex h-4 w-9 items-center rounded-full transition-colors focus:outline-none ${
                    showOrphanWells ? 'bg-red-600' : 'bg-zinc-800'
                  }`}
                  role="switch"
                  aria-checked={showOrphanWells}
                >
                  <span
                    className={`inline-block h-2.5 w-2.5 transform rounded-full bg-white transition-transform duration-200 ${
                      showOrphanWells ? 'translate-x-5.5' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono tracking-wider text-zinc-400">GROUNDWATER WELLS</span>
                <button
                  onClick={onToggleGroundwater}
                  className={`relative inline-flex h-4 w-9 items-center rounded-full transition-colors focus:outline-none ${
                    showGroundwater ? 'bg-blue-600' : 'bg-zinc-800'
                  }`}
                  role="switch"
                  aria-checked={showGroundwater}
                >
                  <span
                    className={`inline-block h-2.5 w-2.5 transform rounded-full bg-white transition-transform duration-200 ${
                      showGroundwater ? 'translate-x-5.5' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono tracking-wider text-zinc-400">ACTIVE FRACKING SITES</span>
                <button
                  onClick={onToggleFrackingSites}
                  className={`relative inline-flex h-4 w-9 items-center rounded-full transition-colors focus:outline-none ${
                    showFrackingSites ? 'bg-pink-600' : 'bg-zinc-800'
                  }`}
                  role="switch"
                  aria-checked={showFrackingSites}
                >
                  <span
                    className={`inline-block h-2.5 w-2.5 transform rounded-full bg-white transition-transform duration-200 ${
                      showFrackingSites ? 'translate-x-5.5' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono tracking-wider text-zinc-400">EPA CONTAMINATION SITES</span>
                <button
                  onClick={onToggleEpaSites}
                  className={`relative inline-flex h-4 w-9 items-center rounded-full transition-colors focus:outline-none ${
                    showEpaSites ? 'bg-orange-500' : 'bg-zinc-800'
                  }`}
                  role="switch"
                  aria-checked={showEpaSites}
                >
                  <span
                    className={`inline-block h-2.5 w-2.5 transform rounded-full bg-white transition-transform duration-200 ${
                      showEpaSites ? 'translate-x-5.5' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono tracking-wider text-zinc-400">FEMA FLOOD ZONES</span>
                <button
                  onClick={onToggleFloodZones}
                  className={`relative inline-flex h-4 w-9 items-center rounded-full transition-colors focus:outline-none ${
                    showFloodZones ? 'bg-cyan-600' : 'bg-zinc-800'
                  }`}
                  role="switch"
                  aria-checked={showFloodZones}
                >
                  <span
                    className={`inline-block h-2.5 w-2.5 transform rounded-full bg-white transition-transform duration-200 ${
                      showFloodZones ? 'translate-x-5.5' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono tracking-wider text-zinc-400">RISK (HEATMAP + HEX ZONES)</span>
                <button
                  onClick={onToggleRiskHeatmap}
                  className={`relative inline-flex h-4 w-9 items-center rounded-full transition-colors focus:outline-none ${
                    showRiskHeatmap ? 'bg-red-600' : 'bg-zinc-800'
                  }`}
                  role="switch"
                  aria-checked={showRiskHeatmap}
                >
                  <span
                    className={`inline-block h-2.5 w-2.5 transform rounded-full bg-white transition-transform duration-200 ${
                      showRiskHeatmap ? 'translate-x-5.5' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {/* Threshold only affects the hex zone outlines. The classic heatmap underlay (density glow) always uses full data. */}
              {showRiskHeatmap && onRiskThresholdChange && (
                <div className="pl-1 pt-1">
                  <div className="flex items-center justify-between">
                    <div className="text-[9px] text-zinc-500 tracking-widest">MIN HAZARD LEVEL (for hex zones)</div>
                    <button
                      onClick={() => onRiskThresholdChange(0)}
                      className="text-[9px] px-1.5 py-0 border border-zinc-700 hover:border-zinc-500 text-zinc-400 rounded-sm"
                    >
                      reset
                    </button>
                  </div>
                  <div className="flex gap-1 mt-1">
                    {[0, 4, 6, 8].map((level) => {
                      const active = riskThreshold === level;
                      return (
                        <button
                          key={level}
                          onClick={() => onRiskThresholdChange(level)}
                          className={`flex-1 py-0.5 text-[9px] font-mono tracking-wider border transition-colors rounded-sm ${
                            active
                              ? "bg-zinc-900 border-zinc-600 text-zinc-100"
                              : "bg-transparent border-zinc-800 text-zinc-500 hover:border-zinc-700 hover:text-zinc-400"
                          }`}
                        >
                          {level === 0 ? "ALL" : `≥${level}`}
                        </button>
                      );
                    })}
                  </div>
                  <div className="text-[8px] text-zinc-600 mt-0.5 tracking-wide">Classic heatmap glow is always full data. Higher = stricter hex zones only.</div>
                </div>
              )}

              {/* Visible risk layer error */}
              {showRiskHeatmap && riskError && (
                <div className="mt-2 p-2 text-[9px] bg-zinc-900 border border-red-900/60 border-l-2 border-l-red-500 text-red-400 font-mono tracking-wide">
                  <div className="flex justify-between items-start gap-2">
                    <div>
                      <span className="font-bold">RISK LAYER ERROR</span><br />
                      {riskError.length > 120 ? riskError.slice(0, 117) + '...' : riskError}
                    </div>
                    {onRiskErrorClear && (
                      <button
                        onClick={onRiskErrorClear}
                        className="text-red-400 hover:text-red-300 text-sm leading-none"
                        aria-label="Dismiss risk error"
                      >
                        ×
                      </button>
                    )}
                  </div>
                  <div className="mt-1 text-[8px] text-red-500/70">Check Supabase RPC + run heatmap_rpc.sql</div>
                </div>
              )}
            </div>
          </div>

          {/* Active Regions */}
          <div>
            <div className="ui-section flex items-center justify-between mb-1.5">
              <span className="flex items-center gap-1.5"><span>◎</span> ACTIVE REGIONS</span>
              <span className="text-[9px] text-zinc-600">{activeRegions.length}/50</span>
            </div>
            <input
              type="text"
              value={regionFilter}
              onChange={(e) => setRegionFilter(e.target.value)}
              placeholder="Filter states (e.g. tex, cal)…"
              className="ui-input w-full mb-2 px-2 py-1 text-[10px] tracking-wide"
            />
            <div className="max-h-52 overflow-y-auto pr-2 space-y-2.5 scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-transparent">
              {Object.entries(STATE_FIPS)
                .filter(([id, state]) => {
                  if (!regionFilter) return true;
                  const q = regionFilter.toLowerCase();
                  return id.toLowerCase().includes(q) || state.name.toLowerCase().includes(q);
                })
                .map(([id, state]) => {
                const isActive = activeRegions.includes(id);
                return (
                  <div key={id} className="flex items-center justify-between">
                    <span className="text-[10px] font-mono tracking-wider text-zinc-400">
                      {state.name} ({id})
                    </span>
                    <button
                      onClick={() => onToggleRegion(id)}
                      className={`relative inline-flex h-4 w-9 items-center rounded-full transition-colors focus:outline-none ${
                        isActive ? 'bg-blue-600' : 'bg-zinc-800'
                      }`}
                      role="switch"
                      aria-checked={isActive}
                    >
                      <span
                        className={`inline-block h-2.5 w-2.5 transform rounded-full bg-white transition-transform duration-200 ${
                          isActive ? 'translate-x-5.5' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── Statistics ── */}
        <div className="p-4 px-5 border-b border-zinc-900 flex-shrink-0">
          <div className="ui-section flex items-center gap-1.5">
            <span>≡</span> STATISTICS
          </div>
          <div className="flex flex-col gap-2">
            {stats.map(({ label, value, color }) => (
              <div key={label} className="flex justify-between items-baseline">
                <span className="text-[10px] font-mono text-zinc-500 tracking-wider">
                  {label}
                </span>
                <span className={`text-xs font-mono font-medium ${color}`}>
                  {value}
                </span>
              </div>
            ))}
          </div>
          {searchedLocation && searchedLabel && (
            <div className="text-[9px] text-zinc-650 mt-2 font-mono tracking-wide">
              from {searchedLabel}
            </div>
          )}
        </div>

        {/* ── Error ── */}
        {error && (
          <div className="p-4 px-5 border-b border-zinc-900 border-l-2 border-l-red-500 flex-shrink-0">
            <div className="text-[9px] text-red-500 font-mono tracking-widest font-bold mb-1">
              CONNECTION ERROR
            </div>
            <div className="text-xs text-zinc-400 leading-normal">{error}</div>
          </div>
        )}

        {/* ── Loading ── */}
        {loading && (
          <div className="p-3 px-5 border-b border-zinc-900 flex items-center gap-2 flex-shrink-0">
            <div className="w-2 h-2 border border-zinc-800 border-t-zinc-400 rounded-full animate-spin flex-shrink-0" />
            <span className="text-[9px] text-zinc-500 font-mono tracking-wide">
              QUERYING DATABASE...
            </span>
          </div>
        )}

        {/* ── Well list ── */}
        <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent well-list">
          {!loading && wells.length === 0 && !error && (
            <div className="p-8 px-5">
              <div className="text-[10px] font-mono tracking-widest text-zinc-500 font-bold mb-2">
                NO WELLS IN VIEWPORT
              </div>
              <div className="text-xs text-zinc-500 font-mono leading-relaxed">
                pan or zoom to find orphan wells
              </div>
            </div>
          )}

          {sortedWells.map((well) => {
            const isSelected = well.api_number === selectedWellApi;
            const color = getWellColor(well, colorMode);
            const showDistance =
              colorMode === "proximity" && !!searchedLocation && well.miles_away != null;
            const metricValue = showDistance
              ? `${well.miles_away!.toFixed(1)}MI`
              : formatWellAge(well).toUpperCase();

            return (
              <button
                key={well.api_number}
                onClick={() => onSelectWell(isSelected ? null : well.api_number)}
                className={`flex items-center w-full p-0 border-none border-b border-zinc-900 cursor-pointer text-left transition-colors duration-150 ${
                  isSelected ? "bg-zinc-900 border-l-2" : "bg-transparent hover:bg-zinc-900/40 border-l-2 border-l-transparent"
                }`}
                style={{
                  borderLeftColor: isSelected ? color : undefined,
                }}
              >
                <div className="flex-1 min-w-0 p-2 px-3">
                  <div className="font-mono text-xs text-zinc-300 truncate">
                    {well.api_number}
                  </div>
                  <div className="text-[10px] text-zinc-500 mt-0.5 truncate tracking-wide font-mono">
                    {[well.operator_name, well.county, well.state].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <div
                  className="flex-shrink-0 pr-3 text-[10px] font-mono tracking-wider font-semibold"
                  style={{ color }}
                >
                  {metricValue}
                </div>
              </button>
            );
          })}
        </div>

        {/* ── Footer / Legend ── */}
        <div className="p-4 border-t border-zinc-900 flex-shrink-0 flex flex-col gap-2 ui-panel">
          <div className="flex items-center justify-between">
            <span className="ui-section !mb-0">MAP LEGEND</span>
            {colorMode === "proximity" && searchedLocation && (
              <span className="text-[9px] text-zinc-500 font-mono">PROXIMITY ACTIVE</span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            {colorMode === "proximity" && searchedLocation ? (
              <>
                <div className="flex items-center gap-1.5">
                  <div className="legend-swatch" style={{ background: "#ef4444" }} />
                  <span className="text-[10px] text-zinc-500 font-mono tracking-wider">&lt; 1MI</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="legend-swatch" style={{ background: "#f97316" }} />
                  <span className="text-[10px] text-zinc-500 font-mono tracking-wider">&lt; 5MI</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="legend-swatch" style={{ background: "#facc15" }} />
                  <span className="text-[10px] text-zinc-500 font-mono tracking-wider">5+MI</span>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-1.5">
                  <div className="legend-swatch" style={{ background: "#f8fafc", border: "1px solid #333" }} />
                  <span className="text-[10px] text-zinc-500 font-mono tracking-wider">UNKNOWN</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="legend-swatch" style={{ background: "#facc15" }} />
                  <span className="text-[10px] text-zinc-500 font-mono tracking-wider">&lt; 10YR</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="legend-swatch" style={{ background: "#f97316" }} />
                  <span className="text-[10px] text-zinc-500 font-mono tracking-wider">10-20YR</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="legend-swatch" style={{ background: "#ef4444" }} />
                  <span className="text-[10px] text-zinc-500 font-mono tracking-wider">20+YR</span>
                </div>
              </>
            )}
            <div className="flex items-center gap-1.5 col-span-2 mt-0.5 border-t border-zinc-900 pt-1.5">
              <div className="legend-swatch" style={{ background: "#0284c7", border: "1px solid #38bdf8" }} />
              <span className="text-[10px] text-zinc-500 font-mono tracking-wider">FEMA FLOOD ZONE</span>
            </div>

            {/* Updated for the hex-based hazard zones (clear polygonal areas) */}
            <div className="col-span-2 mt-0.5 border-t border-zinc-900 pt-1.5">
              <div className="flex items-center gap-1.5 mb-1">
                <div className="legend-swatch hazard" style={{ background: "linear-gradient(to right, #1e3a8a, #166534, #854d0e, #9a3412, #7f1d1d)" }} />
                <span className="text-[10px] text-zinc-500 font-mono tracking-wider">ENV. HAZARD (HEATMAP + HEX ZONES)</span>
              </div>
              <div className="grid grid-cols-4 gap-1 text-[9px] text-zinc-500 font-mono pl-0.5">
                <div className="flex items-center gap-1"><span className="legend-swatch" style={{background:'#1e3a8a'}}></span> low</div>
                <div className="flex items-center gap-1"><span className="legend-swatch" style={{background:'#166534'}}></span> mod</div>
                <div className="flex items-center gap-1"><span className="legend-swatch" style={{background:'#854d0e'}}></span> subst.</div>
                <div className="flex items-center gap-1"><span className="legend-swatch" style={{background:'#7f1d1d'}}></span> high</div>
              </div>
              <div className="text-[8px] text-zinc-600 mt-0.5 pl-0.5 tracking-wide">Hex cells • server-scored (wells + flood + gw)</div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
