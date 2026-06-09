-- ── FEMA Flood Zones table + RPC setup ──────────────────────────────────────────
-- Run this in the Supabase SQL Editor BEFORE running the seed script.

-- 1. Create the table
CREATE TABLE IF NOT EXISTS fema_flood_zones (
  zone_id     text PRIMARY KEY,
  zone_type   text NOT NULL,
  state_fips  text,
  geom        geography(Geometry, 4326) NOT NULL
);

-- 2. Spatial index (critical for location queries)
CREATE INDEX IF NOT EXISTS fema_flood_zones_geom_idx ON fema_flood_zones USING GIST(geom);

-- 3. RPC to ingest a single simplified GeoJSON polygon/multipolygon
CREATE OR REPLACE FUNCTION ingest_fema_geojson(
  p_zone_id text,
  p_zone_type text,
  p_state_fips text,
  p_geojson jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER -- Executes with database owner privileges
AS $$
BEGIN
  INSERT INTO fema_flood_zones (zone_id, zone_type, state_fips, geom)
  VALUES (
    p_zone_id,
    p_zone_type,
    p_state_fips,
    ST_SimplifyPreserveTopology(
      ST_SetSRID(ST_GeomFromGeoJSON(p_geojson::text), 4326),
      0.001 -- default simplification tolerance (approx 100m) to keep DB storage optimized
    )::geography
  )
  ON CONFLICT (zone_id) DO UPDATE
  SET zone_type = EXCLUDED.zone_type,
      state_fips = EXCLUDED.state_fips,
      geom = EXCLUDED.geom;
END;
$$;
