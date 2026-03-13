"use client";

interface LandingOverlayProps {
  onEnter: () => void;
}

export default function LandingOverlay({ onEnter }: LandingOverlayProps) {
  return (
    <div
      className="grid-texture"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2000,
        background: "var(--bg-abyss)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px",
        animation: "fade-in 0.5s ease-out",
      }}
    >
      {/* Hazard mark */}
      <div style={{ marginBottom: "24px" }}>
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
          <path d="M20 6L36 34H4L20 6Z" stroke="var(--amber)" strokeWidth="1.5" fill="var(--amber-dim)" />
          <circle cx="20" cy="28" r="1.5" fill="var(--amber)" />
          <rect x="19.25" y="16" width="1.5" height="8" rx="0.75" fill="var(--amber)" />
        </svg>
      </div>

      {/* Title */}
      <h1
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "clamp(32px, 5vw, 52px)",
          fontWeight: 800,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--text-bright)",
          textAlign: "center",
          marginBottom: "12px",
          lineHeight: 1.1,
        }}
      >
        Orphan Well Locator
      </h1>

      <p
        style={{
          fontFamily: "var(--font-body)",
          fontSize: "15px",
          lineHeight: 1.7,
          color: "var(--text-secondary)",
          textAlign: "center",
          maxWidth: "420px",
          marginBottom: "36px",
        }}
      >
        11,000+ abandoned wells mapped across Texas.
        <br />
        Pan, zoom, and search by radius to see what&apos;s near you.
      </p>

      {/* Enter */}
      <button
        onClick={onEnter}
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "14px",
          fontWeight: 700,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          padding: "13px 44px",
          background: "var(--amber-dim)",
          color: "var(--amber)",
          border: "1px solid var(--amber)",
          borderRadius: "2px",
          cursor: "pointer",
          transition: "all 0.2s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--amber)";
          e.currentTarget.style.color = "var(--bg-abyss)";
          e.currentTarget.style.boxShadow = "0 0 24px var(--amber-glow)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "var(--amber-dim)";
          e.currentTarget.style.color = "var(--amber)";
          e.currentTarget.style.boxShadow = "none";
        }}
      >
        Open Map
      </button>

      {/* Source tag */}
      <div
        style={{
          position: "absolute",
          bottom: "20px",
          fontFamily: "var(--font-mono)",
          fontSize: "10px",
          color: "var(--text-muted)",
          letterSpacing: "0.06em",
        }}
      >
        DATA: TX RAILROAD COMMISSION
      </div>
    </div>
  );
}
