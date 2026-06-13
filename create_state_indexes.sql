-- Btree indexes for the viewport queries' .in('state', ...) filters.
-- Without these, a multi-state filter over a wide viewport scans the full
-- table and can hit the statement timeout, which PostgREST surfaces to the
-- frontend as a 500. Run in the Supabase SQL Editor.
--
-- Note: get_risk_heatmap_data needs no changes — it works as deployed once the
-- frontend passes full state names ("Texas") matching what the scrapers stored.

CREATE INDEX IF NOT EXISTS idx_orphan_wells_state ON orphan_wells (state);
CREATE INDEX IF NOT EXISTS idx_groundwater_wells_state ON groundwater_wells (state);
CREATE INDEX IF NOT EXISTS idx_epa_sites_state ON epa_sites (state);
