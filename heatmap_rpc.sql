-- PostGIS RPC: Calculate environmental liability risk intensity (1-10) entirely on the server.
-- Run this in your Supabase SQL Editor.

CREATE OR REPLACE FUNCTION get_risk_heatmap_data(
  min_lng float8,
  min_lat float8,
  max_lng float8,
  max_lat float8
)
RETURNS TABLE (
  longitude float8,
  latitude float8,
  intensity float8
)
LANGUAGE sql STABLE AS $$
  SELECT 
    w.longitude,
    w.latitude,
    LEAST(10.0, 
      2.0 + 
      -- 1. Intersects with FEMA flood zones
      CASE WHEN EXISTS (
        SELECT 1 
        FROM fema_flood_zones f 
        WHERE ST_Intersects(w.geom::geometry, f.geom::geometry)
      ) THEN 3.0 ELSE 0.0 END +
      -- 2. Proximity to groundwater wells (using fast spheroidal math via ST_DWithin and GIST indexes)
      COALESCE(
        (
          SELECT 
            CASE 
              WHEN min_dist <= 45 THEN 5.0    -- Within 45m (150ft)
              WHEN min_dist <= 150 THEN 3.0   -- Within 150m (500ft)
              ELSE 1.0                        -- Within 402m (1/4 mile)
            END
          FROM (
            SELECT ST_Distance(w.geom, gw.geom, false) AS min_dist
            FROM groundwater_wells gw
            WHERE ST_DWithin(w.geom, gw.geom, 402, false)
            ORDER BY w.geom <-> gw.geom
            LIMIT 1
          ) sub
        ),
        0.0
      )
    ) AS intensity
  FROM orphan_wells w
  WHERE w.latitude BETWEEN min_lat AND max_lat
    AND w.longitude BETWEEN min_lng AND max_lng
  LIMIT 5000;
$$;
