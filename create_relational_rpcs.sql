-- Bounding-box optimized relational PostGIS RPCs
-- Run this in your Supabase SQL Editor.

-- 1. Get Groundwater Wells near a reference layer
CREATE OR REPLACE FUNCTION get_groundwater_wells_near_layer(
  radius_meters float8,
  reference_layer text,
  user_lat float8,
  user_lng float8
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
LANGUAGE plpgsql STABLE AS $$
DECLARE
  center_geom geography;
  bbox box2d;
  delta_lat float8;
  delta_lng float8;
BEGIN
  center_geom := ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography;
  
  -- Calculate bounding box envelope to avoid full table scan (&&)
  delta_lat := radius_meters / 111139.0;
  delta_lng := radius_meters / (111139.0 * cos(radians(LEAST(GREATEST(user_lat, -85.0), 85.0))));
  bbox := ST_MakeEnvelope(
    user_lng - delta_lng,
    user_lat - delta_lat,
    user_lng + delta_lng,
    user_lat + delta_lat,
    4326
  )::box2d;

  IF reference_layer = 'orphan_wells' THEN
    RETURN QUERY
    SELECT DISTINCT ON (g.well_id)
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
      ST_Distance(g.geom, center_geom) AS distance_meters
    FROM groundwater_wells g
    JOIN orphan_wells r ON ST_DWithin(g.geom, r.geom, radius_meters)
    WHERE g.geom::geometry && bbox
      AND ST_DWithin(g.geom, center_geom, radius_meters)
    ORDER BY g.well_id, distance_meters;
  ELSIF reference_layer = 'epa_sites' THEN
    RETURN QUERY
    SELECT DISTINCT ON (g.well_id)
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
      ST_Distance(g.geom, center_geom) AS distance_meters
    FROM groundwater_wells g
    JOIN epa_sites r ON ST_DWithin(g.geom, r.geom, radius_meters)
    WHERE g.geom::geometry && bbox
      AND ST_DWithin(g.geom, center_geom, radius_meters)
    ORDER BY g.well_id, distance_meters;
  ELSE
    RAISE EXCEPTION 'Unsupported reference layer for groundwater_wells';
  END IF;
END;
$$;

-- 2. Get Wells near a reference layer
CREATE OR REPLACE FUNCTION get_wells_near_layer(
  radius_meters float8,
  reference_layer text,
  user_lat float8,
  user_lng float8
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
LANGUAGE plpgsql STABLE AS $$
DECLARE
  center_geom geography;
  bbox box2d;
  delta_lat float8;
  delta_lng float8;
BEGIN
  center_geom := ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography;
  delta_lat := radius_meters / 111139.0;
  delta_lng := radius_meters / (111139.0 * cos(radians(LEAST(GREATEST(user_lat, -85.0), 85.0))));
  bbox := ST_MakeEnvelope(
    user_lng - delta_lng,
    user_lat - delta_lat,
    user_lng + delta_lng,
    user_lat + delta_lat,
    4326
  )::box2d;

  IF reference_layer = 'groundwater_wells' THEN
    RETURN QUERY
    SELECT DISTINCT ON (w.api_number)
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
      (ST_Distance(w.geom, center_geom) / 1609.34) AS miles_away
    FROM orphan_wells w
    JOIN groundwater_wells r ON ST_DWithin(w.geom, r.geom, radius_meters)
    WHERE w.geom::geometry && bbox
      AND ST_DWithin(w.geom, center_geom, radius_meters)
    ORDER BY w.api_number, miles_away;
  ELSIF reference_layer = 'epa_sites' THEN
    RETURN QUERY
    SELECT DISTINCT ON (w.api_number)
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
      (ST_Distance(w.geom, center_geom) / 1609.34) AS miles_away
    FROM orphan_wells w
    JOIN epa_sites r ON ST_DWithin(w.geom, r.geom, radius_meters)
    WHERE w.geom::geometry && bbox
      AND ST_DWithin(w.geom, center_geom, radius_meters)
    ORDER BY w.api_number, miles_away;
  ELSE
    RAISE EXCEPTION 'Unsupported reference layer for orphan_wells';
  END IF;
END;
$$;

-- 3. Get EPA Sites near a reference layer
CREATE OR REPLACE FUNCTION get_epa_sites_near_layer(
  radius_meters float8,
  reference_layer text,
  user_lat float8,
  user_lng float8
)
RETURNS TABLE (
  site_id text,
  site_name text,
  latitude float8,
  longitude float8,
  state text,
  county text,
  city text,
  site_type text,
  status text,
  contamination_type text,
  federal_facility boolean,
  npl_status text,
  distance_meters float8
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  center_geom geography;
  bbox box2d;
  delta_lat float8;
  delta_lng float8;
BEGIN
  center_geom := ST_SetSRID(ST_MakePoint(user_lng, user_lat), 4326)::geography;
  delta_lat := radius_meters / 111139.0;
  delta_lng := radius_meters / (111139.0 * cos(radians(LEAST(GREATEST(user_lat, -85.0), 85.0))));
  bbox := ST_MakeEnvelope(
    user_lng - delta_lng,
    user_lat - delta_lat,
    user_lng + delta_lng,
    user_lat + delta_lat,
    4326
  )::box2d;

  IF reference_layer = 'orphan_wells' THEN
    RETURN QUERY
    SELECT DISTINCT ON (e.site_id)
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
      ST_Distance(e.geom, center_geom) AS distance_meters
    FROM epa_sites e
    JOIN orphan_wells r ON ST_DWithin(e.geom, r.geom, radius_meters)
    WHERE e.geom::geometry && bbox
      AND ST_DWithin(e.geom, center_geom, radius_meters)
    ORDER BY e.site_id, distance_meters;
  ELSIF reference_layer = 'groundwater_wells' THEN
    RETURN QUERY
    SELECT DISTINCT ON (e.site_id)
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
      ST_Distance(e.geom, center_geom) AS distance_meters
    FROM epa_sites e
    JOIN groundwater_wells r ON ST_DWithin(e.geom, r.geom, radius_meters)
    WHERE e.geom::geometry && bbox
      AND ST_DWithin(e.geom, center_geom, radius_meters)
    ORDER BY e.site_id, distance_meters;
  ELSE
    RAISE EXCEPTION 'Unsupported reference layer for epa_sites';
  END IF;
END;
$$;
