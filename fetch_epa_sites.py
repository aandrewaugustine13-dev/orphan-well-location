#!/usr/bin/env python3
"""
Fetch EPA environmental site data from official EPA ArcGIS REST services
and import into the epa_sites Supabase table.

Sources (all from EPA_GEO on ArcGIS Online):
  Superfund NPL  — FAC_Superfund_Site_Feature_Locations_EPA_Public/FeatureServer/0
  Brownfields    — FRS_INTERESTS_ACRES/FeatureServer/0
  TRI Facilities — FRS_INTERESTS_TRI/FeatureServer/0

Usage:
  python3 scripts/fetch_epa_sites.py

Outputs:
  scripts/epa_superfund.csv
  scripts/epa_brownfields.csv
  scripts/epa_tri.csv
  (then imports all three into Supabase)
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
SCRIPT_DIR   = os.path.dirname(os.path.abspath(__file__))

AGIS_PAGE_SIZE = 2000  # ArcGIS max records per request
BATCH_SIZE     = 300   # Supabase upsert batch size
RETRY_LIMIT    = 3

# ── State code → full name ────────────────────────────────────────────────────

STATE_ABBR = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas",
    "CA": "California", "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware",
    "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho",
    "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas",
    "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland",
    "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi",
    "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada",
    "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York",
    "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma",
    "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina",
    "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah",
    "VT": "Vermont", "VA": "Virginia", "WA": "Washington", "WV": "West Virginia",
    "WI": "Wisconsin", "WY": "Wyoming", "DC": "District of Columbia",
}

US_STATES = set(STATE_ABBR.keys())

# NPL status code → readable label
NPL_STATUS = {
    "C": "Current NPL",
    "D": "Deleted from NPL",
    "P": "Proposed for NPL",
    "F": "Final NPL",
    "": "Unknown",
}


# ── ArcGIS fetch helpers ───────────────────────────────────────────────────────

def arcgis_count(base_url: str, where: str = "1=1") -> int:
    url = f"{base_url}/query?where={urllib.parse.quote(where)}&returnCountOnly=true&f=json"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read()).get("count", 0)


def arcgis_fetch_page(base_url: str, offset: int, fields: str = "*", where: str = "1=1") -> list[dict]:
    params = urllib.parse.urlencode({
        "where": where,
        "outFields": fields,
        "resultOffset": offset,
        "resultRecordCount": AGIS_PAGE_SIZE,
        "f": "json",
        "outSR": "4326",
    })
    url = f"{base_url}/query?{params}"
    for attempt in range(RETRY_LIMIT):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=30) as r:
                data = json.loads(r.read())
                return data.get("features", [])
        except Exception as exc:
            if attempt == RETRY_LIMIT - 1:
                print(f"  ArcGIS fetch error at offset {offset}: {exc}", file=sys.stderr)
                return []
            time.sleep(2 ** attempt)
    return []


def arcgis_fetch_all(base_url: str, fields: str = "*", where: str = "1=1", label: str = "") -> list[dict]:
    total = arcgis_count(base_url, where)
    print(f"  {label}: {total:,} records")
    all_features = []
    offset = 0
    while offset < total:
        page = arcgis_fetch_page(base_url, offset, fields, where)
        if not page:
            break
        all_features.extend(page)
        offset += len(page)
        print(f"    fetched {offset:,} / {total:,}", end="\r")
        time.sleep(0.2)
    print(f"    fetched {len(all_features):,} total          ")
    return all_features


# ── Supabase helpers ───────────────────────────────────────────────────────────

def supabase_upsert(table: str, rows: list[dict], conflict_col: str = "site_id") -> tuple[int, int]:
    ok = err = 0
    for start in range(0, len(rows), BATCH_SIZE):
        batch = rows[start: start + BATCH_SIZE]
        url = f"{SUPABASE_URL}/rest/v1/{table}?on_conflict={conflict_col}"
        payload = json.dumps(batch).encode()
        req = urllib.request.Request(url, data=payload, method="POST", headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        })
        for attempt in range(RETRY_LIMIT):
            try:
                with urllib.request.urlopen(req, timeout=30) as r:
                    ok += len(batch)
                    break
            except urllib.error.HTTPError as e:
                body = e.read().decode(errors="replace")
                if attempt == RETRY_LIMIT - 1:
                    err += len(batch)
                    print(f"  Supabase error HTTP {e.code}: {body[:120]}", file=sys.stderr)
                else:
                    time.sleep(2 ** attempt)
            except Exception as exc:
                if attempt == RETRY_LIMIT - 1:
                    err += len(batch)
                    print(f"  Supabase error: {exc}", file=sys.stderr)
                else:
                    time.sleep(2 ** attempt)
        time.sleep(0.1)
    return ok, err


def save_csv(rows: list[dict], path: str) -> None:
    if not rows:
        return
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(rows)
    print(f"  Saved {len(rows):,} rows → {os.path.basename(path)}")


# ── Superfund NPL ─────────────────────────────────────────────────────────────

def fetch_superfund() -> list[dict]:
    # Use FRS_INTERESTS filtered to SEMS program — one record per Superfund site
    BASE = "https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/FRS_INTERESTS/FeatureServer/0"
    fields = "KEY_FIELD,PGM_SYS_ID,PRIMARY_NAME,CITY_NAME,COUNTY_NAME,STATE_CODE,LATITUDE83,LONGITUDE83,ACTIVE_STATUS,FEDERAL_LAND_IND,INTEREST_TYPE"

    features = arcgis_fetch_all(
        BASE, fields=fields, where="PGM_SYS_ACRNM='SEMS'", label="Superfund/SEMS"
    )

    rows = []
    for feat in features:
        a = feat.get("attributes", {})
        g = feat.get("geometry", {})
        state = (a.get("STATE_CODE") or "").strip().upper()
        lat = g.get("y") or a.get("LATITUDE83")
        lng = g.get("x") or a.get("LONGITUDE83")
        key = a.get("KEY_FIELD")

        if state not in US_STATES or lat is None or lng is None or not key:
            continue

        interest = (a.get("INTEREST_TYPE") or "").upper()
        active_status = (a.get("ACTIVE_STATUS") or "").strip()
        is_npl = "NPL" in interest and "NON-NPL" not in interest
        npl_status = (
            "Current NPL" if is_npl and "DELETED" not in active_status.upper()
            else "Deleted from NPL" if "DELETED" in active_status.upper()
            else "Non-NPL Superfund" if not is_npl
            else "Unknown"
        )

        rows.append({
            "site_id": key,
            "site_name": (a.get("PRIMARY_NAME") or "").strip().title(),
            "latitude": round(float(lat), 7),
            "longitude": round(float(lng), 7),
            "state": STATE_ABBR.get(state, state),
            "county": (a.get("COUNTY_NAME") or "").replace(" County", "").strip().title(),
            "city": (a.get("CITY_NAME") or "").strip().title(),
            "site_type": "Superfund",
            "status": active_status.title() if active_status else "Unknown",
            "contamination_type": None,
            "federal_facility": (a.get("FEDERAL_LAND_IND") or "N").strip().upper() == "Y",
            "npl_status": npl_status,
        })

    print(f"  {len(rows):,} Superfund sites (including NPL and non-NPL)")
    return rows


# ── Brownfields (ACRES) ────────────────────────────────────────────────────────

def fetch_brownfields() -> list[dict]:
    BASE = "https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/FRS_INTERESTS_ACRES/FeatureServer/0"
    fields = "KEY_FIELD,PRIMARY_NAME,CITY_NAME,COUNTY_NAME,STATE_CODE,LATITUDE83,LONGITUDE83,ACTIVE_STATUS,FEDERAL_LAND_IND"

    features = arcgis_fetch_all(BASE, fields=fields, label="ACRES Brownfields")

    rows = []
    for feat in features:
        a = feat.get("attributes", {})
        g = feat.get("geometry", {})
        state = (a.get("STATE_CODE") or "").strip().upper()
        lat = g.get("y") or a.get("LATITUDE83")
        lng = g.get("x") or a.get("LONGITUDE83")
        key = a.get("KEY_FIELD")

        if state not in US_STATES or lat is None or lng is None or not key:
            continue

        rows.append({
            "site_id": key,
            "site_name": (a.get("PRIMARY_NAME") or "").strip().title(),
            "latitude": round(float(lat), 7),
            "longitude": round(float(lng), 7),
            "state": STATE_ABBR.get(state, state),
            "county": (a.get("COUNTY_NAME") or "").replace(" County", "").strip().title(),
            "city": (a.get("CITY_NAME") or "").strip().title(),
            "site_type": "Brownfield",
            "status": (a.get("ACTIVE_STATUS") or "Unknown").strip().title(),
            "contamination_type": None,
            "federal_facility": (a.get("FEDERAL_LAND_IND") or "N").strip().upper() == "Y",
            "npl_status": None,
        })

    return rows


# ── TRI Facilities ─────────────────────────────────────────────────────────────

def fetch_tri() -> list[dict]:
    BASE = "https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/FRS_INTERESTS_TRI/FeatureServer/0"
    fields = "KEY_FIELD,PRIMARY_NAME,CITY_NAME,COUNTY_NAME,STATE_CODE,LATITUDE83,LONGITUDE83,ACTIVE_STATUS,FEDERAL_LAND_IND"

    features = arcgis_fetch_all(BASE, fields=fields, label="TRI Facilities")

    rows = []
    for feat in features:
        a = feat.get("attributes", {})
        g = feat.get("geometry", {})
        state = (a.get("STATE_CODE") or "").strip().upper()
        lat = g.get("y") or a.get("LATITUDE83")
        lng = g.get("x") or a.get("LONGITUDE83")
        key = a.get("KEY_FIELD")

        if state not in US_STATES or lat is None or lng is None or not key:
            continue

        rows.append({
            "site_id": key,
            "site_name": (a.get("PRIMARY_NAME") or "").strip().title(),
            "latitude": round(float(lat), 7),
            "longitude": round(float(lng), 7),
            "state": STATE_ABBR.get(state, state),
            "county": (a.get("COUNTY_NAME") or "").replace(" County", "").strip().title(),
            "city": (a.get("CITY_NAME") or "").strip().title(),
            "site_type": "TRI",
            "status": (a.get("ACTIVE_STATUS") or "Unknown").strip().title(),
            "contamination_type": None,
            "federal_facility": (a.get("FEDERAL_LAND_IND") or "N").strip().upper() == "Y",
            "npl_status": None,
        })

    return rows


# ── Main ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    csv_only = "--csv-only" in sys.argv
    import_only = "--import-only" in sys.argv

    print("=" * 60)
    print("EPA SITES FETCH + IMPORT")
    print(f"Mode: {'CSV generation only' if csv_only else 'Import only (from existing CSVs)' if import_only else 'Fetch + Import'}")
    print(f"Started: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)

    total_ok = total_err = 0

    sources = [
        ("Superfund/SEMS", fetch_superfund,  "epa_superfund.csv"),
        ("Brownfields",    fetch_brownfields, "epa_brownfields.csv"),
        ("TRI Facilities", fetch_tri,         "epa_tri.csv"),
    ]

    for label, fetch_fn, csv_name in sources:
        csv_path = os.path.join(SCRIPT_DIR, csv_name)
        print(f"\n── {label} ──────────────────────────────────────────")

        if import_only:
            # Load from existing CSV
            if not os.path.exists(csv_path):
                print(f"  CSV not found: {csv_path} — skipping")
                continue
            with open(csv_path, encoding="utf-8") as f:
                reader = csv.DictReader(f)
                rows = list(reader)
                # Coerce boolean and numeric fields
                for row in rows:
                    row["federal_facility"] = row.get("federal_facility", "").lower() in ("true", "1", "yes")
                    for col in ("latitude", "longitude"):
                        try:
                            row[col] = float(row[col]) if row[col] else None
                        except (ValueError, TypeError):
                            row[col] = None
                    for col in ("contamination_type", "npl_status"):
                        if row.get(col) == "":
                            row[col] = None
            print(f"  Loaded {len(rows):,} rows from {csv_name}")
        else:
            rows = fetch_fn()
            save_csv(rows, csv_path)

        if not csv_only:
            print(f"  Importing {len(rows):,} rows into Supabase epa_sites...")
            ok, err = supabase_upsert("epa_sites", rows)
            total_ok += ok
            total_err += err
            print(f"  Done — {ok:,} upserted, {err} errors")

    if not csv_only:
        print("\n" + "=" * 60)
        print(f"COMPLETE — {total_ok:,} total upserted, {total_err} errors")
        print()
        print("If errors occurred, run epa_sites_setup.sql in Supabase SQL editor first,")
        print("then re-run: python3 scripts/fetch_epa_sites.py --import-only")
        print()
        print("After import, run in SQL editor:")
        print("  UPDATE epa_sites SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography")
        print("  WHERE geom IS NULL AND latitude IS NOT NULL AND longitude IS NOT NULL;")
    else:
        print("\n" + "=" * 60)
        print("CSVs generated. Next steps:")
        print("  1. Run epa_sites_setup.sql in Supabase SQL editor")
        print("  2. Run: python3 scripts/fetch_epa_sites.py --import-only")
        print("  3. Run geom UPDATE in SQL editor")
