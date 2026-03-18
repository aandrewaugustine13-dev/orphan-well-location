"use client";

import { useState, useRef, useEffect } from "react";
import { supabase } from "@/utils/supabase";

export interface NLResult {
  center: { lat: number; lng: number };
  radiusMiles: number;
  summary: string;
}

interface NLSearchBarProps {
  onResult: (result: NLResult) => void;
  onError: (msg: string) => void;
}

const LS_KEY = "gemini_api_key";
const MILES_TO_METERS = 1609.34;

const SYSTEM_PROMPT = `You parse natural language queries about oil and gas wells into structured JSON.

Database tables:
- wells: api_number, well_name, latitude, longitude, state, county, operator_name,
  well_type, well_status, spud_date, months_inactive, liability_est
- groundwater_wells: well_id, latitude, longitude, state, county, well_depth_ft,
  well_capacity_gpm, water_use, status, year_constructed

RPC functions (called by the client, not you):
- get_wells_in_radius(user_lng, user_lat, radius_meters)
- get_groundwater_wells_in_radius(user_lng, user_lat, radius_meters)

Respond ONLY with valid JSON, no other text:
{
  "state": "Ohio",
  "county": "Cuyahoga",
  "radius_miles": 3,
  "query_type": "orphan_near_groundwater"
}

query_type must be one of:
- "orphan_near_groundwater" — find orphan wells near domestic water wells
- "nearest_orphan_to_groundwater" — find the single closest orphan well to any water well
- "orphan_count" — count orphan wells in area
- "general" — general area query

Default radius_miles to 5 if unspecified. Strip "County" from county name.`;

interface ParsedQuery {
  state: string;
  county: string;
  radius_miles: number;
  query_type:
    | "orphan_near_groundwater"
    | "nearest_orphan_to_groundwater"
    | "orphan_count"
    | "general";
}

interface WellRow {
  latitude: number;
  longitude: number;
  [key: string]: unknown;
}

function haversineDistanceMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function parseQueryWithGemini(
  query: string,
  apiKey: string
): Promise<ParsedQuery> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ parts: [{ text: query }] }],
        generationConfig: { maxOutputTokens: 256 },
      }),
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg =
      (err as { error?: { message?: string } })?.error?.message ?? res.statusText;
    throw new Error(`Gemini error: ${msg}`);
  }

  const data = await res.json();
  const text: string =
    data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

  // Strip markdown code fences if present
  const cleaned = text.replace(/^```[a-z]*\n?/i, "").replace(/```$/m, "").trim();
  const parsed: ParsedQuery = JSON.parse(cleaned);

  if (!parsed.state || !parsed.county || !parsed.query_type) {
    throw new Error("Missing required fields in parsed query");
  }
  return parsed;
}

