"use client";

import { useState, useRef, useEffect } from "react";

interface SearchResult {
  display_name: string;
  lat: string;
  lon: string;
}

interface AddressSearchProps {
  onSelect: (lat: number, lng: number, label: string) => void;
}

export default function AddressSearch({ onSelect }: AddressSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function search(q: string) {
    if (q.length < 3) {
      setResults([]);
      setShowResults(false);
      return;
    }

    setLoading(true);
    fetch(
      `https://nominatim.openstreetmap.org/search?format=json&countrycodes=us&limit=5&q=${encodeURIComponent(q)}`,
      {
        headers: { "Accept-Language": "en" },
      }
    )
      .then((res) => res.json())
      .then((data: SearchResult[]) => {
        setResults(data);
        setShowResults(data.length > 0);
      })
      .catch(() => {
        setResults([]);
      })
      .finally(() => {
        setLoading(false);
      });
  }

  function handleInput(value: string) {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(value), 400);
  }

  function handleSelect(result: SearchResult) {
    const lat = parseFloat(result.lat);
    const lng = parseFloat(result.lon);

    // Shorten display name - take first 2-3 parts
    const parts = result.display_name.split(",").map((s) => s.trim());
    const short = parts.slice(0, 3).join(", ");

    setQuery(short);
    setShowResults(false);
    setResults([]);
    onSelect(lat, lng, short);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && results.length > 0) {
      e.preventDefault();
      handleSelect(results[0]);
    }
    if (e.key === "Escape") {
      setShowResults(false);
    }
  }

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          background: "var(--bg-base)",
          borderRadius: "var(--radius-sm)",
          border: "1px solid var(--border)",
          padding: "0 12px",
          gap: "8px",
        }}
      >
        {/* Search icon */}
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
          type="text"
          value={query}
          onChange={(e) => handleInput(e.target.value)}
          onFocus={() => results.length > 0 && setShowResults(true)}
          onKeyDown={handleKeyDown}
          placeholder="Search address or zip code..."
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            outline: "none",
            color: "var(--text-primary)",
            fontSize: "13px",
            fontFamily: "var(--font-sans)",
            padding: "10px 0",
          }}
        />

        {/* Loading spinner or clear button */}
        {loading ? (
          <div
            style={{
              width: "12px",
              height: "12px",
              border: "2px solid var(--bg-surface)",
              borderTopColor: "var(--accent)",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
              flexShrink: 0,
            }}
          />
        ) : query.length > 0 ? (
          <button
            onClick={() => {
              setQuery("");
              setResults([]);
              setShowResults(false);
            }}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-tertiary)",
              cursor: "pointer",
              padding: "2px",
              display: "flex",
              alignItems: "center",
              flexShrink: 0,
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        ) : null}
      </div>

      {/* Results dropdown */}
      {showResults && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            marginTop: "4px",
            background: "var(--bg-card)",
            border: "1px solid var(--border-strong)",
            borderRadius: "var(--radius-sm)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
            zIndex: 10,
            overflow: "hidden",
          }}
        >
          {results.map((r, i) => {
            const parts = r.display_name.split(",").map((s) => s.trim());
            const main = parts.slice(0, 2).join(", ");
            const sub = parts.slice(2, 4).join(", ");

            return (
              <button
                key={i}
                onClick={() => handleSelect(r)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 12px",
                  background: "transparent",
                  border: "none",
                  borderBottom: i < results.length - 1 ? "1px solid var(--border)" : "none",
                  cursor: "pointer",
                  color: "var(--text-primary)",
                  fontFamily: "var(--font-sans)",
                  transition: "background 0.1s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--bg-card-hover)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                }}
              >
                <div style={{ fontSize: "13px", fontWeight: 500 }}>{main}</div>
                {sub && (
                  <div style={{ fontSize: "11px", color: "var(--text-tertiary)", marginTop: "2px" }}>
                    {sub}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
