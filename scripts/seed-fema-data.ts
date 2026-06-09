import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load local environment variables
dotenv.config({ path: '.env.local' });

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing Supabase environment variables. Please check .env.local");
  process.exit(1);
}

// Initialize Supabase with the Service Role Key to bypass RLS during server-side ingestion
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// FEMA NFHL ArcGIS REST API Endpoint (Layer 28 is standard Flood Hazard Zones)
const FEMA_API_BASE = 'https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer/28/query';

async function ingestFEMAData(stateFipsCode: string) {
  console.log(`Starting FEMA ingestion for State FIPS: ${stateFipsCode}...`);
  
  let offset = 0;
  const batchSize = 1000;
  let hasMoreData = true;

  while (hasMoreData) {
    try {
      // Build the query: High-risk zones only (A and V), chunked by pagination
      const params = new URLSearchParams({
        where: `(FLD_ZONE LIKE 'A%' OR FLD_ZONE LIKE 'V%') AND STATE_FIPS = '${stateFipsCode}'`,
        outFields: 'DFIRM_ID,FLD_ZONE,STATE_FIPS',
        outSR: '4326', // Request standard WGS84 coordinates
        f: 'geojson',
        resultOffset: offset.toString(),
        resultRecordCount: batchSize.toString(),
      });

      console.log(`Fetching batch starting at offset ${offset}...`);
      const response = await fetch(`${FEMA_API_BASE}?${params.toString()}`);
      
      if (!response.ok) {
        throw new Error(`FEMA API responded with status: ${response.status}`);
      }

      const data = await response.json();

      if (!data.features || data.features.length === 0) {
        console.log('No more features found. State batch complete.');
        hasMoreData = false;
        break;
      }

      console.log(`Fetched ${data.features.length} polygons. Pushing to Supabase...`);

      // Push each polygon to the Supabase PostGIS receiver
      for (const feature of data.features) {
        // Using a composite ID in case DFIRM_IDs overlap across counties
        const zoneId = `${feature.properties.DFIRM_ID}_${offset}`; 
        
        const { error } = await supabase.rpc('ingest_fema_geojson', {
          p_zone_id: zoneId,
          p_zone_type: feature.properties.FLD_ZONE,
          p_state_fips: feature.properties.STATE_FIPS,
          p_geojson: feature.geometry
        });

        if (error) {
          console.error(`Error inserting ${zoneId}:`, error.message);
        }
      }

      offset += batchSize;
      
      // Quick breather to respect rate limits and avoid blocking
      await new Promise(resolve => setTimeout(resolve, 1000));

    } catch (err) {
      console.error('Fatal Pipeline Error:', err);
      hasMoreData = false;
    }
  }
  console.log('Ingestion pipeline successfully closed.');
}

// Execute the pipeline for Texas (FIPS code 48)
ingestFEMAData('48');
