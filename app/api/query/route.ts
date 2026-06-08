import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

const MILES_TO_METERS = 1609.34;

const SYSTEM_PROMPT = `You are a deterministic translation engine that converts natural language environmental queries into a strict, parameterized JSON payload for PostGIS query execution.

DATABASE TABLES AVAILABLE FOR POSTGIS EXECUTION:
- wells: api_number (text), well_name (text), latitude (float8), longitude (float8), state (text), county (text), operator_name (text), well_type (text), well_status (text), spud_date (date), months_inactive (float8), liability_est (float8)
- groundwater_wells: well_id (text), latitude (float8), longitude (float8), state (text), county (text), well_depth_ft (float8), well_capacity_gpm (float8), water_use (text), status (text), year_constructed (int4)
- epa_sites: site_id (text), site_name (text), latitude (float8), longitude (float8), state (text), county (text), city (text), site_type (text), status (text), contamination_type (text), federal_facility (boolean), npl_status (text)

POSTGIS RPC FUNCTIONS TARGETED:
- get_wells_in_radius(user_lng, user_lat, radius_meters)
- get_groundwater_wells_in_radius(user_lng, user_lat, radius_meters)
- get_epa_sites_in_radius(user_lng, user_lat, radius_meters)
- get_wells_near_layer(reference_layer, user_lng, user_lat, radius_meters)
- get_groundwater_wells_near_layer(reference_layer, user_lng, user_lat, radius_meters)
- get_epa_sites_near_layer(reference_layer, user_lng, user_lat, radius_meters)

OUTPUT FORMAT:
You must output a single, flat JSON object containing EXACTLY these keys. Do not generate markdown backticks, explanations, or any other surrounding text.

JSON Schema:
{
  "state": "Full US state name (e.g. 'Texas', 'Ohio')",
  "county": "County name without 'County' suffix (e.g. 'Reeves', 'Cuyahoga')",
  "extracted_city": "City name if specified in input (e.g. 'Odessa', 'Columbus'), otherwise null",
  "radius_miles": 5.0, // Default strictly to 5.0 if not specified in input
  "action": "one of: 'proximity_analysis' | 'orphan_count' | 'general'", // Use 'proximity_analysis' when checking points in one layer near points in another layer. Use 'orphan_count' when counting features of the target_layer.
  "target_layer": "one of: 'orphan_wells' | 'groundwater_wells' | 'epa_sites'", // The layer the user wants to count or find
  "reference_layer": "one of: 'orphan_wells' | 'groundwater_wells' | 'epa_sites' | null" // The anchor layer they are near (only for 'proximity_analysis' action, otherwise null)
}

CRITICAL RULES:
1. Strip "County" or "Co." from the county name.
2. Only output the raw JSON. No markdown code blocks, no trailing comments.
3. Return ONLY valid JSON. Do not use markdown formatting. Do not include conversational text.`;

interface ParsedQuery {
  state: string;
  county: string;
  extracted_city: string | null;
  radius_miles: number;
  action: "proximity_analysis" | "orphan_count" | "general";
  target_layer: "orphan_wells" | "groundwater_wells" | "epa_sites";
  reference_layer: "orphan_wells" | "groundwater_wells" | "epa_sites" | null;
}

