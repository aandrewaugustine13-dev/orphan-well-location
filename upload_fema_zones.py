import geopandas as gpd
from sqlalchemy import create_engine
import sys

# --- CONFIGURATION ---
# Replace with your actual Supabase connection string
# Make sure it uses 'postgresql://' not 'postgres://' for SQLAlchemy
SUPABASE_URL = "postgresql://postgres.echnydvgehjkfsiyhnth:[YOUR_PASSWORD]@aws-0-us-east-1.pooler.supabase.com:6543/postgres"

def upload_flood_zones(shapefile_path: str, fips_code: str):
    print(f"Loading FEMA shapefile for FIPS {fips_code}...")
    
    # 1. Read the shapefile
    # FEMA uses 'S_Fld_Haz_Ar' for the actual flood polygons
    gdf = gpd.read_file(shapefile_path, layer='S_Fld_Haz_Ar')
    
    # 2. Filter for high-risk zones (A and V zones are the 100-year floodplains)
    # We drop the low-risk zones to save massive amounts of database space
    high_risk_zones = ['A', 'AE', 'AH', 'AO', 'AR', 'A99', 'V', 'VE']
    gdf = gdf[gdf['FLD_ZONE'].isin(high_risk_zones)].copy()
    
    # 3. Ensure the coordinate system matches PostGIS/Leaflet (WGS84)
    if gdf.crs != "EPSG:4326":
        print("Reprojecting to EPSG:4326...")
        gdf = gdf.to_crs("EPSG:4326")
    
    # 4. Standardize the dataframe to match your Supabase schema
    # Your schema expects: geom (geometry) and state_fips (text)
    gdf = gdf[['geometry']]
    gdf['state_fips'] = str(fips_code)
    
    # Rename 'geometry' to 'geom' to match PostGIS
    gdf = gdf.rename(columns={'geometry': 'geom'})
    
    # 5. Connect and Push to Supabase
    print("Connecting to Supabase...")
    engine = create_engine(SUPABASE_URL)
    
    print(f"Uploading {len(gdf)} flood zones to PostGIS. This might take a minute...")
    gdf.to_postgis(
        name='fema_flood_zones',
        con=engine,
        if_exists='append', # Append so we don't overwrite Texas!
        index=False,
        dtype={'geom': 'Geometry(MultiPolygon, 4326)'}
    )
    
    print(f"Success! FIPS {fips_code} flood zones are live.")

if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python upload_fema_zones.py <path_to_shapefile.gdb> <fips_code>")
        sys.exit(1)
        
    shapefile = sys.argv[1]
    fips = sys.argv[2]
    upload_flood_zones(shapefile, fips)
