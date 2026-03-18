import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

let _anthropic: Anthropic | null = null;
function getAnthropic(): Anthropic {
  if (!_anthropic) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY environment variable is not configured");
    }
    _anthropic = new Anthropic({ apiKey });
  }
  return _anthropic;
}

// SupabaseClient<any, any, any, any>: explicit type args are required to avoid a TypeScript
// issue where ReturnType<typeof createClient> leaves conditional type defaults unevaluated,
// causing the rpc() args parameter to be incorrectly resolved as `undefined`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _supabase: SupabaseClient<any, any, any, any> | null = null;
function getSupabase(): SupabaseClient<any, any, any, any> {
  if (!_supabase) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY;
    if (!url || !key) {
      throw new Error("Supabase environment variables are not configured");
    }
    _supabase = createClient(url, key);
  }
  return _supabase;
}

const MILES_TO_METERS = 1609.34;

const SYSTEM_PROMPT = `You parse natural language queries about oil and gas wells into structured JSON.

Database tables:
- wells: api_number, well_name, latitude, longitude, state, county, operator_name,
  well_type, well_status, spud_date, months_inactive, liability_est
- groundwater_wells: well_id, latitude, longitude, state, county, well_depth_ft,
  well_capacity_gpm, water_use, status, year_constructed

RPC functions (called by the server, not you):
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
  let body: { query?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { query } = body;
  if (!query || typeof query !== "string") {
    return NextResponse.json({ error: "Missing query" }, { status: 400 });
  }

  // Step 1: Parse with Claude
  let parsed: ParsedQuery;
  try {
    const msg = await getAnthropic().messages.create({
      model: "claude-sonnet-4-20250514",
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
      { headers: { "Accept-Language": "en", "User-Agent": "OrphanWellLocator/1.0" } }
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
    const { data: orphanData, error: orphanErr } = await getSupabase().rpc("get_wells_in_radius", {
      user_lng: center.lng,
      user_lat: center.lat,
      radius_meters: radiusMeters,
    });
    if (orphanErr) throw orphanErr;
    orphanWells = orphanData ?? [];

    if (needsGroundwater) {
      const { data: gwData, error: gwErr } = await getSupabase().rpc("get_groundwater_wells_in_radius", {
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
