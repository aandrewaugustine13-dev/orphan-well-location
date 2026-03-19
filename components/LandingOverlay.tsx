"use client";

export default function LandingOverlay({ onEnter }: { onEnter: () => void }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2000,
        background: "#0a0a0a",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "0 56px",
        fontFamily: "var(--font-mono)",
      }}
    >
      <div style={{ maxWidth: "520px" }}>
        <div
          style={{
            fontSize: "9px",
            color: "#444",
            letterSpacing: "0.25em",
            marginBottom: "28px",
          }}
        >
          US EPA / USGS / STATE REGULATORY DATA
        </div>

        <h1
          style={{
            fontSize: "32px",
            fontWeight: 700,
            color: "#e0e0e0",
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            lineHeight: 1.05,
            marginBottom: "20px",
          }}
        >
          ORPHAN WELL<br />LOCATOR
        </h1>

        <p
          style={{
            fontSize: "12px",
            color: "#666",
            lineHeight: 1.8,
            marginBottom: "40px",
            maxWidth: "400px",
          }}
        >
          120,000+ abandoned oil &amp; gas wells mapped across 27 states.<br />
          Viewport-based query from public regulatory records.
        </p>

        <button
          onClick={onEnter}
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "10px",
            fontWeight: 500,
            letterSpacing: "0.2em",
            padding: "10px 28px",
            background: "none",
            color: "#e0e0e0",
            border: "1px solid #e0e0e0",
            cursor: "pointer",
            textTransform: "uppercase",
          }}
        >
          ENTER
        </button>
      </div>

      <div
        style={{
          position: "absolute",
          bottom: "24px",
          left: "56px",
          fontSize: "9px",
          color: "#333",
          letterSpacing: "0.1em",
        }}
      >
        NOT FOR LEGAL OR PROPERTY ASSESSMENT USE &nbsp;·&nbsp; DATA: USGS + STATE REGULATORY AGENCIES
      </div>
    </div>
  );
}
