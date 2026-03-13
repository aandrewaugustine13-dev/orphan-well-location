# Orphan Well Locator

Real-time map for locating abandoned oil & gas wells in West Texas. Built with Next.js, Leaflet, PostGIS, and Supabase.

## What It Does

Pan the map and the app queries a PostGIS-enabled Supabase database for orphan wells within your search radius. Wells are color-coded by proximity:

- **Red** — within 1 mile
- **Amber** — within 5 miles
- **Green** — 5+ miles

## Stack

- **Framework:** Next.js 15 (App Router)
- **Mapping:** react-leaflet with CartoDB Dark Matter tiles
- **Database:** Supabase (PostgreSQL + PostGIS)
- **Styling:** Tailwind CSS + custom dark theme

## Setup

1. Clone the repo
2. Copy `.env.local.example` to `.env.local` and add your Supabase credentials
3. `npm install`
4. `npm run dev`

## Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

**Vercel deployment:** Add both variables in Settings → Environment Variables. Check all three boxes (Production, Preview, Development). Redeploy with build cache disabled.

## Supabase RPC

The app calls `get_wells_in_radius(user_lng, user_lat, radius_meters)` which returns `well_name`, `api_number`, `latitude`, `longitude`, and `miles_away`.
