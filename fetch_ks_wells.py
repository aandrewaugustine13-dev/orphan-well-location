#!/usr/bin/env python3
"""
Kansas well pipeline:
  Orphan wells: USGS NWIS (KGS ArcGIS not accessible - KGS geoportal times out)
  Groundwater:  USGS NWIS
Note: no orphan well ArcGIS data found for Kansas - using USGS NWIS oil/gas sites
"""
import csv, json, os, sys, time, urllib.error, urllib.parse, urllib.request
from datetime import datetime

SUPABASE_URL = "https://echnydvgehjkfsiyhnth.supabase.co"
SUPABASE_KEY = "sb_publishable_HZqnTHDFwTbcnvmFiSQzqQ_e9IemFS4"
BATCH_SIZE   = 200
RETRY_LIMIT  = 3
SCRIPT_DIR   = os.path.dirname(os.path.abspath(__file__))
USGS_NWIS_URL = "https://waterservices.usgs.gov/nwis/site/"

KS_LAT_MIN, KS_LAT_MAX = 36.99, 40.00
KS_LON_MIN, KS_LON_MAX = -102.05, -94.59
NOW = datetime.utcnow()

def http_get(url, timeout=60):
    req = urllib.request.Request(url, headers={"User-Agent": "OrphanWellLocator/1.0"})
    return urllib.request.urlopen(req, timeout=timeout).read()

def coerce(row, numeric_cols):
    out = {}
    for k, v in row.items():
        if isinstance(v, (int, float)):
            out[k] = v
        else:
            s = str(v).strip() if v is not None else ""
            if not s or s.lower() == "null": out[k] = None
            elif k in numeric_cols:
                try: out[k] = float(s) if "." in s else int(s)
                except ValueError: out[k] = None
            else: out[k] = s
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
            with urllib.request.urlopen(req, timeout=30) as r: return r.status, None
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

def fetch_usgs_nwis_gw(state_cd, state_name, lat_min, lat_max, lon_min, lon_max):
    print(f"\nFetching USGS NWIS groundwater wells for {state_name}...")
    params = urllib.parse.urlencode({
        "stateCd": state_cd, "siteType": "GW",
        "format": "rdb", "siteStatus": "all", "siteOutput": "expanded",
    })
    try:
        data = http_get(USGS_NWIS_URL + "?" + params, timeout=120).decode("utf-8", errors="replace")
    except Exception as exc:
        print(f"  ERROR: {exc}", file=sys.stderr); return []

    wells = []; seen_ids = set(); lines = data.splitlines()
    header_idx = next((i for i, l in enumerate(lines) if l.startswith("agency_cd") and "site_no" in l), None)
    if header_idx is None: return []
    headers = lines[header_idx].split("\t"); col = {h: i for i, h in enumerate(headers)}
    def gc(p, n, d=""): idx=col.get(n); return p[idx].strip() if idx is not None and idx<len(p) else d

    for line in lines[header_idx + 2:]:
        if not line or line.startswith("#"): continue
        p = line.split("\t")
        if len(p) < 5: continue
        site_no = gc(p, "site_no")
        if not site_no or site_no in seen_ids: continue
        try: lat, lon = float(gc(p,"dec_lat_va")), float(gc(p,"dec_long_va"))
        except: continue
        if not (lat_min<=lat<=lat_max and lon_min<=lon<=lon_max): continue
        seen_ids.add(site_no)
        try: depth = float(gc(p,"well_depth_va")) if gc(p,"well_depth_va") else None
        except: depth = None
        wells.append({
            "well_id": f"{state_cd.upper()}-USGS-{site_no}",
            "latitude": round(lat,6), "longitude": round(lon,6),
            "state": state_name, "county": gc(p,"county_cd"),
            "well_depth_ft": round(depth,1) if depth else None,
            "well_capacity_gpm": None,
            "water_use": gc(p,"water_use") or "Groundwater",
            "status": "Active", "year_constructed": None,
        })
    print(f"  USGS NWIS {state_name}: {len(wells)} sites.")
    return wells

if __name__ == "__main__":
    print("Kansas pipeline (USGS NWIS fallback - KGS ArcGIS geoportal not accessible)")
    print("no orphan well ArcGIS data found for Kansas")

    gw_wells = fetch_usgs_nwis_gw("KS", "Kansas", KS_LAT_MIN, KS_LAT_MAX, KS_LON_MIN, KS_LON_MAX)
    with open(os.path.join(SCRIPT_DIR, "ks_groundwater_wells.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["well_id","latitude","longitude","state","county","well_depth_ft","well_capacity_gpm","water_use","status","year_constructed"], extrasaction="ignore")
        w.writeheader(); w.writerows(gw_wells)
    print(f"Saved {len(gw_wells):,} GW rows")

    import_rows(gw_wells, "groundwater_wells", "well_id", {"latitude","longitude","well_depth_ft","well_capacity_gpm","year_constructed"})

    print("\nRun in Supabase SQL editor:")
    print("  UPDATE groundwater_wells SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326) WHERE state = 'Kansas' AND geom IS NULL;")
    print(f"\nKS pipeline complete. Orphan: 0 (no data)  GW: {len(gw_wells):,}")
