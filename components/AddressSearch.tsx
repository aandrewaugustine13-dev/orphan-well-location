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
  const requestIdRef = useRef(0);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function normalizeLabel(value: string) {
    const parts = value.split(",").map((s) => s.trim());
    return parts.slice(0, 3).join(", ");
  }

  async function fetchJson(url: string): Promise<SearchResult[]> {
    const response = await fetch(url, { headers: { "Accept-Language": "en" } });
    if (!response.ok) throw new Error(`Geocoding failed with status ${response.status}`);
    return response.json();
  }

  async function search(q: string) {
    const trimmed = q.trim();
    const requestId = ++requestIdRef.current;

    if (trimmed.length < 3) {
      setResults([]);
      setError(null);
      setShowResults(false);
      setLoading(false);
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

      if (requestId !== requestIdRef.current) return;

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
        setError("no results — try a full street address or US zip code");
      }
    } catch {
      if (requestId !== requestIdRef.current) return;
      setResults([]);
      setShowResults(false);
      setError("geocoding failed — please try again");
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }

  function handleInput(value: string) {
    setQuery(value);
    setError(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
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
    if (e.key === "Escape") setShowResults(false);
  }

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%", fontFamily: "var(--font-mono)" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          background: "#0a0a0a",
          border: "1px solid #2a2a2a",
          padding: "0 10px",
          gap: "8px",
        }}
      >
        <span style={{ color: "#444", fontSize: "11px", flexShrink: 0 }}>/</span>

        <input
          type="text"
          value={query}
          onChange={(e) => handleInput(e.target.value)}
          onFocus={() => {
            if (results.length > 0) setShowResults(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder="address or zip code..."
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            outline: "none",
            color: "#e0e0e0",
            fontSize: "11px",
            fontFamily: "var(--font-mono)",
            padding: "8px 0",
            letterSpacing: "0.02em",
          }}
        />

        {loading ? (
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
              color: "#444",
              cursor: "pointer",
              padding: "2px",
              display: "flex",
              alignItems: "center",
              flexShrink: 0,
              fontSize: "14px",
              fontFamily: "var(--font-mono)",
            }}
            aria-label="Clear search"
          >
            ×
          </button>
        ) : null}
      </div>

      {error && (
        <div
          style={{
            marginTop: "4px",
            fontSize: "10px",
            color: "#e5484d",
            letterSpacing: "0.03em",
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
            marginTop: "1px",
            background: "#111",
            border: "1px solid #444",
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
                  padding: "8px 12px",
                  background: "transparent",
                  border: "none",
                  borderBottom: i < results.length - 1 ? "1px solid #222" : "none",
                  cursor: "pointer",
                  color: "#e0e0e0",
                  fontFamily: "var(--font-mono)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "#1a1a1a";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                }}
              >
                <div style={{ fontSize: "11px", color: "#e0e0e0" }}>{main}</div>
                {sub && (
                  <div style={{ fontSize: "10px", color: "#555", marginTop: "2px", letterSpacing: "0.02em" }}>
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
