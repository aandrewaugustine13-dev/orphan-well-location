#!/usr/bin/env python3
"""
Fetch West Virginia orphan/abandoned well data and groundwater well data,
then export CSVs ready for Supabase import.

Sources
-------
Orphan wells  : WVDEP TAGIS ArcGIS REST API — MapServer Layer 2
                (wellstatus = 'Abandoned Well')
                https://tagis.dep.wv.gov/arcgis/rest/services/WVDEP_enterprise/oil_gas/MapServer/2

Groundwater   : USGS NWIS Site Inventory for WV groundwater sites
                https://waterservices.usgs.gov/nwis/site/

Usage
-----
  python3 scripts/fetch_wv_wells.py

Outputs
-------
  scripts/wv_orphan_wells.csv       — import into 'wells' (or 'orphan_wells') table
  scripts/wv_groundwater_wells.csv  — import into 'groundwater_wells' table
"""

import csv
import json
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime

# ── WV county FIPS → name lookup ─────────────────────────────────────────────
# Source: US Census FIPS codes for West Virginia (state FIPS 54)
WV_COUNTY_FIPS = {
    "001": "Barbour",    "003": "Berkeley",   "005": "Boone",
    "007": "Braxton",    "009": "Brooke",     "011": "Cabell",
    "013": "Calhoun",    "015": "Clay",       "017": "Doddridge",
    "019": "Fayette",    "021": "Gilmer",     "023": "Grant",
    "025": "Greenbrier", "027": "Hampshire",  "029": "Hancock",
    "031": "Hardy",      "033": "Harrison",   "035": "Jackson",
    "037": "Jefferson",  "039": "Kanawha",    "041": "Lewis",
    "043": "Lincoln",    "045": "Logan",      "047": "McDowell",
    "049": "Marion",     "051": "Marshall",   "053": "Mason",
    "055": "Mercer",     "057": "Mineral",    "059": "Mingo",
    "061": "Monongalia", "063": "Monroe",     "065": "Morgan",
    "067": "Nicholas",   "069": "Ohio",       "071": "Pendleton",
    "073": "Pleasants",  "075": "Pocahontas", "077": "Preston",
    "079": "Putnam",     "081": "Raleigh",    "083": "Randolph",
    "085": "Ritchie",    "087": "Roane",      "089": "Summers",
    "091": "Taylor",     "093": "Tucker",     "095": "Tyler",
    "097": "Upshur",     "099": "Wayne",      "101": "Webster",
    "103": "Wetzel",     "105": "Wirt",       "107": "Wood",
    "109": "Wyoming",
}

# ── Helpers ───────────────────────────────────────────────────────────────────

