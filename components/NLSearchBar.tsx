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

// ── Analytics action types ────────────────────────────────────────────────────

interface CountWellsAction {
  action: "count_wells";
  state: string;
  county?: string | null;
  operator?: string | null;
  min_age_years?: number | null;
  max_age_years?: number | null;
  min_liability?: number | null;
  max_liability?: number | null;
}
interface ProximityAnalysisAction {
  action: "proximity_analysis";
  state: string;
  county?: string | null;
  max_distance_miles: number;
}
interface LiabilitySummaryAction {
  action: "liability_summary";
  state: string;
  county?: string | null;
  group_by: "county" | "state" | "operator";
  sort: "asc" | "desc";
  limit: number;
}
interface AgeRankingAction {
  action: "age_ranking";
  state: string;
  county?: string | null;
  limit: number;
}
interface GroundwaterRiskAction {
  action: "groundwater_risk";
  state: string;
  county?: string | null;
  max_distance_miles: number;
  limit: number;
}
interface OperatorSummaryAction {
  action: "operator_summary";
  state: string;
  county?: string | null;
  limit: number;
}
interface GroupCountAction {
  action: "group_count";
  state: string;
  county?: string | null;
  group_by: "county" | "operator" | "well_type" | "well_status";
  sort: "asc" | "desc";
  limit: number;
}
interface GeneralStatsAction {
  action: "general_stats";
  state: string;
  county?: string | null;
}
interface EpaSitesNearAction {
  action: "epa_sites_near";
  state: string;
  county?: string | null;
  site_type?: "Superfund" | "Brownfield" | "TRI" | null;
  max_distance_miles: number;
  limit: number;
}
interface CombinedRiskAction {
  action: "combined_risk";
  state: string;
  county?: string | null;
  max_distance_miles: number;
}
interface MoveMapAction {
  action: "move_map";
  state: string;
  county?: string | null;
  radius_miles?: number | null;
}

type AnalyticsAction =
  | CountWellsAction
  | ProximityAnalysisAction
  | LiabilitySummaryAction
  | AgeRankingAction
  | GroundwaterRiskAction
  | OperatorSummaryAction
  | GroupCountAction
  | GeneralStatsAction
  | EpaSitesNearAction
  | CombinedRiskAction
  | MoveMapAction;

// ── System prompt for the planning call ──────────────────────────────────────

