-- Viewport-based well query RPCs
-- Run these in the Supabase SQL editor to create the RPC functions.
-- The client currently uses direct table queries (.from("wells").select(...))
-- which work without these RPCs. Install these if you want RPC-based access instead.

CREATE OR REPLACE FUNCTION get_wells_in_bounds(
  min_lat float8,
  max_lat float8,
  min_lng float8,
  max_lng float8
)
RETURNS SETOF wells
LANGUAGE sql
STABLE
AS $$
  SELECT *
  FROM wells
  WHERE latitude  BETWEEN min_lat AND max_lat
    AND longitude BETWEEN min_lng AND max_lng
  LIMIT 5000;
$$;

CREATE OR REPLACE FUNCTION get_groundwater_wells_in_bounds(
  min_lat float8,
  max_lat float8,
  min_lng float8,
  max_lng float8
)
RETURNS SETOF groundwater_wells
LANGUAGE sql
STABLE
AS $$
  SELECT *
  FROM groundwater_wells
  WHERE latitude  BETWEEN min_lat AND max_lat
    AND longitude BETWEEN min_lng AND max_lng
  LIMIT 5000;
$$;

-- Optional: add indexes on lat/lng if not already present
-- CREATE INDEX IF NOT EXISTS wells_lat_lng_idx ON wells (latitude, longitude);
-- CREATE INDEX IF NOT EXISTS groundwater_lat_lng_idx ON groundwater_wells (latitude, longitude);