def http_get(url: str, timeout: int = 60) -> bytes:
    req = urllib.request.Request(
        url, headers={"User-Agent": "OrphanWellLocator/1.0 (research; not commercial)"}
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def parse_date(val) -> str:
    """Parse ESRI date value — may be YYYY/MM/DD string, ISO string, or ms epoch int."""
    if val is None:
        return ""
    if isinstance(val, (int, float)):
        try:
            return datetime.utcfromtimestamp(int(val) / 1000).strftime("%Y-%m-%d")
        except Exception:
            return ""
    s = str(val).strip()
    if not s or s.lower() in ("null", "none", ""):
        return ""
    for fmt in ("%Y/%m/%d", "%Y-%m-%d", "%m/%d/%Y", "%m-%d-%Y"):
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except ValueError:
            pass
    # Try just the year (some entries are "1947" only)
    if len(s) == 4 and s.isdigit():
        return f"{s}-01-01"
    return ""


def clean_county(raw: str) -> str:
    """Resolve county: FIPS code → name, or strip 'County' suffix."""
    if not raw:
        return ""
    s = raw.strip()
    # 3-digit FIPS code (as returned by WVDEP API)
    if s.isdigit() and len(s) <= 3:
        return WV_COUNTY_FIPS.get(s.zfill(3), s)
    # 5-digit state+county FIPS
    if s.isdigit() and len(s) == 5:
        return WV_COUNTY_FIPS.get(s[2:], s)
    if s.upper().endswith(" COUNTY"):
        s = s[:-7].strip()
    return s.title()


def norm_api(raw) -> str:
    """Normalise a WV API number to a consistent string."""
    if raw is None:
        return ""
    s = str(raw).strip().lstrip("0")
    # WV state code is 47; full API is typically 10 digits: 4700103456
    # Store as-is but ensure it's non-empty
    return s


# ── WVDEP orphan well fetch ───────────────────────────────────────────────────

WVDEP_BASE = (
    "https://tagis.dep.wv.gov/arcgis/rest/services"
    "/WVDEP_enterprise/oil_gas/MapServer/2/query"
)

# All fields available on Layer 2
WVDEP_FIELDS = (
    "permitid,county,wellstatus,welltype,welluse,"
    "respparty,farmname,wellnumber,issuedate,compdate,"
    "formation,api,welldepth,marcellus"
)

PAGE_SIZE = 1000  # conservative; API supports up to 3000


def fetch_wvdep_page(offset: int) -> dict:
    params = {
        "where": "wellstatus='Abandoned Well'",
        "outFields": WVDEP_FIELDS,
        "outSR": "4326",
        "returnGeometry": "true",
        "geometryType": "esriGeometryPoint",
        "f": "json",
        "resultOffset": str(offset),
        "resultRecordCount": str(PAGE_SIZE),
    }
    url = WVDEP_BASE + "?" + urllib.parse.urlencode(params)
    raw = http_get(url)
    return json.loads(raw)


def fetch_all_wvdep_wells() -> list[dict]:
    wells = []
    offset = 0
    print("Fetching WVDEP abandoned wells (Layer 2)...")

    while True:
        try:
            page = fetch_wvdep_page(offset)
        except Exception as exc:
            print(f"  ERROR at offset {offset}: {exc}", file=sys.stderr)
            break

        # Surface any server-side error
        if "error" in page:
            print(f"  API error: {page['error']}", file=sys.stderr)
            break

        features = page.get("features") or []
        if not features:
            break

        for feat in features:
            attrs = feat.get("attributes") or {}
            geom = feat.get("geometry") or {}

            lon = geom.get("x")
            lat = geom.get("y")

            # Reject missing / obviously wrong coordinates
            if lon is None or lat is None:
                continue
            if not (37.0 <= lat <= 40.75 and -82.75 <= lon <= -77.7):
                continue

            raw_api = norm_api(attrs.get("api"))
            permit_id = str(attrs.get("permitid") or "").strip()

            # Require at least one identifier
            api_number = raw_api or (f"WV-PERMIT-{permit_id}" if permit_id else "")
            if not api_number:
                continue

            county = clean_county(str(attrs.get("county") or ""))
            operator = str(attrs.get("respparty") or "").strip()
            well_type = str(attrs.get("welltype") or "").strip()
            well_use = str(attrs.get("welluse") or "").strip()
            farm_name = str(attrs.get("farmname") or "").strip()
            well_number = str(attrs.get("wellnumber") or "").strip()
            formation = str(attrs.get("formation") or "").strip()

            # Compose a human-readable well name
            if farm_name and well_number:
                well_name = f"{farm_name} #{well_number}"
            elif farm_name:
                well_name = farm_name
            elif well_number:
                well_name = f"Well #{well_number}"
            else:
                well_name = ""

            # Dates — issuedate is permit issue; compdate is completion
            issue_date = parse_date(attrs.get("issuedate"))
            comp_date = parse_date(attrs.get("compdate"))
            # Use completion date as spud_date proxy; fall back to issue date
            spud_date = comp_date or issue_date

            # months_inactive: calculate from comp_date to today if available
            months_inactive = ""
            if comp_date:
                try:
                    completed = datetime.strptime(comp_date, "%Y-%m-%d")
                    delta_months = (
                        (datetime.utcnow().year - completed.year) * 12
                        + (datetime.utcnow().month - completed.month)
                    )
                    if delta_months > 0:
                        months_inactive = str(delta_months)
                except Exception:
                    pass

            wells.append({
                "api_number":    api_number,
                "well_name":     well_name,
                "latitude":      round(lat, 6),
                "longitude":     round(lon, 6),
                "state":         "West Virginia",
                "county":        county,
                "operator_name": operator,
                "well_type":     well_type or well_use,
                "well_status":   "Abandoned",
                "spud_date":     spud_date,
                "months_inactive": months_inactive,
                "liability_est": "",
                "field_name":    formation,
                "lease_name":    farm_name,
                "district":      "",
            })

        fetched = len(features)
        print(f"  offset={offset:>6}  page={fetched:>4}  total={len(wells):>6}")

        # Stop when we got fewer records than requested (last page)
        exceeded = page.get("exceededTransferLimit", False)
        if not exceeded and fetched < PAGE_SIZE:
            break

        offset += PAGE_SIZE
        time.sleep(0.4)  # polite delay

    print(f"\nWVDEP: {len(wells)} abandoned wells with valid coordinates.")
    return wells


# ── USGS NWIS groundwater fetch ───────────────────────────────────────────────

NWIS_URL = (
    "https://waterservices.usgs.gov/nwis/site/"
    "?format=rdb"
    "&stateCd=WV"
    "&siteType=GW"
    "&siteStatus=all"
    "&hasDataTypeCd=gw"
    "&siteOutput=expanded"
)


def fetch_usgs_groundwater() -> list[dict]:
    print("\nFetching USGS NWIS groundwater wells for WV...")
    try:
        raw = http_get(NWIS_URL)
        text = raw.decode("utf-8", errors="replace")
    except Exception as exc:
        print(f"  ERROR fetching NWIS: {exc}", file=sys.stderr)
        return []

    lines = text.splitlines()
    header: list[str] | None = None
    skip_next = False
    wells = []

    for line in lines:
        if line.startswith("#"):
            continue
        if header is None:
            header = line.split("\t")
            skip_next = True  # next line is the column-width descriptor row
            continue
        if skip_next:
            skip_next = False
            continue

        parts = line.split("\t")
        if len(parts) < 5:
            continue
        row = dict(zip(header, parts))

        lat_s = row.get("dec_lat_va", "").strip()
        lon_s = row.get("dec_long_va", "").strip()
        if not lat_s or not lon_s:
            continue
        try:
            lat = float(lat_s)
            lon = float(lon_s)
        except ValueError:
            continue

        # NWIS stores western longitudes as positive; fix it
        if lon > 0:
            lon = -lon

        if not (37.0 <= lat <= 40.75 and -82.75 <= lon <= -77.7):
            continue

        site_no = row.get("site_no", "").strip()
        station_nm = row.get("station_nm", "").strip()

        # County from 5-digit FIPS (first 2 = state, last 3 = county)
        county_cd = row.get("county_cd", "").strip()
        county = ""
        if len(county_cd) >= 5:
            county = WV_COUNTY_FIPS.get(county_cd[-3:], "")
        elif len(county_cd) == 3:
            county = WV_COUNTY_FIPS.get(county_cd, "")

        # Well depth
        depth_s = (row.get("well_depth_va") or row.get("hole_depth_va") or "").strip()
        try:
            depth_ft = round(float(depth_s), 1) if depth_s else ""
        except ValueError:
            depth_ft = ""

        # Year constructed
        const_dt = (row.get("construction_dt") or "").strip()
        year_constructed = ""
        if const_dt and len(const_dt) >= 4:
            try:
                yr = int(const_dt[:4])
                if 1800 <= yr <= 2030:
                    year_constructed = yr
            except ValueError:
                pass

        # Site status
        site_status = row.get("site_tp_cd", "").strip()
        status = "Active" if site_status == "GW" else site_status

        wells.append({
            "well_id":           f"USGS-{site_no}",
            "latitude":          round(lat, 6),
            "longitude":         round(lon, 6),
            "state":             "West Virginia",
            "county":            county,
            "well_depth_ft":     depth_ft,
            "well_capacity_gpm": "",
            "water_use":         "Monitoring",
            "status":            status,
            "year_constructed":  year_constructed,
        })

    print(f"USGS NWIS: {len(wells)} groundwater monitoring wells.")
    return wells


# ── CSV writers ───────────────────────────────────────────────────────────────

ORPHAN_FIELDS = [
    "api_number", "well_name", "latitude", "longitude", "state", "county",
    "operator_name", "well_type", "well_status", "spud_date", "months_inactive",
    "liability_est", "field_name", "lease_name", "district",
]

GW_FIELDS = [
    "well_id", "latitude", "longitude", "state", "county",
    "well_depth_ft", "well_capacity_gpm", "water_use", "status", "year_constructed",
]


def write_csv(rows: list[dict], fields: list[str], path: str) -> None:
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {len(rows):,} rows → {path}")


# ── Main ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import os

    out_dir = os.path.dirname(os.path.abspath(__file__))

    # ── Orphan wells
    orphan_wells = fetch_all_wvdep_wells()
    if orphan_wells:
        # Deduplicate on api_number (keep first occurrence)
        seen: set[str] = set()
        deduped = []
        for w in orphan_wells:
            key = w["api_number"]
            if key not in seen:
                seen.add(key)
                deduped.append(w)
        print(f"After dedup: {len(deduped):,} unique wells.")
        write_csv(deduped, ORPHAN_FIELDS, os.path.join(out_dir, "wv_orphan_wells.csv"))
    else:
        print("No orphan wells fetched — check WVDEP API connectivity.", file=sys.stderr)

    # ── Groundwater wells
    gw_wells = fetch_usgs_groundwater()
    if gw_wells:
        write_csv(gw_wells, GW_FIELDS, os.path.join(out_dir, "wv_groundwater_wells.csv"))
    else:
        print("No groundwater wells fetched — check USGS NWIS connectivity.", file=sys.stderr)

    print("\nDone.")
    print("Next steps:")
    print("  1. Review the CSVs in scripts/")
    print("  2. Import via Supabase Dashboard → Table Editor → Import CSV")
    print("     OR via psql:  \\copy wells FROM 'wv_orphan_wells.csv' CSV HEADER")
    print("     OR via psql:  \\copy groundwater_wells FROM 'wv_groundwater_wells.csv' CSV HEADER")
    print("  3. The geom column is auto-populated by a Supabase trigger if you have one,")
    print("     or run: UPDATE wells SET geom = ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)")
    print("             WHERE state = 'West Virginia' AND geom IS NULL;")
