#!/usr/bin/env python3
"""
Colorado well pipeline:
  Orphan wells: ArcGIS Online COGCC CO_OIL_AND_GAS_WELLS FeatureServer
  Groundwater:  USGS NWIS
"""
import csv, json, os, sys, time, urllib.error, urllib.parse, urllib.request
from datetime import datetime

SUPABASE_URL = "https://echnydvgehjkfsiyhnth.supabase.co"
SUPABASE_KEY = "sb_publishable_HZqnTHDFwTbcnvmFiSQzqQ_e9IemFS4"
BATCH_SIZE   = 200
RETRY_LIMIT  = 3
SCRIPT_DIR   = os.path.dirname(os.path.abspath(__file__))

CO_ORPHAN_URL = "https://services1.arcgis.com/qr14biwnHA6Vis6l/arcgis/rest/services/CO_OIL_AND_GAS_WELLS/FeatureServer/0/query"
USGS_NWIS_URL = "https://waterservices.usgs.gov/nwis/site/"

CO_LAT_MIN, CO_LAT_MAX = 36.99, 41.00
CO_LON_MIN, CO_LON_MAX = -109.05, -102.04

NOW = datetime.utcnow()

FACIL_STAT_MAP = {
    "AB": "Abandoned", "PA": "Permanently Abandoned",
    "TA": "Temporarily Abandoned", "SI": "Shut-In Inactive",
    "DG": "Dry Gas", "DA": "Dry Abandoned", "P&A": "Plugged and Abandoned",
}

def http_get(url, timeout=60):
    req = urllib.request.Request(url, headers={"User-Agent": "OrphanWellLocator/1.0"})
    return urllib.request.urlopen(req, timeout=timeout).read()

def arcgis_query(base_url, params, timeout=60):
    url = base_url + "?" + urllib.parse.urlencode(params)
    return json.loads(http_get(url, timeout))

def liability_from_depth(depth):
    try:
        d = float(depth)
    except (TypeError, ValueError):
        return 37500
    if d >= 8000: return 250000
    elif d >= 3000: return 112500
    else: return 37500

def coerce(row, numeric_cols):
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

def upsert_batch(table, conflict_col, rows):
    url = f"{SUPABASE_URL}/rest/v1/{table}?on_conflict={conflict_col}"
    payload = json.dumps(rows).encode("utf-8")
    req = urllib.request.Request(url, data=payload, method="POST", headers={
        "apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=ignore-duplicates,return=minimal",
    })
    for attempt in range(1, RETRY_LIMIT + 1):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.status, None
        except urllib.error.HTTPError as e:
            body = e.read().decode(errors="replace")
            if attempt == RETRY_LIMIT: return e.code, body
            time.sleep(2 ** attempt)
        except Exception as exc:
            if attempt == RETRY_LIMIT: return 0, str(exc)
            time.sleep(2 ** attempt)
    return 0, "unknown"

def import_rows(rows, table, conflict_col, numeric_cols):
    total = len(rows); inserted = 0; errors = 0
    print(f"\n{'─'*60}\nTable : {table}  ({total:,} rows)\n{'─'*60}")
    for start in range(0, total, BATCH_SIZE):
        batch = [coerce(r, numeric_cols) for r in rows[start:start+BATCH_SIZE]]
        status, err = upsert_batch(table, conflict_col, batch)
        end = min(start + BATCH_SIZE, total)
        if status in (200, 201):
            inserted += len(batch); print(f"  [{end:>7}/{total}]  OK")
        else:
            errors += len(batch)
            print(f"  [{end:>7}/{total}]  ERR HTTP {status}: {(err or '')[:120]}", file=sys.stderr)
        time.sleep(0.12)
    print(f"Done — {inserted:,} sent, {errors:,} errors.")
    return inserted

def parse_epoch_ms(val):
    try:
        ts = int(val) / 1000
        if ts > 0:
            return datetime.utcfromtimestamp(ts).strftime("%Y-%m-%d")
    except (TypeError, ValueError):
        pass
    return ""

def fetch_co_orphan():
    wells = []; offset = 0; seen = set()
    print("Fetching CO abandoned/plugged wells (COGCC ArcGIS Online)...")
    where = "Facil_Stat IN ('AB','PA','TA','SI','DG','DA')"
    fields = "API,Well_Name,Operator,Well_Class,Facil_Stat,Spud_Date,Completion_Date,Approval_Date,Field_Name,Max_TVD,API_County,Latitude,Longitude"

    while True:
        try:
            page = arcgis_query(CO_ORPHAN_URL, {
                "where": where, "outFields": fields,
                "outSR": "4326", "returnGeometry": "true",
                "resultOffset": str(offset), "resultRecordCount": "1000", "f": "json",
            }, timeout=120)
        except Exception as exc:
            print(f"  ERROR at offset {offset}: {exc}", file=sys.stderr); break

        if "error" in page:
            print(f"  API error: {page['error']}", file=sys.stderr); break

        features = page.get("features") or []
        if not features: break

        for feat in features:
            a = feat.get("attributes") or {}
            geom = feat.get("geometry") or {}
            lat = a.get("Latitude") or geom.get("y")
            lon = a.get("Longitude") or geom.get("x")
            if not lat or not lon: continue
            try: lat, lon = float(lat), float(lon)
            except: continue
            if not (CO_LAT_MIN <= lat <= CO_LAT_MAX and CO_LON_MIN <= lon <= CO_LON_MAX): continue

            api = str(a.get("API") or "").strip()
            if not api: continue
            # Pad to 10 digits
            if len(api) < 10:
                api = api.zfill(10)
            if api in seen: continue
            seen.add(api)

            depth = a.get("Max_TVD")
            stat = str(a.get("Facil_Stat") or "").strip()
            wells.append({
                "api_number":     api,
                "well_name":      str(a.get("Well_Name") or "").strip(),
                "latitude":       round(lat, 6),
                "longitude":      round(lon, 6),
                "state":          "Colorado",
                "county":         str(a.get("API_County") or "").strip(),
                "operator_name":  str(a.get("Operator") or "").strip(),
                "well_type":      str(a.get("Well_Class") or "").strip(),
                "well_status":    FACIL_STAT_MAP.get(stat, stat),
                # Best available date: spud → completion → permit/approval
                "spud_date": (
                    parse_epoch_ms(a.get("Spud_Date"))
                    or parse_epoch_ms(a.get("Completion_Date"))
                    or parse_epoch_ms(a.get("Approval_Date"))
                ),
                "months_inactive": "",
                "liability_est":  liability_from_depth(depth),
                "field_name":     str(a.get("Field_Name") or "").strip(),
                "lease_name":     "",
                "district":       "",
            })

        print(f"  offset={offset:>7}  page={len(features):>4}  total={len(wells):>7}")
        if not page.get("exceededTransferLimit") and len(features) < 1000: break
        offset += 1000
        time.sleep(0.3)

    print(f"CO Orphan: {len(wells)} wells.")
    return wells

