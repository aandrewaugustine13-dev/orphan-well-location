#!/usr/bin/env python3
"""
Fix groundwater_wells table: rebuild geom for rows where it is NULL.

Uses concurrent HTTP requests for speed (~20-30 min for 180K rows).
Prefer running fix_groundwater_geom.sql in the Supabase SQL editor instead —
that's instant. Use this script only if you can't access the SQL editor.
"""

import json
import time
import urllib.request
import urllib.error
import urllib.parse
import sys
import os
from concurrent.futures import ThreadPoolExecutor, as_completed

SUPABASE_URL = "https://echnydvgehjkfsiyhnth.supabase.co"
SUPABASE_KEY = "sb_publishable_HZqnTHDFwTbcnvmFiSQzqQ_e9IemFS4"
TABLE = "groundwater_wells"
FETCH_BATCH = 1000   # rows fetched per page
PATCH_WORKERS = 20   # concurrent PATCH requests
MAX_RETRIES = 3


def base_headers():
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }


def count_fixable() -> int:
    """Count rows where geom IS NULL but lat/lng are valid."""
    url = (
        f"{SUPABASE_URL}/rest/v1/{TABLE}"
        "?geom=is.null&latitude=not.is.null&longitude=not.is.null&select=well_id"
    )
    req = urllib.request.Request(url, headers={**base_headers(), "Prefer": "count=exact"})
    req.add_header("Range-Unit", "items")
    req.add_header("Range", "0-0")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            cr = r.headers.get("content-range", "")
            if "/" in cr:
                return int(cr.split("/")[1])
    except urllib.error.HTTPError as e:
        print(f"Count error HTTP {e.code}: {e.read().decode(errors='replace')[:200]}", file=sys.stderr)
    return -1


def fetch_batch(offset: int, limit: int) -> list[dict]:
    url = (
        f"{SUPABASE_URL}/rest/v1/{TABLE}"
        f"?geom=is.null&latitude=not.is.null&longitude=not.is.null"
        f"&select=well_id,latitude,longitude"
        f"&limit={limit}&offset={offset}"
    )
    req = urllib.request.Request(url, headers=base_headers())
    for attempt in range(MAX_RETRIES):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read())
        except Exception as exc:
            if attempt == MAX_RETRIES - 1:
                print(f"Fetch error at offset {offset}: {exc}", file=sys.stderr)
                return []
            time.sleep(2 ** attempt)
    return []


def patch_row(row: dict) -> tuple[str, bool]:
    wid = row["well_id"]
    lat = row["latitude"]
    lng = row["longitude"]
    wkt = f"SRID=4326;POINT({lng} {lat})"
    url = f"{SUPABASE_URL}/rest/v1/{TABLE}?well_id=eq.{urllib.parse.quote(str(wid))}"
    data = json.dumps({"geom": wkt}).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="PATCH", headers=base_headers())
    for attempt in range(MAX_RETRIES):
        try:
            with urllib.request.urlopen(req, timeout=20) as _r:
                return wid, True
        except urllib.error.HTTPError as e:
            body = e.read().decode(errors="replace")
            if attempt == MAX_RETRIES - 1:
                print(f"Patch error {wid} HTTP {e.code}: {body[:100]}", file=sys.stderr)
                return wid, False
            time.sleep(2 ** attempt)
        except Exception as exc:
            if attempt == MAX_RETRIES - 1:
                print(f"Patch error {wid}: {exc}", file=sys.stderr)
                return wid, False
            time.sleep(2 ** attempt)
    return wid, False


# ── Main ─────────────────────────────────────────────────────────────────────

print("=" * 60)
print("GROUNDWATER_WELLS GEOM FIX")
print("=" * 60)
print()
print("NOTE: Running fix_groundwater_geom.sql in the Supabase SQL")
print("editor is much faster. Use this script as a fallback only.")
print()

total_fixable = count_fixable()
if total_fixable < 0:
    print("Could not determine row count. Proceeding anyway...", file=sys.stderr)
    total_fixable = 0
elif total_fixable == 0:
    print("No rows need fixing. Done.")
    sys.exit(0)
else:
    print(f"Rows to fix: {total_fixable:,}")

fixed = 0
errors = 0
offset = 0
start_time = time.time()

with ThreadPoolExecutor(max_workers=PATCH_WORKERS) as executor:
    while True:
        rows = fetch_batch(offset, FETCH_BATCH)
        if not rows:
            break

        futures = {executor.submit(patch_row, row): row for row in rows}
        for fut in as_completed(futures):
            _, ok = fut.result()
            if ok:
                fixed += 1
            else:
                errors += 1

        offset += len(rows)
        elapsed = time.time() - start_time
        rate = fixed / elapsed if elapsed > 0 else 0
        remaining = (total_fixable - fixed) / rate if rate > 0 else 0
        print(
            f"  Progress: {offset:,} fetched | {fixed:,} fixed | {errors} errors "
            f"| {rate:.0f} rows/s | ~{remaining/60:.1f} min remaining"
        )

        if len(rows) < FETCH_BATCH:
            break

print()
print(f"Done: {fixed:,} rows fixed, {errors} errors in {(time.time()-start_time)/60:.1f} min.")
