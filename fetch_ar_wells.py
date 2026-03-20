#!/usr/bin/env python3
"""STATE_NAME well pipeline: USGS NWIS (no accessible state ArcGIS)"""
import csv, json, os, sys, time, urllib.error, urllib.parse, urllib.request

SUPABASE_URL = "https://echnydvgehjkfsiyhnth.supabase.co"
SUPABASE_KEY = "sb_publishable_HZqnTHDFwTbcnvmFiSQzqQ_e9IemFS4"
BATCH_SIZE = 200; RETRY_LIMIT = 3
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
USGS_NWIS_URL = "https://waterservices.usgs.gov/nwis/site/"
STATE_CD = "AR"
STATE_NAME = "Arkansas"
LAT_MIN, LAT_MAX = 33.00, 36.50
LON_MIN, LON_MAX = -94.62, -89.64

def http_get(url, timeout=60):
    req = urllib.request.Request(url, headers={"User-Agent": "OrphanWellLocator/1.0"})
    return urllib.request.urlopen(req, timeout=timeout).read()

def coerce(row, nc):
    out = {}
    for k, v in row.items():
        if isinstance(v, (int, float)):
            out[k] = v
        else:
            s = str(v).strip() if v is not None else ""
            if not s or s.lower() == "null":
                out[k] = None
            elif k in nc:
                try:
                    out[k] = float(s) if "." in s else int(s)
                except ValueError:
                    out[k] = None
            else:
                out[k] = s
    return out

def upsert_batch(table, cc, rows):
    url = f"{SUPABASE_URL}/rest/v1/{table}?on_conflict={cc}"
    payload = json.dumps(rows).encode()
    req = urllib.request.Request(url, data=payload, method="POST", headers={
        "apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=ignore-duplicates,return=minimal",
    })
    for i in range(1, RETRY_LIMIT + 1):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.status, None
        except urllib.error.HTTPError as e:
            body = e.read().decode(errors="replace")
            if i == RETRY_LIMIT:
                return e.code, body
            time.sleep(2 ** i)
        except Exception as exc:
            if i == RETRY_LIMIT:
                return 0, str(exc)
            time.sleep(2 ** i)
    return 0, "unknown"

def import_rows(rows, table, cc, nc):
    total = len(rows)
    ins = 0
    errs = 0
    sep = "-" * 60
    print(f"\n{sep}\nTable: {table} ({total:,})\n{sep}")
    for s in range(0, total, BATCH_SIZE):
        batch = [coerce(r, nc) for r in rows[s:s+BATCH_SIZE]]
        st, e = upsert_batch(table, cc, batch)
        end = min(s + BATCH_SIZE, total)
        if st in (200, 201):
            ins += len(batch)
            print(f"  [{end:>7}/{total}]  OK")
        else:
            errs += len(batch)
            print(f"  [{end:>7}/{total}]  ERR {st}: {(str(e) if e else '')[:80]}", file=sys.stderr)
        time.sleep(0.12)
    print(f"Done - {ins:,} sent, {errs:,} errors.")

def fetch_usgs_gw():
    print(f"\nFetching USGS NWIS GW for {STATE_NAME}...")
    params = urllib.parse.urlencode({
        "stateCd": STATE_CD, "siteType": "GW",
        "format": "rdb", "siteStatus": "all", "siteOutput": "expanded",
    })
    try:
        data = http_get(USGS_NWIS_URL + "?" + params, timeout=120).decode("utf-8", "replace")
    except Exception as e:
        print(f"  ERROR: {e}", file=sys.stderr)
        return []

    wells = []
    seen = set()
    lines = data.splitlines()
    hi = next((i for i, l in enumerate(lines) if l.startswith("agency_cd") and "site_no" in l), None)
    if hi is None:
        return []
    hdrs = lines[hi].split("\t")
    col = {h: i for i, h in enumerate(hdrs)}

    def gc(p, n, d=""):
        idx = col.get(n)
        return p[idx].strip() if idx is not None and idx < len(p) else d

    for line in lines[hi + 2:]:
        if not line or line.startswith("#"):
            continue
        p = line.split("\t")
        if len(p) < 5:
            continue
        sn = gc(p, "site_no")
        if not sn or sn in seen:
            continue
        try:
            lat = float(gc(p, "dec_lat_va"))
            lon = float(gc(p, "dec_long_va"))
        except ValueError:
            continue
        if not (LAT_MIN <= lat <= LAT_MAX and LON_MIN <= lon <= LON_MAX):
            continue
        seen.add(sn)
        depth_s = gc(p, "well_depth_va")
        try:
            depth = float(depth_s) if depth_s else None
        except ValueError:
            depth = None
        wells.append({
            "well_id":           f"{STATE_CD}-USGS-{sn}",
            "latitude":          round(lat, 6),
            "longitude":         round(lon, 6),
            "state":             STATE_NAME,
            "county":            gc(p, "county_cd"),
            "well_depth_ft":     round(depth, 1) if depth else None,
            "well_capacity_gpm": None,
            "water_use":         gc(p, "water_use") or "Groundwater",
            "status":            "Active",
            "year_constructed":  None,
        })
    print(f"  {STATE_NAME}: {len(wells)} GW sites.")
    return wells

if __name__ == "__main__":
    print(f"{STATE_NAME} pipeline (USGS NWIS - no accessible state ArcGIS)")
    gw = fetch_usgs_gw()
    lower = STATE_CD.lower()
    with open(os.path.join(SCRIPT_DIR, f"{lower}_groundwater_wells.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["well_id","latitude","longitude","state","county","well_depth_ft","well_capacity_gpm","water_use","status","year_constructed"], extrasaction="ignore")
        w.writeheader()
        w.writerows(gw)
    print(f"Saved {len(gw):,} GW rows")
    import_rows(gw, "groundwater_wells", "well_id", {"latitude","longitude","well_depth_ft","well_capacity_gpm","year_constructed"})
    print(f"\n  UPDATE groundwater_wells SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326) WHERE state = '{STATE_NAME}' AND geom IS NULL;")
    print(f"\n{STATE_NAME} pipeline complete. Orphan: 0 (no data)  GW: {len(gw):,}")
