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

export function getWellAgeYears(well: Well): number | null {
  if (!well.spud_date) return null;
  const spud = new Date(well.spud_date);
  if (isNaN(spud.getTime())) return null;
  const years = (Date.now() - spud.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
  return Math.round(years * 10) / 10;
}

export function formatWellAge(well: Well): string {
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
  if (miles <= 1) return "#e5484d";
  if (miles <= 5) return "#f0a000";
  return "#30a46c";
}

export function getWellAgeColor(well: Well): string {
  const years = getWellAgeYears(well);
  if (years == null) return "#505c72";  // gray - no spud date
  if (years >= 20) return "#e5484d";   // red - over 20 years
  if (years >= 10) return "#f0a000";   // yellow - 10–20 years
  return "#30a46c";                     // green - under 10 years
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
