import fs from 'fs';
import path from 'path';
// @ts-ignore
import csv from 'csv-parser';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

// Load local environment variables
dotenv.config({ path: '.env.local' });

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing Supabase environment variables. Please check .env.local");
  process.exit(1);
}

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function seedFrackingData() {
  const csvFilePath = path.join(process.cwd(), 'data', 'rrc_active_wells.csv');
  console.log(`Starting fracking data ingestion pipeline...`);
  console.log(`Target CSV Path: ${csvFilePath}`);

  if (!fs.existsSync(csvFilePath)) {
    console.log(`\n[Info] Local CSV file not found at: ${csvFilePath}`);
    console.log(`Skipping seeding execution until the file is added. The pipeline script is fully prepared.`);
    process.exit(0);
  }

  let batch: any[] = [];
  const BATCH_SIZE = 500;
  let processedCount = 0;

  async function insertBatch(records: any[]) {
    processedCount += records.length;
    
    // Bulk insert with ON CONFLICT DO NOTHING (ignore duplicates)
    const { error } = await supabase
      .from('fracking_sites')
      .upsert(records, {
        onConflict: 'api_number',
        ignoreDuplicates: true
      });

    if (error) {
      console.error(`Error inserting batch:`, error.message);
      throw error;
    } else {
      console.log(`Processed ${processedCount} rows...`);
    }
  }

  const stream = fs.createReadStream(csvFilePath).pipe(csv());

  stream.on('data', (row: any) => {
    // Map coordinates
    const lat = parseFloat(row.Lat || row.lat || row.Latitude || row.latitude);
    const lng = parseFloat(row.Lng || row.lng || row.Longitude || row.longitude);
    const api = row.API || row.api || row.ApiNumber || row.api_number;
    const operator = row.Operator || row.operator || row.OperatorName || row.operator_name;
    const wellType = row.WellType || row.well_type || row.Well_Type;

    // Guard clause: skip invalid rows
    if (isNaN(lat) || isNaN(lng) || !api) {
      return;
    }

    const formattedRow = {
      api_number: api.toString().trim(),
      operator_name: operator ? operator.toString().trim() : null,
      well_type: wellType ? wellType.toString().trim() : null,
      geom: {
        type: 'Point',
        coordinates: [lng, lat]
      }
    };

    batch.push(formattedRow);

    if (batch.length >= BATCH_SIZE) {
      // Pause stream to await database insertion
      stream.pause();

      const currentBatch = [...batch];
      batch = [];

      insertBatch(currentBatch)
        .then(() => {
          stream.resume();
        })
        .catch((err) => {
          console.error("Batch insertion failed. Resuming stream to log remaining errors:", err);
          stream.resume();
        });
    }
  });

  stream.on('error', (err: any) => {
    console.error("Stream encountered an error during parsing:", err);
    process.exit(1);
  });

  stream.on('end', async () => {
    try {
      if (batch.length > 0) {
        console.log(`Inserting final batch of ${batch.length} records...`);
        await insertBatch(batch);
        batch = [];
      }
      console.log(`\nIngestion pipeline complete.`);
      console.log(`Successfully processed a total of ${processedCount} active fracking sites.`);
      process.exit(0);
    } catch (err) {
      console.error("Error during final batch processing:", err);
      process.exit(1);
    }
  });
}

// Execute seed script
seedFrackingData();