const ANALYTICS_SYSTEM_PROMPT = `You are an analytics planner for a US multi-hazard environmental risk database. Read the user's natural language question and return a single JSON object describing what analytics to run.

CRITICAL: Return ONLY raw JSON. No markdown. No backticks. No explanation. No extra text.

=== DATABASE SCHEMA ===

Table: wells  (orphan oil/gas wells)
- api_number   text PK          — API well identifier
- well_name    text             — name of the well
- latitude     float8           — decimal latitude
- longitude    float8           — decimal longitude
- state        text             — full US state name e.g. "Texas", "West Virginia"
- county       text             — county WITHOUT "County" e.g. "Kanawha", "Reeves"
- operator_name text            — company that operated the well
- well_type    text             — e.g. "Oil Well", "Gas Well", "Injection Well"
- well_status  text             — e.g. "Orphaned", "Abandoned", "Plugged"
- spud_date    date             — date drilling began; well age = years since spud_date
- liability_est   float8        — estimated cleanup cost in USD
- field_name   text             — oil/gas field name
- lease_name   text             — lease name
- district     text             — regulatory district

Table: groundwater_wells  (domestic/municipal water wells)
- well_id          text PK      — unique identifier
- latitude         float8       — decimal latitude
- longitude        float8       — decimal longitude
- state            text         — full US state name
- county           text         — county WITHOUT "County"
- well_depth_ft    float8       — depth in feet
- well_capacity_gpm float8      — capacity in gallons per minute
- water_use        text         — e.g. "Domestic", "Municipal", "Agricultural"
- status           text         — e.g. "Active", "Inactive"
- year_constructed int4         — year built

Table: epa_sites  (EPA-regulated contamination sites)
- site_id          text PK      — unique identifier
- site_name        text         — name of the site or facility
- latitude         float8       — decimal latitude
- longitude        float8       — decimal longitude
- state            text         — full US state name
- county           text         — county WITHOUT "County"
- city             text         — city name
- site_type        text         — "Superfund", "Brownfield", or "TRI"
- status           text         — e.g. "Active", "Inactive", "Archived/Deleted"
- contamination_type text       — type of contamination (if known)
- federal_facility boolean      — whether it is a federal facility
- npl_status       text         — NPL status e.g. "Current NPL", "Deleted from NPL"

Supabase RPCs available:
- get_wells_in_radius(user_lng, user_lat, radius_meters)            → orphan wells within radius
- get_groundwater_wells_in_radius(user_lng, user_lat, radius_meters) → groundwater wells within radius

=== ACTION TYPES — return exactly one ===

count_wells — count orphan wells matching optional filters
{"action":"count_wells","state":"West Virginia","county":"Kanawha","operator":null,"min_age_years":null,"max_age_years":null,"min_liability":null,"max_liability":null}

proximity_analysis — how many orphan wells sit within X miles of groundwater wells
{"action":"proximity_analysis","state":"Pennsylvania","county":"Butler","max_distance_miles":1}

liability_summary — sum estimated cleanup liability, grouped and ranked
{"action":"liability_summary","state":"Texas","county":null,"group_by":"county","sort":"desc","limit":10}
group_by must be one of: "county", "state", "operator"

age_ranking — list the oldest orphan wells (by spud_date) in an area
{"action":"age_ranking","state":"Oklahoma","county":null,"limit":10}

groundwater_risk — which groundwater wells have the most orphan wells nearby
{"action":"groundwater_risk","state":"West Virginia","county":"Kanawha","max_distance_miles":1,"limit":10}

operator_summary — which operators have the highest liability burden (details on operator responsibility)
{"action":"operator_summary","state":"Texas","county":null,"limit":10}

group_count — count wells grouped by a categorical field (county, operator, well_type, or well_status)
{"action":"group_count","state":"Texas","county":null,"group_by":"county","sort":"desc","limit":10}
group_by must be one of: "county", "operator", "well_type", "well_status"

general_stats — overall statistics for a state or county
{"action":"general_stats","state":"Ohio","county":"Cuyahoga"}

epa_sites_near — count or list EPA contamination sites near a location
{"action":"epa_sites_near","state":"Texas","county":"Harris","site_type":"Superfund","max_distance_miles":5,"limit":10}
site_type must be one of: "Superfund", "Brownfield", "TRI", or null for all types

combined_risk — show both orphan wells AND EPA sites near a location for a combined environmental risk view
{"action":"combined_risk","state":"West Virginia","county":"Kanawha","max_distance_miles":3}

move_map — just navigate the map to a location with no analytics
{"action":"move_map","state":"Colorado","county":"Weld","radius_miles":5}

=== ROUTING RULES ===
- state is ALWAYS required (full state name)
- county is WITHOUT "County"; null for state-wide queries
- All numeric filter fields default to null unless explicitly mentioned
- limit defaults to 10 when not specified
- "how many" / "count" / "total" questions → count_wells
- "which county has the most" / "top counties by count" / "most wells per county" → group_count with group_by "county"
- "what types of wells" / "breakdown by well type" / "well status distribution" → group_count with group_by "well_type" or "well_status"
- "which operator abandoned the most" / "top operators by count" → group_count with group_by "operator"
- "highest liability" / "total cleanup cost" grouped by area → liability_summary
- "operator liability" / "which operator owes the most" → operator_summary
- "near water wells" / "risk to drinking water" → proximity_analysis or groundwater_risk
- "oldest" / "ancient" / "drilled decades ago" / "well age" → age_ranking
- "show me" / "take me to" / "where are" / simple map navigation → move_map
- "stats" / "overview" / "summary of the problem" → general_stats
- Age filters: "older than X years" → min_age_years=X; "newer than X years" → max_age_years=X
- "superfund" / "brownfield" / "EPA sites" / "contamination sites" / "toxic" / "TRI" → epa_sites_near
- "combined risk" / "all environmental hazards" / "total risk" / "everything near" → combined_risk

=== EXAMPLES ===
"how many orphan wells are in Kanawha County West Virginia"
→ {"action":"count_wells","state":"West Virginia","county":"Kanawha","operator":null,"min_age_years":null,"max_age_years":null,"min_liability":null,"max_liability":null}

"wells drilled more than 20 years ago in Ohio"
→ {"action":"count_wells","state":"Ohio","county":null,"operator":null,"min_age_years":20,"max_age_years":null,"min_liability":null,"max_liability":null}

"which county in Texas has the most orphan wells"
→ {"action":"group_count","state":"Texas","county":null,"group_by":"county","sort":"desc","limit":10}

"top counties in West Virginia by orphan well count"
→ {"action":"group_count","state":"West Virginia","county":null,"group_by":"county","sort":"desc","limit":10}

"what types of wells are in Colorado"
→ {"action":"group_count","state":"Colorado","county":null,"group_by":"well_type","sort":"desc","limit":10}

"breakdown of well status in Ohio"
→ {"action":"group_count","state":"Ohio","county":null,"group_by":"well_status","sort":"desc","limit":10}

"which operators have abandoned the most wells in Texas"
→ {"action":"group_count","state":"Texas","county":null,"group_by":"operator","sort":"desc","limit":10}

"which county in Texas has the highest total cleanup liability"
→ {"action":"liability_summary","state":"Texas","county":null,"group_by":"county","sort":"desc","limit":10}

"which operators owe the most in liability in Pennsylvania"
→ {"action":"operator_summary","state":"Pennsylvania","county":null,"limit":10}

"orphan wells within 1 mile of drinking water wells in Butler County PA"
→ {"action":"proximity_analysis","state":"Pennsylvania","county":"Butler","max_distance_miles":1}

"which water wells in West Virginia are most threatened by orphan wells"
→ {"action":"groundwater_risk","state":"West Virginia","county":null,"max_distance_miles":2,"limit":10}

"oldest orphan wells in Oklahoma"
→ {"action":"age_ranking","state":"Oklahoma","county":null,"limit":10}

"overview of the orphan well problem in Wyoming"
→ {"action":"general_stats","state":"Wyoming","county":null}

"how many superfund sites are near Kanawha County West Virginia"
→ {"action":"epa_sites_near","state":"West Virginia","county":"Kanawha","site_type":"Superfund","max_distance_miles":10,"limit":10}

"brownfield sites in Houston Texas"
→ {"action":"epa_sites_near","state":"Texas","county":"Harris","site_type":"Brownfield","max_distance_miles":20,"limit":10}

"TRI toxic release facilities in Ohio"
→ {"action":"epa_sites_near","state":"Ohio","county":null,"site_type":"TRI","max_distance_miles":50,"limit":10}

"all EPA contamination sites near me in Pennsylvania"
→ {"action":"epa_sites_near","state":"Pennsylvania","county":null,"site_type":null,"max_distance_miles":25,"limit":10}

"combined environmental risk in Kanawha County West Virginia"
→ {"action":"combined_risk","state":"West Virginia","county":"Kanawha","max_distance_miles":5}

"all environmental hazards near Reeves County Texas"
→ {"action":"combined_risk","state":"Texas","county":"Reeves","max_distance_miles":10}

"show orphan wells in Reeves County Texas"
→ {"action":"move_map","state":"Texas","county":"Reeves","radius_miles":5}`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function haversineDistanceMiles(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function geocodeLocation(state: string, county?: string | null): Promise<{ lat: number; lng: number }> {
  const q = county ? `${county} County, ${state}, USA` : `${state}, USA`;
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&countrycodes=us&limit=1&q=${encodeURIComponent(q)}`,
    { headers: { "Accept-Language": "en", "User-Agent": "OrphanWellLocator/1.0" } }
  );
  const data = await res.json();
  if (!data.length) throw new Error(`Could not geocode: ${q}`);
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
}

// ── Gemini call 1: plan analytics action ─────────────────────────────────────

async function planWithGemini(query: string, apiKey: string): Promise<AnalyticsAction> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: ANALYTICS_SYSTEM_PROMPT }] },
        contents: [{ parts: [{ text: query }] }],
        generationConfig: { maxOutputTokens: 512, responseMimeType: "application/json" },
      }),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = (err as { error?: { message?: string } })?.error?.message ?? res.statusText;
    throw new Error(`Gemini error: ${msg}`);
  }
  const data = await res.json();
  const rawText: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const fenceMatch = rawText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i);
  const bareMatch = rawText.match(/\{[\s\S]*\}/);
  const jsonStr = fenceMatch?.[1] ?? bareMatch?.[0] ?? rawText;
  let parsed: AnalyticsAction;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(`Could not parse Gemini plan: ${jsonStr.slice(0, 200)}`);
  }
  if (!parsed.action || !parsed.state) {
    throw new Error(`Invalid plan from Gemini: ${jsonStr.slice(0, 200)}`);
  }
  return parsed;
}

// ── Gemini call 2: summarize results ─────────────────────────────────────────

async function summarizeWithGemini(
  originalQuery: string,
  action: AnalyticsAction,
  results: unknown,
  apiKey: string
): Promise<string> {
  const prompt = `The user asked: "${originalQuery}"

Analysis performed: ${JSON.stringify(action)}

Database results:
${JSON.stringify(results, null, 2)}

Write a clear, concise answer (2-4 sentences) that directly responds to the user's question using the actual numbers above. Be specific. Use plain text only — no markdown, no bullet points, no headers.`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 512 },
      }),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = (err as { error?: { message?: string } })?.error?.message ?? res.statusText;
    throw new Error(`Gemini summarize error: ${msg}`);
  }
  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? "Analysis complete.";
}

