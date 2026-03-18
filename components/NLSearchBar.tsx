"use client";

import { useState, useRef } from "react";

export interface NLResult {
  center: { lat: number; lng: number };
  radiusMiles: number;
  summary: string;
}

interface NLSearchBarProps {
  onResult: (result: NLResult) => void;
  onError: (msg: string) => void;
}

export default function NLSearchBar({ onResult, onError }: NLSearchBarProps) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function submit() {
    const trimmed = query.trim();
    if (!trimmed) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: trimmed }),
      });

      const data = await res.json();

      if (!res.ok) {
        const msg = data?.error ?? "Something went wrong. Please try again.";
        setError(msg);
        onError(msg);
        return;
      }

      setQuery("");
      onResult({
        center: data.center,
        radiusMiles: data.radiusMiles,
        summary: data.summary,
      });
    } catch {
      const msg = "Network error. Please try again.";
      setError(msg);
      onError(msg);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div
      style={{
        position: "absolute",
        top: "56px",
        left: "50%",
        transform: "translateX(-50%)",
        width: "min(520px, calc(100vw - 48px))",
        zIndex: 800,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          background: "var(--bg-card)",
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--border-strong)",
          padding: "0 12px",
          gap: "8px",
          boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--text-tertiary)"
          strokeWidth="2"
          strokeLinecap="round"
          style={{ flexShrink: 0 }}
        >
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.35-4.35" />
        </svg>

        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setError(null);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Ask about wells near you..."
          disabled={loading}
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            outline: "none",
            color: "var(--text-primary)",
            fontSize: "13px",
            fontFamily: "var(--font-sans)",
            padding: "11px 0",
            opacity: loading ? 0.6 : 1,
          }}
        />

        {loading ? (
          <div
            style={{
              width: "14px",
              height: "14px",
              border: "2px solid var(--bg-surface)",
              borderTopColor: "var(--accent)",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
              flexShrink: 0,
            }}
          />
        ) : query.length > 0 ? (
          <button
            onClick={submit}
            style={{
              background: "none",
              border: "none",
              color: "var(--accent)",
              cursor: "pointer",
              padding: "2px",
              display: "flex",
              alignItems: "center",
              flexShrink: 0,
            }}
            aria-label="Submit query"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>
        ) : null}
      </div>

      {error && (
        <div
          style={{
            marginTop: "6px",
            fontSize: "12px",
            color: "var(--red)",
            background: "var(--bg-card)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
            padding: "8px 12px",
            boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
