import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;

export interface Well {
  well_name?: string;
  api_number: string;
  latitude: number;
  longitude: number;
  miles_away: number;
  spud_date?: string | null;
  liability_est?: number | null;
  operator_name?: string;
  well_status?: string;
  well_type?: string;
  county?: string;
  field_name?: string;
  lease_name?: string;
  months_inactive?: number | null;
  district?: string;
}

export type ColorMode = "proximity" | "inactivity";

export function getInactivityYears(well: Well): number | null {
  if (well.months_inactive == null) return null;
  return Math.round((well.months_inactive / 12) * 10) / 10;
}

export function formatInactivity(well: Well): string {
  if (well.months_inactive == null) return "Unknown";
  const years = well.months_inactive / 12;
  if (years >= 1) return `${years.toFixed(1)} yr`;
  return `${well.months_inactive} mo`;
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

export function getInactivityColor(well: Well): string {
  const months = well.months_inactive;
  if (months == null) return "#505c72";
  if (months >= 120) return "#e5484d";  // 10+ years abandoned = red
  if (months >= 60) return "#f0a000";   // 5-10 years = amber
  return "#30a46c";                      // under 5 years = green
}

export function getWellColor(well: Well, mode: ColorMode): string {
  return mode === "inactivity"
    ? getInactivityColor(well)
    : getProximityColor(well.miles_away);
}

export function getInactivityRadius(well: Well, isSelected: boolean): number {
  if (isSelected) return 10;
  const months = well.months_inactive;
  if (months == null) return 4;
  if (months >= 120) return 8;
  if (months >= 60) return 6;
  return 5;
}
