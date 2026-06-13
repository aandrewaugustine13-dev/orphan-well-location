# Loading FEMA NFHL Flood Zones into `fema_flood_zones`

Runbook for ingesting a state's FEMA National Flood Hazard Layer (NFHL) flood
polygons into the `fema_flood_zones` PostGIS table in Supabase. Written from the
Oklahoma (FIPS 40) load; reuse it per state.

## Scripts

- **`upload_fema_zones.py`** — the reusable engine. `load_and_prepare()` does the
  heavy GIS work (read → filter → reproject → simplify → promote → PK-suffix) and
  performs **no DB writes**. Also defines the DB connection (`SUPABASE_URL`).
- **`load_oklahoma.py`** — the per-state orchestrator with the two phases
  (`prepare`, `load`) and the state-specific constants. Copy/adapt per state.

## Target schema (verified live, do not assume)

| column | type | notes |
|---|---|---|
| `zone_id` | `text` | **PRIMARY KEY, NOT NULL, no default** — must be populated |
| `zone_type` | `text` | nullable |
| `state_fips` | `text` | nullable |
| `geom` | `geometry(MultiPolygon, 4326)` | nullable |

Introspect it read-only via PostgREST without the DB password:
`curl "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/" -H "apikey: $SERVICE_KEY"` →
`definitions.fema_flood_zones` (its `required` array = NOT-NULL-without-default
columns).

### Field mapping
- `zone_id`  ← FEMA `FLD_AR_ID` (raw, no prefix)
- `zone_type` ← FEMA `FLD_ZONE`
- `state_fips` ← the FIPS string you pass in (e.g. `"40"`)
- `geom` ← the `S_FLD_HAZ_AR` geometry, reprojected + simplified

### High-risk zone filter
Only the 100-year floodplain zones are loaded (the rest are dropped to save space):
`A, AE, AH, AO, AR, A99, V, VE`.

---

## Two-phase workflow: `prepare` → `load`

These are split deliberately. The GIS work is memory-heavy and historically
crashed (OOM / shell crash); the DB write is light. Splitting means a crash in
`prepare` never touches the DB, and a crash in `load` can be retried from the
saved parquet **without** re-running the expensive prepare.

```
prepare:  .gdb ──(read+filter+reproject+simplify+PK-suffix)──▶ data/ok_prepared.parquet   [NO DB]
load:     data/ok_prepared.parquet ──(baseline gate → chunked append → Gate 5)──▶ Supabase
```

- **`prepare`** writes `data/<state>_prepared.parquet` (GeoParquet — preserves CRS
  and the `geom` column name). Requires `pyarrow`. No DB connection at all. Ends
  with a hard row-count gate (see `EXPECT_OK_ROWS`) and a geometry-validity check.
- **`load`** reads the parquet (no heavy GIS), runs a read-only connectivity test
  and baseline gate, appends in 500-row chunks (each chunk commits independently),
  then verifies (Gate 5).

### Run under tmux (survives a terminal/shell crash)

```bash
# one-time per machine: GeoParquet needs pyarrow
./fema_env/bin/pip install pyarrow

# PHASE 1 — prepare (heavy, no DB)
tmux new-session -d -s prep './fema_env/bin/python load_oklahoma.py prepare > prepare.log 2>&1'
tail -n 40 prepare.log    # re-run to watch; do NOT use `tail -f` via the `!` REPL prefix

# PHASE 2 — load (light read + DB write)
# `-L <socket>` forces a FRESH tmux server so it inherits SUPABASE_DB_PASSWORD
# from the current shell (a pre-existing tmux server may not have the env var).
tmux -L fema new-session -d -s load './fema_env/bin/python load_oklahoma.py load > load.log 2>&1'
tail -n 50 load.log
```

> tmux does **not** save you from the OOM killer — the kernel/`systemd-oomd` kills
> the process inside tmux too. tmux only protects against the *terminal/shell*
> dying. Memory safety comes from the batched read (below), not tmux.

---

## Per-state procedure

1. **Get the .gdb from FEMA MSC.** The statewide NFHL DB is at
   `https://msc.fema.gov/portal/advanceSearch` → State = `<state>` → download the
   **NFHL Database** (`NFHL_<FIPS>_<YYYYMMDD>.zip`). The date suffix changes per
   FEMA re-issue. **Note:** the bare
   `https://hazards.fema.gov/nfhlv2/output/State/<FIPS>_<date>.zip` pattern returns
   404 for direct scripted requests — download via the MSC search UI manually.
