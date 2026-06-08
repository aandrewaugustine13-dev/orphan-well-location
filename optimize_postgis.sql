-- Up migration: PostGIS Performance Indexing and Function Optimizations
-- Copy and run this in your Supabase SQL Editor.

-- 1. Create B-Tree composite indices for viewport box queries
CREATE INDEX IF NOT EXISTS orphan_wells_lat_lng_idx ON orphan_wells (latitude, longitude);
CREATE INDEX IF NOT EXISTS groundwater_wells_lat_lng_idx ON groundwater_wells (latitude, longitude);

-- 2. Create spatial indices for geography radius queries
CREATE INDEX IF NOT EXISTS orphan_wells_geom_idx ON orphan_wells USING GIST (geom);
CREATE INDEX IF NOT EXISTS groundwater_wells_geom_idx ON groundwater_wells USING GIST (geom);

-- 3. Optimized RPC for orphan wells (uses fast sphere math & KNN index order)
CREATE OR REPLACE FUNCTION get_wells_in_radius(
  user_lng float8,
  user_lat float8,
  radius_meters float8
)
RETURNS TABLE (
  api_number text,
  well_name text,
  latitude float8,
  longitude float8,
  state text,
  county text,
  operator_name text,
  well_type text,
  well_status text,
  spud_date text,
  months_inactive float8,
  liability_est float8,
  miles_away float8
)
LANGUAGE sql STABLE AS $$
  SELECT
    w.api_number,
    w.well_name,
    w.latitude,
    w.longitude,
    w.state,
    w.county,
    w.operator_name,
    w.well_type,
    w.well_status,
    w.spud_date::text,
    w.months_inactive,
    w.liability_est,
    (ST_Distance(
      w.geom,
      ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography,
      false -- use_spheroid = false (uses sphere math, ~2-5x faster than spheroid math)
    ) / 1609.34) AS miles_away
  FROM orphan_wells w
  WHERE ST_DWithin(
    w.geom,
    ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography,
    radius_meters,
    false -- use_spheroid = false
  )
  ORDER BY w.geom <-> ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography
  LIMIT 500;
$$;

-- 4. Optimized RPC for groundwater wells (uses fast sphere math & KNN index order)
CREATE OR REPLACE FUNCTION get_groundwater_wells_in_radius(
  user_lng float8,
  user_lat float8,
  radius_meters float8
)
RETURNS TABLE (
  well_id text,
  latitude float8,
  longitude float8,
  state text,
  county text,
  well_depth_ft float8,
  well_capacity_gpm float8,
  water_use text,
  status text,
  year_constructed int4,
  distance_meters float8
)
LANGUAGE sql STABLE AS $$
  SELECT
    g.well_id,
    g.latitude,
    g.longitude,
    g.state,
    g.county,
    g.well_depth_ft,
    g.well_capacity_gpm,
    g.water_use,
    g.status,
    g.year_constructed,
    ST_Distance(
      g.geom,
      ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography,
      false -- use_spheroid = false
    ) AS distance_meters
  FROM groundwater_wells g
  WHERE ST_DWithin(
    g.geom,
    ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography,
    radius_meters,
    false -- use_spheroid = false
  )
  ORDER BY g.geom <-> ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography
  LIMIT 500;
$$;
