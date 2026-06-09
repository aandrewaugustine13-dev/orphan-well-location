-- ── FEMA Flood Zones table + RPC setup ──────────────────────────────────────────
-- Run this in the Supabase SQL Editor BEFORE running the seed script.

-- 1. Create the table
CREATE TABLE IF NOT EXISTS fema_flood_zones (
  fld_ar_id   text PRIMARY KEY,
  fld_zone    text NOT NULL,
  zone_subty  text,
  geom        geography(Geometry, 4326) NOT NULL
);

-- 2. Spatial index (critical for location queries)
CREATE INDEX IF NOT EXISTS fema_flood_zones_geom_idx ON fema_flood_zones USING GIST(geom);

-- 3. RPC to batch upsert simplified flood zones
CREATE OR REPLACE FUNCTION insert_fema_flood_zones_batch(
  p_features jsonb,
  p_simplify_tolerance float8
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  feat jsonb;
  v_fld_ar_id text;
  v_fld_zone text;
  v_zone_subty text;
  v_geom_str text;
BEGIN
  FOR feat IN SELECT * FROM jsonb_array_elements(p_features) LOOP
    v_fld_ar_id := feat->'properties'->>'FLD_AR_ID';
    v_fld_zone := feat->'properties'->>'FLD_ZONE';
    v_zone_subty := feat->'properties'->>'ZONE_SUBTY';
    v_geom_str := (feat->'geometry')::text;

    IF v_fld_ar_id IS NOT NULL AND v_geom_str IS NOT NULL THEN
      BEGIN
        INSERT INTO fema_flood_zones (fld_ar_id, fld_zone, zone_subty, geom)
        VALUES (
          v_fld_ar_id,
          v_fld_zone,
          v_zone_subty,
          ST_SimplifyPreserveTopology(
            ST_SetSRID(ST_GeomFromGeoJSON(v_geom_str), 4326),
            p_simplify_tolerance
          )::geography
        )
        ON CONFLICT (fld_ar_id) DO UPDATE
        SET fld_zone = EXCLUDED.fld_zone,
            zone_subty = EXCLUDED.zone_subty,
            geom = EXCLUDED.geom;
      EXCEPTION WHEN OTHERS THEN
        -- Skip invalid geometries gracefully
        RAISE NOTICE 'Skipping invalid geometry for FLD_AR_ID %: %', v_fld_ar_id, SQLERRM;
      END;
    END IF;
  END LOOP;
END;
$$;