function extractJson(rawText: string): string {
  const match = rawText.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("No JSON object structure found in response");
  }
  let jsonContent = match[0];
  // Strip trailing commas before closing braces and brackets
  jsonContent = jsonContent
    .replace(/,\s*\}/g, "}")
    .replace(/,\s*\]/g, "]");
  return jsonContent.trim();
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

    const rawText = msg.content[0].type === "text" ? msg.content[0].text : "";
    console.log("Raw LLM Output:", rawText);

    let cleanedText = "";
    try {
      cleanedText = extractJson(rawText);
    } catch (err: any) {
      return NextResponse.json({ error: `JSON boundaries not found: ${err.message}` }, { status: 400 });
    }

    try {
      parsed = JSON.parse(cleanedText);
    } catch (err: any) {
      return NextResponse.json({ error: `JSON parse failed: ${err.message}. Cleaned payload: ${cleanedText}` }, { status: 400 });
    }

    if (!parsed.state || !parsed.action || !parsed.target_layer) {
      return NextResponse.json({ error: "Validation error: Missing required fields ('state', 'action', or 'target_layer') in parsed payload." }, { status: 400 });
    }
  } catch (err: any) {
    return NextResponse.json({ error: `API route handler error: ${err.message}` }, { status: 500 });
  }

  // Step 2: Geocode city/county + state via Nominatim
  let geoQuery = parsed.extracted_city
    ? `${parsed.extracted_city}, ${parsed.state}, USA`
    : parsed.county
    ? `${parsed.county} County, ${parsed.state}, USA`
    : `${parsed.state}, USA`;
  let center: { lat: number; lng: number };
  try {
    let geoRes = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&countrycodes=us&limit=1&q=${encodeURIComponent(geoQuery)}`,
      {
        headers: { "Accept-Language": "en", "User-Agent": "OrphanWellLocator/1.0" },
        cache: "force-cache",
      }
    );

    if (!geoRes.ok) {
      return NextResponse.json(
        { error: `Geocoding request failed: ${geoRes.status} ${geoRes.statusText}` },
        { status: 502 }
      );
    }

    let geoData = await geoRes.json();

    // Fallback if city geocoding returns empty results
    if ((!geoData || !geoData.length) && parsed.extracted_city && parsed.county) {
      console.log(`Geocoding for city "${parsed.extracted_city}" returned no results. Falling back to county "${parsed.county}".`);
      geoQuery = `${parsed.county} County, ${parsed.state}, USA`;
      geoRes = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&countrycodes=us&limit=1&q=${encodeURIComponent(geoQuery)}`,
        {
          headers: { "Accept-Language": "en", "User-Agent": "OrphanWellLocator/1.0" },
          cache: "force-cache",
        }
      );
      if (geoRes.ok) {
        geoData = await geoRes.json();
      }
    }

    if (!geoData || !geoData.length) {
      return NextResponse.json(
        { error: `Could not resolve coordinates for query: "${geoQuery}"` },
        { status: 404 }
      );
    }

    const lat = parseFloat(geoData[0].lat);
    const lng = parseFloat(geoData[0].lon);
    if (isNaN(lat) || isNaN(lng) || (lat === 0 && lng === 0)) {
      return NextResponse.json(
        { error: "Geocoder resolved invalid coordinates (NaN or 0,0)" },
        { status: 422 }
      );
    }
    center = { lat, lng };
  } catch (err: any) {
    return NextResponse.json(
      { error: `Geocoding network error: ${err.message}` },
      { status: 500 }
    );
  }

  // Explicit safety check on coordinates before Supabase RPC call
  if (!center || isNaN(center.lat) || isNaN(center.lng) || (center.lat === 0 && center.lng === 0)) {
    return NextResponse.json(
      { error: "Pre-query validation failed: Invalid resolved search coordinates." },
      { status: 400 }
    );
  }

  const radiusMiles = typeof parsed.radius_miles === "number" && !isNaN(parsed.radius_miles) ? parsed.radius_miles : 5.0;
  const radiusMeters = Math.round(radiusMiles * MILES_TO_METERS);

  // Step 3: Query Supabase
  const action = parsed.action || "general";
  const targetLayer = parsed.target_layer || "orphan_wells";
  const referenceLayer = parsed.reference_layer;

  const needsOrphan = targetLayer === "orphan_wells";
  const needsGroundwater = targetLayer === "groundwater_wells";
  const needsEpa = targetLayer === "epa_sites";

  let orphanWells: WellRow[] = [];
  let groundwaterWells: WellRow[] = [];
  let epaSites: any[] = [];
  let proximityResults: any[] = [];

  try {
    if (action === "proximity_analysis") {
      if (!referenceLayer) {
        return NextResponse.json({ error: "Validation error: Missing reference_layer for proximity_analysis." }, { status: 400 });
      }

      let rpcName = "";
      if (targetLayer === "orphan_wells") {
        rpcName = "get_wells_near_layer";
      } else if (targetLayer === "groundwater_wells") {
        rpcName = "get_groundwater_wells_near_layer";
      } else if (targetLayer === "epa_sites") {
        rpcName = "get_epa_sites_near_layer";
      } else {
        return NextResponse.json({ error: `Unsupported target_layer: ${targetLayer}` }, { status: 400 });
      }

      const { data: proxData, error: proxErr } = await supabase.rpc(rpcName, {
        reference_layer: referenceLayer,
        user_lng: center.lng,
        user_lat: center.lat,
        radius_meters: radiusMeters,
      });
      if (proxErr) throw proxErr;
      proximityResults = proxData ?? [];

      if (targetLayer === "orphan_wells") {
        orphanWells = proximityResults;
      } else if (targetLayer === "groundwater_wells") {
        groundwaterWells = proximityResults;
      } else if (targetLayer === "epa_sites") {
        epaSites = proximityResults;
      }
    } else {

      if (needsOrphan) {
        const { data: orphanData, error: orphanErr } = await supabase.rpc("get_wells_in_radius", {
          user_lng: center.lng,
          user_lat: center.lat,
          radius_meters: radiusMeters,
        });
        if (orphanErr) throw orphanErr;
        orphanWells = orphanData ?? [];
      }

      if (needsGroundwater) {
        const { data: gwData, error: gwErr } = await supabase.rpc("get_groundwater_wells_in_radius", {
          user_lng: center.lng,
          user_lat: center.lat,
          radius_meters: radiusMeters,
        });
        if (gwErr) throw gwErr;
        groundwaterWells = gwData ?? [];
      }

      if (needsEpa) {
        const { data: epaData, error: epaErr } = await supabase.rpc("get_epa_sites_in_radius", {
          user_lng: center.lng,
          user_lat: center.lat,
          radius_meters: radiusMeters,
        });
        if (epaErr) throw epaErr;
        epaSites = epaData ?? [];
      }
    }
  } catch (err: any) {
    return NextResponse.json({ error: `Database query failed: ${err.message}` }, { status: 500 });
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
  const { county, state, radius_miles, action: parsedAction, target_layer, reference_layer, extracted_city } = parsed;
  let summary: string;
  const nearest =
    nearestDistanceMiles !== null ? nearestDistanceMiles.toFixed(1) : null;

  switch (parsedAction) {
    case "proximity_analysis":
      summary = `Found ${proximityResults.length} ${targetLayer.replace("_", " ")} within ${radiusMiles} miles of ${referenceLayer?.replace("_", " ")} in ${extracted_city || county || ""}, ${state}.`;
      break;
    case "orphan_count":
      if (targetLayer === "groundwater_wells") {
        summary = `Found ${groundwaterWells.length} groundwater well${groundwaterWells.length !== 1 ? "s" : ""} within ${radius_miles} miles in ${extracted_city || county || ""}, ${state}.`;
      } else if (targetLayer === "epa_sites") {
        summary = `Found ${epaSites.length} EPA contamination site${epaSites.length !== 1 ? "s" : ""} within ${radius_miles} miles in ${extracted_city || county || ""}, ${state}.`;
      } else {
        summary = `Found ${orphanWells.length} orphan well${orphanWells.length !== 1 ? "s" : ""} within ${radius_miles} miles in ${extracted_city || county || ""}, ${state}.`;
      }
      break;
    default:
      if (targetLayer === "groundwater_wells") {
        summary = `Showing ${groundwaterWells.length} groundwater well${groundwaterWells.length !== 1 ? "s" : ""} near ${extracted_city || county || ""}, ${state}.`;
      } else if (targetLayer === "epa_sites") {
        summary = `Showing ${epaSites.length} EPA contamination site${epaSites.length !== 1 ? "s" : ""} near ${extracted_city || county || ""}, ${state}.`;
      } else {
        summary = `Showing ${orphanWells.length} orphan well${orphanWells.length !== 1 ? "s" : ""} near ${extracted_city || county || ""}, ${state}.`;
      }
  }

  return NextResponse.json({
    center,
    radiusMiles: radius_miles,
    summary,
    target_layer: targetLayer,
    reference_layer: referenceLayer,
    stats: {
      orphanCount: orphanWells.length,
      groundwaterCount: groundwaterWells.length,
      epaCount: epaSites.length,
      proximityCount: proximityResults.length,
      nearbyOrphanCount,
      nearestDistanceMiles,
    },
  });
}
