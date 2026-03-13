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

function ThreatLevel({ wells }: { wells: Well[] }) {
  const closeCount = wells.filter((w) => w.miles_away <= 1).length;
  const nearCount = wells.filter((w) => w.miles_away <= 5).length;

  let level: "CLEAR" | "MONITOR" | "CAUTION" | "WARNING" = "CLEAR";
  let color = "var(--green)";
  let dimColor = "var(--green-dim)";

  if (closeCount > 5) {
    level = "WARNING";
    color = "var(--red)";
    dimColor = "var(--red-dim)";
  } else if (closeCount > 0) {
    level = "CAUTION";
    color = "var(--red)";
    dimColor = "var(--red-dim)";
  } else if (nearCount > 0) {
    level = "MONITOR";
    color = "var(--amber)";
    dimColor = "var(--amber-dim)";
  }

  return (
    <div
      style={{
        background: dimColor,
        border: `1px solid ${color}22`,
        borderRadius: "3px",
        padding: "10px 14px",
        display: "flex",
        alignItems: "center",
        gap: "10px",
      }}
    >
      <div
        style={{
          width: "8px",
          height: "8px",
          borderRadius: "50%",
          background: color,
          boxShadow: `0 0 8px ${color}`,
          animation:
            level === "WARNING" || level === "CAUTION"
              ? "pulse-amber 1.5s ease-in-out infinite"
              : "none",
        }}
      />
      <div>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "13px",
            fontWeight: 700,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color,
          }}
        >
          {level}
        </div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-muted)", marginTop: "1px" }}>
          {level === "CLEAR"
            ? "No wells within 5 mi"
            : level === "MONITOR"
            ? `${nearCount} well${nearCount !== 1 ? "s" : ""} within 5 mi`
            : `${closeCount} well${closeCount !== 1 ? "s" : ""} within 1 mi`}
        </div>
      </div>
    </div>
  );
}

function StatBlock({
  value,
  label,
  color,
  large,
}: {
  value: string | number;
  label: string;
  color?: string;
  large?: boolean;
}) {
  return (
    <div
      style={{
        background: "var(--bg-panel)",
        border: "1px solid var(--border)",
        borderRadius: "3px",
        padding: large ? "14px" : "10px 12px",
        flex: 1,
        minWidth: 0,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Top accent line */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: "2px",
          background: color || "var(--amber)",
          opacity: 0.6,
        }}
      />
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: large ? "28px" : "20px",
          fontWeight: 400,
          color: color || "var(--text-bright)",
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "10px",
          fontWeight: 600,
          color: "var(--text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          marginTop: "6px",
        }}
      >
        {label}
      </div>
    </div>
  );
}

