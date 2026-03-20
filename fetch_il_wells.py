#!/usr/bin/env python3
"""
Illinois well pipeline:
  1. Fetch abandoned/plugged orphan wells from ISGS ILOIL Wells2 ArcGIS
  2. Fetch groundwater wells from ISGS ILWATER Water_and_Related_Wells2
  3. Upsert into Supabase

Sources
-------
  Orphan wells  : maps.isgs.illinois.edu ILOIL/Wells2 MapServer Layer 8
                  Filter: STATUS_TEXT LIKE '%Abandon%' OR '%Plug%' OR '%Idle%'

  Groundwater   : maps.isgs.illinois.edu ILWATER/Water_and_Related_Wells2 Layer 2
"""

import csv, json, os, sys, time, urllib.error, urllib.parse, urllib.request
from datetime import datetime

SUPABASE_URL = "https://echnydvgehjkfsiyhnth.supabase.co"
SUPABASE_KEY = "sb_publishable_HZqnTHDFwTbcnvmFiSQzqQ_e9IemFS4"
BATCH_SIZE   = 200
RETRY_LIMIT  = 3
SCRIPT_DIR   = os.path.dirname(os.path.abspath(__file__))

IL_ORPHAN_URL = "https://maps.isgs.illinois.edu/arcgis/rest/services/ILOIL/Wells2/MapServer/8/query"
IL_GW_URL     = "https://maps.isgs.illinois.edu/arcgis/rest/services/ILWATER/Water_and_Related_Wells2/MapServer/2/query"

IL_LAT_MIN, IL_LAT_MAX = 36.97, 42.51
IL_LON_MIN, IL_LON_MAX = -91.51, -87.02

NOW = datetime.utcnow()


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
    """Convert epoch ms to YYYY-MM-DD string."""
    try:
        ts = int(val) / 1000
        if ts > 0:
            return datetime.utcfromtimestamp(ts).strftime("%Y-%m-%d")
    except (TypeError, ValueError):
        pass
    return ""

