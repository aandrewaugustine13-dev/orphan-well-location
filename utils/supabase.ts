import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ??
  "";

export const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;

export interface Well {
  well_name?: string;
  api_number: string;
  latitude: number;
  longitude: number;
  miles_away?: number;
  spud_date?: string | null;
  liability_est?: number | null;
  operator_name?: string;
  well_status?: string;
  well_type?: string;
  county?: string;
  state?: string;
  field_name?: string;
  lease_name?: string;
  months_inactive?: number | null;
  district?: string;
}

export type ColorMode = "proximity" | "age";

// Wells in these states with no date are assumed pre-1950 (predating modern
// well construction standards and documentation requirements).
const APPALACHIAN_STATES = new Set([
  "West Virginia", "Pennsylvania", "Ohio", "Kentucky",
]);

export function getWellAgeYears(well: Well): number | null {
  if (!well.spud_date) {
    // Appalachian wells with no date are assumed very old (pre-1950 → ~75+ yr)
    if (well.state && APPALACHIAN_STATES.has(well.state)) return 100;
    return null;
  }
  const spud = new Date(well.spud_date);
  if (isNaN(spud.getTime())) return null;
  const years = (Date.now() - spud.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
  return Math.round(years * 10) / 10;
}

export function isAgeEstimated(well: Well): boolean {
  return !well.spud_date && !!well.state && APPALACHIAN_STATES.has(well.state);
}

export function formatWellAge(well: Well): string {
  if (isAgeEstimated(well)) return "est. pre-1950";
  const years = getWellAgeYears(well);
  if (years == null) return "Unknown";
  if (years < 1) return "<1 yr";
  return `${years.toFixed(1)} yr`;
}

export function formatLiability(est: number | null | undefined): string {
  if (est == null) return "N/A";
  if (est >= 1_000_000) return `$${(est / 1_000_000).toFixed(1)}M`;
  if (est >= 1_000) return `$${(est / 1_000).toFixed(0)}K`;
  return `$${est.toLocaleString()}`;
}

// Color helpers
export function getProximityColor(miles: number): string {
  if (miles <= 1) return "#ef4444";  // Red
  if (miles <= 5) return "#f97316";  // Orange
  return "#facc15";                  // Yellow
}

export function getWellAgeColor(well: Well): string {
  const years = getWellAgeYears(well);
  if (years == null) return "#f8fafc";  // Age Unknown: White / Slate
  if (years >= 20) return "#ef4444";   // 20+ Years Old: Red
  if (years >= 10) return "#f97316";   // 10 - 20 Years Old: Orange
  return "#facc15";                     // < 10 Years Old: Yellow
}

export function getWellColor(well: Well, mode: ColorMode): string {
  if (mode === "age" || well.miles_away == null) {
    return getWellAgeColor(well);
  }
  return getProximityColor(well.miles_away);
}

export function getWellAgeRadius(well: Well, isSelected: boolean): number {
  if (isSelected) return 10;
  const years = getWellAgeYears(well);
  if (years == null) return 4;
  if (years >= 20) return 8;
  if (years >= 10) return 6;
  return 5;
}

export const STATE_FIPS: Record<string, { name: string; fips: string }> = {
  AL: { name: "ALABAMA", fips: "01" }, AK: { name: "ALASKA", fips: "02" }, AZ: { name: "ARIZONA", fips: "04" }, AR: { name: "ARKANSAS", fips: "05" }, CA: { name: "CALIFORNIA", fips: "06" }, CO: { name: "COLORADO", fips: "08" }, CT: { name: "CONNECTICUT", fips: "09" }, DE: { name: "DELAWARE", fips: "10" }, FL: { name: "FLORIDA", fips: "12" }, GA: { name: "GEORGIA", fips: "13" }, HI: { name: "HAWAII", fips: "15" }, ID: { name: "IDAHO", fips: "16" }, IL: { name: "ILLINOIS", fips: "17" }, IN: { name: "INDIANA", fips: "18" }, IA: { name: "IOWA", fips: "19" }, KS: { name: "KANSAS", fips: "20" }, KY: { name: "KENTUCKY", fips: "21" }, LA: { name: "LOUISIANA", fips: "22" }, ME: { name: "MAINE", fips: "23" }, MD: { name: "MARYLAND", fips: "24" }, MA: { name: "MASSACHUSETTS", fips: "25" }, MI: { name: "MICHIGAN", fips: "26" }, MN: { name: "MINNESOTA", fips: "27" }, MS: { name: "MISSISSIPPI", fips: "28" }, MO: { name: "MISSOURI", fips: "29" }, MT: { name: "MONTANA", fips: "30" }, NE: { name: "NEBRASKA", fips: "31" }, NV: { name: "NEVADA", fips: "32" }, NH: { name: "NEW HAMPSHIRE", fips: "33" }, NJ: { name: "NEW JERSEY", fips: "34" }, NM: { name: "NEW MEXICO", fips: "35" }, NY: { name: "NEW YORK", fips: "36" }, NC: { name: "NORTH CAROLINA", fips: "37" }, ND: { name: "NORTH DAKOTA", fips: "38" }, OH: { name: "OHIO", fips: "39" }, OK: { name: "OKLAHOMA", fips: "40" }, OR: { name: "OREGON", fips: "41" }, PA: { name: "PENNSYLVANIA", fips: "42" }, RI: { name: "RHODE ISLAND", fips: "44" }, SC: { name: "SOUTH CAROLINA", fips: "45" }, SD: { name: "SOUTH DAKOTA", fips: "46" }, TN: { name: "TENNESSEE", fips: "47" }, TX: { name: "TEXAS", fips: "48" }, UT: { name: "UTAH", fips: "49" }, VT: { name: "VERMONT", fips: "50" }, VA: { name: "VIRGINIA", fips: "51" }, WA: { name: "WASHINGTON", fips: "53" }, WV: { name: "WEST VIRGINIA", fips: "54" }, WI: { name: "WISCONSIN", fips: "55" }, WY: { name: "WYOMING", fips: "56" }
};

// The scrapers stored `state` as Title Case full names ("Texas", "New Mexico"),
// while the UI tracks regions by 2-letter code. Translate at the query boundary,
// keeping the abbreviation too so rows ingested either way still match.
export function regionsToDbStates(regions: string[]): string[] {
  return regions.flatMap((abbr) => {
    const entry = STATE_FIPS[abbr];
    if (!entry) return [abbr];
    const fullName = entry.name
      .toLowerCase()
      .replace(/(^|\s)[a-z]/g, (c) => c.toUpperCase());
    return [abbr, fullName];
  });
}