def fetch_usgs_nwis_gw(state_cd, state_name, lat_min, lat_max, lon_min, lon_max):
    print(f"\nFetching USGS NWIS groundwater wells for {state_name}...")
    params = urllib.parse.urlencode({
        "stateCd": state_cd, "siteType": "GW",
        "format": "rdb", "siteStatus": "all",
        "siteOutput": "expanded",
    })
    url = USGS_NWIS_URL + "?" + params
    try:
        data = http_get(url, timeout=120).decode("utf-8", errors="replace")
    except Exception as exc:
        print(f"  ERROR: {exc}", file=sys.stderr); return []

    wells = []; seen_ids = set()
    lines = data.splitlines()
    header_idx = None
    for i, line in enumerate(lines):
        if line.startswith("agency_cd") and "site_no" in line:
            header_idx = i; break

    if header_idx is None:
        print("  Could not find NWIS header", file=sys.stderr); return []

    headers = lines[header_idx].split("\t")
    col = {h: i for i, h in enumerate(headers)}

    def gc(parts, name, default=""):
        idx = col.get(name)
        return parts[idx].strip() if idx is not None and idx < len(parts) else default

    for line in lines[header_idx + 2:]:
        if not line or line.startswith("#"): continue
        parts = line.split("\t")
        if len(parts) < 5: continue
        site_no = gc(parts, "site_no")
        if not site_no or site_no in seen_ids: continue
        lat_s = gc(parts, "dec_lat_va"); lon_s = gc(parts, "dec_long_va")
        if not lat_s or not lon_s: continue
        try: lat, lon = float(lat_s), float(lon_s)
        except: continue
        if not (lat_min <= lat <= lat_max and lon_min <= lon <= lon_max): continue
        seen_ids.add(site_no)
        depth_s = gc(parts, "well_depth_va")
        try: depth = float(depth_s) if depth_s else None
        except: depth = None
        wells.append({
            "well_id":           f"{state_cd.upper()}-USGS-{site_no}",
            "latitude":          round(lat, 6),
            "longitude":         round(lon, 6),
            "state":             state_name,
            "county":            gc(parts, "county_cd"),
            "well_depth_ft":     round(depth, 1) if depth else None,
            "well_capacity_gpm": None,
            "water_use":         gc(parts, "water_use") or "Groundwater",
            "status":            "Active",
            "year_constructed":  None,
        })

    print(f"  USGS NWIS {state_name}: {len(wells)} sites.")
    return wells

if __name__ == "__main__":
    orphan_wells = fetch_co_orphan()
    with open(os.path.join(SCRIPT_DIR, "co_orphan_wells.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["api_number","well_name","latitude","longitude","state","county","operator_name","well_type","well_status","spud_date","months_inactive","liability_est","field_name","lease_name","district"], extrasaction="ignore")
        w.writeheader(); w.writerows(orphan_wells)
    print(f"Saved {len(orphan_wells):,} orphan rows")

    gw_wells = fetch_usgs_nwis_gw("CO", "Colorado", CO_LAT_MIN, CO_LAT_MAX, CO_LON_MIN, CO_LON_MAX)
    with open(os.path.join(SCRIPT_DIR, "co_groundwater_wells.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["well_id","latitude","longitude","state","county","well_depth_ft","well_capacity_gpm","water_use","status","year_constructed"], extrasaction="ignore")
        w.writeheader(); w.writerows(gw_wells)
    print(f"Saved {len(gw_wells):,} GW rows")

    import_rows(orphan_wells, "orphan_wells", "api_number", {"latitude","longitude","months_inactive","liability_est"})
    import_rows(gw_wells, "groundwater_wells", "well_id", {"latitude","longitude","well_depth_ft","well_capacity_gpm","year_constructed"})

    print("\nRun in Supabase SQL editor:")
    print("  UPDATE orphan_wells SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326) WHERE state = 'Colorado' AND geom IS NULL;")
    print("  UPDATE groundwater_wells SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326) WHERE state = 'Colorado' AND geom IS NULL;")
    print(f"\nCO pipeline complete. Orphan: {len(orphan_wells):,}  GW: {len(gw_wells):,}")
