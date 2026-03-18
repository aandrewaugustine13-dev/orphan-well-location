# Orphan Well Locator

An interactive map of 120,000+ abandoned and orphan oil & gas wells across the United States, built to help property owners, researchers, and policymakers understand well distribution and associated environmental risk.

## What It Does

- Renders orphan and abandoned wells on a dark-themed interactive map
- Queries wells spatially in real time as the map moves, using PostGIS radius functions
- Colors wells by **proximity** (distance from map center) or **inactivity** (years since last activity)
- Geocodes address and ZIP code searches via OpenStreetMap Nominatim
- Displays per-well metadata: API number, operator, county, inactivity duration, and estimated cleanup liability
- Overlays a toggleable **groundwater well** layer from USGS data

## Color Coding

**Proximity mode**
- Red — within 1 mile
- Amber — within 5 miles
- Green — 5+ miles

**Inactivity mode**
- Red — inactive 10+ years
- Amber — inactive 5–10 years
- Green — inactive under 5 years

## Data Sources

- **USGS National Water Information System** — domestic/groundwater wells
- **State regulatory agencies** — orphan well funds and plugging databases (27 states)
- **RBDMS** — Remedial Bonds and Decommissioning Management System records

## Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript |
| Mapping | Leaflet + react-leaflet |
| Database | Supabase (PostgreSQL + PostGIS) |
| Styling | Tailwind CSS |
| Geocoding | OpenStreetMap Nominatim |
| Deployment | Vercel |

## Architecture

The frontend is a Next.js client component that fetches wells from Supabase on every map `moveend` event (debounced 300ms). Spatial queries run through two Supabase RPC functions backed by PostGIS:

- `get_wells_in_radius(lng, lat, radius_meters)` — orphan wells
- `get_groundwater_wells_in_radius(lng, lat, radius_meters)` — USGS water wells

Both functions return pre-calculated `miles_away` values. No API routes are needed — the Supabase client runs in the browser with a public anon key against a read-only dataset.

## Local Setup

**Prerequisites:** Node.js 18+, a Supabase project with PostGIS enabled

```bash
git clone https://github.com/your-username/orphan-well-location
cd orphan-well-location
npm install
cp .env.local.example .env.local
# Fill in NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
npm run dev
```

### Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

**Vercel:** Add both variables in Settings → Environment Variables, check all three environment boxes (Production, Preview, Development), then redeploy with build cache cleared.

## Database

The `wells` and `groundwater_wells` tables use PostGIS `geography` columns for spatial indexing. RPC functions compute distances server-side, keeping client payloads small. Schema and functions are managed via the Supabase dashboard. Well data was imported from state agency CSVs and JSONL exports, enriched with `months_inactive` and `liability_est` values, then bulk-loaded.

## Coverage

27 states, with particular depth in Oklahoma, Texas, and other major oil-producing regions. National groundwater coverage via USGS NWIS.

## License

MIT
