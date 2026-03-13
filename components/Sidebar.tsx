"use client";

import { Well } from "@/utils/supabase";

interface SidebarProps {
  wells: Well[];
  loading: boolean;
  error: string | null;
  radiusMiles: number;
  onRadiusChange: (miles: number) => void;
  selectedWellApi: string | null;
  onSelectWell: (api: string | null) => void;
  isOpen: boolean;
  onToggle: () => void;
  center: { lat: number; lng: number };
}

function ProximityBadge({ miles }: { miles: number }) {
  const isClose = miles <= 1;
  const isMedium = miles <= 5;
  const color = isClose ? "var(--red)" : isMedium ? "var(--amber)" : "var(--green)";
  const bg = isClose ? "var(--red-soft)" : isMedium ? "var(--amber-soft)" : "var(--green-soft)";

  return (
    <span
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: "12px",
        fontWeight: 500,
        color,
        background: bg,
        padding: "3px 8px",
        borderRadius: "4px",
        whiteSpace: "nowrap",
      }}
    >
      {miles.toFixed(1)} mi
    </span>
  );
}

export default function Sidebar({
  wells,
  loading,
  error,
  radiusMiles,
  onRadiusChange,
  selectedWellApi,
  onSelectWell,
  isOpen,
  onToggle,
  center,
}: SidebarProps) {
  const closeWells = wells.filter((w) => w.miles_away <= 1);
  const nearWells = wells.filter((w) => w.miles_away > 1 && w.miles_away <= 5);
  const sortedWells = [...wells].sort((a, b) => a.miles_away - b.miles_away);
  const closestWell = sortedWells[0];

  return (
    <>
      {/* Collapsed toggle */}
      {!isOpen && (
        <button
          onClick={onToggle}
          style={{
            position: "absolute",
            top: "12px",
            left: "12px",
            zIndex: 1000,
            background: "var(--bg-card)",
            border: "1px solid var(--border-strong)",
            borderRadius: "var(--radius)",
            padding: "10px 14px",
            color: "var(--text-primary)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "10px",
            fontSize: "14px",
            fontWeight: 500,
            boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M3 12h18M3 6h18M3 18h18" />
          </svg>
          {wells.length > 0 && (
            <span
              style={{
                background: "var(--accent)",
                color: "#fff",
                borderRadius: "12px",
                padding: "2px 8px",
                fontSize: "12px",
                fontWeight: 600,
              }}
            >
              {wells.length}
            </span>
          )}
        </button>
      )}

      {/* Panel */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "380px",
          height: "100%",
          background: "var(--bg-card)",
          borderRight: "1px solid var(--border)",
          zIndex: 1000,
          display: "flex",
          flexDirection: "column",
          transform: isOpen ? "translateX(0)" : "translateX(-100%)",
          transition: "transform 0.25s ease-out",
          boxShadow: isOpen ? "8px 0 32px rgba(0,0,0,0.2)" : "none",
        }}
      >
        {/* Header */}
        <div style={{ padding: "20px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <div
                style={{
                  width: "32px",
                  height: "32px",
                  borderRadius: "8px",
                  background: "var(--accent-soft)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="10" r="3" stroke="var(--accent)" strokeWidth="1.5" />
                  <path d="M12 2C7.58 2 4 5.58 4 10c0 5.25 8 12 8 12s8-6.75 8-12c0-4.42-3.58-8-8-8z" stroke="var(--accent)" strokeWidth="1.5" fill="none" />
                </svg>
              </div>
              <div>
                <h1 style={{ fontSize: "16px", fontWeight: 700, letterSpacing: "-0.01em" }}>
                  Orphan Wells
                </h1>
                <div style={{ fontSize: "12px", color: "var(--text-tertiary)", marginTop: "1px" }}>
                  {center.lat.toFixed(4)}, {center.lng.toFixed(4)}
                </div>
              </div>
            </div>
            <button
              onClick={onToggle}
              style={{
                background: "var(--bg-surface)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                color: "var(--text-secondary)",
                cursor: "pointer",
                padding: "6px",
                display: "flex",
                alignItems: "center",
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
          </div>
        </div>

        {/* Stats */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px" }}>
            {[
              {
                value: loading ? "\u2014" : wells.length,
                label: "Total",
                color: "var(--accent)",
              },
              {
                value: loading ? "\u2014" : closeWells.length,
                label: "Within 1 mi",
                color: closeWells.length > 0 ? "var(--red)" : "var(--text-tertiary)",
              },
              {
                value: loading || !closestWell ? "\u2014" : `${closestWell.miles_away.toFixed(1)}`,
                label: "Nearest (mi)",
                color:
                  closestWell && closestWell.miles_away <= 1
                    ? "var(--red)"
                    : closestWell && closestWell.miles_away <= 5
                    ? "var(--amber)"
                    : "var(--green)",
              },
            ].map((stat) => (
              <div
                key={stat.label}
                style={{
                  background: "var(--bg-base)",
                  borderRadius: "var(--radius-sm)",
                  padding: "12px",
                }}
              >
                <div
                  style={{
                    fontSize: "22px",
                    fontWeight: 700,
                    color: stat.color,
                    lineHeight: 1.1,
                    letterSpacing: "-0.02em",
                  }}
                >
                  {stat.value}
                </div>
                <div
                  style={{
                    fontSize: "11px",
                    color: "var(--text-tertiary)",
                    marginTop: "4px",
                    fontWeight: 500,
                  }}
                >
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Radius */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "10px",
            }}
          >
            <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-secondary)" }}>
              Search Radius
            </span>
            <span
              style={{
                fontSize: "14px",
                fontWeight: 700,
                color: "var(--accent)",
              }}
            >
              {radiusMiles} mi
            </span>
          </div>
          <input
            type="range"
            min={1}
            max={50}
            value={radiusMiles}
            onChange={(e) => onRadiusChange(Number(e.target.value))}
          />
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "11px",
              color: "var(--text-tertiary)",
              marginTop: "6px",
            }}
          >
            <span>1 mi</span>
            <span>50 mi</span>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div
            style={{
              margin: "12px 20px 0",
              padding: "12px 14px",
              background: "var(--red-soft)",
              borderRadius: "var(--radius-sm)",
              flexShrink: 0,
            }}
          >
            <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--red)", marginBottom: "2px" }}>
              Connection Error
            </div>
            <div style={{ fontSize: "12px", color: "var(--text-secondary)", lineHeight: 1.5 }}>
              {error}
            </div>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div
            style={{
              padding: "14px 20px",
              display: "flex",
              alignItems: "center",
              gap: "10px",
              borderBottom: "1px solid var(--border)",
              flexShrink: 0,
            }}
          >
            <div
              style={{
                width: "14px",
                height: "14px",
                border: "2px solid var(--bg-surface)",
                borderTopColor: "var(--accent)",
                borderRadius: "50%",
                animation: "spin 0.8s linear infinite",
              }}
            />
            <span style={{ fontSize: "13px", color: "var(--text-tertiary)" }}>
              Scanning area...
            </span>
          </div>
        )}

        {/* Well list */}
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 12px" }}>
          {!loading && wells.length === 0 && !error && (
            <div style={{ textAlign: "center", padding: "48px 20px", color: "var(--text-tertiary)" }}>
              <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "6px" }}>
                No wells found
              </div>
              <div style={{ fontSize: "13px", lineHeight: 1.5 }}>
                Try panning the map or increasing the search radius.
              </div>
            </div>
          )}

          {sortedWells.map((well) => {
            const isSelected = well.api_number === selectedWellApi;

            return (
              <button
                key={well.api_number}
                onClick={() => onSelectWell(isSelected ? null : well.api_number)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: "var(--radius-sm)",
                  border: isSelected ? "1px solid var(--accent-soft)" : "1px solid transparent",
                  background: isSelected ? "var(--accent-soft)" : "transparent",
                  cursor: "pointer",
                  textAlign: "left",
                  color: "var(--text-primary)",
                  transition: "background 0.1s",
                  marginBottom: "2px",
                  fontFamily: "var(--font-sans)",
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) e.currentTarget.style.background = "var(--bg-card-hover)";
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) e.currentTarget.style.background = isSelected ? "var(--accent-soft)" : "transparent";
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "13px",
                      fontWeight: 500,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {well.api_number}
                  </div>
                  {well.well_name && (
                    <div
                      style={{
                        fontSize: "12px",
                        color: "var(--text-tertiary)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        marginTop: "1px",
                      }}
                    >
                      {well.well_name}
                    </div>
                  )}
                </div>
                <ProximityBadge miles={well.miles_away} />
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "14px 20px",
            borderTop: "1px solid var(--border)",
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>
            Source: TX Railroad Commission
          </span>
          <div style={{ display: "flex", gap: "12px" }}>
            {[
              { color: "var(--red)", label: "< 1 mi" },
              { color: "var(--amber)", label: "< 5 mi" },
              { color: "var(--green)", label: "5+ mi" },
            ].map(({ color, label }) => (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                <div
                  style={{
                    width: "7px",
                    height: "7px",
                    borderRadius: "50%",
                    background: color,
                  }}
                />
                <span style={{ fontSize: "11px", color: "var(--text-tertiary)" }}>{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
