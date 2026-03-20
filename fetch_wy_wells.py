#!/usr/bin/env python3
"""
Full Wyoming well pipeline:
  1. Fetch PA/TA orphan wells from WyGISC/WOGCC ArcGIS REST service
  2. Fetch domestic/municipal groundwater wells from WSGS Groundwater Atlas
  3. Clean + transform to match Supabase schema
  4. Batch-upsert directly into Supabase (ON CONFLICT DO NOTHING)
  5. Backfill geom column via Supabase SQL endpoint

Sources
-------
  Orphan wells   : WyGISC WOGCC Active Wells MapServer Layer 0
                   https://services.wygisc.org/hostgis/rest/services/GeoHub/WOGCCActiveWells/MapServer/0
                   Filter: STATUS IN ('PA','TA')   ~6,164 wells

  Groundwater    : WSGS Groundwater Atlas MapServer Layer 0
                   https://portal.wsgs.wyo.gov/ags/rest/services/Groundwater/Groundwater_Atlas/MapServer/0
                   Filter: domestic/municipal wells with valid coordinates   ~79,270 wells
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

WOGCC_URL = (
    "https://services.wygisc.org/hostgis/rest/services"
    "/GeoHub/WOGCCActiveWells/MapServer/0/query"
)
WSGS_GW_URL = (
    "https://portal.wsgs.wyo.gov/ags/rest/services"
    "/Groundwater/Groundwater_Atlas/MapServer/0/query"
)

# Wyoming county FIPS (odd numbers 1-45) → name
WY_COUNTY = {
     1: "Albany",     3: "Big Horn",   5: "Campbell",   7: "Carbon",
     9: "Converse",  11: "Crook",     13: "Fremont",   15: "Goshen",
    17: "Hot Springs",19: "Johnson",  21: "Laramie",   23: "Lincoln",
    25: "Natrona",   27: "Niobrara",  29: "Park",      31: "Platte",
    33: "Sheridan",  35: "Sublette",  37: "Sweetwater",39: "Teton",
    41: "Uinta",     43: "Washakie",  45: "Weston",
}

# WOGCC well class codes → readable type
WELL_CLASS_MAP = {
    "O": "Oil", "G": "Gas", "D": "Disposal", "I": "Injection",
    "M": "Monitor", "W": "Water", "S": "Service", "C": "Coal Bed Methane",
    "NA": "Unknown",
}

STATUS_MAP = {
    "PA": "Permanently Abandoned",
    "TA": "Temporarily Abandoned",
}

NOW = datetime.utcnow()

# ── Shared HTTP helper ────────────────────────────────────────────────────────

def http_get(url: str, timeout: int = 60) -> bytes:
    req = urllib.request.Request(
        url, headers={"User-Agent": "OrphanWellLocator/1.0"}
    )
    return urllib.request.urlopen(req, timeout=timeout).read()


def arcgis_query(base_url: str, params: dict, timeout: int = 60) -> dict:
    url = base_url + "?" + urllib.parse.urlencode(params)
    return json.loads(http_get(url, timeout))

# ── WOGCC orphan well fetch ───────────────────────────────────────────────────

WOGCC_FIELDS = (
    "API_NUMBER,WN,UNIT_LEASE,COMPANY,FIELD_NAME,WELL_CLASS,"
    "STATUS,LATITUDE,LONGITUDE,COUNTY,SPUD,STAT_YEAR,STAT_MONTH,COMP_DATE,TD"
)
WOGCC_PAGE = 1000


def parse_spud(val) -> str:
    """SPUD is stored as YYYYMM integer (e.g. 195506 = Jun 1955)."""
    try:
        n = int(val)
    except (TypeError, ValueError):
        return ""
    if n < 190001 or n > 209912:
        return ""
    yr  = n // 100
    mo  = n  % 100
    if mo < 1 or mo > 12:
        mo = 1
    return f"{yr:04d}-{mo:02d}-01"


def calc_months_inactive(stat_year, stat_month) -> str:
    try:
        sy, sm = int(stat_year), int(stat_month)
    except (TypeError, ValueError):
        return ""
    if sy < 1900 or sy > NOW.year:
        return ""
    if sm < 1 or sm > 12:
        sm = 1
    months = (NOW.year - sy) * 12 + (NOW.month - sm)
    return str(max(months, 0)) if months >= 0 else ""


def fetch_wogcc_page(offset: int) -> dict:
    return arcgis_query(WOGCC_URL, {
        "where":            "STATUS IN ('PA','TA')",
        "outFields":        WOGCC_FIELDS,
        "outSR":            "4326",
        "returnGeometry":   "true",
        "resultOffset":     str(offset),
        "resultRecordCount": str(WOGCC_PAGE),
        "f":                "json",
    })


def fetch_all_wogcc() -> list[dict]:
    wells  = []
    offset = 0
    print("Fetching WOGCC PA/TA wells (WyGISC service)...")

    while True:
        try:
            page = fetch_wogcc_page(offset)
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

            lat = a.get("LATITUDE")  or geom.get("y")
            lon = a.get("LONGITUDE") or geom.get("x")
            if not lat or not lon:
                continue
            lat, lon = float(lat), float(lon)
            # Wyoming bounding box
            if not (40.99 <= lat <= 45.01 and -111.06 <= lon <= -104.05):
                continue

            raw_api = str(a.get("API_NUMBER") or "").strip()
            if not raw_api:
                continue

            county_code = a.get("COUNTY")
            county = WY_COUNTY.get(int(county_code), "") if county_code else ""

            lease    = str(a.get("UNIT_LEASE") or "").strip()
            wn       = str(a.get("WN") or "").strip()
            well_name = f"{lease} #{wn}" if lease and wn else (lease or wn or "")

            wc   = str(a.get("WELL_CLASS") or "").strip().upper()
            status_code = str(a.get("STATUS") or "").strip()

            spud_date       = parse_spud(a.get("SPUD"))
            months_inactive = calc_months_inactive(a.get("STAT_YEAR"), a.get("STAT_MONTH"))

            wells.append({
                "api_number":     raw_api,
                "well_name":      well_name,
                "latitude":       round(lat, 6),
                "longitude":      round(lon, 6),
                "state":          "Wyoming",
                "county":         county,
                "operator_name":  str(a.get("COMPANY") or "").strip(),
                "well_type":      WELL_CLASS_MAP.get(wc, wc or ""),
                "well_status":    STATUS_MAP.get(status_code, status_code),
                "spud_date":      spud_date,
                "months_inactive": months_inactive,
                "liability_est":  "",
                "field_name":     str(a.get("FIELD_NAME") or "").strip(),
                "lease_name":     lease,
                "district":       "",
            })

        fetched = len(features)
        print(f"  offset={offset:>6}  page={fetched:>4}  total={len(wells):>6}")
        exceeded = page.get("exceededTransferLimit", False)
        if not exceeded and fetched < WOGCC_PAGE:
            break

        offset += WOGCC_PAGE
        time.sleep(0.3)

    # Deduplicate on api_number
    seen: set[str] = set()
    deduped = []
    for w in wells:
        if w["api_number"] not in seen:
            seen.add(w["api_number"])
            deduped.append(w)

    print(f"WOGCC: {len(wells)} total fetched, {len(deduped)} after dedup.")
    return deduped


# ── WSGS groundwater fetch ────────────────────────────────────────────────────

WSGS_FIELDS = (
    "OBJECTID,PermitNumber,PermitPrefix,PermitSuffix,WR_Number,"
    "IsActive,FirstName,LastName,Company,FacilityName,Uses,"
    "Latitude,Longitude,TotalDepth_Ft,DepthOfPump,Appropriation_GPM,"
    "StaticWaterLevel_Ft,PriorityDate,FacilityType,SummaryWRStatus"
)
WSGS_PAGE  = 2000
WSGS_WHERE = (
    "FacilityType='Well' AND "
    "(Uses LIKE '%DOM%' OR Uses LIKE '%MUN%') AND "
    "Latitude IS NOT NULL AND Longitude IS NOT NULL"
)

# Water use code → readable label
def clean_uses(raw: str) -> str:
    if not raw:
        return "Groundwater"
    raw = raw.strip()
    mapping = {
        "DOM": "Domestic", "MUN": "Municipal", "STK": "Stock",
        "IRR": "Irrigation", "IND": "Industrial", "COM": "Commercial",
        "MIN": "Mining", "PWR": "Power",
    }
    parts = [p.strip() for p in raw.replace(",", " ").split() if p.strip()]
    labels = [mapping.get(p.upper(), p) for p in parts]
    return ", ".join(dict.fromkeys(labels)) or "Groundwater"  # deduplicate


def fetch_wsgs_page(last_objectid: int) -> dict:
    where = f"{WSGS_WHERE} AND OBJECTID > {last_objectid}"
    return arcgis_query(WSGS_GW_URL, {
        "where":            where,
        "outFields":        WSGS_FIELDS,
        "returnGeometry":   "false",
        "orderByFields":    "OBJECTID ASC",
        "resultRecordCount": str(WSGS_PAGE),
        "f":                "json",
    }, timeout=60)


def fetch_all_wsgs() -> list[dict]:
    wells       = []
    last_oid    = 0
    page_num    = 0
    print("\nFetching WSGS domestic/municipal groundwater wells...")

    while True:
        try:
            page = fetch_wsgs_page(last_oid)
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

            lat = a.get("Latitude")
            lon = a.get("Longitude")
            if not lat or not lon:
                continue
            lat, lon = float(lat), float(lon)
            if not (40.99 <= lat <= 45.01 and -111.06 <= lon <= -104.05):
                continue

            wr     = str(a.get("WR_Number") or "").strip()
            permit = a.get("PermitNumber")
            well_id = wr or (f"WY-{int(permit)}" if permit else f"WY-OID-{a.get('OBJECTID')}")

            depth   = a.get("TotalDepth_Ft")
            capacity = a.get("Appropriation_GPM")

            # Year from PriorityDate (ISO date string "YYYY-MM-DD")
            year_constructed = ""
            pd = a.get("PriorityDate") or ""
            if pd and len(str(pd)) >= 4:
                try:
                    yr = int(str(pd)[:4])
                    if 1800 <= yr <= NOW.year:
                        year_constructed = yr
                except ValueError:
                    pass

            status_raw = str(a.get("IsActive") or "").strip()
            status = "Active" if status_raw == "A" else ("Inactive" if status_raw == "I" else status_raw)

            wells.append({
                "well_id":           well_id,
                "latitude":          round(lat, 6),
                "longitude":         round(lon, 6),
                "state":             "Wyoming",
                "county":            "",   # not available in this dataset
                "well_depth_ft":     round(float(depth), 1) if depth else "",
                "well_capacity_gpm": round(float(capacity), 2) if capacity else "",
                "water_use":         clean_uses(str(a.get("Uses") or "")),
                "status":            status,
                "year_constructed":  year_constructed,
            })

            last_oid = max(last_oid, int(a.get("OBJECTID") or 0))

        page_num += 1
        print(f"  page={page_num:>3}  fetched={len(features):>4}  total={len(wells):>7}  last_oid={last_oid}")

        exceeded = page.get("exceededTransferLimit", False)
        if not exceeded and len(features) < WSGS_PAGE:
            break

        time.sleep(0.3)

    print(f"WSGS: {len(wells)} groundwater wells fetched.")
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
            print(f"  [{end:>7}/{total}]  ✓")
        else:
            errors += len(batch)
            print(f"  [{end:>7}/{total}]  ✗ HTTP {status}: {(err or '')[:120]}", file=sys.stderr)

        time.sleep(0.12)

    print(f"Done — {inserted:,} sent, {errors:,} errors.")


# ── Geom backfill via Supabase SQL endpoint ───────────────────────────────────

def backfill_geom(table: str, pk_col: str, state: str) -> None:
    sql = (
        f"UPDATE {table} "
        f"SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326) "
        f"WHERE state = '{state}' AND geom IS NULL;"
    )
    url = f"{SUPABASE_URL}/rest/v1/rpc/exec_sql"

    # Try the /sql endpoint (Supabase supports this with service role key only;
    # with anon key we fall back to printing instructions)
    payload = json.dumps({"query": sql}).encode()
    req = urllib.request.Request(url, data=payload, method="POST", headers={
        "apikey":        SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type":  "application/json",
    })
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            print(f"geom backfill {table}: HTTP {r.status}")
    except Exception:
        # anon key can't execute raw SQL — print the statement for manual run
        print(f"\nRun in Supabase SQL editor to backfill {table} geom:")
        print(f"  {sql}")


# ── Main ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":

    # ── 1. Fetch orphan wells
    orphan_wells = fetch_all_wogcc()
    orphan_csv = os.path.join(SCRIPT_DIR, "wy_orphan_wells.csv")
    orphan_fields = [
        "api_number","well_name","latitude","longitude","state","county",
        "operator_name","well_type","well_status","spud_date","months_inactive",
        "liability_est","field_name","lease_name","district",
    ]
    with open(orphan_csv, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=orphan_fields, extrasaction="ignore")
        w.writeheader(); w.writerows(orphan_wells)
    print(f"Saved {len(orphan_wells):,} rows → {orphan_csv}")

    # ── 2. Fetch groundwater wells
    gw_wells = fetch_all_wsgs()
    gw_csv = os.path.join(SCRIPT_DIR, "wy_groundwater_wells.csv")
    gw_fields = [
        "well_id","latitude","longitude","state","county",
        "well_depth_ft","well_capacity_gpm","water_use","status","year_constructed",
    ]
    with open(gw_csv, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=gw_fields, extrasaction="ignore")
        w.writeheader(); w.writerows(gw_wells)
    print(f"Saved {len(gw_wells):,} rows → {gw_csv}")

    # ── 3. Import orphan wells
    import_rows(
        rows         = orphan_wells,
        table        = "orphan_wells",
        conflict_col = "api_number",
        numeric_cols = {"latitude","longitude","months_inactive","liability_est"},
    )

    # ── 4. Import groundwater wells
    import_rows(
        rows         = gw_wells,
        table        = "groundwater_wells",
        conflict_col = "well_id",
        numeric_cols = {"latitude","longitude","well_depth_ft","well_capacity_gpm","year_constructed"},
    )

    # ── 5. Backfill geom
    print("\nBackfilling geom columns...")
    backfill_geom("orphan_wells",    "api_number", "Wyoming")
    backfill_geom("groundwater_wells", "well_id",  "Wyoming")

    print("\n✓ Wyoming pipeline complete.")
