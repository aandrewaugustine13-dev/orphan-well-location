-- ── FEMA Flood Zones table + Generic Ingestion RPC setup ───────────────────────
-- Run this in the Supabase SQL Editor to set up the table and generic function.

-- 1. Create the table
CREATE TABLE IF NOT EXISTS fema_flood_zones (
  zone_id     text PRIMARY KEY,
  zone_type   text NOT NULL,
  state_fips  text,
  geom        geography(Geometry, 4326) NOT NULL
);

-- 2. Spatial index (critical for location queries)
CREATE INDEX IF NOT EXISTS fema_flood_zones_geom_idx ON fema_flood_zones USING GIST(geom);

-- 3. Generic RPC to ingest a simplified GeoJSON geometry into any PostGIS table
CREATE OR REPLACE FUNCTION ingest_geometry_geojson(
  p_table_name text,
  p_id_column text,
  p_id_value text,
  p_type_column text,
  p_type_value text,
  p_geojson jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER -- Runs with creator privileges to bypass RLS
AS $$
BEGIN
  EXECUTE format(
    'INSERT INTO %I (%I, %I, geom) ' ||
    'VALUES ($1, $2, ST_SimplifyPreserveTopology(ST_SetSRID(ST_GeomFromGeoJSON($3), 4326), 0.001)::geography) ' ||
    'ON CONFLICT (%I) DO UPDATE ' ||
    'SET %I = EXCLUDED.%I, geom = EXCLUDED.geom',
    p_table_name, p_id_column, p_type_column,
    p_id_column,
    p_type_column, p_type_column
  )
  USING p_id_value, p_type_value, p_geojson::text;
END;
$$;