// ── Execute analytics action against Supabase ─────────────────────────────────

interface WellRow {
  latitude: number;
  longitude: number;
  [key: string]: unknown;
}

interface ActionResult {
  results: unknown;
  center: { lat: number; lng: number };
  radiusMiles: number;
}

async function executeAction(action: AnalyticsAction): Promise<ActionResult> {
  if (!supabase) throw new Error("Supabase not configured");

  const center = await geocodeLocation(action.state, action.county);
  const defaultRadius = action.county ? 50 : 500;

  switch (action.action) {
    case "move_map": {
      const r = action.radius_miles ?? (action.county ? 5 : 500);
      return {
        results: { location: action.county ? `${action.county} County, ${action.state}` : action.state },
        center,
        radiusMiles: r,
      };
    }

    case "count_wells": {
      let q = supabase
        .from("orphan_wells")
        .select("*", { count: "exact", head: true })
        .ilike("state", action.state);
      if (action.county) q = q.ilike("county", action.county);
      if (action.operator) q = q.ilike("operator_name", `%${action.operator}%`);
      if (action.min_age_years != null) {
        const cutoff = new Date();
        cutoff.setFullYear(cutoff.getFullYear() - action.min_age_years);
        q = q.lte("spud_date", cutoff.toISOString().split("T")[0]);
      }
      if (action.max_age_years != null) {
        const cutoff = new Date();
        cutoff.setFullYear(cutoff.getFullYear() - action.max_age_years);
        q = q.gte("spud_date", cutoff.toISOString().split("T")[0]);
      }
      if (action.min_liability != null) q = q.gte("liability_est", action.min_liability);
      if (action.max_liability != null) q = q.lte("liability_est", action.max_liability);
      const { count, error } = await q;
      if (error) throw error;
      return {
        results: {
          count,
          location: action.county ? `${action.county} County, ${action.state}` : action.state,
          filters: {
            operator: action.operator ?? null,
            min_age_years: action.min_age_years ?? null,
            max_age_years: action.max_age_years ?? null,
            min_liability: action.min_liability ?? null,
            max_liability: action.max_liability ?? null,
          },
        },
        center,
        radiusMiles: defaultRadius,
      };
    }

    case "proximity_analysis": {
      const maxDist = action.max_distance_miles ?? 1;
      const searchRadiusMeters = Math.max(maxDist * 20, 50) * MILES_TO_METERS;
      const [orphanRes, gwRes] = await Promise.all([
        supabase.rpc("get_wells_in_radius", {
          user_lng: center.lng,
          user_lat: center.lat,
          radius_meters: searchRadiusMeters,
        }),
        supabase.rpc("get_groundwater_wells_in_radius", {
          user_lng: center.lng,
          user_lat: center.lat,
          radius_meters: searchRadiusMeters,
        }),
      ]);
      if (orphanRes.error) throw orphanRes.error;
      if (gwRes.error) throw gwRes.error;
      const orphans: WellRow[] = orphanRes.data ?? [];
      const groundwater: WellRow[] = gwRes.data ?? [];

      let atRiskCount = 0;
      let closestPair: number | null = null;
      for (const o of orphans) {
        let minDist = Infinity;
        for (const g of groundwater) {
          const d = haversineDistanceMiles(o.latitude, o.longitude, g.latitude, g.longitude);
          if (d < minDist) minDist = d;
        }
        if (minDist <= maxDist) {
          atRiskCount++;
          if (closestPair === null || minDist < closestPair) closestPair = minDist;
        }
      }

      return {
        results: {
          location: action.county ? `${action.county} County, ${action.state}` : action.state,
          max_distance_miles: maxDist,
          orphan_wells_in_search_area: orphans.length,
          groundwater_wells_in_search_area: groundwater.length,
          orphan_wells_within_threshold: atRiskCount,
          closest_pair_miles: closestPair !== null ? Math.round(closestPair * 1000) / 1000 : null,
        },
        center,
        radiusMiles: Math.max(maxDist * 5, defaultRadius),
      };
    }

    case "liability_summary": {
      const groupCol =
        action.group_by === "operator" ? "operator_name" : action.group_by;
      const selectCols =
        action.group_by === "operator"
          ? "operator_name, liability_est"
          : action.group_by === "county"
          ? "county, liability_est"
          : "state, liability_est";

      let q = supabase
        .from("orphan_wells")
        .select(selectCols)
        .ilike("state", action.state)
        .not("liability_est", "is", null);
      if (action.county) q = q.ilike("county", action.county);
      const { data, error } = await q.limit(50000);
      if (error) throw error;

      const rows = (data ?? []) as Array<Record<string, unknown>>;
      const grouped: Record<string, number> = {};
      for (const row of rows) {
        const key = (row[groupCol] as string) ?? "Unknown";
        grouped[key] = (grouped[key] ?? 0) + ((row.liability_est as number) ?? 0);
      }

      const sorted = Object.entries(grouped)
        .sort((a, b) => (action.sort === "desc" ? b[1] - a[1] : a[1] - b[1]))
        .slice(0, action.limit ?? 10)
        .map(([name, total]) => ({
          name,
          total_liability_usd: Math.round(total),
        }));

      return {
        results: {
          location: action.county ? `${action.county} County, ${action.state}` : action.state,
          group_by: action.group_by,
          wells_with_liability_data: rows.length,
          top_groups: sorted,
        },
        center,
        radiusMiles: defaultRadius,
      };
    }

    case "age_ranking": {
      let q = supabase
        .from("orphan_wells")
        .select("well_name, api_number, state, county, operator_name, spud_date, liability_est")
        .ilike("state", action.state)
        .not("spud_date", "is", null)
        .order("spud_date", { ascending: true })
        .limit(action.limit ?? 10);
      if (action.county) q = q.ilike("county", action.county);
      const { data, error } = await q;
      if (error) throw error;

      const now = Date.now();
      return {
        results: {
          location: action.county ? `${action.county} County, ${action.state}` : action.state,
          oldest_wells: (data ?? []).map((w: Record<string, unknown>) => {
            const spud = w.spud_date ? new Date(w.spud_date as string) : null;
            const ageYears = spud
              ? Math.round(((now - spud.getTime()) / (1000 * 60 * 60 * 24 * 365.25)) * 10) / 10
              : null;
            return {
              well_name: w.well_name,
              operator_name: w.operator_name,
              county: w.county,
              spud_date: w.spud_date,
              age_years: ageYears,
              liability_est: w.liability_est,
            };
          }),
        },
        center,
        radiusMiles: defaultRadius,
      };
    }

    case "groundwater_risk": {
      const maxDist = action.max_distance_miles ?? 1;
      const searchRadiusMeters = Math.max(maxDist * 20, action.county ? 50 : 100) * MILES_TO_METERS;
      const [orphanRes, gwRes] = await Promise.all([
        supabase.rpc("get_wells_in_radius", {
          user_lng: center.lng,
          user_lat: center.lat,
          radius_meters: searchRadiusMeters,
        }),
        supabase.rpc("get_groundwater_wells_in_radius", {
          user_lng: center.lng,
          user_lat: center.lat,
          radius_meters: searchRadiusMeters,
        }),
      ]);
      if (orphanRes.error) throw orphanRes.error;
      if (gwRes.error) throw gwRes.error;
      const orphans: WellRow[] = orphanRes.data ?? [];
      const groundwater: WellRow[] = gwRes.data ?? [];

      const riskScores: Array<{
        well_id: unknown;
        county: unknown;
        water_use: unknown;
        orphan_count: number;
        closest_orphan_miles: number;
      }> = [];

      for (const gw of groundwater) {
        let count = 0;
        let closest = Infinity;
        for (const o of orphans) {
          const d = haversineDistanceMiles(gw.latitude, gw.longitude, o.latitude, o.longitude);
          if (d <= maxDist) {
            count++;
            if (d < closest) closest = d;
          }
        }
        if (count > 0) {
          riskScores.push({
            well_id: (gw as Record<string, unknown>).well_id,
            county: (gw as Record<string, unknown>).county,
            water_use: (gw as Record<string, unknown>).water_use,
            orphan_count: count,
            closest_orphan_miles: Math.round(closest * 1000) / 1000,
          });
        }
      }
      riskScores.sort((a, b) => b.orphan_count - a.orphan_count);

      return {
        results: {
          location: action.county ? `${action.county} County, ${action.state}` : action.state,
          search_radius_miles: searchRadiusMeters / MILES_TO_METERS,
          max_distance_miles: maxDist,
          groundwater_wells_analyzed: groundwater.length,
          groundwater_wells_at_risk: riskScores.length,
          top_at_risk: riskScores.slice(0, action.limit ?? 10),
        },
        center,
        radiusMiles: defaultRadius,
      };
    }

    case "operator_summary": {
      let q = supabase
        .from("orphan_wells")
        .select("operator_name, liability_est")
        .ilike("state", action.state)
        .not("operator_name", "is", null);
      if (action.county) q = q.ilike("county", action.county);
      const { data, error } = await q.limit(50000);
      if (error) throw error;

      const byOp: Record<string, { count: number; total_liability: number }> = {};
      for (const row of (data ?? []) as Array<{ operator_name: string; liability_est?: number | null }>) {
        const op = row.operator_name ?? "Unknown";
        if (!byOp[op]) byOp[op] = { count: 0, total_liability: 0 };
        byOp[op].count++;
        byOp[op].total_liability += row.liability_est ?? 0;
      }

      const sorted = Object.entries(byOp)
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, action.limit ?? 10)
        .map(([name, stats]) => ({
          operator: name,
          well_count: stats.count,
          total_liability_usd: Math.round(stats.total_liability),
        }));

      return {
        results: {
          location: action.county ? `${action.county} County, ${action.state}` : action.state,
          total_wells_analyzed: data?.length ?? 0,
          top_operators: sorted,
        },
        center,
        radiusMiles: defaultRadius,
      };
    }

    case "group_count": {
      const colMap: Record<string, string> = {
        county: "county",
        operator: "operator_name",
        well_type: "well_type",
        well_status: "well_status",
      };
      const col = colMap[action.group_by] ?? action.group_by;

      let q = supabase
        .from("orphan_wells")
        .select(col)
        .ilike("state", action.state)
        .not(col, "is", null);
      if (action.county) q = q.ilike("county", action.county);
      const { data, error } = await q.limit(100000);
      if (error) throw error;

      const counts: Record<string, number> = {};
      for (const row of (data as unknown as Array<Record<string, unknown>>) ?? []) {
        const key = (row[col] as string) ?? "Unknown";
        counts[key] = (counts[key] ?? 0) + 1;
      }

      const sorted = Object.entries(counts)
        .sort((a, b) => (action.sort === "desc" ? b[1] - a[1] : a[1] - b[1]))
        .slice(0, action.limit ?? 10)
        .map(([name, count]) => ({ name, well_count: count }));

      return {
        results: {
          location: action.county ? `${action.county} County, ${action.state}` : action.state,
          group_by: action.group_by,
          total_wells_analyzed: data?.length ?? 0,
          top_groups: sorted,
        },
        center,
        radiusMiles: defaultRadius,
      };
    }

    case "general_stats": {
      const location = action.county
        ? `${action.county} County, ${action.state}`
        : action.state;

      let countQ = supabase
        .from("orphan_wells")
        .select("*", { count: "exact", head: true })
        .ilike("state", action.state);
      if (action.county) countQ = countQ.ilike("county", action.county);
      const { count: totalCount, error: countErr } = await countQ;
      if (countErr) throw countErr;

      let dataQ = supabase
        .from("orphan_wells")
        .select("liability_est, spud_date, operator_name")
        .ilike("state", action.state);
      if (action.county) dataQ = dataQ.ilike("county", action.county);
      const { data: statsData, error: statsErr } = await dataQ.limit(50000);
      if (statsErr) throw statsErr;

      const rows = (statsData ?? []) as Array<{
        liability_est?: number | null;
        spud_date?: string | null;
        operator_name?: string | null;
      }>;

      const liabilityRows = rows.filter((r) => r.liability_est != null);
      const totalLiability = liabilityRows.reduce((s, r) => s + (r.liability_est ?? 0), 0);

      const now = Date.now();
      const ageRows = rows.filter((r) => r.spud_date != null).map((r) => {
        const spud = new Date(r.spud_date!);
        return (now - spud.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
      });
      const avgAgeYears =
        ageRows.length > 0
          ? Math.round((ageRows.reduce((s, a) => s + a, 0) / ageRows.length) * 10) / 10
          : null;

      const oldWellCount = ageRows.filter((a) => a >= 20).length;

      const opCounts: Record<string, number> = {};
      for (const r of rows) {
        if (r.operator_name) opCounts[r.operator_name] = (opCounts[r.operator_name] ?? 0) + 1;
      }
      const topOperator =
        Object.keys(opCounts).length > 0
          ? Object.entries(opCounts).sort((a, b) => b[1] - a[1])[0]
          : null;

      return {
        results: {
          location,
          total_orphan_wells: totalCount,
          total_liability_est_usd: Math.round(totalLiability),
          wells_with_liability_data: liabilityRows.length,
          avg_age_years: avgAgeYears,
          wells_with_spud_date: ageRows.length,
          wells_over_20_years_old: oldWellCount,
          top_operator: topOperator
            ? { name: topOperator[0], well_count: topOperator[1] }
            : null,
        },
        center,
        radiusMiles: defaultRadius,
      };
    }

    case "epa_sites_near": {
      const maxDist = action.max_distance_miles ?? 10;
      const searchRadiusMeters = maxDist * MILES_TO_METERS;

      let q = supabase
        .from("epa_sites")
        .select("site_id, site_name, site_type, status, npl_status, county, city, federal_facility")
        .ilike("state", action.state);
      if (action.county) q = q.ilike("county", action.county);
      if (action.site_type) q = q.eq("site_type", action.site_type);
      const { data, error } = await q.limit(action.limit ?? 10);
      if (error) throw error;

      const byType: Record<string, number> = {};
      for (const row of (data ?? []) as Array<Record<string, unknown>>) {
        const t = (row.site_type as string) ?? "Unknown";
        byType[t] = (byType[t] ?? 0) + 1;
      }

      return {
        results: {
          location: action.county ? `${action.county} County, ${action.state}` : action.state,
          site_type_filter: action.site_type ?? "All",
          max_distance_miles: maxDist,
          total_sites: data?.length ?? 0,
          by_type: byType,
          sites: (data ?? []).slice(0, action.limit ?? 10),
        },
        center,
        radiusMiles: Math.max(maxDist * 2, defaultRadius),
      };
    }

    case "combined_risk": {
      const maxDist = action.max_distance_miles ?? 5;
      const searchRadiusMeters = Math.max(maxDist * 10, 50) * MILES_TO_METERS;

      const [orphanRes, epaRes, gwRes] = await Promise.all([
        supabase.rpc("get_wells_in_radius", {
          user_lng: center.lng,
          user_lat: center.lat,
          radius_meters: searchRadiusMeters,
        }),
        supabase.rpc("get_epa_sites_in_radius", {
          user_lng: center.lng,
          user_lat: center.lat,
          radius_meters: searchRadiusMeters,
        }),
        supabase.rpc("get_groundwater_wells_in_radius", {
          user_lng: center.lng,
          user_lat: center.lat,
          radius_meters: searchRadiusMeters,
        }),
      ]);

      if (orphanRes.error) throw orphanRes.error;
      // EPA or groundwater errors are non-fatal — log and continue
      if (epaRes.error) console.error("EPA sites RPC error:", epaRes.error);
      if (gwRes.error) console.error("Groundwater RPC error:", gwRes.error);

      const orphans = (orphanRes.data ?? []) as Array<Record<string, unknown>>;
      const epaSites = (epaRes.data ?? []) as Array<Record<string, unknown>>;
      const groundwater = (gwRes.data ?? []) as Array<Record<string, unknown>>;

      const epaByType: Record<string, number> = {};
      for (const s of epaSites) {
        const t = (s.site_type as string) ?? "Unknown";
        epaByType[t] = (epaByType[t] ?? 0) + 1;
      }

      const superfundCount = epaByType["Superfund"] ?? 0;
      const riskLevel =
        orphans.length > 50 && superfundCount > 0
          ? "CRITICAL"
          : orphans.length > 20 || superfundCount > 0
          ? "HIGH"
          : orphans.length > 5 || (epaByType["Brownfield"] ?? 0) > 5
          ? "MODERATE"
          : "LOW";

      return {
        results: {
          location: action.county ? `${action.county} County, ${action.state}` : action.state,
          search_radius_miles: searchRadiusMeters / MILES_TO_METERS,
          risk_level: riskLevel,
          orphan_wells: orphans.length,
          groundwater_wells: groundwater.length,
          epa_sites: epaSites.length,
          epa_by_type: epaByType,
          superfund_sites: superfundCount,
          brownfield_sites: epaByType["Brownfield"] ?? 0,
          tri_facilities: epaByType["TRI"] ?? 0,
        },
        center,
        radiusMiles: Math.max(maxDist * 3, defaultRadius),
      };
    }
  }
}