2. **Unzip into `data/`.** The result is a `.gdb` **directory** (not a file) —
   keep it whole. Confirm the layer exists:
   `pyogrio.list_layers(path)` should list `S_FLD_HAZ_AR` (matched
   case-insensitively by `_resolve_layer`).
3. **Set the per-state constants** in your orchestrator
   (copy `load_oklahoma.py` → `load_<state>.py`):
   - `GDB` = path to the `.gdb`
   - `FIPS` = the 2-digit FIPS string (Oklahoma = `"40"`, Texas = `"48"`)
   - `EXPECT_OK_ROWS` = the Gate-3 post-filter count for this state (see below)
   - `EXPECT_TX_48` / `EXPECT_TX_NULL` = baseline counts to protect (see Texas note)
4. **Gate 3 — dry inspection** (no DB). Call `load_and_prepare` and report:
   resolved layer, row count **before** and **after** the FLD_ZONE filter, source
   CRS → final EPSG:4326, geometry types, **null `FLD_AR_ID` count (must be 0)**,
   **duplicate `FLD_AR_ID` count**. Use the post-filter count as `EXPECT_OK_ROWS`.
   - Oklahoma observed: **76,190 → 18,398** after filter; source CRS `EPSG:4269`.
5. **`prepare`**, confirm the row-count gate passes and `Invalid geometries: 0`,
   then **`load`**.

---

## Connection configuration

- **Session pooler, port `5432`** — NOT the transaction pooler (`6543`). Session
  mode is the right IPv4 path for batch writes.
- **Region host:** `aws-0-us-west-2.pooler.supabase.com` for this project
  (`echnydvgehjkfsiyhnth`). The wrong region gives `FATAL: (ENOTFOUND) tenant/user
  ... not found`. Get the exact host from the Supabase dashboard → Connect.
- **Username:** `postgres.echnydvgehjkfsiyhnth` (the dotted pooler user).
- **Build the URL from discrete fields with `sqlalchemy.engine.URL.create()`** —
  never a URL string. String parsing truncated the username at the dot
  (`postgres.<ref>` → `postgres`, causing `password authentication failed for user
  "postgres"`) and could mangle a password containing special characters.
  `URL.create(username=..., password=..., host=..., port=..., database=...)` passes
  each field to psycopg2 as a separate kwarg, so no parsing applies.
- **Password:** read **only** from `os.environ['SUPABASE_DB_PASSWORD']`. Never
  inline it into a command, script, or URL string (process args and transcripts
  leak). Export it in the shell that launches the tmux `load` session.

---

## Memory safety (batched read)

The full statewide layer (~76k polygons, 40+ attribute columns, large multipart
geometries) does **not** fit comfortably on a 7 GB box that's already using ~5 GB.
`load_and_prepare` keeps peak memory bounded by:

1. **Read-time `where` filter** — drops the ~57k low-risk polygons at the OGR layer
   before they're ever materialized/reprojected.
2. **Column pruning** — reads only `FLD_ZONE`, `FLD_AR_ID` + geometry, not all 40+
   NFHL fields.
3. **Windowed read** — `pyogrio` `skip_features`/`max_features` in windows of
   `READ_BATCH = 2000`, with each window reprojected and **simplified immediately**
   so the large unsimplified geometries are never all resident at once. The loop is
   bounded by the raw feature count, which is correct under either pyogrio
   windowing semantics (filtered-stream or raw-layer); windows past the filtered
   end just return empty. Lower `READ_BATCH` if a box is tighter still.

The `EXPECT_OK_ROWS` assertion after concat turns any windowing gap/double-read
into a loud abort **before** the parquet is written.

---

## Geometry handling

- **Reproject** source (commonly NAD83 / `EPSG:4269`) → `EPSG:4326`.
- **Simplify** at tolerance `0.001` (~100 m) with `preserve_topology=True`,
  *before* upload, to shrink vertex counts.
- **Promote** any `Polygon` → `MultiPolygon` so the column dtype stays consistent
  with `geometry(MultiPolygon, 4326)`.
