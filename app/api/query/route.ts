import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

const MILES_TO_METERS = 1609.34;

const SYSTEM_PROMPT = `You are a deterministic translation engine that converts natural language environmental queries into a strict, parameterized JSON payload for PostGIS query execution.

DATABASE TABLES AVAILABLE FOR POSTGIS EXECUTION:
- wells: api_number (text), well_name (text), latitude (float8), longitude (float8), state (text), county (text), operator_name (text), well_type (text), well_status (text), spud_date (date), months_inactive (float8), liability_est (float8)
- groundwater_wells: well_id (text), latitude (float8), longitude (float8), state (text), county (text), well_depth_ft (float8), well_capacity_gpm (float8), water_use (text), status (text), year_constructed (int4)

POSTGIS RPC FUNCTIONS TARGETED:
- get_wells_in_radius(user_lng, user_lat, radius_meters)
- get_groundwater_wells_in_radius(user_lng, user_lat, radius_meters)

OUTPUT FORMAT:
You must output a single, flat JSON object containing EXACTLY these keys. Do not generate markdown backticks, explanations, or any other surrounding text.

JSON Schema:
{
  "state": "Full US state name (e.g. 'Texas', 'Ohio')",
  "county": "County name without 'County' suffix (e.g. 'Reeves', 'Cuyahoga')",
  "radius_miles": 5.0, // Default strictly to 5.0 if not specified in input
  "query_type": "one of: 'orphan_near_groundwater' | 'nearest_orphan_to_groundwater' | 'orphan_count' | 'general'"
}

CRITICAL RULES:
1. Strip "County" or "Co." from the county name.
2. Only output the raw JSON. No markdown code blocks, no trailing comments.`;

interface ParsedQuery {
  state: string;
  county: string;
  radius_miles: number;
  query_type: "orphan_near_groundwater" | "nearest_orphan_to_groundwater" | "orphan_count" | "general";
}

interface WellRow {
  latitude: number;
  longitude: number;
  [key: string]: unknown;
}

function haversineDistanceMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8; // Earth radius in miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function POST(req: NextRequest) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  let body: { query?: string; apiKey?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { query, apiKey: clientApiKey } = body;
  if (!query || typeof query !== "string") {
    return NextResponse.json({ error: "Missing query" }, { status: 400 });
  }

  const activeApiKey = clientApiKey || process.env.ANTHROPIC_API_KEY;
  if (!activeApiKey) {
    return NextResponse.json({ error: "Missing Anthropic API Key" }, { status: 401 });
  }

  const anthropic = new Anthropic({ apiKey: activeApiKey });

  // Step 1: Parse with Claude
  let parsed: ParsedQuery;
  try {
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 256,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: query }],
    });

    const text = msg.content.find((c) => c.type === "text")?.text ?? "";
    parsed = JSON.parse(text.trim());

    if (!parsed.state || !parsed.county || !parsed.query_type) {
      throw new Error("Missing required fields");
    }
  } catch {
    return NextResponse.json({ error: "Could not parse query" }, { status: 400 });
  }

  // Step 2: Geocode county + state via Nominatim
  const geoQuery = `${parsed.county} County, ${parsed.state}`;
  let center: { lat: number; lng: number };
  try {
    const geoRes = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&countrycodes=us&limit=1&q=${encodeURIComponent(geoQuery)}`,
      {
        headers: { "Accept-Language": "en", "User-Agent": "OrphanWellLocator/1.0" },
        cache: "force-cache",
      }
    );
    const geoData = await geoRes.json();
    if (!geoData.length) throw new Error("Not found");
    center = { lat: parseFloat(geoData[0].lat), lng: parseFloat(geoData[0].lon) };
  } catch {
    return NextResponse.json(
      { error: `Could not locate ${parsed.county}, ${parsed.state}` },
      { status: 422 }
    );
  }

  const radiusMeters = Math.round(parsed.radius_miles * MILES_TO_METERS);

  // Step 3: Query Supabase
  const needsGroundwater =
    parsed.query_type === "orphan_near_groundwater" ||
    parsed.query_type === "nearest_orphan_to_groundwater";

  let orphanWells: WellRow[] = [];
  let groundwaterWells: WellRow[] = [];

  try {
    const { data: orphanData, error: orphanErr } = await supabase.rpc("get_wells_in_radius", {
      user_lng: center.lng,
      user_lat: center.lat,
      radius_meters: radiusMeters,
    });
    if (orphanErr) throw orphanErr;
    orphanWells = orphanData ?? [];

    if (needsGroundwater) {
      const { data: gwData, error: gwErr } = await supabase.rpc("get_groundwater_wells_in_radius", {
        user_lng: center.lng,
        user_lat: center.lat,
        radius_meters: radiusMeters,
      });
      if (gwErr) throw gwErr;
      groundwaterWells = gwData ?? [];
    }
  } catch {
    return NextResponse.json({ error: "Database query failed" }, { status: 500 });
  }

  // Step 4: Cross-proximity computation
  let nearbyOrphanCount = 0;
  let nearestDistanceMiles: number | null = null;

  if (needsGroundwater && groundwaterWells.length > 0 && orphanWells.length > 0) {
    for (const orphan of orphanWells) {
      let minDist = Infinity;
      for (const gw of groundwaterWells) {
        const d = haversineDistanceMiles(orphan.latitude, orphan.longitude, gw.latitude, gw.longitude);
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
  let summary: string;
  const nearest =
    nearestDistanceMiles !== null ? nearestDistanceMiles.toFixed(1) : null;

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

  return NextResponse.json({
    center,
    radiusMiles: radius_miles,
    summary,
    stats: {
      orphanCount: orphanWells.length,
      groundwaterCount: groundwaterWells.length,
      nearbyOrphanCount,
      nearestDistanceMiles,
    },
  });
}
