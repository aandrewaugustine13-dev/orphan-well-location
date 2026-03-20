#!/usr/bin/env python3
"""
Full Tennessee well pipeline:
  1. Fetch abandoned oil & gas wells from TDEC Oil_and_Gas2 MapServer
  2. Fetch groundwater/water wells from TDEC WLTS_Well_Locations_PUBLIC FeatureServer
  3. Clean + transform to Supabase schema
  4. Batch-upsert directly into Supabase (ON CONFLICT DO NOTHING)
  5. Print geom backfill SQL (requires service role for raw SQL)

Sources
-------
  Orphan wells   : TDEC Oil and Gas MapServer Layer 0
                   https://tdeconline.tn.gov/arcgis/rest/services/Oil_and_Gas2/MapServer/0
                   Filter: PURPOSE_OF_WELL LIKE '%Abandoned%'   ~10,372 wells

  Groundwater    : TDEC WLTS Well Locations FeatureServer Layer 0
                   https://tdeconline.tn.gov/arcgis/rest/services/WLTS_Well_Locations_PUBLIC/FeatureServer/0
                   Filter: LATITUDE_DD IS NOT NULL               ~174,406 wells
"""

import csv
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime

# ── Config ────────────────────────────────────────────────────────────────────

SUPABASE_URL = "https://echnydvgehjkfsiyhnth.supabase.co"
SUPABASE_KEY = "sb_publishable_HZqnTHDFwTbcnvmFiSQzqQ_e9IemFS4"
BATCH_SIZE   = 200
RETRY_LIMIT  = 3
SCRIPT_DIR   = os.path.dirname(os.path.abspath(__file__))

TDEC_OG_URL  = "https://tdeconline.tn.gov/arcgis/rest/services/Oil_and_Gas2/MapServer/0/query"
TDEC_GW_URL  = "https://tdeconline.tn.gov/arcgis/rest/services/WLTS_Well_Locations_PUBLIC/FeatureServer/0/query"

TDEC_HEADERS = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
    "Referer":    "https://tdeconline.tn.gov/",
}

# Tennessee bounding box
TN_LAT = (34.98, 36.68)
TN_LON = (-90.31, -81.65)

NOW = datetime.utcnow()

# ── Shared helpers ────────────────────────────────────────────────────────────

def http_get(url: str, timeout: int = 90) -> dict:
    req = urllib.request.Request(url, headers=TDEC_HEADERS)
    return json.loads(urllib.request.urlopen(req, timeout=timeout).read())


def arcgis_query(base: str, params: dict) -> dict:
    url = base + "?" + urllib.parse.urlencode(params)
    return http_get(url)


def parse_ms_date(val) -> str:
    if val is None:
        return ""
    try:
        return datetime.utcfromtimestamp(int(val) / 1000).strftime("%Y-%m-%d")
    except Exception:
        return ""


def year_from_ms(val) -> int | str:
    if val is None:
        return ""
    try:
        yr = datetime.utcfromtimestamp(int(val) / 1000).year
        return yr if 1800 <= yr <= NOW.year else ""
    except Exception:
        return ""


def clean_county(raw: str) -> str:
    if not raw:
        return ""
    s = raw.strip().title()
    if s.endswith(" County"):
        s = s[:-7].strip()
    return s


def in_tn(lat, lon) -> bool:
    try:
        return TN_LAT[0] <= float(lat) <= TN_LAT[1] and TN_LON[0] <= float(lon) <= TN_LON[1]
    except Exception:
        return False


# ── TDEC Oil & Gas abandoned wells ───────────────────────────────────────────

OG_FIELDS = "API_NO,PERMIT_NO,OPERATOR_NAME,WELL_NAME_AND_NO,COUNTY,LATITUDE,LONGITUDE,PERMIT_DATE,FORMATION_AT_TOTAL_DEPTH,PURPOSE_OF_WELL"
OG_PAGE   = 17000   # max allowed; fits all ~10k abandoned wells in one shot


def fetch_og_page(offset: int) -> dict:
    return arcgis_query(TDEC_OG_URL, {
        "where":             "PURPOSE_OF_WELL LIKE '%Abandoned%'",
        "outFields":         OG_FIELDS,
        "outSR":             "4326",
        "returnGeometry":    "true",
        "resultOffset":      str(offset),
        "resultRecordCount": str(OG_PAGE),
        "f":                 "json",
    })


