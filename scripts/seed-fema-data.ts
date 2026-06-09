import { createClient } from "@supabase/supabase-js";

// ── Environment Settings & Fallback Config ────────────────────────────────────
const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "https://echnydvgehjkfsiyhnth.supabase.co";

const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "sb_publishable_HZqnTHDFwTbcnvmFiSQzqQ_e9IemFS4";

// Max features to fetch (defaults to 2000 to remain within storage limits)
const LIMIT = parseInt(process.env.LIMIT || "2000", 10);

// Simplification tolerance in degrees (0.001 is ~100m, yielding high compression)
const SIMPLIFY_TOLERANCE = parseFloat(
  process.env.SIMPLIFY_TOLERANCE || "0.001"
);

// Number of features to query per request
const BATCH_SIZE = 100;

// FEMA NFHL ArcGIS MapServer Layer 28 (Flood Hazard Zones)
const FEMA_URL =
  "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query";

async function main() {
  console.log("============================================================");
  console.log("🚀 FEMA FLOOD HAZARD DATA INGESTION PIPELINE");
  console.log(`Supabase URL:        ${SUPABASE_URL}`);
  console.log(`Target Limit:        ${LIMIT} features`);
  console.log(`Simplification Tol:  ${SIMPLIFY_TOLERANCE} degrees`);
  console.log("============================================================");

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  let offset = 0;
  let totalImported = 0;
  let retryCount = 0;
  const maxRetries = 3;

  while (totalImported < LIMIT) {
    const fetchLimit = Math.min(BATCH_SIZE, LIMIT - totalImported);
    console.log(`[Fetch] Querying FEMA at offset ${offset} (size: ${fetchLimit})...`);

    // High-risk Zone A and Zone V filters (Special Flood Hazard Areas)
    const params = new URLSearchParams({
      where: "FLD_ZONE LIKE 'A%' OR FLD_ZONE LIKE 'V%'",
      outFields: "FLD_AR_ID,FLD_ZONE,ZONE_SUBTY",
      returnGeometry: "true",
      f: "geojson",
      outSR: "4326",
      resultRecordCount: fetchLimit.toString(),
      resultOffset: offset.toString(),
    });

    let res;
    try {
      res = await fetch(`${FEMA_URL}?${params}`);
      if (!res.ok) {
        throw new Error(`FEMA API returned status ${res.status}: ${res.statusText}`);
      }
    } catch (err: any) {
      console.error(`[Network Error] FEMA fetch failed: ${err.message}`);
      if (retryCount < maxRetries) {
        retryCount++;
        const backoff = Math.pow(2, retryCount) * 1000;
        console.log(`Retrying in ${backoff / 1000}s (attempt ${retryCount}/${maxRetries})...`);
        await new Promise((resolve) => setTimeout(resolve, backoff));
        continue;
      }
      console.error("Max retries exceeded. Exiting pipeline.");
      break;
    }

    // Reset retry count on successful fetch
    retryCount = 0;

    let geojson: any;
    try {
      geojson = await res.json();
    } catch (err: any) {
      console.error(`[Parse Error] Failed to parse response as JSON: ${err.message}`);
      break;
    }

    if (geojson.error) {
      console.error(`[API Error] FEMA returned an error: ${JSON.stringify(geojson.error)}`);
      break;
    }

    const features = geojson.features || [];
    if (features.length === 0) {
      console.log("[Info] No more features returned from FEMA endpoint.");
      break;
    }

    console.log(`[Database] Fetched ${features.length} features. Upserting to Supabase...`);

    try {
      // Call database function to handle simplification and batch upsert
      const { error } = await supabase.rpc("insert_fema_flood_zones_batch", {
        p_features: features,
        p_simplify_tolerance: SIMPLIFY_TOLERANCE,
      });

      if (error) {
        throw error;
      }

      totalImported += features.length;
      offset += features.length;
      console.log(`[Success] Batch complete. Total imported: ${totalImported} / ${LIMIT}`);
    } catch (err: any) {
      console.error(`[Database Error] Batch upsert failed: ${err.message}`);
      console.log("Ensure scripts/fema_setup.sql was executed in your Supabase SQL Editor first.");
      break;
    }

    // Prevent overwhelming the FEMA REST server (respectful scraping)
    await new Promise((resolve) => setTimeout(resolve, 800));
  }

  console.log("============================================================");
  console.log(`🎉 INGESTION PIPELINE DONE: Imported ${totalImported} features.`);
  console.log("============================================================");
}

main().catch((err) => {
  console.error("Fatal pipeline error:", err);
  process.exit(1);
});
