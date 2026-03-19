"use client";

import {
  Well,
  ColorMode,
  getWellColor,
  getWellAgeYears,
  formatWellAge,
} from "@/utils/supabase";
import AddressSearch from "@/components/AddressSearch";

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
}

const LABEL_STYLE = {
  fontSize: "9px",
  color: "#555",
  letterSpacing: "0.15em",
  fontFamily: "var(--font-mono)",
} as const;

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
      color: "#e0e0e0",
    },
    {
      label: "20+ YR OLD",
      value: loading ? "—" : String(oldWells.length),
      color: oldWells.length > 0 ? "#e5484d" : "#555",
    },
    {
      label: "OLDEST WELL",
      value: loading || !oldestWell ? "—" : formatWellAge(oldestWell).toUpperCase(),
      color:
        oldestWell && (getWellAgeYears(oldestWell) ?? 0) >= 20 ? "#e5484d" : "#d4a017",
    },
  ];

  // Distance stats only shown when a real address has been searched
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
        color: closeWells.length > 0 ? "#e5484d" : "#555",
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
              ? "#e5484d"
              : closestWell.miles_away <= 5
              ? "#d4a017"
              : "#30a46c"
            : "#555",
      }
    );
  }

  return (
    <>
      {/* Collapsed toggle */}
      {!isOpen && (
        <button
          onClick={onToggle}
          style={{
            position: "absolute",
            top: "56px",
            left: "12px",
            zIndex: 1000,
            background: "#111",
            border: "1px solid #333",
            padding: "8px 12px",
            color: "#888",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            fontSize: "10px",
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.1em",
          }}
        >
          ≡
          {wells.length > 0 && (
            <span style={{ color: "#e0e0e0" }}>{wells.length}</span>
          )}
        </button>
      )}

      {/* Panel */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "340px",
          height: "100%",
          background: "#111",
          borderRight: "1px solid #333",
          zIndex: 1000,
          display: "flex",
          flexDirection: "column",
          transform: isOpen ? "translateX(0)" : "translateX(-100%)",
          transition: "transform 0.2s ease-out",
        }}
      >
        {/* ── Header ── */}
        <div
          style={{
            padding: "14px 20px 12px",
            borderBottom: "1px solid #222",
            flexShrink: 0,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
          }}
        >
          <div>
            <div style={{ ...LABEL_STYLE, marginBottom: "4px" }}>
              ORPHAN WELL LOCATOR
            </div>
            <div style={{ fontSize: "11px", color: "#888", fontFamily: "var(--font-mono)" }}>
              {center.lat.toFixed(4)},{" "}
              {center.lng.toFixed(4)}
            </div>
          </div>
          <button
            onClick={onToggle}
            style={{
              background: "none",
              border: "1px solid #2a2a2a",
              color: "#555",
              cursor: "pointer",
              padding: "3px 8px",
              fontSize: "14px",
              fontFamily: "var(--font-mono)",
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {/* ── Address search ── */}
        <div style={{ padding: "10px 20px", borderBottom: "1px solid #222", flexShrink: 0 }}>
          <AddressSearch onSelect={(lat, lng, label) => onSearchLocation(lat, lng, label)} />
        </div>

        {/* ── Color mode — only show proximity when address is set ── */}
        {searchedLocation && (
          <div style={{ padding: "10px 20px", borderBottom: "1px solid #222", flexShrink: 0 }}>
            <div style={{ ...LABEL_STYLE, marginBottom: "7px" }}>COLOR BY</div>
            <div style={{ display: "flex", gap: "6px" }}>
              <button
                onClick={() => onColorModeChange("age")}
                style={{
                  flex: 1,
                  padding: "5px 0",
                  fontSize: "9px",
                  fontWeight: 500,
                  letterSpacing: "0.12em",
                  color: colorMode === "age" ? "#e0e0e0" : "#444",
                  background: "none",
                  border: colorMode === "age" ? "1px solid #666" : "1px solid #222",
                  cursor: "pointer",
                  fontFamily: "var(--font-mono)",
                }}
              >
                WELL AGE
              </button>
              <button
                onClick={() => onColorModeChange("proximity")}
                style={{
                  flex: 1,
                  padding: "5px 0",
                  fontSize: "9px",
                  fontWeight: 500,
                  letterSpacing: "0.12em",
                  color: colorMode === "proximity" ? "#e0e0e0" : "#444",
                  background: "none",
                  border: colorMode === "proximity" ? "1px solid #666" : "1px solid #222",
                  cursor: "pointer",
                  fontFamily: "var(--font-mono)",
                }}
              >
                PROXIMITY
              </button>
            </div>
          </div>
        )}

        {/* ── Statistics ── */}
        <div style={{ padding: "12px 20px", borderBottom: "1px solid #222", flexShrink: 0 }}>
          <div style={{ ...LABEL_STYLE, marginBottom: "10px" }}>STATISTICS</div>
          {stats.map(({ label, value, color }) => (
            <div
              key={label}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                marginBottom: "5px",
              }}
            >
              <span style={{ fontSize: "10px", color: "#555", letterSpacing: "0.06em" }}>
                {label}
              </span>
              <span
                style={{
                  fontSize: "12px",
                  color,
                  fontFamily: "var(--font-mono)",
                  fontWeight: 500,
                }}
              >
                {value}
              </span>
            </div>
          ))}
          {searchedLocation && searchedLabel && (
            <div style={{ fontSize: "9px", color: "#333", marginTop: "6px", letterSpacing: "0.04em" }}>
              from {searchedLabel}
            </div>
          )}
        </div>

        {/* ── Error ── */}
        {error && (
          <div
            style={{
              padding: "10px 20px",
              borderBottom: "1px solid #222",
              borderLeft: "2px solid #e5484d",
              flexShrink: 0,
            }}
          >
            <div
              style={{ fontSize: "9px", color: "#e5484d", letterSpacing: "0.12em", marginBottom: "3px" }}
            >
              CONNECTION ERROR
            </div>
            <div style={{ fontSize: "10px", color: "#888", lineHeight: 1.6 }}>{error}</div>
          </div>
        )}

        {/* ── Loading ── */}
        {loading && (
          <div
            style={{
              padding: "8px 20px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              borderBottom: "1px solid #1a1a1a",
              flexShrink: 0,
            }}
          >
            <div
              style={{
                width: "8px",
                height: "8px",
                border: "1px solid #333",
                borderTopColor: "#888",
                borderRadius: "50%",
                animation: "spin 0.8s linear infinite",
                flexShrink: 0,
              }}
            />
            <span style={{ fontSize: "9px", color: "#555", letterSpacing: "0.1em" }}>
              QUERYING DATABASE...
            </span>
          </div>
        )}

        {/* ── Well list ── */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {!loading && wells.length === 0 && !error && (
            <div style={{ padding: "32px 20px" }}>
              <div style={{ fontSize: "10px", color: "#555", letterSpacing: "0.08em" }}>
                NO WELLS IN VIEWPORT
              </div>
              <div style={{ fontSize: "10px", color: "#333", marginTop: "6px", lineHeight: 1.6 }}>
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
                style={{
                  display: "flex",
                  alignItems: "center",
                  width: "100%",
                  padding: "0",
                  border: "none",
                  borderBottom: "1px solid #1a1a1a",
                  borderLeft: `2px solid ${isSelected ? color : "transparent"}`,
                  background: isSelected ? "#181818" : "transparent",
                  cursor: "pointer",
                  textAlign: "left",
                  color: "var(--text-primary)",
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) e.currentTarget.style.background = "#141414";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = isSelected ? "#181818" : "transparent";
                }}
              >
                <div style={{ flex: 1, minWidth: 0, padding: "7px 8px 7px 10px" }}>
                  <div
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "11px",
                      color: "#e0e0e0",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {well.api_number}
                  </div>
                  <div
                    style={{
                      fontSize: "10px",
                      color: "#555",
                      marginTop: "2px",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      letterSpacing: "0.02em",
                    }}
                  >
                    {[well.operator_name, well.county, well.state].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <div
                  style={{
                    flexShrink: 0,
                    paddingRight: "10px",
                    fontSize: "10px",
                    color,
                    letterSpacing: "0.04em",
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {metricValue}
                </div>
              </button>
            );
          })}
        </div>

        {/* ── Footer / Legend ── */}
        <div
          style={{
            padding: "10px 20px",
            borderTop: "1px solid #222",
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span style={{ fontSize: "9px", color: "#333", letterSpacing: "0.08em" }}>
            USGS / STATE AGENCIES
          </span>
          <div style={{ display: "flex", gap: "10px" }}>
            {(colorMode === "proximity" && searchedLocation
              ? [
                  { color: "#e5484d", label: "<1MI" },
                  { color: "#d4a017", label: "<5MI" },
                  { color: "#30a46c", label: "5+MI" },
                ]
              : [
                  { color: "#30a46c", label: "<10YR" },
                  { color: "#f0a000", label: "10-20" },
                  { color: "#e5484d", label: "20+YR" },
                ]
            ).map(({ color, label }) => (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <div style={{ width: "6px", height: "6px", background: color }} />
                <span style={{ fontSize: "9px", color: "#555", letterSpacing: "0.06em" }}>
                  {label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
