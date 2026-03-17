"use client";

import { useEffect, useRef, useState } from "react";

interface SearchResult {
  display_name: string;
  lat: string;
  lon: string;
}

interface NormalizedResult {
  label: string;
  lat: number;
  lng: number;
}

interface AddressSearchProps {
  onSelect: (lat: number, lng: number, label: string) => void;
}

const ZIP_REGEX = /^\d{5}$/;

export default function AddressSearch({ onSelect }: AddressSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NormalizedResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    }

    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function normalizeLabel(value: string) {
    const parts = value.split(",").map((s) => s.trim());
    return parts.slice(0, 3).join(", ");
  }

  async function fetchJson(url: string): Promise<SearchResult[]> {
    const response = await fetch(url, {
      headers: {
        "Accept-Language": "en",
      },
    });

    if (!response.ok) {
      throw new Error(`Geocoding failed with status ${response.status}`);
    }

    return response.json();
  }

  async function search(q: string) {
    const trimmed = q.trim();

    if (trimmed.length < 3) {
      setResults([]);
      setError(null);
      setShowResults(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      let data: SearchResult[] = [];

      if (ZIP_REGEX.test(trimmed)) {
        data = await fetchJson(
          `https://nominatim.openstreetmap.org/search?format=json&countrycodes=us&postalcode=${trimmed}&limit=5`
        );

        if (!data.length) {
          data = await fetchJson(
            `https://nominatim.openstreetmap.org/search?format=json&countrycodes=us&limit=5&q=${encodeURIComponent(
              `${trimmed}, United States`
            )}`
          );
        }
      } else {
        data = await fetchJson(
          `https://nominatim.openstreetmap.org/search?format=json&countrycodes=us&limit=5&q=${encodeURIComponent(
            trimmed
          )}`
        );
      }

      const normalized = data
        .map((item) => ({
          lat: Number(item.lat),
          lng: Number(item.lon),
          label: normalizeLabel(item.display_name),
        }))
        .filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lng));

      setResults(normalized);
      setShowResults(normalized.length > 0);

      if (normalized.length === 0) {
        setError("No results found. Try a full street address or valid US ZIP code.");
      }
    } catch {
      setResults([]);
      setShowResults(false);
      setError("Could not geocode this location right now. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleInput(value: string) {
    setQuery(value);
    setError(null);

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => search(value), 350);
  }

  function handleSelect(result: NormalizedResult) {
    setQuery(result.label);
    setResults([]);
    setShowResults(false);
    setError(null);
    onSelect(result.lat, result.lng, result.label);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      if (results.length > 0) {
        e.preventDefault();
        handleSelect(results[0]);
      }
      return;
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
          onFocus={() => {
            if (results.length > 0) {
              setShowResults(true);
            }
          }}
          onKeyDown={handleKeyDown}
          placeholder="Search address or ZIP code..."
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
              setError(null);
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
            aria-label="Clear search"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        ) : null}
      </div>

      {error && (
        <div
          style={{
            marginTop: "6px",
            fontSize: "11px",
            color: "var(--red)",
          }}
        >
          {error}
        </div>
      )}

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
          {results.map((result, i) => {
            const parts = result.label.split(",").map((s) => s.trim());
            const main = parts.slice(0, 2).join(", ");
            const sub = parts.slice(2).join(", ");

            return (
              <button
                key={`${result.lat}-${result.lng}-${i}`}
                onClick={() => handleSelect(result)}
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