function SectionHeader({ children }: { children: string }) {
  return (
    <div
      style={{
        fontFamily: "var(--font-display)",
        fontSize: "10px",
        fontWeight: 700,
        color: "var(--text-muted)",
        textTransform: "uppercase",
        letterSpacing: "0.14em",
        padding: "0 2px",
        marginBottom: "8px",
        display: "flex",
        alignItems: "center",
        gap: "8px",
      }}
    >
      <span>{children}</span>
      <div
        style={{
          flex: 1,
          height: "1px",
          background: "var(--border)",
        }}
      />
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
  center,
}: SidebarProps) {
  const closeWells = wells.filter((w) => w.miles_away <= 1);
  const midWells = wells.filter((w) => w.miles_away > 1 && w.miles_away <= 5);
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
            background: "var(--bg-panel)",
            border: "1px solid var(--border-amber)",
            borderRadius: "3px",
            padding: "8px 12px",
            color: "var(--amber)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            fontFamily: "var(--font-mono)",
            fontSize: "11px",
            boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 12h18M3 6h18M3 18h18" />
          </svg>
          {wells.length > 0 && (
            <span
              style={{
                background: "var(--amber)",
                color: "var(--bg-abyss)",
                borderRadius: "2px",
                padding: "1px 6px",
                fontSize: "10px",
                fontWeight: 700,
              }}
            >
              {wells.length}
            </span>
          )}
        </button>
      )}

      {/* Panel */}
      <div
        className="grid-texture"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "360px",
          height: "100%",
          background: "var(--bg-secondary)",
          borderRight: "1px solid var(--border-amber)",
          zIndex: 1000,
          display: "flex",
          flexDirection: "column",
          transform: isOpen ? "translateX(0)" : "translateX(-100%)",
          transition: "transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
          boxShadow: isOpen ? "12px 0 40px rgba(0,0,0,0.5)" : "none",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 16px 14px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
            position: "relative",
          }}
        >
          {/* Top amber line */}
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: "2px",
              background: "linear-gradient(90deg, var(--amber), transparent)",
            }}
          />

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "2px" }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M12 3L21 19H3L12 3Z" stroke="var(--amber)" strokeWidth="1.5" fill="var(--amber-dim)" />
                  <circle cx="12" cy="15" r="1" fill="var(--amber)" />
                  <rect x="11.5" y="9" width="1" height="4" rx="0.5" fill="var(--amber)" />
                </svg>
                <h1
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: "15px",
                    fontWeight: 700,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                    color: "var(--text-bright)",
                  }}
                >
                  Control Panel
                </h1>
              </div>
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "10px",
                  color: "var(--text-muted)",
                  letterSpacing: "0.04em",
                }}
              >
                {center.lat.toFixed(4)}°N {Math.abs(center.lng).toFixed(4)}°W
              </div>
            </div>
            <button
              onClick={onToggle}
              style={{
                background: "var(--bg-panel)",
                border: "1px solid var(--border)",
                borderRadius: "2px",
                color: "var(--text-muted)",
                cursor: "pointer",
                padding: "4px 6px",
                display: "flex",
                alignItems: "center",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
          </div>
        </div>

        {/* Threat Level */}
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <SectionHeader>Threat Assessment</SectionHeader>
          {loading ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "10px 0",
              }}
            >
              <div
                style={{
                  width: "14px",
                  height: "14px",
                  border: "2px solid var(--bg-elevated)",
                  borderTop: "2px solid var(--amber)",
                  borderRadius: "50%",
                  animation: "spin 0.8s linear infinite",
                }}
              />
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-muted)" }}>
                SCANNING AREA...
              </span>
            </div>
          ) : (
            <ThreatLevel wells={wells} />
          )}
        </div>

        {/* Stats Grid */}
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <SectionHeader>Scan Results</SectionHeader>
          <div style={{ display: "flex", gap: "6px", marginBottom: "6px" }}>
            <StatBlock
              value={loading ? "—" : wells.length}
              label="Detected"
              color="var(--amber)"
              large
            />
            <StatBlock
              value={loading ? "—" : closeWells.length}
              label="Critical < 1mi"
              color={closeWells.length > 0 ? "var(--red)" : "var(--text-muted)"}
              large
            />
          </div>
          <div style={{ display: "flex", gap: "6px" }}>
            <StatBlock
              value={loading ? "—" : midWells.length}
              label="Nearby < 5mi"
              color={midWells.length > 0 ? "var(--amber)" : "var(--text-muted)"}
            />
            <StatBlock
              value={loading || !closestWell ? "—" : `${closestWell.miles_away.toFixed(1)} mi`}
              label="Nearest"
              color={
                closestWell && closestWell.miles_away <= 1
                  ? "var(--red)"
                  : closestWell && closestWell.miles_away <= 5
                  ? "var(--amber)"
                  : "var(--green)"
              }
            />
          </div>
        </div>

        {/* Radius Control */}
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <SectionHeader>Search Radius</SectionHeader>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              marginBottom: "8px",
            }}
          >
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-muted)" }}>
              RANGE
            </span>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "18px",
                color: "var(--amber-bright)",
              }}
            >
              {radiusMiles}
              <span style={{ fontSize: "11px", color: "var(--text-muted)", marginLeft: "3px" }}>MI</span>
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
              fontFamily: "var(--font-mono)",
              fontSize: "9px",
              color: "var(--text-muted)",
              marginTop: "4px",
              letterSpacing: "0.05em",
            }}
          >
            <span>1 MI</span>
            <span>25 MI</span>
            <span>50 MI</span>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div
            style={{
              padding: "10px 16px",
              background: "var(--red-dim)",
              borderBottom: "1px solid var(--border-red)",
              flexShrink: 0,
            }}
          >
            <div
              style={{
                fontFamily: "var(--font-display)",
                fontSize: "11px",
                fontWeight: 700,
                color: "var(--red)",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                marginBottom: "2px",
              }}
            >
              System Error
            </div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: "10px", color: "var(--text-secondary)", lineHeight: 1.5 }}>
              {error}
            </div>
          </div>
        )}

        {/* Well List */}
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 8px" }}>
          {!loading && wells.length === 0 && !error && (
            <div
              style={{
                textAlign: "center",
                padding: "40px 16px",
                color: "var(--text-muted)",
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: "13px",
                  fontWeight: 600,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  marginBottom: "6px",
                  color: "var(--text-secondary)",
                }}
              >
                Area Clear
              </div>
              <div style={{ fontFamily: "var(--font-mono)", fontSize: "11px", lineHeight: 1.5 }}>
                No orphan wells detected in scan range.
                <br />
                Pan map or increase radius.
              </div>
            </div>
          )}

          {sortedWells.map((well, i) => {
            const isClose = well.miles_away <= 1;
            const isMedium = well.miles_away <= 5;
            const isSelected = well.api_number === selectedWellApi;
            const dotColor = isClose ? "var(--red)" : isMedium ? "var(--amber)" : "var(--green)";

            return (
              <button
                key={well.api_number}
                onClick={() => onSelectWell(isSelected ? null : well.api_number)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  width: "100%",
                  padding: "8px 10px",
                  borderRadius: "3px",
                  border: isSelected ? `1px solid ${dotColor}33` : "1px solid transparent",
                  background: isSelected ? "var(--bg-panel)" : "transparent",
                  cursor: "pointer",
                  textAlign: "left",
                  color: "var(--text-primary)",
                  transition: "all 0.15s",
                  marginBottom: "1px",
                  fontFamily: "var(--font-body)",
                  animation: `fade-in 0.2s ease-out ${Math.min(i * 30, 500)}ms both`,
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) e.currentTarget.style.background = "var(--bg-panel)";
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) e.currentTarget.style.background = "transparent";
                }}
              >
                {/* Index + dot */}
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "9px",
                      color: "var(--text-muted)",
                      width: "18px",
                      textAlign: "right",
                    }}
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div
                    style={{
                      width: "6px",
                      height: "6px",
                      borderRadius: "1px",
                      background: dotColor,
                      boxShadow: `0 0 6px ${dotColor}`,
                      transform: "rotate(45deg)",
                    }}
                  />
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "11px",
                      color: isSelected ? "var(--text-bright)" : "var(--text-primary)",
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
                        fontSize: "10px",
                        color: "var(--text-muted)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {well.well_name}
                    </div>
                  )}
                </div>

                {/* Distance */}
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "11px",
                    color: dotColor,
                    flexShrink: 0,
                    textAlign: "right",
                  }}
                >
                  {well.miles_away.toFixed(1)}
                  <span style={{ fontSize: "9px", marginLeft: "2px", color: "var(--text-muted)" }}>MI</span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "10px 16px",
            borderTop: "1px solid var(--border)",
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ fontFamily: "var(--font-mono)", fontSize: "9px", color: "var(--text-muted)", lineHeight: 1.6 }}>
            SOURCE: TX RAILROAD COMMISSION
          </div>
          <div style={{ display: "flex", gap: "10px" }}>
            {[
              { color: "var(--red)", label: "< 1" },
              { color: "var(--amber)", label: "< 5" },
              { color: "var(--green)", label: "5+" },
            ].map(({ color, label }) => (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <div
                  style={{
                    width: "5px",
                    height: "5px",
                    borderRadius: "1px",
                    background: color,
                    transform: "rotate(45deg)",
                  }}
                />
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "9px", color: "var(--text-muted)" }}>
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
