"use client";

interface LandingOverlayProps {
  onEnter: () => void;
}

export default function LandingOverlay({ onEnter }: LandingOverlayProps) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2000,
        background: "var(--bg-base)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 24px",
      }}
    >
      {/* Logo mark */}
      <div
        style={{
          width: "48px",
          height: "48px",
          borderRadius: "12px",
          background: "var(--accent-soft)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: "28px",
        }}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="10" r="3" stroke="var(--accent)" strokeWidth="1.5" />
          <path
            d="M12 2C7.58 2 4 5.58 4 10c0 5.25 8 12 8 12s8-6.75 8-12c0-4.42-3.58-8-8-8z"
            stroke="var(--accent)"
            strokeWidth="1.5"
            fill="none"
          />
        </svg>
      </div>

      <h1
        style={{
          fontSize: "clamp(28px, 4vw, 40px)",
          fontWeight: 700,
          color: "var(--text-primary)",
          textAlign: "center",
          marginBottom: "12px",
          letterSpacing: "-0.02em",
          lineHeight: 1.15,
        }}
      >
        Orphan Well Locator
      </h1>

      <p
        style={{
          fontSize: "16px",
          lineHeight: 1.6,
          color: "var(--text-secondary)",
          textAlign: "center",
          maxWidth: "380px",
          marginBottom: "32px",
        }}
      >
        11,000+ abandoned wells mapped across Texas. See what's near your
        property in real time.
      </p>

      <button
        onClick={onEnter}
        style={{
          fontSize: "15px",
          fontWeight: 600,
          padding: "12px 32px",
          background: "var(--accent)",
          color: "#fff",
          border: "none",
          borderRadius: "var(--radius)",
          cursor: "pointer",
          transition: "background 0.15s",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--accent-hover)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "var(--accent)";
        }}
      >
        Open Map
      </button>

      <div
        style={{
          position: "absolute",
          bottom: "24px",
          fontSize: "12px",
          color: "var(--text-tertiary)",
        }}
      >
        Data from Texas Railroad Commission
      </div>
    </div>
  );
}