export default function NLSearchBar({ onResult, onError }: NLSearchBarProps) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [geminiKey, setGeminiKey] = useState("");
  const [keyPopoverOpen, setKeyPopoverOpen] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const keyInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const stored = localStorage.getItem(LS_KEY) ?? "";
    setGeminiKey(stored);
    setKeyInput(stored);
  }, []);

  function saveKey() {
    const trimmed = keyInput.trim();
    setGeminiKey(trimmed);
    localStorage.setItem(LS_KEY, trimmed);
    setKeyPopoverOpen(false);
    if (trimmed) inputRef.current?.focus();
  }

  function openKeyPopover() {
    setKeyInput(geminiKey);
    setKeyPopoverOpen(true);
    setTimeout(() => keyInputRef.current?.focus(), 50);
  }

  async function submit() {
    const trimmed = query.trim();
    if (!trimmed) return;

    if (!geminiKey) {
      openKeyPopover();
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Step 1: Parse with Gemini
      const parsed = await parseQueryWithGemini(trimmed, geminiKey);

      // Step 2: Geocode county + state via Nominatim
      const geoQuery = `${parsed.county} County, ${parsed.state}`;
      const geoRes = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&countrycodes=us&limit=1&q=${encodeURIComponent(geoQuery)}`,
        { headers: { "Accept-Language": "en", "User-Agent": "OrphanWellLocator/1.0" } }
      );
      const geoData = await geoRes.json();
      if (!geoData.length) {
        throw new Error(`Could not locate ${parsed.county}, ${parsed.state}`);
      }
      const center = {
        lat: parseFloat(geoData[0].lat),
        lng: parseFloat(geoData[0].lon),
      };

      const radiusMeters = Math.round(parsed.radius_miles * MILES_TO_METERS);

      // Step 3: Query Supabase
      if (!supabase) throw new Error("Supabase not configured");

      const needsGroundwater =
        parsed.query_type === "orphan_near_groundwater" ||
        parsed.query_type === "nearest_orphan_to_groundwater";

      const { data: orphanData, error: orphanErr } = await supabase.rpc(
        "get_wells_in_radius",
        { user_lng: center.lng, user_lat: center.lat, radius_meters: radiusMeters }
      );
      if (orphanErr) throw orphanErr;
      const orphanWells: WellRow[] = orphanData ?? [];

      let groundwaterWells: WellRow[] = [];
      if (needsGroundwater) {
        const { data: gwData, error: gwErr } = await supabase.rpc(
          "get_groundwater_wells_in_radius",
          { user_lng: center.lng, user_lat: center.lat, radius_meters: radiusMeters }
        );
        if (gwErr) throw gwErr;
        groundwaterWells = gwData ?? [];
      }

      // Step 4: Cross-proximity computation
      let nearbyOrphanCount = 0;
      let nearestDistanceMiles: number | null = null;

      if (needsGroundwater && groundwaterWells.length > 0 && orphanWells.length > 0) {
        for (const orphan of orphanWells) {
          let minDist = Infinity;
          for (const gw of groundwaterWells) {
            const d = haversineDistanceMiles(
              orphan.latitude,
              orphan.longitude,
              gw.latitude,
              gw.longitude
            );
            if (d < minDist) minDist = d;
          }
          if (minDist <= parsed.radius_miles) {
            nearbyOrphanCount++;
            if (nearestDistanceMiles === null || minDist < nearestDistanceMiles) {
              nearestDistanceMiles = minDist;
            }
          }
        }
      }

      // Step 5: Build summary
      const { county, state, radius_miles, query_type } = parsed;
      const nearest =
        nearestDistanceMiles !== null ? nearestDistanceMiles.toFixed(1) : null;
      let summary: string;

      switch (query_type) {
        case "orphan_near_groundwater":
          summary = nearest
            ? `Found ${nearbyOrphanCount} orphan well${nearbyOrphanCount !== 1 ? "s" : ""} within ${radius_miles} miles of domestic water wells in ${county} County, ${state}. The nearest is ${nearest} miles from a water well.`
            : `Found ${nearbyOrphanCount} orphan well${nearbyOrphanCount !== 1 ? "s" : ""} within ${radius_miles} miles of domestic water wells in ${county} County, ${state}.`;
          break;
        case "nearest_orphan_to_groundwater":
          summary = nearest
            ? `The nearest orphan well to a domestic water well in ${county} County, ${state} is ${nearest} miles away.`
            : `No orphan wells found near domestic water wells in ${county} County, ${state}.`;
          break;
        case "orphan_count":
          summary = `Found ${orphanWells.length} orphan well${orphanWells.length !== 1 ? "s" : ""} within ${radius_miles} miles in ${county} County, ${state}.`;
          break;
        default:
          summary = `Showing ${orphanWells.length} orphan well${orphanWells.length !== 1 ? "s" : ""} near ${county} County, ${state}.`;
      }

      setQuery("");
      onResult({ center, radiusMiles: radius_miles, summary });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Something went wrong. Please try again.";
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

  const keyIsSet = !!geminiKey;

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
      {/* Search bar */}
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

        {/* Key button */}
        <button
          onClick={openKeyPopover}
          title={keyIsSet ? "Gemini API key configured" : "Set Gemini API key"}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: "2px",
            display: "flex",
            alignItems: "center",
            flexShrink: 0,
            color: keyIsSet ? "var(--accent)" : "var(--text-tertiary)",
          }}
          aria-label="Configure Gemini API key"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="7.5" cy="15.5" r="5.5" />
            <path d="M21 2l-9.6 9.6" />
            <path d="M15.5 7.5l3 3L22 7l-3-3" />
          </svg>
        </button>

        {/* Spinner or submit arrow */}
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
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          </button>
        ) : null}
      </div>

      {/* Key popover */}
      {keyPopoverOpen && (
        <div
          style={{
            marginTop: "6px",
            background: "var(--bg-card)",
            border: "1px solid var(--border-strong)",
            borderRadius: "var(--radius-sm)",
            padding: "12px",
            boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
          }}
        >
          <p
            style={{
              margin: "0 0 8px",
              fontSize: "12px",
              color: "var(--text-secondary)",
              lineHeight: 1.4,
            }}
          >
            Enter your{" "}
            <strong style={{ color: "var(--text-primary)" }}>Gemini API key</strong> to
            use natural language search. Your key is stored only in your browser.
          </p>
          <div style={{ display: "flex", gap: "6px" }}>
            <input
              ref={keyInputRef}
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveKey();
                if (e.key === "Escape") setKeyPopoverOpen(false);
              }}
              placeholder="AIza..."
              style={{
                flex: 1,
                background: "var(--bg-surface)",
                border: "1px solid var(--border)",
                borderRadius: "4px",
                color: "var(--text-primary)",
                fontSize: "12px",
                fontFamily: "var(--font-mono, monospace)",
                padding: "6px 8px",
                outline: "none",
              }}
            />
            <button
              onClick={saveKey}
              style={{
                background: "var(--accent)",
                border: "none",
                borderRadius: "4px",
                color: "#fff",
                cursor: "pointer",
                fontSize: "12px",
                padding: "6px 10px",
                fontFamily: "var(--font-sans)",
              }}
            >
              Save
            </button>
            <button
              onClick={() => setKeyPopoverOpen(false)}
              style={{
                background: "none",
                border: "1px solid var(--border)",
                borderRadius: "4px",
                color: "var(--text-secondary)",
                cursor: "pointer",
                fontSize: "12px",
                padding: "6px 10px",
                fontFamily: "var(--font-sans)",
              }}
            >
              Cancel
            </button>
          </div>
          {geminiKey && (
            <button
              onClick={() => {
                setGeminiKey("");
                setKeyInput("");
                localStorage.removeItem(LS_KEY);
                setKeyPopoverOpen(false);
              }}
              style={{
                marginTop: "8px",
                background: "none",
                border: "none",
                color: "var(--text-tertiary)",
                cursor: "pointer",
                fontSize: "11px",
                padding: 0,
                fontFamily: "var(--font-sans)",
              }}
            >
              Clear saved key
            </button>
          )}
        </div>
      )}

      {/* Error message */}
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
