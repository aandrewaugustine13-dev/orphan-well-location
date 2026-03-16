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
}

export type ColorMode = "proximity" | "age";

export function getWellAge(well: Well): number | null {
  if (!well.spud_date) return null;
  const spud = new Date(well.spud_date);
  if (isNaN(spud.getTime())) return null;
  const now = new Date();
  return Math.floor((now.getTime() - spud.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
}

export function getWellYear(well: Well): string {
  if (!well.spud_date) return "Unknown";
  const d = new Date(well.spud_date);
  if (isNaN(d.getTime())) return "Unknown";
  return d.getFullYear().toString();
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

export function getAgeColor(well: Well): string {
  const age = getWellAge(well);
  if (age === null) return "#505c72"; // unknown = dim
  if (age >= 50) return "#e5484d";    // 50+ years = red
  if (age >= 30) return "#f0a000";    // 30-50 = amber
  return "#30a46c";                    // under 30 = green
}

export function getWellColor(well: Well, mode: ColorMode): string {
  return mode === "age" ? getAgeColor(well) : getProximityColor(well.miles_away);
}

export function getAgeRadius(well: Well, isSelected: boolean): number {
  if (isSelected) return 10;
  const age = getWellAge(well);
  if (age === null) return 4;
  if (age >= 50) return 8;
  if (age >= 30) return 6;
  return 5;
}
