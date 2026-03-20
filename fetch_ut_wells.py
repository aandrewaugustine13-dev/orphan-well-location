#!/usr/bin/env python3
"""
Utah well pipeline:
  Orphan wells: USGS NWIS (UT DOGM ArcGIS not accessible via gis.utah.gov)
  Groundwater:  USGS NWIS
"""
import csv, json, os, sys, time, urllib.error, urllib.parse, urllib.request
from datetime import datetime

SUPABASE_URL = "https://echnydvgehjkfsiyhnth.supabase.co"
SUPABASE_KEY = "sb_publishable_HZqnTHDFwTbcnvmFiSQzqQ_e9IemFS4"
BATCH_SIZE   = 200; RETRY_LIMIT = 3
SCRIPT_DIR   = os.path.dirname(os.path.abspath(__file__))
USGS_NWIS_URL = "https://waterservices.usgs.gov/nwis/site/"

UT_LAT_MIN, UT_LAT_MAX = 36.99, 42.00
UT_LON_MIN, UT_LON_MAX = -114.05, -109.04

def http_get(url, timeout=60):
    req = urllib.request.Request(url, headers={"User-Agent": "OrphanWellLocator/1.0"})
    return urllib.request.urlopen(req, timeout=timeout).read()

def coerce(row, nc):
    out = {}
    for k, v in row.items():
        if isinstance(v, (int, float)): out[k] = v
        else:
            s = str(v).strip() if v is not None else ""
            if not s or s.lower()=="null": out[k] = None
            elif k in nc:
                try: out[k] = float(s) if "." in s else int(s)
                except: out[k] = None
            else: out[k] = s
    return out

def upsert_batch(table, cc, rows):
    url = f"{SUPABASE_URL}/rest/v1/{table}?on_conflict={cc}"
    payload = json.dumps(rows).encode()
    req = urllib.request.Request(url, data=payload, method="POST", headers={
        "apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json", "Prefer": "resolution=ignore-duplicates,return=minimal"})
    for i in range(1, RETRY_LIMIT+1):
        try:
            with urllib.request.urlopen(req, timeout=30) as r: return r.status, None
        except urllib.error.HTTPError as e:
            body = e.read().decode(errors="replace")
            if i == RETRY_LIMIT: return e.code, body
            time.sleep(2**i)
        except Exception as exc:
            if i == RETRY_LIMIT: return 0, str(exc)
            time.sleep(2**i)
    return 0, "unknown"

def import_rows(rows, table, cc, nc):
    total = len(rows); ins = 0; errs = 0
    print(f"\n{'─'*60}\nTable: {table} ({total:,})\n{'─'*60}")
    for s in range(0, total, BATCH_SIZE):
        batch = [coerce(r, nc) for r in rows[s:s+BATCH_SIZE]]
        st, e = upsert_batch(table, cc, batch)
        end = min(s+BATCH_SIZE, total)
        if st in (200,201): ins += len(batch); print(f"  [{end:>7}/{total}]  OK")
        else: errs += len(batch); print(f"  [{end:>7}/{total}]  ERR {st}: {(e or '')[:80]}", file=sys.stderr)
        time.sleep(0.12)
    print(f"Done — {ins:,} sent, {errs:,} errors.")

def fetch_usgs_gw(state_cd, state_name, lat_min, lat_max, lon_min, lon_max):
    print(f"\nFetching USGS NWIS GW for {state_name}...")
    params = urllib.parse.urlencode({"stateCd":state_cd,"siteType":"GW","format":"rdb","siteStatus":"all","siteOutput":"expanded"})
    try: data = http_get(USGS_NWIS_URL+"?"+params, timeout=120).decode("utf-8","replace")
    except Exception as e: print(f"  ERROR: {e}", file=sys.stderr); return []
    wells = []; seen = set(); lines = data.splitlines()
    hi = next((i for i,l in enumerate(lines) if l.startswith("agency_cd") and "site_no" in l), None)
    if hi is None: return []
    hdrs = lines[hi].split("\t"); col = {h:i for i,h in enumerate(hdrs)}
    def gc(p,n,d=""): idx=col.get(n); return p[idx].strip() if idx is not None and idx<len(p) else d
    for line in lines[hi+2:]:
        if not line or line.startswith("#"): continue
        p = line.split("\t")
        if len(p) < 5: continue
        sn = gc(p,"site_no")
        if not sn or sn in seen: continue
        try: lat,lon = float(gc(p,"dec_lat_va")), float(gc(p,"dec_long_va"))
        except: continue
        if not (lat_min<=lat<=lat_max and lon_min<=lon<=lon_max): continue
        seen.add(sn)
        try: depth = float(gc(p,"well_depth_va")) if gc(p,"well_depth_va") else None
        except: depth = None
        wells.append({"well_id":f"{state_cd}-USGS-{sn}","latitude":round(lat,6),"longitude":round(lon,6),"state":state_name,"county":gc(p,"county_cd"),"well_depth_ft":round(depth,1) if depth else None,"well_capacity_gpm":None,"water_use":gc(p,"water_use") or "Groundwater","status":"Active","year_constructed":None})
    print(f"  {state_name}: {len(wells)} GW sites.")
    return wells

if __name__ == "__main__":
    print("Utah pipeline (USGS NWIS - gis.utah.gov DOGM endpoint not accessible)")
    print("no orphan well ArcGIS data found for Utah")

    gw_wells = fetch_usgs_gw("UT", "Utah", UT_LAT_MIN, UT_LAT_MAX, UT_LON_MIN, UT_LON_MAX)
    with open(os.path.join(SCRIPT_DIR,"ut_groundwater_wells.csv"),"w",newline="",encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["well_id","latitude","longitude","state","county","well_depth_ft","well_capacity_gpm","water_use","status","year_constructed"], extrasaction="ignore")
        w.writeheader(); w.writerows(gw_wells)
    print(f"Saved {len(gw_wells):,} GW rows")
    import_rows(gw_wells,"groundwater_wells","well_id",{"latitude","longitude","well_depth_ft","well_capacity_gpm","year_constructed"})
    print("\n  UPDATE groundwater_wells SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326) WHERE state = 'Utah' AND geom IS NULL;")
    print(f"\nUT pipeline complete. Orphan: 0  GW: {len(gw_wells):,}")
