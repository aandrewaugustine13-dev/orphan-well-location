"use client";

import {
  Well,
  ColorMode,
  getWellColor,
  getWellAgeYears,
  formatWellAge,
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
  onNLResult,
}: SidebarProps) {
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
        <div className="p-4 px-5 border-b border-zinc-900 flex-shrink-0 flex flex-col gap-3">
          <div>
            <div className="text-[9px] font-mono tracking-widest text-zinc-500 font-bold mb-2">GEOGRAPHIC SEARCH</div>
            <AddressSearch onSelect={(lat, lng, label) => onSearchLocation(lat, lng, label)} />
          </div>
          <div>
            <div className="text-[9px] font-mono tracking-widest text-zinc-500 font-bold mb-1">NATURAL LANGUAGE QUERY</div>
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
            <div className="text-[9px] font-mono tracking-widest text-zinc-500 font-bold mb-2.5">MAP LAYERS</div>
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
            </div>
          </div>
        </div>

        {/* ── Statistics ── */}
        <div className="p-4 px-5 border-b border-zinc-900 flex-shrink-0">
          <div className="text-[9px] font-mono tracking-widest text-zinc-500 font-bold mb-2.5">STATISTICS</div>
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
        <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent">
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
        <div className="p-4 border-t border-zinc-900 flex-shrink-0 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[9px] text-zinc-600 font-mono tracking-widest font-bold">
              MAP LEGEND
            </span>
            {colorMode === "proximity" && searchedLocation && (
              <span className="text-[9px] text-zinc-500 font-mono">PROXIMITY ACTIVE</span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2">
            {colorMode === "proximity" && searchedLocation ? (
              <>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-sm" style={{ background: "#ef4444" }} />
                  <span className="text-[10px] text-zinc-500 font-mono tracking-wider">&lt; 1MI</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-sm" style={{ background: "#f97316" }} />
                  <span className="text-[10px] text-zinc-500 font-mono tracking-wider">&lt; 5MI</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-sm" style={{ background: "#facc15" }} />
                  <span className="text-[10px] text-zinc-500 font-mono tracking-wider">5+MI</span>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-sm border border-zinc-800" style={{ background: "#f8fafc" }} />
                  <span className="text-[10px] text-zinc-500 font-mono tracking-wider">UNKNOWN</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-sm" style={{ background: "#facc15" }} />
                  <span className="text-[10px] text-zinc-500 font-mono tracking-wider">&lt; 10YR</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-sm" style={{ background: "#f97316" }} />
                  <span className="text-[10px] text-zinc-500 font-mono tracking-wider">10-20YR</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-sm" style={{ background: "#ef4444" }} />
                  <span className="text-[10px] text-zinc-500 font-mono tracking-wider">20+YR</span>
                </div>
              </>
            )}
            <div className="flex items-center gap-1.5 col-span-2 mt-0.5 border-t border-zinc-900 pt-1.5">
              <div className="w-2.5 h-2 rounded-sm" style={{ background: "#0284c7", border: "1px solid #38bdf8" }} />
              <span className="text-[10px] text-zinc-500 font-mono tracking-wider">FEMA FLOOD ZONE</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