// ── Component ────────────────────────────────────────────────────────────────

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
      const action = await planWithGemini(trimmed, geminiKey);
      const { results, center, radiusMiles } = await executeAction(action);

      let summary: string;
      if (action.action === "move_map") {
        const loc = action.county ? `${action.county} County, ${action.state}` : action.state;
        summary = `Showing orphan wells near ${loc}.`;
      } else {
        summary = await summarizeWithGemini(trimmed, action, results, geminiKey);
      }

      setQuery("");
      onResult({ center, radiusMiles, summary });
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
        top: "48px",
        left: "50%",
        transform: "translateX(-50%)",
        width: "min(520px, calc(100vw - 48px))",
        zIndex: 800,
        fontFamily: "var(--font-mono)",
      }}
    >
      {/* Search bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          background: "#111",
          border: "1px solid #444",
          padding: "0 10px",
          gap: "8px",
        }}
      >
        <span style={{ color: "#555", fontSize: "11px", flexShrink: 0 }}>&gt;</span>

        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setError(null);
          }}
          onKeyDown={handleKeyDown}
          placeholder="query wells — count, liability, risk, location..."
          disabled={loading}
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            outline: "none",
            color: "#e0e0e0",
            fontSize: "11px",
            fontFamily: "var(--font-mono)",
            padding: "10px 0",
            opacity: loading ? 0.5 : 1,
            letterSpacing: "0.02em",
          }}
        />

        {/* API key button */}
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
            color: keyIsSet ? "#d4a017" : "#444",
            fontSize: "10px",
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.05em",
          }}
          aria-label="Configure Gemini API key"
        >
          KEY
        </button>

        {/* Spinner or submit */}
        {loading ? (
          <div
            style={{
              width: "10px",
              height: "10px",
              border: "1px solid #333",
              borderTopColor: "#888",
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
              color: "#888",
              cursor: "pointer",
              padding: "2px",
              display: "flex",
              alignItems: "center",
              flexShrink: 0,
              fontSize: "14px",
              fontFamily: "var(--font-mono)",
            }}
            aria-label="Submit query"
          >
            ↵
          </button>
        ) : null}
      </div>

      {/* API key popover */}
      {keyPopoverOpen && (
        <div
          style={{
            marginTop: "1px",
            background: "#111",
            border: "1px solid #444",
            padding: "12px",
          }}
        >
          <p
            style={{
              margin: "0 0 8px",
              fontSize: "10px",
              color: "#666",
              lineHeight: 1.6,
              letterSpacing: "0.03em",
            }}
          >
            GEMINI API KEY — stored locally in your browser only
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
                background: "#0a0a0a",
                border: "1px solid #333",
                color: "#e0e0e0",
                fontSize: "11px",
                fontFamily: "var(--font-mono)",
                padding: "6px 8px",
                outline: "none",
              }}
            />
            <button
              onClick={saveKey}
              style={{
                background: "none",
                border: "1px solid #888",
                color: "#e0e0e0",
                cursor: "pointer",
                fontSize: "10px",
                padding: "6px 12px",
                fontFamily: "var(--font-mono)",
                letterSpacing: "0.08em",
              }}
            >
              SAVE
            </button>
            <button
              onClick={() => setKeyPopoverOpen(false)}
              style={{
                background: "none",
                border: "1px solid #333",
                color: "#555",
                cursor: "pointer",
                fontSize: "10px",
                padding: "6px 10px",
                fontFamily: "var(--font-mono)",
              }}
            >
              ×
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
                color: "#444",
                cursor: "pointer",
                fontSize: "10px",
                padding: 0,
                fontFamily: "var(--font-mono)",
                letterSpacing: "0.06em",
              }}
            >
              CLEAR SAVED KEY
            </button>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div
          style={{
            marginTop: "1px",
            fontSize: "10px",
            color: "#e5484d",
            background: "#111",
            border: "1px solid #333",
            borderLeft: "2px solid #e5484d",
            padding: "8px 12px",
            letterSpacing: "0.03em",
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
