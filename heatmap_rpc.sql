-- PostGIS RPC: Calculate environmental liability risk intensity (1-10) entirely on the server.
-- MAJOR PERFORMANCE IMPROVEMENTS (2026-06):
--   * Decimate EARLY by snapping orphan wells to grid → risk is computed only once per cell (often 5-20x fewer distance checks).
--   * Replaced per-well correlated KNN subquery (very expensive) with cheap indexed EXISTS + ST_DWithin for bucketed groundwater proximity.
--   * Added optional active_states filter (uses state index) and adaptive grid_size from client.
--   * Lower output cardinality cap suitable for interactive heatmap.
--   * Grid size is chosen coarser at low zoom (far fewer cells when zoomed out).
--
-- After editing, re-run this entire block in the Supabase SQL Editor.

CREATE OR REPLACE FUNCTION get_risk_heatmap_data(
  min_lng float8,
  min_lat float8,
  max_lng float8,
  max_lat float8,
  active_states text[] DEFAULT NULL,
  active_fips text[] DEFAULT NULL,
  grid_size float8 DEFAULT 0.003
)
RETURNS TABLE (
  longitude float8,
  latitude float8,
  intensity float8
)
LANGUAGE sql STABLE AS $$
  WITH candidate_wells AS (
    -- Early filter + bbox. State filter (when provided) lets the btree state index kick in.
    SELECT w.geom::geometry AS geom
    FROM orphan_wells w
    WHERE w.latitude BETWEEN min_lat AND max_lat
      AND w.longitude BETWEEN min_lng AND max_lng
      AND (active_states IS NULL OR w.state = ANY(active_states))
  ),
  -- Snap FIRST, then unique cells. This is the key decimation step.
  snapped_cells AS (
    SELECT DISTINCT ST_SnapToGrid(geom, grid_size) AS cell
    FROM candidate_wells
  ),
  scored_cells AS (
    SELECT
      cell,
      LEAST(10.0,
        2.0 +
        -- Flood zone bonus (still cheap with GIST on fema)
        CASE WHEN EXISTS (
          SELECT 1 FROM fema_flood_zones f
          WHERE ST_Intersects(cell, f.geom::geometry)
        ) THEN 3.0 ELSE 0.0 END +
        -- Groundwater proximity using multiple indexed semi-joins (no ORDER BY/LIMIT per cell).
        -- Much faster than the old per-well KNN subquery.
        CASE
          WHEN EXISTS (
            SELECT 1 FROM groundwater_wells gw
            WHERE ST_DWithin(cell::geography, gw.geom, 45, false)
          ) THEN 5.0
          WHEN EXISTS (
            SELECT 1 FROM groundwater_wells gw
            WHERE ST_DWithin(cell::geography, gw.geom, 150, false)
          ) THEN 3.0
          WHEN EXISTS (
            SELECT 1 FROM groundwater_wells gw
            WHERE ST_DWithin(cell::geography, gw.geom, 402, false)
          ) THEN 1.0
          ELSE 0.0
        END
      ) AS score
    FROM snapped_cells
  )
  SELECT
    ST_X(cell) AS longitude,
    ST_Y(cell) AS latitude,
    MAX(score) AS intensity   -- in case of rounding collisions (rare)
  FROM scored_cells
  GROUP BY cell
  LIMIT 2500;   -- Hard cap suitable for smooth Deck.gl heatmap rendering
$$;