def fetch_all_og() -> list[dict]:
    wells  = []
    offset = 0
    print("Fetching TDEC abandoned oil & gas wells...")

    while True:
        try:
            page = fetch_og_page(offset)
        except Exception as exc:
            print(f"  ERROR at offset {offset}: {exc}", file=sys.stderr)
            break

        if "error" in page:
            print(f"  API error: {page['error']}", file=sys.stderr)
            break

        features = page.get("features") or []
        if not features:
            break

        for feat in features:
            a    = feat.get("attributes") or {}
            geom = feat.get("geometry")   or {}

            lat = a.get("LATITUDE") or geom.get("y")
            lon = a.get("LONGITUDE") or geom.get("x")
            if not lat or not lon:
                continue
            lat, lon = float(lat), float(lon)
            if not in_tn(lat, lon):
                continue

            raw_api = str(a.get("API_NO") or "").strip()
            permit  = str(a.get("PERMIT_NO") or "").strip()
            api_number = raw_api or (f"TN-PERMIT-{permit}" if permit else "")
            if not api_number:
                continue

            purpose   = str(a.get("PURPOSE_OF_WELL") or "").strip()
            permit_dt = parse_ms_date(a.get("PERMIT_DATE"))

            # Rough months_inactive from permit date to today
            months_inactive = ""
            if permit_dt:
                try:
                    pd = datetime.strptime(permit_dt, "%Y-%m-%d")
                    m  = (NOW.year - pd.year) * 12 + (NOW.month - pd.month)
                    months_inactive = str(max(m, 0)) if m >= 0 else ""
                except Exception:
                    pass

            wells.append({
                "api_number":     api_number,
                "well_name":      str(a.get("WELL_NAME_AND_NO") or "").strip(),
                "latitude":       round(lat, 6),
                "longitude":      round(lon, 6),
                "state":          "Tennessee",
                "county":         clean_county(str(a.get("COUNTY") or "")),
                "operator_name":  str(a.get("OPERATOR_NAME") or "").strip(),
                "well_type":      "",
                "well_status":    purpose,
                "spud_date":      permit_dt,
                "months_inactive": months_inactive,
                "liability_est":  "",
                "field_name":     str(a.get("FORMATION_AT_TOTAL_DEPTH") or "").strip(),
                "lease_name":     "",
                "district":       "",
            })

        fetched = len(features)
        print(f"  offset={offset:>6}  page={fetched:>5}  total={len(wells):>6}")
        exceeded = page.get("exceededTransferLimit", False)
        if not exceeded and fetched < OG_PAGE:
            break
        offset += OG_PAGE
        time.sleep(0.3)

    # Deduplicate on api_number
    seen: set[str] = set()
    deduped = []
    for w in wells:
        if w["api_number"] not in seen:
            seen.add(w["api_number"])
            deduped.append(w)

    print(f"TDEC O&G: {len(wells)} fetched, {len(deduped)} after dedup.")
    return deduped


# ── TDEC WLTS groundwater / water well fetch ─────────────────────────────────

GW_FIELDS = (
    "OBJECTID,WELL_NUMBR,LATITUDE_DD,LONGITUDE_DD,"
    "CMPLTN_TOTAL_DEPTH,CMPLTN_ESTIMATED_YIELD,CMPLTN_STATIC_LEVEL,"
    "WELL_USE,COUNTY_NAME,CMPLTN_DATE,WORK_TYPE,FINISH_TYPE"
)
GW_PAGE  = 10000
GW_WHERE = "LATITUDE_DD IS NOT NULL AND LONGITUDE_DD IS NOT NULL"


def fetch_gw_page(last_oid: int) -> dict:
    where = f"{GW_WHERE} AND OBJECTID > {last_oid}"
    return arcgis_query(TDEC_GW_URL, {
        "where":             where,
        "outFields":         GW_FIELDS,
        "returnGeometry":    "false",
        "orderByFields":     "OBJECTID ASC",
        "resultRecordCount": str(GW_PAGE),
        "f":                 "json",
    })


def fetch_all_gw() -> list[dict]:
    wells    = []
    last_oid = 0
    page_num = 0
    print("\nFetching TDEC WLTS groundwater wells...")

    while True:
        try:
            page = fetch_gw_page(last_oid)
        except Exception as exc:
            print(f"  ERROR at OID>{last_oid}: {exc}", file=sys.stderr)
            break

        if "error" in page:
            print(f"  API error: {page['error']}", file=sys.stderr)
            break

        features = page.get("features") or []
        if not features:
            break

        for feat in features:
            a = feat.get("attributes") or {}

            lat = a.get("LATITUDE_DD")
            lon = a.get("LONGITUDE_DD")
            if lat is None or lon is None:
                continue
            lat, lon = float(lat), float(lon)
            # Longitude stored positive in some records — fix it
            if lon > 0:
                lon = -lon
            if not in_tn(lat, lon):
                continue

            well_num = str(a.get("WELL_NUMBR") or "").strip()
            oid      = a.get("OBJECTID")
            well_id  = f"TN-{well_num}" if well_num else f"TN-OID-{oid}"

            depth    = a.get("CMPLTN_TOTAL_DEPTH")
            yield_   = a.get("CMPLTN_ESTIMATED_YIELD")
            yr       = year_from_ms(a.get("CMPLTN_DATE"))

            work_type = str(a.get("WORK_TYPE") or "").strip()
            status    = "Active" if work_type in ("New Well", "Deepening", "Recondition") else (work_type or "Unknown")

            wells.append({
                "well_id":           well_id,
                "latitude":          round(lat, 6),
                "longitude":         round(lon, 6),
                "state":             "Tennessee",
                "county":            clean_county(str(a.get("COUNTY_NAME") or "")),
                "well_depth_ft":     round(float(depth), 1) if depth is not None else "",
                "well_capacity_gpm": round(float(yield_), 2) if yield_ is not None else "",
                "water_use":         str(a.get("WELL_USE") or "").strip() or "Groundwater",
                "status":            status,
                "year_constructed":  yr,
            })

            last_oid = max(last_oid, int(oid or 0))

        page_num += 1
        print(f"  page={page_num:>3}  fetched={len(features):>5}  total={len(wells):>7}  last_oid={last_oid}")
        exceeded = page.get("exceededTransferLimit", False)
        if not exceeded and len(features) < GW_PAGE:
            break
        time.sleep(0.25)

    print(f"TDEC WLTS: {len(wells)} groundwater wells fetched.")
    return wells


