"""Gated Oklahoma (FIPS 40) FEMA flood-zone load, split into two phases.

Reads the DB password ONLY from os.environ['SUPABASE_DB_PASSWORD'] (never
inlined). Two independently-retryable phases:

    ./fema_env/bin/python load_oklahoma.py prepare   # heavy, NO DB
    ./fema_env/bin/python load_oklahoma.py load      # light read + DB write

PREPARE: runs load_and_prepare once (read + reproject + simplify + promote +
  PK-suffix) and writes the result to data/ok_prepared.parquet (GeoParquet).
  No DB connection — a crash here cannot touch the database.

LOAD: reads the parquet (no heavy geo work), runs the read-only connectivity
  test + Texas baseline gate, then the chunked append + Gate 5. Safe to retry
  from the saved parquet without re-running PREPARE.
"""
import os
import sys
import geopandas as gpd
from sqlalchemy import create_engine, text

import upload_fema_zones as u

GDB = "data/NFHL_40_20260512.gdb"
PARQUET = "data/ok_prepared.parquet"
FIPS = "40"
CHUNK = 500

# Gate-3-verified post-filter row count for Oklahoma. The batched/windowed read
# relies on pyogrio skip/max semantics; this hard check turns any windowing
# gap or double-read into a loud abort BEFORE the parquet is written.
EXPECT_OK_ROWS = 18398

EXPECT_TX_48 = 68
EXPECT_TX_NULL = 61287


def counts(conn):
    q = lambda w: conn.execute(
        text(f"select count(*) from fema_flood_zones where {w}")).scalar()
    return {
        "total": conn.execute(text("select count(*) from fema_flood_zones")).scalar(),
        "40": q("state_fips='40'"),
        "48": q("state_fips='48'"),
        "null": q("state_fips is null"),
    }


def prepare():
    print("== PREPARE phase (no DB writes, no DB connection) ==")
    gdf = u.load_and_prepare(GDB, FIPS)

    # Hard windowing-correctness gate: the batched read MUST yield exactly the
    # Gate-3 post-filter count. Abort before writing the parquet if it doesn't.
    if len(gdf) != EXPECT_OK_ROWS:
        raise SystemExit(
            f"ABORT: prepared row count {len(gdf)} != expected {EXPECT_OK_ROWS}. "
            "Windowed read may have dropped or duplicated rows — NOT writing parquet."
        )
    print(f"Row-count gate OK: {len(gdf)} == expected {EXPECT_OK_ROWS}.")

    # Confirm geometry survived SKIP + simplify as valid MultiPolygon.
    types = sorted(gdf.geom_type.unique())
    n_invalid = int((~gdf.geometry.is_valid).sum())
    n_empty = int(gdf.geometry.is_empty.sum())
    print(f"Rows prepared       : {len(gdf)}")
    print(f"Geometry types      : {types}")
    print(f"Invalid geometries  : {n_invalid}")
    print(f"Empty geometries    : {n_empty}")
    if types != ["MultiPolygon"]:
        print("WARN: not all geometries are MultiPolygon — review before loading!")
    if n_invalid:
        print("WARN: invalid geometries present — review before loading!")

    gdf.to_parquet(PARQUET)  # GeoParquet (CRS + geom column name preserved)
    print(f"Wrote {len(gdf)} rows -> {PARQUET}")
    print("PREPARE done. Run the 'load' phase next.")


def load():
    if not u.DB_PASSWORD:
        print("STOP: SUPABASE_DB_PASSWORD not set in this environment.")
        sys.exit(2)
    if not os.path.exists(PARQUET):
        print(f"STOP: {PARQUET} not found. Run the 'prepare' phase first.")
        sys.exit(2)

    print(f"== LOAD phase: reading {PARQUET} ==")
    gdf = gpd.read_parquet(PARQUET)
    total = len(gdf)
    print(f"Read {total} prepared rows. geom col='{gdf.geometry.name}', "
          f"crs={gdf.crs.to_string()}, types={sorted(gdf.geom_type.unique())}")

    eng = create_engine(u.SUPABASE_URL)

    # --- read-only connectivity test + baseline gate ---
    print("\n== Connectivity test (read-only) via us-west-2 session pooler ==")
    with eng.connect() as c:
        print("Auth OK:", c.execute(text("select version()")).scalar().split(" on ")[0])
        base = counts(c)
    print(f"Baseline -> total={base['total']}  OK(40)={base['40']}  "
          f"TX(48)={base['48']}  TX(NULL)={base['null']}")
    if not (base["48"] == EXPECT_TX_48 and base["null"] == EXPECT_TX_NULL):
        print(f"STOP: Texas baseline differs from expected "
              f"(48={EXPECT_TX_48}, NULL={EXPECT_TX_NULL}). Not loading.")
        sys.exit(3)
    if base["40"] != 0:
        print(f"STOP: OK already has {base['40']} rows; expected 0. Not loading.")
        sys.exit(3)
    print("Baseline OK (TX 68/61287, OK 0).\n")

    # --- Gate 4: chunked append (each chunk commits independently) ---
    print(f"== Gate 4: appending {total} rows in chunks of {CHUNK} ==")
    n_chunks = (total + CHUNK - 1) // CHUNK
    uploaded = 0
    try:
        for start in range(0, total, CHUNK):
            chunk = gdf.iloc[start:start + CHUNK]
            chunk.to_postgis(
                name="fema_flood_zones", con=eng, if_exists="append",
                index=False, dtype={"geom": "Geometry(MultiPolygon, 4326)"},
            )
            uploaded += len(chunk)
            print(f"  chunk {start // CHUNK + 1:>3}/{n_chunks}  "
                  f"+{len(chunk):>3}  (uploaded {uploaded}/{total})", flush=True)
    except Exception as e:
        with eng.connect() as c:
            landed = c.execute(text(
                "select count(*) from fema_flood_zones where state_fips='40'")).scalar()
        print(f"\nERROR during append: {type(e).__name__}: {str(e).splitlines()[0]}")
        print(f"STOP. FIPS-40 rows that actually landed in the DB: {landed}")
        sys.exit(4)
    print(f"Gate 4 done: appended {uploaded} FIPS-40 rows.\n")

    # --- Gate 5: verify ---
    print("== Gate 5: verification ==")
    with eng.connect() as c:
        after = counts(c)
    print(f"OK(40)  : {after['40']}   (expected {total})")
    print(f"TX(48)  : {after['48']}   (baseline {EXPECT_TX_48}, "
          f"{'UNCHANGED' if after['48']==EXPECT_TX_48 else 'CHANGED!'})")
    print(f"TX(NULL): {after['null']}   (baseline {EXPECT_TX_NULL}, "
          f"{'UNCHANGED' if after['null']==EXPECT_TX_NULL else 'CHANGED!'})")
    print(f"total   : {after['total']}   (baseline {base['total']} + {total} "
          f"= {base['total']+total})")
    ok = (after["40"] == total and after["48"] == EXPECT_TX_48
          and after["null"] == EXPECT_TX_NULL
          and after["total"] == base["total"] + total)
    print("\nALL CHECKS PASS" if ok else "\nMISMATCH — review above")


if __name__ == "__main__":
    phase = sys.argv[1] if len(sys.argv) > 1 else ""
    if phase == "prepare":
        prepare()
    elif phase == "load":
        load()
    else:
        print("Usage: python load_oklahoma.py [prepare|load]")
        sys.exit(1)
