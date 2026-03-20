-- Fix groundwater_wells table: rebuild geom for rows where it is NULL
-- Run this in the Supabase SQL editor (Dashboard > SQL Editor)

-- Step 1: Check how many rows need fixing
SELECT
  COUNT(*) AS total_rows,
  COUNT(*) FILTER (WHERE geom IS NULL) AS null_geom,
  COUNT(*) FILTER (WHERE geom IS NULL AND latitude IS NOT NULL AND longitude IS NOT NULL) AS fixable,
  COUNT(*) FILTER (WHERE latitude IS NULL OR longitude IS NULL) AS missing_coords
FROM groundwater_wells;

-- Step 2: Rebuild geom for all rows that have valid coordinates but no geom
UPDATE groundwater_wells
SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
WHERE geom IS NULL
  AND latitude IS NOT NULL
  AND longitude IS NOT NULL
  AND latitude BETWEEN -90 AND 90
  AND longitude BETWEEN -180 AND 180;

-- Step 3: Verify the fix
SELECT
  COUNT(*) AS total_rows,
  COUNT(*) FILTER (WHERE geom IS NULL) AS null_geom_remaining,
  COUNT(*) FILTER (WHERE geom IS NOT NULL) AS rows_with_geom
FROM groundwater_wells;

-- Step 4 (optional): Rebuild the spatial index to ensure performance
-- REINDEX INDEX groundwater_wells_geom_idx;
