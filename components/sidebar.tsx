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
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color?: string;
}) {
  return (
    <div
      style={{
        background: "var(--bg-tertiary)",
        borderRadius: "8px",
        padding: "12px",
        flex: 1,
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: "20px",
          fontWeight: 700,
          color: color || "var(--text-primary)",
          lineHeight: 1.2,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: "11px",
          color: "var(--text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          marginTop: "4px",
        }}
      >
        {label}
      </div>
    </div>
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
}: SidebarProps) {
  const closeWells = wells.filter((w) => w.miles_away <= 1);
  const midWells = wells.filter((w) => w.miles_away > 1 && w.miles_away <= 5);
  const farWells = wells.filter((w) => w.miles_away > 5);

  const sortedWells = [...wells].sort((a, b) => a.miles_away - b.miles_away);

  const closestWell = sortedWells[0];

  return (
    <>
      {/* Toggle button when sidebar is closed */}
      {!isOpen && (
        <button
          onClick={onToggle}
          style={{
            position: "absolute",
            top: "16px",
            left: "16px",
            zIndex: 1000,
            background: "var(--bg-secondary)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            padding: "10px 14px",
            color: "var(--text-primary)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            fontSize: "13px",
            fontWeight: 600,
            boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 12h18M3 6h18M3 18h18" />
          </svg>
          {wells.length > 0 && (
            <span
              style={{
                background: "var(--accent-amber)",
                color: "#000",
                borderRadius: "10px",
                padding: "1px 7px",
                fontSize: "11px",
                fontWeight: 700,
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              {wells.length}
            </span>
          )}
        </button>
      )}

      {/* Sidebar */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "380px",
          height: "100vh",
          background: "var(--bg-secondary)",
          borderRight: "1px solid var(--border)",
          zIndex: 1000,
          display: "flex",
          flexDirection: "column",
          transform: isOpen ? "translateX(0)" : "translateX(-100%)",
          transition: "transform 0.25s ease-out",
          boxShadow: isOpen ? "8px 0 32px rgba(0,0,0,0.3)" : "none",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "20px 20px 16px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  marginBottom: "4px",
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="4" fill="#f59e0b" />
                  <circle cx="12" cy="12" r="8" stroke="#f59e0b" strokeWidth="1.5" opacity="0.4" />
                  <circle cx="12" cy="12" r="11" stroke="#f59e0b" strokeWidth="1" opacity="0.15" />
                </svg>
                <h1
                  style={{
                    fontSize: "16px",
                    fontWeight: 700,
                    margin: 0,
                    letterSpacing: "-0.02em",
                  }}
                >
                  Orphan Well Locator
                </h1>
              </div>
              <p
                style={{
                  fontSize: "12px",
                  color: "var(--text-muted)",
                  margin: 0,
                  lineHeight: 1.4,
                }}
              >
                Abandoned oil &amp; gas wells with no responsible operator.
                <br />
                Pan the map to scan any area.
              </p>
            </div>
            <button
              onClick={onToggle}
              style={{
                background: "none",
                border: "none",
                color: "var(--text-muted)",
                cursor: "pointer",
                padding: "4px",
                borderRadius: "4px",
                display: "flex",
                alignItems: "center",
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
          </div>

          {/* Radius control */}
          <div style={{ marginTop: "16px" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "6px",
              }}
            >
              <span style={{ fontSize: "11px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Search Radius
              </span>
              <span
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: "12px",
                  color: "var(--accent-amber)",
                  fontWeight: 600,
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
              style={{
                width: "100%",
                accentColor: "var(--accent-amber)",
                height: "4px",
              }}
            />
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: "10px",
                color: "var(--text-muted)",
                marginTop: "2px",
              }}
            >
              <span>1 mi</span>
              <span>50 mi</span>
            </div>
          </div>
        </div>

        {/* Stats */}
        <div
          style={{
            padding: "12px 20px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", gap: "8px" }}>
            <StatCard label="Total" value={loading ? "—" : wells.length} />
            <StatCard
              label="< 1 mi"
              value={loading ? "—" : closeWells.length}
              color={closeWells.length > 0 ? "var(--accent-red)" : undefined}
            />
            <StatCard
              label="Nearest"
              value={loading || !closestWell ? "—" : `${closestWell.miles_away.toFixed(1)}`}
              color={
                closestWell && closestWell.miles_away <= 1
                  ? "var(--accent-red)"
                  : closestWell && closestWell.miles_away <= 5
                  ? "var(--accent-amber)"
                  : "var(--accent-green)"
              }
            />
          </div>
        </div>

        {/* Error state */}
        {error && (
          <div
            style={{
              padding: "12px 20px",
              background: "var(--accent-red-dim)",
              borderBottom: "1px solid rgba(239, 68, 68, 0.2)",
              flexShrink: 0,
            }}
          >
            <div style={{ fontSize: "12px", color: "var(--accent-red)", fontWeight: 600, marginBottom: "2px" }}>
              Connection Error
            </div>
            <div style={{ fontSize: "11px", color: "var(--text-secondary)", lineHeight: 1.4 }}>{error}</div>
          </div>
        )}

        {/* Loading indicator */}
        {loading && (
          <div
            style={{
              padding: "12px 20px",
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              gap: "8px",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <div
              style={{
                width: "12px",
                height: "12px",
                border: "2px solid var(--border)",
                borderTop: "2px solid var(--accent-amber)",
                borderRadius: "50%",
                animation: "spin 0.8s linear infinite",
              }}
            />
            <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>Scanning area...</span>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {/* Well list */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "8px 12px",
          }}
        >
          {!loading && wells.length === 0 && !error && (
            <div
              style={{
                textAlign: "center",
                padding: "40px 20px",
                color: "var(--text-muted)",
              }}
            >
              <svg
                width="40"
                height="40"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                style={{ margin: "0 auto 12px", opacity: 0.4 }}
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 8v4M12 16h.01" />
              </svg>
              <div style={{ fontSize: "13px", fontWeight: 500, marginBottom: "4px" }}>
                No wells in this area
              </div>
              <div style={{ fontSize: "12px" }}>
                Try panning the map or increasing the search radius.
              </div>
            </div>
          )}

          {sortedWells.map((well) => {
            const isClose = well.miles_away <= 1;
            const isMedium = well.miles_away <= 5;
            const isSelected = well.api_number === selectedWellApi;
            const dotColor = isClose ? "var(--accent-red)" : isMedium ? "var(--accent-amber)" : "var(--accent-green)";

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
                  borderRadius: "6px",
                  border: "none",
                  background: isSelected ? "var(--bg-hover)" : "transparent",
                  cursor: "pointer",
                  textAlign: "left",
                  color: "var(--text-primary)",
                  transition: "background 0.15s",
                  marginBottom: "2px",
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) e.currentTarget.style.background = "var(--bg-tertiary)";
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) e.currentTarget.style.background = "transparent";
                }}
              >
                {/* Status dot */}
                <div
                  style={{
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    background: dotColor,
                    flexShrink: 0,
                    boxShadow: `0 0 6px ${dotColor}`,
                  }}
                />

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: "12px",
                      fontWeight: 600,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {well.api_number}
                  </div>
                  {well.operator_name && (
                    <div
                      style={{
                        fontSize: "11px",
                        color: "var(--text-muted)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {well.operator_name}
                    </div>
                  )}
                </div>

                {/* Distance */}
                <div
                  style={{
                    fontFamily: "'JetBrains Mono', monospace",
                    fontSize: "12px",
                    fontWeight: 600,
                    color: dotColor,
                    flexShrink: 0,
                  }}
                >
                  {well.miles_away.toFixed(1)} mi
                </div>
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "12px 20px",
            borderTop: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <div style={{ fontSize: "10px", color: "var(--text-muted)", lineHeight: 1.5 }}>
            Data sourced from Texas Railroad Commission records.
            <br />
            <span style={{ color: "var(--accent-red)", fontWeight: 600 }}>Red</span> = within 1 mi &nbsp;
            <span style={{ color: "var(--accent-amber)", fontWeight: 600 }}>Amber</span> = within 5 mi &nbsp;
            <span style={{ color: "var(--accent-green)", fontWeight: 600 }}>Green</span> = 5+ mi
          </div>
        </div>
      </div>
    </>
  );
}