def fetch_il_orphan():
    wells = []; offset = 0; seen = set()
    print("Fetching IL abandoned/plugged wells (ISGS ILOIL Wells2)...")
    where = "STATUS_TEXT LIKE '%Abandon%' OR STATUS_TEXT LIKE '%Plug%' OR STATUS_TEXT LIKE '%Idle%'"
    fields = "API_NUMBER,COMPANY_NAME,FARM_NAME,FARM_NUM,STATUS,STATUS_TEXT,SPUD_DATE,COMP_DATE,PERMIT_DATE,TOTAL_DEPTH,LATITUDE,LONGITUDE"

    while True:
        try:
            page = arcgis_query(IL_ORPHAN_URL, {
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
            lat = a.get("LATITUDE") or geom.get("y")
            lon = a.get("LONGITUDE") or geom.get("x")
            if not lat or not lon: continue
            try: lat, lon = float(lat), float(lon)
            except: continue
            if not (IL_LAT_MIN <= lat <= IL_LAT_MAX and IL_LON_MIN <= lon <= IL_LON_MAX): continue

            raw_api = str(a.get("API_NUMBER") or "").strip()
            if not raw_api or raw_api in seen: continue
            seen.add(raw_api)

            farm = str(a.get("FARM_NAME") or "").strip()
            num  = str(a.get("FARM_NUM") or "").strip()
            well_name = f"{farm} #{num}" if farm and num else (farm or "")

            depth = a.get("TOTAL_DEPTH")
            wells.append({
                "api_number":     raw_api,
                "well_name":      well_name,
                "latitude":       round(lat, 6),
                "longitude":      round(lon, 6),
                "state":          "Illinois",
                "county":         "",
                "operator_name":  str(a.get("COMPANY_NAME") or "").strip(),
                "well_type":      "",
                "well_status":    str(a.get("STATUS_TEXT") or "").strip(),
                # Best available date: spud → completion → permit
                "spud_date": (
                    parse_epoch_ms(a.get("SPUD_DATE"))
                    or parse_epoch_ms(a.get("COMP_DATE"))
                    or parse_epoch_ms(a.get("PERMIT_DATE"))
                ),
                "months_inactive": "",
                "liability_est":  liability_from_depth(depth),
                "field_name":     "",
                "lease_name":     farm,
                "district":       "",
            })

        print(f"  offset={offset:>6}  page={len(features):>4}  total={len(wells):>6}")
        if not page.get("exceededTransferLimit") and len(features) < 1000: break
        offset += 1000
        time.sleep(0.3)

    print(f"IL Orphan: {len(wells)} after dedup.")
    return wells

def fetch_il_groundwater():
    wells = []; last_oid = 0; page_num = 0
    print("\nFetching IL groundwater wells (ISGS ILWATER)...")
    where_base = "LATITUDE IS NOT NULL AND LONGITUDE IS NOT NULL"
    fields = "OBJECTID,API_NUMBER,ISWSPNUM,STATUS,STATUSLONG,LATITUDE,LONGITUDE,CNTYNAME,TOTAL_DEPTH,PUMPGPM,DATE_DRILLED,WELL_TYPE,WELL_TYPE_TEXT"

    while True:
        where = f"{where_base} AND OBJECTID > {last_oid}"
        try:
            page = arcgis_query(IL_GW_URL, {
                "where": where, "outFields": fields,
                "returnGeometry": "false", "orderByFields": "OBJECTID ASC",
                "resultRecordCount": "2000", "f": "json",
            }, timeout=120)
        except Exception as exc:
            print(f"  ERROR at OID>{last_oid}: {exc}", file=sys.stderr); break

        if "error" in page:
            print(f"  API error: {page['error']}", file=sys.stderr); break

        features = page.get("features") or []
        if not features: break

        for feat in features:
            a = feat.get("attributes") or {}
            lat = a.get("LATITUDE"); lon = a.get("LONGITUDE")
            if not lat or not lon: continue
            try: lat, lon = float(lat), float(lon)
            except: continue
            if not (IL_LAT_MIN <= lat <= IL_LAT_MAX and IL_LON_MIN <= lon <= IL_LON_MAX): continue

            api = str(a.get("API_NUMBER") or "").strip()
            iswsp = str(a.get("ISWSPNUM") or "").strip()
            oid = int(a.get("OBJECTID") or 0)
            well_id = f"IL-{api or iswsp or f'OID-{oid}'}"

            depth = a.get("TOTAL_DEPTH")
            cap   = a.get("PUMPGPM")

            year_constructed = None
            dd = a.get("DATE_DRILLED")
            if dd:
                try:
                    yr = int(datetime.utcfromtimestamp(int(dd)/1000).strftime("%Y"))
                    if 1800 <= yr <= NOW.year: year_constructed = yr
                except: pass

            wells.append({
                "well_id":           well_id,
                "latitude":          round(lat, 6),
                "longitude":         round(lon, 6),
                "state":             "Illinois",
                "county":            str(a.get("CNTYNAME") or "").strip(),
                "well_depth_ft":     round(float(depth),1) if depth else None,
                "well_capacity_gpm": round(float(cap),2) if cap else None,
                "water_use":         str(a.get("WELL_TYPE_TEXT") or "Groundwater").strip(),
                "status":            str(a.get("STATUSLONG") or "").strip(),
                "year_constructed":  year_constructed,
            })
            last_oid = max(last_oid, oid)

        page_num += 1
        print(f"  page={page_num:>3}  fetched={len(features):>4}  total={len(wells):>7}  last_oid={last_oid}")
        if not page.get("exceededTransferLimit") and len(features) < 2000: break
        time.sleep(0.3)

    print(f"IL GW: {len(wells)} wells.")
    return wells

if __name__ == "__main__":
    orphan_wells = fetch_il_orphan()
    with open(os.path.join(SCRIPT_DIR, "il_orphan_wells.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["api_number","well_name","latitude","longitude","state","county","operator_name","well_type","well_status","spud_date","months_inactive","liability_est","field_name","lease_name","district"], extrasaction="ignore")
        w.writeheader(); w.writerows(orphan_wells)
    print(f"Saved {len(orphan_wells):,} orphan rows")

    gw_wells = fetch_il_groundwater()
    with open(os.path.join(SCRIPT_DIR, "il_groundwater_wells.csv"), "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["well_id","latitude","longitude","state","county","well_depth_ft","well_capacity_gpm","water_use","status","year_constructed"], extrasaction="ignore")
        w.writeheader(); w.writerows(gw_wells)
    print(f"Saved {len(gw_wells):,} GW rows")

    import_rows(orphan_wells, "orphan_wells", "api_number", {"latitude","longitude","months_inactive","liability_est"})
    import_rows(gw_wells, "groundwater_wells", "well_id", {"latitude","longitude","well_depth_ft","well_capacity_gpm","year_constructed"})

    print("\nRun in Supabase SQL editor:")
    print("  UPDATE orphan_wells SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326) WHERE state = 'Illinois' AND geom IS NULL;")
    print("  UPDATE groundwater_wells SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326) WHERE state = 'Illinois' AND geom IS NULL;")
    print(f"\nIL pipeline complete. Orphan: {len(orphan_wells):,}  GW: {len(gw_wells):,}")
