#!/usr/bin/env python3
"""
Montana well pipeline:
  Orphan wells: MT BOGC via gis.dnrc.mt.gov ArcGIS (BOG/DataMiner/MapServer/11)
  Groundwater:  USGS NWIS
"""
import csv, json, os, sys, time, urllib.error, urllib.parse, urllib.request
from datetime import datetime

SUPABASE_URL = "https://echnydvgehjkfsiyhnth.supabase.co"
SUPABASE_KEY = "sb_publishable_HZqnTHDFwTbcnvmFiSQzqQ_e9IemFS4"
BATCH_SIZE   = 200
RETRY_LIMIT  = 3
SCRIPT_DIR   = os.path.dirname(os.path.abspath(__file__))

MT_ORPHAN_URL = "https://gis.dnrc.mt.gov/arcgis/rest/services/BOG/DataMiner/MapServer/11/query"
USGS_NWIS_URL = "https://waterservices.usgs.gov/nwis/site/"

MT_LAT_MIN, MT_LAT_MAX = 44.36, 49.00
MT_LON_MIN, MT_LON_MAX = -116.05, -104.04

NOW = datetime.utcnow()

def http_get(url, timeout=60):
    req = urllib.request.Request(url, headers={"User-Agent": "OrphanWellLocator/1.0"})
    return urllib.request.urlopen(req, timeout=timeout).read()

def arcgis_query(base_url, params, timeout=60):
    url = base_url + "?" + urllib.parse.urlencode(params)
    return json.loads(http_get(url, timeout))

def liability_from_depth(depth):
    try: d = float(depth)
    except: return 37500
    if d >= 8000: return 250000
    elif d >= 3000: return 112500
    else: return 37500

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
        "Content-Type": "application/json",
        "Prefer": "resolution=ignore-duplicates,return=minimal"})
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

def parse_date_str(val):
    if not val: return ""
    s = str(val).strip()
    for fmt in ("%m/%d/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return ""

def fetch_mt_orphan():
    wells = []; offset = 0; seen = set()
    print("Fetching MT P&A/abandoned wells (BOGC DataMiner)...")
    where = "Status LIKE '%Abandon%' OR Status LIKE '%P&A%' OR Status LIKE '%Plug%' OR Status LIKE '%Idle%' OR Status LIKE '%Orphan%'"
    fields = "API_WellNo,CoName,Well_Nm,Status,Type,Completed,Prod_Field,DTD"

    while True:
        try:
            page = arcgis_query(MT_ORPHAN_URL, {
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
            lat = geom.get("y"); lon = geom.get("x")
            if not lat or not lon: continue
            try: lat, lon = float(lat), float(lon)
            except: continue
            if not (MT_LAT_MIN<=lat<=MT_LAT_MAX and MT_LON_MIN<=lon<=MT_LON_MAX): continue

            api = str(a.get("API_WellNo") or "").strip()
            if not api or api in seen: continue
            seen.add(api)

            depth = a.get("DTD")
            wells.append({
                "api_number":     api,
                "well_name":      str(a.get("Well_Nm") or "").strip(),
                "latitude":       round(lat, 6),
                "longitude":      round(lon, 6),
                "state":          "Montana",
                "county":         "",
                "operator_name":  str(a.get("CoName") or "").strip(),
                "well_type":      str(a.get("Type") or "").strip(),
                "well_status":    str(a.get("Status") or "").strip(),
                "spud_date":      parse_date_str(a.get("Completed")),
                "months_inactive": "",
                "liability_est":  liability_from_depth(depth),
                "field_name":     str(a.get("Prod_Field") or "").strip(),
                "lease_name":     "",
                "district":       "",
            })

        print(f"  offset={offset:>6}  page={len(features):>4}  total={len(wells):>6}")
        if not page.get("exceededTransferLimit") and len(features) < 1000: break
        offset += 1000
        time.sleep(0.3)

    print(f"MT Orphan: {len(wells)} wells.")
    return wells

def fetch_usgs_gw():
    print(f"\nFetching USGS NWIS GW for Montana...")
    params = urllib.parse.urlencode({"stateCd":"MT","siteType":"GW","format":"rdb","siteStatus":"all","siteOutput":"expanded"})
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
        if not (MT_LAT_MIN<=lat<=MT_LAT_MAX and MT_LON_MIN<=lon<=MT_LON_MAX): continue
        seen.add(sn)
        try: depth = float(gc(p,"well_depth_va")) if gc(p,"well_depth_va") else None
        except: depth = None
        wells.append({"well_id":f"MT-USGS-{sn}","latitude":round(lat,6),"longitude":round(lon,6),"state":"Montana","county":gc(p,"county_cd"),"well_depth_ft":round(depth,1) if depth else None,"well_capacity_gpm":None,"water_use":gc(p,"water_use") or "Groundwater","status":"Active","year_constructed":None})
    print(f"  Montana: {len(wells)} GW sites.")
    return wells

if __name__ == "__main__":
    orphan_wells = fetch_mt_orphan()
    with open(os.path.join(SCRIPT_DIR,"mt_orphan_wells.csv"),"w",newline="",encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["api_number","well_name","latitude","longitude","state","county","operator_name","well_type","well_status","spud_date","months_inactive","liability_est","field_name","lease_name","district"], extrasaction="ignore")
        w.writeheader(); w.writerows(orphan_wells)
    print(f"Saved {len(orphan_wells):,} orphan rows")

    gw_wells = fetch_usgs_gw()
    with open(os.path.join(SCRIPT_DIR,"mt_groundwater_wells.csv"),"w",newline="",encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["well_id","latitude","longitude","state","county","well_depth_ft","well_capacity_gpm","water_use","status","year_constructed"], extrasaction="ignore")
        w.writeheader(); w.writerows(gw_wells)
    print(f"Saved {len(gw_wells):,} GW rows")

    import_rows(orphan_wells,"orphan_wells","api_number",{"latitude","longitude","months_inactive","liability_est"})
    import_rows(gw_wells,"groundwater_wells","well_id",{"latitude","longitude","well_depth_ft","well_capacity_gpm","year_constructed"})

    print("\nRun in Supabase SQL editor:")
    print("  UPDATE orphan_wells SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326) WHERE state = 'Montana' AND geom IS NULL;")
    print("  UPDATE groundwater_wells SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326) WHERE state = 'Montana' AND geom IS NULL;")
    print(f"\nMT pipeline complete. Orphan: {len(orphan_wells):,}  GW: {len(gw_wells):,}")