# ── Supabase upsert ───────────────────────────────────────────────────────────

def coerce(row: dict, numeric_cols: set) -> dict:
    out = {}
    for k, v in row.items():
        if isinstance(v, (int, float)):
            out[k] = v
        else:
            s = str(v).strip()
            if not s or s.lower() == "null":
                out[k] = None
            elif k in numeric_cols:
                try:
                    out[k] = float(s) if "." in s else int(s)
                except ValueError:
                    out[k] = None
            else:
                out[k] = s
    return out


def upsert_batch(table: str, conflict_col: str, rows: list[dict]) -> tuple[int, str | None]:
    url     = f"{SUPABASE_URL}/rest/v1/{table}?on_conflict={conflict_col}"
    payload = json.dumps(rows).encode("utf-8")
    req     = urllib.request.Request(url, data=payload, method="POST", headers={
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
    return 0, "unknown"


def import_rows(rows: list[dict], table: str, conflict_col: str, numeric_cols: set) -> None:
    total    = len(rows)
    inserted = 0
    errors   = 0
    print(f"\n{'─'*60}")
    print(f"Table : {table}  ({total:,} rows)")
    print(f"{'─'*60}")

    for start in range(0, total, BATCH_SIZE):
        batch_raw = rows[start : start + BATCH_SIZE]
        batch     = [coerce(r, numeric_cols) for r in batch_raw]
        status, err = upsert_batch(table, conflict_col, batch)
        end = min(start + BATCH_SIZE, total)

        if status in (200, 201):
            inserted += len(batch)
            print(f"  [{end:>8}/{total}]  ✓")
        else:
            errors += len(batch)
            print(f"  [{end:>8}/{total}]  ✗ HTTP {status}: {(err or '')[:120]}", file=sys.stderr)

        time.sleep(0.12)

    print(f"Done — {inserted:,} sent, {errors:,} errors.")


# ── Main ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":

    ORPHAN_NUMERIC = {"latitude", "longitude", "months_inactive", "liability_est"}
    GW_NUMERIC     = {"latitude", "longitude", "well_depth_ft", "well_capacity_gpm", "year_constructed"}

    # ── 1. Fetch + save orphan wells
    orphan_wells = fetch_all_og()
    orphan_csv   = os.path.join(SCRIPT_DIR, "tn_orphan_wells.csv")
    orphan_fields = [
        "api_number","well_name","latitude","longitude","state","county",
        "operator_name","well_type","well_status","spud_date","months_inactive",
        "liability_est","field_name","lease_name","district",
    ]
    with open(orphan_csv, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=orphan_fields, extrasaction="ignore")
        w.writeheader(); w.writerows(orphan_wells)
    print(f"Saved {len(orphan_wells):,} rows → {orphan_csv}")

    # ── 2. Fetch + save groundwater wells
    gw_wells   = fetch_all_gw()
    gw_csv     = os.path.join(SCRIPT_DIR, "tn_groundwater_wells.csv")
    gw_fields  = [
        "well_id","latitude","longitude","state","county",
        "well_depth_ft","well_capacity_gpm","water_use","status","year_constructed",
    ]
    with open(gw_csv, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=gw_fields, extrasaction="ignore")
        w.writeheader(); w.writerows(gw_wells)
    print(f"Saved {len(gw_wells):,} rows → {gw_csv}")

    # ── 3. Import orphan wells
    import_rows(orphan_wells, "orphan_wells",    "api_number", ORPHAN_NUMERIC)

    # ── 4. Import groundwater wells
    import_rows(gw_wells,     "groundwater_wells", "well_id",  GW_NUMERIC)

    # ── 5. Geom backfill (needs service role; print for manual run)
    print("\nRun in Supabase SQL editor to backfill geom:")
    print("  UPDATE orphan_wells SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326) WHERE state = 'Tennessee' AND geom IS NULL;")
    print("  UPDATE groundwater_wells SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326) WHERE state = 'Tennessee' AND geom IS NULL;")

    print("\n✓ Tennessee pipeline complete.")
