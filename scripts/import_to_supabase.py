#!/usr/bin/env python3
"""
Batch-upsert WV well CSVs into Supabase via REST API.
Uses ON CONFLICT DO NOTHING (ignore-duplicates) so existing rows are skipped.
"""

import csv
import json
import sys
import time
import urllib.request
import urllib.error
import os

SUPABASE_URL = "https://echnydvgehjkfsiyhnth.supabase.co"
SUPABASE_KEY = "sb_publishable_HZqnTHDFwTbcnvmFiSQzqQ_e9IemFS4"
BATCH_SIZE   = 200   # rows per request — safe under Supabase's 1 MB body limit
RETRY_LIMIT  = 3

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))


def coerce(row: dict, numeric_cols: set[str], date_cols: set[str]) -> dict:
    out = {}
    for k, v in row.items():
        v = v.strip()
        if not v or v.lower() == "null":
            out[k] = None
        elif k in numeric_cols:
            try:
                out[k] = float(v) if "." in v else int(v)
            except ValueError:
                out[k] = None
        else:
            out[k] = v
    return out


def upsert_batch(table: str, conflict_col: str, rows: list[dict]) -> tuple[int, str | None]:
    url = f"{SUPABASE_URL}/rest/v1/{table}?on_conflict={conflict_col}"
    payload = json.dumps(rows).encode("utf-8")
    req = urllib.request.Request(url, data=payload, method="POST", headers={
        "apikey":        SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type":  "application/json",
        "Prefer":        "resolution=ignore-duplicates,return=minimal",
    })
    for attempt in range(1, RETRY_LIMIT + 1):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.status, None
        except urllib.error.HTTPError as e:
            body = e.read().decode(errors="replace")
            if attempt == RETRY_LIMIT:
                return e.code, body
            time.sleep(2 ** attempt)
        except Exception as exc:
            if attempt == RETRY_LIMIT:
                return 0, str(exc)
            time.sleep(2 ** attempt)
    return 0, "unknown error"


def import_csv(csv_path: str, table: str, conflict_col: str,
               numeric_cols: set[str], date_cols: set[str]) -> None:
    rows = list(csv.DictReader(open(csv_path, encoding="utf-8")))
    total = len(rows)
    print(f"\n{'─'*60}")
    print(f"Table : {table}")
    print(f"File  : {os.path.basename(csv_path)}")
    print(f"Rows  : {total:,}")
    print(f"{'─'*60}")

    inserted = 0
    errors   = 0

    for start in range(0, total, BATCH_SIZE):
        batch_raw  = rows[start : start + BATCH_SIZE]
        batch      = [coerce(r, numeric_cols, date_cols) for r in batch_raw]
        status, err = upsert_batch(table, conflict_col, batch)
        end = min(start + BATCH_SIZE, total)

        if status in (200, 201):
            inserted += len(batch)
            print(f"  [{end:>6}/{total}]  ✓ batch ok")
        else:
            errors += len(batch)
            print(f"  [{end:>6}/{total}]  ✗ HTTP {status}: {err[:120]}", file=sys.stderr)

        time.sleep(0.15)   # stay well under rate limits

    print(f"\nDone — {inserted:,} rows sent, {errors:,} errors.")


# ── Run ───────────────────────────────────────────────────────────────────────

ORPHAN_NUMERIC = {
    "latitude", "longitude", "months_inactive", "liability_est",
}
GW_NUMERIC = {
    "latitude", "longitude", "well_depth_ft", "well_capacity_gpm", "year_constructed",
}

import_csv(
    csv_path      = os.path.join(SCRIPT_DIR, "wv_orphan_wells.csv"),
    table         = "orphan_wells",
    conflict_col  = "api_number",
    numeric_cols  = ORPHAN_NUMERIC,
    date_cols     = set(),
)

import_csv(
    csv_path      = os.path.join(SCRIPT_DIR, "wv_groundwater_wells.csv"),
    table         = "groundwater_wells",
    conflict_col  = "well_id",
    numeric_cols  = GW_NUMERIC,
    date_cols     = set(),
)

print("\nAll done. Remember to backfill geom columns if needed:")
print("  UPDATE orphan_wells SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326) WHERE state='West Virginia' AND geom IS NULL;")
print("  UPDATE groundwater_wells SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326) WHERE state='West Virginia' AND geom IS NULL;")
