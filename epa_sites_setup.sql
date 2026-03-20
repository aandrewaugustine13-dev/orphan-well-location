-- ── EPA Sites table + RPC setup ───────────────────────────────────────────────
-- Run this in the Supabase SQL editor BEFORE running fetch_epa_sites.py

-- 1. Create table
CREATE TABLE IF NOT EXISTS epa_sites (
  site_id            text PRIMARY KEY,
  site_name          text,
  latitude           float8,
  longitude          float8,
  state              text,
  county             text,
  city               text,
  site_type          text,   -- 'Superfund', 'Brownfield', 'TRI'
  status             text,
  contamination_type text,
  federal_facility   boolean,
  npl_status         text,
  geom               geography
);

-- 2. Spatial index (critical for radius queries)
CREATE INDEX IF NOT EXISTS epa_sites_geom_idx   ON epa_sites USING GIST(geom);
CREATE INDEX IF NOT EXISTS epa_sites_state_idx  ON epa_sites(state);
CREATE INDEX IF NOT EXISTS epa_sites_type_idx   ON epa_sites(site_type);

-- 3. Build geom after import (run this AFTER fetch_epa_sites.py finishes)
-- UPDATE epa_sites
-- SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography
-- WHERE geom IS NULL
--   AND latitude IS NOT NULL
--   AND longitude IS NOT NULL;

-- 4. RPC: get EPA sites within a radius
CREATE OR REPLACE FUNCTION get_epa_sites_in_radius(
  user_lng      float8,
  user_lat      float8,
  radius_meters float8
)
RETURNS TABLE (
  site_id            text,
  site_name          text,
  latitude           float8,
  longitude          float8,
  state              text,
  county             text,
  city               text,
  site_type          text,
  status             text,
  contamination_type text,
  federal_facility   boolean,
  npl_status         text,
  distance_meters    float8
)
LANGUAGE sql STABLE AS $$
  SELECT
    e.site_id,
    e.site_name,
    e.latitude,
    e.longitude,
    e.state,
    e.county,
    e.city,
    e.site_type,
    e.status,
    e.contamination_type,
    e.federal_facility,
    e.npl_status,
    ST_Distance(
      e.geom,
      ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography
    ) AS distance_meters
  FROM epa_sites e
  WHERE ST_DWithin(
    e.geom,
    ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography,
    radius_meters
  )
  ORDER BY distance_meters
  LIMIT 500;
$$;

-- 5. Verify
SELECT site_type, COUNT(*) FROM epa_sites GROUP BY site_type ORDER BY COUNT(*) DESC;
