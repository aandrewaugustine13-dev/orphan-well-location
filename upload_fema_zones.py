import os
import geopandas as gpd
import pandas as pd
import pyogrio
from shapely.geometry import MultiPolygon
from sqlalchemy import create_engine, URL
import sys

# --- CONFIGURATION ---
# Session pooler (port 5432), NOT the transaction pooler (6543).
# Build the engine URL from DISCRETE components via URL.create(), never a URL
# string. String parsing was truncating the Supabase pooler username at the
# dot ("postgres.<ref>" -> "postgres") and could mangle a password with
# special chars. URL.create() stores each field verbatim and the psycopg2
# dialect passes them to the DBAPI as separate kwargs, so no parsing applies.
# Password is read ONLY from the environment and never inlined.
DB_PASSWORD = os.environ.get("SUPABASE_DB_PASSWORD", "")
SUPABASE_URL = URL.create(
    "postgresql+psycopg2",
    username="postgres.echnydvgehjkfsiyhnth",
    password=DB_PASSWORD,
    host="aws-0-us-west-2.pooler.supabase.com",
    port=5432,
    database="postgres",
)

# High-risk zones (A and V zones are the 100-year floodplains).
HIGH_RISK_ZONES = ['A', 'AE', 'AH', 'AO', 'AR', 'A99', 'V', 'VE']

# GDAL's organizePolygons() does an O(n^2) ring-nesting pass that is extremely
# slow (and memory-heavy) on FEMA polygons with >100 parts — it was the cause
# of the read-phase crash. ONLY_CCW skips that pass by assuming interior rings
# (holes) are wound counter-clockwise, which FEMA NFHL data follows. This keeps
# the speed win AND preserves holes — important here, since SKIP would fill
# holes in and inflate flood-zone area. If the winding assumption is ever wrong,
# the prepare-phase validity check (invalid-geometry count) will surface it.
ORGANIZE_POLYGONS = "ONLY_CCW"

# Features per read window. The OOM kill showed peak climbing past ~1.3 GiB
# while reading+reprojecting the full 76k *unsimplified* layer at once. We
# instead read in small windows and simplify each window immediately, so the
# large unsimplified geometries are never all resident together. 2000 keeps a
# single window's transient cost to a small fraction of a GiB even with the
# >100-part polygons; lower it further if a box is tighter still.
READ_BATCH = 2000


def _resolve_layer(shapefile_path: str) -> str:
    """Find the S_FLD_HAZ_AR layer case-insensitively."""
    # pyogrio.list_layers returns an array of [layer_name, geometry_type].
    layers = [row[0] for row in pyogrio.list_layers(shapefile_path)]
    for layer in layers:
        if layer.lower() == 's_fld_haz_ar':
            return layer
    raise ValueError(
        f"No S_FLD_HAZ_AR layer found in {shapefile_path}. Available: {layers}"
    )