- **`ORGANIZE_POLYGONS = "ONLY_CCW"`** (a GDAL config option set via
  `pyogrio.set_gdal_config_options`). GDAL's default `organizePolygons()` does an
  O(n²) ring-nesting pass that is extremely slow on >100-part polygons.
  - `SKIP` avoids the pass but treats every ring as a top-level shell — **interior
    holes are not subtracted, inflating flood-zone area**. Bad for a flood map.
  - `ONLY_CCW` keeps the speed win **and** preserves holes, assuming interior rings
    are wound counter-clockwise (which FEMA NFHL follows). If the assumption is ever
    wrong, the prepare-phase invalid-geometry count surfaces it.
- **Invalid-geometry repair.** Simplification can produce a self-intersecting ring.
  `prepare`'s validity check reports the count; repair with `make_valid()` and then
  **coerce back to MultiPolygon-only** (drop any non-polygonal fragments a
  `GeometryCollection` may contain), re-verify `{MultiPolygon}` / 0 invalid / row
  count unchanged, and rewrite the parquet. Never load an invalid geometry into
  PostGIS. (Oklahoma had exactly 1: `zone_id 40099C_20921`, a ring
  self-intersection; `make_valid` fixed it with area unchanged.)

---

## PRIMARY KEY: `FLD_AR_ID` is not reliably unique

FEMA's `FLD_AR_ID` can tag **distinct** polygons with the same id (Oklahoma had 9
such ids across 24 rows — different geometries, sometimes different `FLD_ZONE`).
Since `zone_id` is the PK, `load_and_prepare` makes it unique generically:
within each `FLD_AR_ID` group the first occurrence keeps the raw id and subsequent
ones get an occurrence suffix (`_1`, `_2`, …); non-colliding ids are untouched.
This runs **after** the batched concat, on the full kept set, so cross-batch
collisions are also caught. Nothing is dropped or merged. A null `FLD_AR_ID` aborts
the prepare (it would otherwise become the string `"None"` and bypass the NOT NULL
PK).

---

## Known failure modes (all hit and resolved during the OK load)

| Symptom | Cause | Fix |
|---|---|---|
| `FATAL: (ENOTFOUND) tenant/user ... not found` | wrong pooler region (`us-east-1` placeholder) | use the project's real region (`us-west-2`) from the dashboard |
| `password authentication failed for user "postgres"` | URL-string parsing truncated the dotted username | build engine with `URL.create()` discrete fields |
| Process SIGKILL'd ~42 s into prepare | OOM (`systemd-oomd`, global pressure) reading the full layer | read-time `where` filter + column pruning + windowed read |
| PK unique violation on append | duplicate `FLD_AR_ID` within the file | occurrence-suffix dedup (post-concat) |
| `Invalid geometries: 1` after prepare | self-intersection from `simplify` | `make_valid` + MultiPolygon coercion, rewrite parquet |
| prepare died with no DB harm | fish shell crashed mid-reproject | the prepare/load split + tmux + GeoParquet checkpoint |

---

## Open items / gotchas

### Deferred: Texas re-tag (data debt)
The live table currently holds **61,355 rows**: only **68** tagged
`state_fips='48'`, and **61,287** with **`state_fips IS NULL`** — the NULL rows are
the Texas bulk load, never tagged. So "verify Texas unchanged" must check **both**
buckets (`48` = 68 AND `NULL` = 61,287), not just `state_fips='48'`. The NULL rows
should eventually be re-tagged to `'48'` (e.g. `UPDATE fema_flood_zones SET
state_fips='48' WHERE state_fips IS NULL` — a destructive write, run deliberately
with a backup, not part of this load). Until then, `EXPECT_TX_NULL` guards it.

### Idempotency gap (no auto-resume from a partial load)
- Each 500-row chunk commits independently, so a crash mid-`load` leaves the
  already-committed FIPS rows in the DB; the script reports how many landed.
- The baseline gate refuses to load if the target FIPS already has rows
  (`OK != 0`), so you **cannot** simply re-run `load` to resume — it will STOP.
- To retry after a partial load you must first remove the partial rows
  (`DELETE FROM fema_flood_zones WHERE state_fips='<FIPS>'`) — a destructive
  statement, deliberately **not** in the script. Then re-run `load` from the same
  parquet.
- `EXPECT_OK_ROWS` is hardcoded per state; update it (from Gate 3) for each new
  state or the prepare row-count gate will abort.

### Dependencies (in `fema_env`)
`geopandas`, `pyogrio`, `shapely`, `sqlalchemy`, `geoalchemy2`, `psycopg2-binary`,
`pyarrow`.
