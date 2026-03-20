#!/usr/bin/env python3
"""
California well pipeline:
  1. Fetch idle/abandoned/plugged orphan wells from CalGEM WellSTAR ArcGIS REST
  2. Fetch groundwater wells from USGS NWIS (CA DWR OSWCR endpoint not accessible)
  3. Clean + transform to match Supabase schema
  4. Batch-upsert into Supabase (ON CONFLICT DO NOTHING)

Sources
-------
  Orphan wells  : CalGEM WellSTAR MapServer Layer 0
                  https://gis.conservation.ca.gov/server/rest/services/WellSTAR/Wells/MapServer/0
                  Filter: WellStatus IN ('Idle','Abandoned','Plugged')  ~175,357 wells

  Groundwater   : USGS NWIS groundwater sites for California
                  https://waterservices.usgs.gov/nwis/site/?stateCd=CA&siteType=GW
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

CA_ORPHAN_URL = (
    "https://gis.conservation.ca.gov/server/rest/services"
    "/WellSTAR/Wells/MapServer/0/query"
)
USGS_NWIS_URL = "https://waterservices.usgs.gov/nwis/site/"

# CA bounding box
CA_LAT_MIN, CA_LAT_MAX = 32.53, 42.01
CA_LON_MIN, CA_LON_MAX = -124.41, -114.13

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


# ── Liability estimate from depth ─────────────────────────────────────────────

def liability_from_depth(depth) -> int:
    try:
        d = float(depth)
    except (TypeError, ValueError):
        return 37500
    if d >= 8000:
        return 250000
    elif d >= 3000:
        return 112500
    else:
        return 37500


# ── CA orphan well fetch ───────────────────────────────────────────────────────

CA_FIELDS = (
    "API,LeaseName,WellNumber,OperatorName,WellType,WellTypeLabel,WellStatus,"
    "SpudDate,CompletionDate,FirstProductionDate,PlugDate,"
    "CountyName,FieldName,Latitude,Longitude,District"
)
CA_PAGE = 1000


def fetch_ca_orphan_page(offset: int) -> dict:
    return arcgis_query(CA_ORPHAN_URL, {
        "where":             "WellStatus IN ('Idle','Abandoned','Plugged')",
        "outFields":         CA_FIELDS,
        "outSR":             "4326",
        "returnGeometry":    "true",
        "resultOffset":      str(offset),
        "resultRecordCount": str(CA_PAGE),
        "f":                 "json",
    }, timeout=120)


def parse_spud_ca(val) -> str:
    """SpudDate in format MM/DD/YYYY or YYYY-MM-DD or None."""
    if not val:
        return ""
    s = str(val).strip()
    # Try MM/DD/YYYY
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%Y/%m/%d"):
        try:
            dt = datetime.strptime(s, fmt)
            return dt.strftime("%Y-%m-%d")
        except ValueError:
            continue
    return ""


def fetch_all_ca_orphan() -> list:
    wells  = []
    offset = 0
    seen: set = set()
    print("Fetching CA idle/abandoned/plugged wells (CalGEM WellSTAR)...")

    while True:
        try:
            page = fetch_ca_orphan_page(offset)
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

            lat = a.get("Latitude") or geom.get("y")
            lon = a.get("Longitude") or geom.get("x")
            if not lat or not lon:
                continue
            try:
                lat, lon = float(lat), float(lon)
            except (TypeError, ValueError):
                continue
            # CA bounding box
            if not (CA_LAT_MIN <= lat <= CA_LAT_MAX and CA_LON_MIN <= lon <= CA_LON_MAX):
                continue

            raw_api = str(a.get("API") or "").strip()
            if not raw_api or raw_api in seen:
                continue
            seen.add(raw_api)

            lease    = str(a.get("LeaseName") or "").strip()
            well_num = str(a.get("WellNumber") or "").strip()
            well_name = f"{lease} #{well_num}" if lease and well_num else (lease or well_num or "")

            wells.append({
                "api_number":      raw_api,
                "well_name":       well_name,
                "latitude":        round(lat, 6),
                "longitude":       round(lon, 6),
                "state":           "California",
                "county":          str(a.get("CountyName") or "").strip(),
                "operator_name":   str(a.get("OperatorName") or "").strip(),
                "well_type":       str(a.get("WellTypeLabel") or a.get("WellType") or "").strip(),
                "well_status":     str(a.get("WellStatus") or "").strip(),
                # Best available date: spud → completion → first production → plug
                "spud_date": (
                    parse_spud_ca(a.get("SpudDate"))
                    or parse_spud_ca(a.get("CompletionDate"))
                    or parse_spud_ca(a.get("FirstProductionDate"))
                    or parse_spud_ca(a.get("PlugDate"))
                ),
                "months_inactive": "",
                "liability_est":   37500,  # No depth field - use default
                "field_name":      str(a.get("FieldName") or "").strip(),
                "lease_name":      lease,
                "district":        str(a.get("District") or "").strip(),
            })

        fetched   = len(features)
        exceeded  = page.get("exceededTransferLimit", False)
        print(f"  offset={offset:>7}  page={fetched:>4}  total={len(wells):>7}")

        if not exceeded and fetched < CA_PAGE:
            break

        offset += CA_PAGE
        time.sleep(0.3)

    print(f"CA Orphan: {len(wells)} wells after dedup.")
    return wells


# ── USGS NWIS groundwater fetch ───────────────────────────────────────────────

def fetch_usgs_nwis_gw(state_cd: str, state_name: str,
                        lat_min: float, lat_max: float,
                        lon_min: float, lon_max: float) -> list:
    """Fetch groundwater sites from USGS NWIS for a state."""
    print(f"\nFetching USGS NWIS groundwater wells for {state_name}...")
    params = urllib.parse.urlencode({
        "stateCd":    state_cd,
        "siteType":   "GW",
        "format":     "rdb",
        "siteStatus": "all",
    })
    url = USGS_NWIS_URL + "?" + params
    try:
        data = http_get(url, timeout=120).decode("utf-8", errors="replace")
    except Exception as exc:
        print(f"  ERROR fetching USGS NWIS: {exc}", file=sys.stderr)
        return []

    wells = []
    seen_ids: set = set()
    lines = data.splitlines()

    # Find header line (starts with agency_cd)
    header_idx = None
    for i, line in enumerate(lines):
        if line.startswith("agency_cd") and "site_no" in line:
            header_idx = i
            break

    if header_idx is None:
        print("  Could not find NWIS header line", file=sys.stderr)
        return []

    headers = lines[header_idx].split("\t")
    # Skip the format line after header
    data_start = header_idx + 2

    col = {h: i for i, h in enumerate(headers)}

    def get_col(row_parts, name, default=""):
        idx = col.get(name)
        if idx is None or idx >= len(row_parts):
            return default
        return row_parts[idx].strip()

    for line in lines[data_start:]:
        if not line or line.startswith("#"):
            continue
        parts = line.split("\t")
        if len(parts) < 5:
            continue

        site_no   = get_col(parts, "site_no")
        if not site_no or site_no in seen_ids:
            continue

        lat_str = get_col(parts, "dec_lat_va")
        lon_str = get_col(parts, "dec_long_va")
        if not lat_str or not lon_str:
            continue
        try:
            lat = float(lat_str)
            lon = float(lon_str)
        except ValueError:
            continue

        if not (lat_min <= lat <= lat_max and lon_min <= lon <= lon_max):
            continue

        seen_ids.add(site_no)
        well_id = f"{state_cd.upper()}-USGS-{site_no}"

        depth_str = get_col(parts, "well_depth_va")
        try:
            depth = float(depth_str) if depth_str else None
        except ValueError:
            depth = None

        county_cd = get_col(parts, "county_cd")

        wells.append({
            "well_id":           well_id,
            "latitude":          round(lat, 6),
            "longitude":         round(lon, 6),
            "state":             state_name,
            "county":            county_cd,
            "well_depth_ft":     round(depth, 1) if depth else None,
            "well_capacity_gpm": None,
            "water_use":         get_col(parts, "water_use") or "Groundwater",
            "status":            "Active",
            "year_constructed":  None,
        })

    print(f"  USGS NWIS: {len(wells)} groundwater sites.")
    return wells


# ── Supabase upsert ───────────────────────────────────────────────────────────

def coerce(row: dict, numeric_cols: set) -> dict:
    out = {}
    for k, v in row.items():
        if isinstance(v, (int, float)):
            out[k] = v
        else:
            s = str(v).strip() if v is not None else ""
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


def upsert_batch(table: str, conflict_col: str, rows: list) -> tuple:
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


def import_rows(rows: list, table: str, conflict_col: str, numeric_cols: set) -> int:
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
            print(f"  [{end:>7}/{total}]  OK")
        else:
            errors += len(batch)
            print(f"  [{end:>7}/{total}]  ERR HTTP {status}: {(err or '')[:120]}", file=sys.stderr)

        time.sleep(0.12)

    print(f"Done — {inserted:,} sent, {errors:,} errors.")
    return inserted


# ── Main ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":

    # 1. Fetch orphan wells
    orphan_wells = fetch_all_ca_orphan()
    orphan_csv = os.path.join(SCRIPT_DIR, "ca_orphan_wells.csv")
    orphan_fields = [
        "api_number","well_name","latitude","longitude","state","county",
        "operator_name","well_type","well_status","spud_date","months_inactive",
        "liability_est","field_name","lease_name","district",
    ]
    with open(orphan_csv, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=orphan_fields, extrasaction="ignore")
        w.writeheader(); w.writerows(orphan_wells)
    print(f"Saved {len(orphan_wells):,} rows -> {orphan_csv}")

    # 2. Fetch groundwater wells
    gw_wells = fetch_usgs_nwis_gw("CA", "California",
                                    CA_LAT_MIN, CA_LAT_MAX,
                                    CA_LON_MIN, CA_LON_MAX)
    gw_csv = os.path.join(SCRIPT_DIR, "ca_groundwater_wells.csv")
    gw_fields = [
        "well_id","latitude","longitude","state","county",
        "well_depth_ft","well_capacity_gpm","water_use","status","year_constructed",
    ]
    with open(gw_csv, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=gw_fields, extrasaction="ignore")
        w.writeheader(); w.writerows(gw_wells)
    print(f"Saved {len(gw_wells):,} rows -> {gw_csv}")

    # 3. Import orphan wells
    import_rows(
        rows         = orphan_wells,
        table        = "orphan_wells",
        conflict_col = "api_number",
        numeric_cols = {"latitude","longitude","months_inactive","liability_est"},
    )

    # 4. Import groundwater wells
    import_rows(
        rows         = gw_wells,
        table        = "groundwater_wells",
        conflict_col = "well_id",
        numeric_cols = {"latitude","longitude","well_depth_ft","well_capacity_gpm","year_constructed"},
    )

    # 5. Geom backfill SQL
    print("\nRun in Supabase SQL editor to backfill geom:")
    print("  UPDATE orphan_wells SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326) WHERE state = 'California' AND geom IS NULL;")
    print("  UPDATE groundwater_wells SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326) WHERE state = 'California' AND geom IS NULL;")

    print(f"\nCA pipeline complete. Orphan: {len(orphan_wells):,}  GW: {len(gw_wells):,}")