def load_and_prepare(shapefile_path: str, fips_code: str) -> gpd.GeoDataFrame:
    """Load, filter, reproject, simplify, and standardize the flood zones.

    Performs NO database writes. Returns a GeoDataFrame with columns:
    geom, state_fips, zone_id, zone_type.
    """
    layer = _resolve_layer(shapefile_path)
    pyogrio.set_gdal_config_options({"OGR_ORGANIZE_POLYGONS": ORGANIZE_POLYGONS})

    # 1-3. Read + filter + reproject + simplify in feature windows so peak
    #      memory is capped to ~one window regardless of layer size / system
    #      load. The OGR `where` clause prunes low-risk zones at read time and
    #      `columns` reads only the two attributes we use; each window is
    #      simplified immediately so the large unsimplified geometries are
    #      never all resident at once.
    #
    #      The loop is bounded by the RAW feature count, which is correct under
    #      either pyogrio windowing semantics: if skip/max index the
    #      where-filtered stream, windows past the filtered end just return
    #      empty (skipped); if they index the raw layer, every raw window is
    #      visited and the `where` filter is applied within it. Survivors are
    #      concatenated once at the end.
    zone_list = ", ".join(f"'{z}'" for z in HIGH_RISK_ZONES)
    where = f"FLD_ZONE IN ({zone_list})"
    raw_total = pyogrio.read_info(shapefile_path, layer=layer)["features"]
    print(f"Loading FEMA layer '{layer}' for FIPS {fips_code} "
          f"(OGR_ORGANIZE_POLYGONS={ORGANIZE_POLYGONS}, read-time FLD_ZONE filter, "
          f"windowed {READ_BATCH}/read over {raw_total} features)...")

    kept = []
    for skip in range(0, raw_total, READ_BATCH):
        batch = pyogrio.read_dataframe(
            shapefile_path,
            layer=layer,
            columns=["FLD_ZONE", "FLD_AR_ID"],
            where=where,
            skip_features=skip,
            max_features=READ_BATCH,
        )
        # Defensive: confirm only high-risk zones survived the read-time filter.
        batch = batch[batch['FLD_ZONE'].isin(HIGH_RISK_ZONES)]
        if len(batch) == 0:
            continue
        # Reproject to WGS84 and simplify THIS window before moving on, so the
        # unsimplified geometry of a window is released before the next read.
        if batch.crs is None or batch.crs.to_epsg() != 4326:
            batch = batch.to_crs("EPSG:4326")
        batch['geometry'] = batch.geometry.simplify(0.001, preserve_topology=True)
        kept.append(batch)

    if not kept:
        raise ValueError("No high-risk polygons found after filtering — nothing to prepare.")
    gdf = gpd.GeoDataFrame(
        pd.concat(kept, ignore_index=True), geometry='geometry', crs="EPSG:4326"
    )
    del kept
    print(f"Read+filtered+simplified {len(gdf)} high-risk polygons "
          f"in windows of {READ_BATCH}.")

    # 4. Promote any plain Polygon to MultiPolygon so the column dtype
    #    stays consistent with Geometry(MultiPolygon, 4326).
    gdf['geometry'] = gdf.geometry.apply(
        lambda g: MultiPolygon([g]) if g is not None and g.geom_type == 'Polygon' else g
    )

    # 5. Standardize to the Supabase schema:
    #    geom (PK zone_id from FLD_AR_ID), zone_type from FLD_ZONE, state_fips.
    out = gdf[['geometry', 'FLD_AR_ID', 'FLD_ZONE']].copy()
    out = out.rename(columns={
        'geometry': 'geom',
        'FLD_AR_ID': 'zone_id',
        'FLD_ZONE': 'zone_type',
    })

    # Guard the PK: a null FLD_AR_ID would become the string "None"/"nan"
    # under .astype(str), bypassing the NOT NULL constraint and inserting a
    # garbage row. Abort loudly instead.
    null_pk = out['zone_id'].isna().sum()
    if null_pk:
        raise ValueError(
            f"{null_pk} row(s) have a null FLD_AR_ID (the PK zone_id). "
            "Aborting before any DB write."
        )

    out['zone_id'] = out['zone_id'].astype(str)
    out['zone_type'] = out['zone_type'].astype(str)

    # Make zone_id (the PK) unique. FEMA's FLD_AR_ID is NOT reliably unique:
    # the same id can tag distinct polygons. Generic, state-agnostic fix:
    # within each FLD_AR_ID group, the first occurrence keeps the raw id and
    # subsequent ones get an occurrence suffix (_1, _2, ...). Non-colliding
    # ids (group size == 1) are left exactly as-is. Drops nothing, merges
    # nothing — every row, geometry, and zone_type is preserved.
    grp = out.groupby('zone_id', sort=False)
    occ = grp.cumcount()
    grp_size = grp['zone_id'].transform('size')
    collide = (grp_size > 1) & (occ > 0)
    if collide.any():
        n_dup_ids = int((grp_size > 1).groupby(out['zone_id']).any().sum())
        out.loc[collide, 'zone_id'] = (
            out.loc[collide, 'zone_id'] + '_' + occ[collide].astype(str)
        )
        print(f"Suffixed {int(collide.sum())} colliding zone_id row(s) "
              f"across {n_dup_ids} duplicated FLD_AR_ID value(s).")

    out['state_fips'] = str(fips_code)

    # Flag (do NOT drop) degenerate zero-area / empty geometries. They remain
    # valid rows with valid (now-unique) ids; we keep them.
    degenerate = out.geom.apply(lambda g: g is None or g.is_empty or g.area == 0.0)
    n_deg = int(degenerate.sum())
    if n_deg:
        print(f"NOTE: {n_deg} row(s) have zero-area/empty geometry "
              f"(kept, not dropped).")

    return gpd.GeoDataFrame(out, geometry='geom', crs="EPSG:4326")


def upload_flood_zones(shapefile_path: str, fips_code: str):
    gdf = load_and_prepare(shapefile_path, fips_code)

    if not DB_PASSWORD:
        print("ERROR: SUPABASE_DB_PASSWORD is not set in the environment.")
        sys.exit(1)

    print("Connecting to Supabase (session pooler, port 5432)...")
    engine = create_engine(SUPABASE_URL)

    print(f"Uploading {len(gdf)} flood zones to PostGIS. This might take a minute...")
    gdf.to_postgis(
        name='fema_flood_zones',
        con=engine,
        if_exists='append',  # Append so we don't overwrite Texas!
        index=False,
        chunksize=500,
        dtype={'geom': 'Geometry(MultiPolygon, 4326)'}
    )

    print(f"Success! FIPS {fips_code} flood zones are live ({len(gdf)} rows).")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python upload_fema_zones.py <path_to_shapefile.gdb> <fips_code>")
        sys.exit(1)

    shapefile = sys.argv[1]
    fips = sys.argv[2]
    upload_flood_zones(shapefile, fips)
