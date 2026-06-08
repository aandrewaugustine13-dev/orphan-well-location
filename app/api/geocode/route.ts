import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q");
  const postalcode = searchParams.get("postalcode");

  if (!q && !postalcode) {
    return NextResponse.json(
      { error: "Missing query parameter 'q' or 'postalcode'" },
      { status: 400 }
    );
  }

  try {
    let url = "";
    if (postalcode) {
      url = `https://nominatim.openstreetmap.org/search?format=json&countrycodes=us&postalcode=${encodeURIComponent(postalcode)}&limit=5`;
    } else {
      url = `https://nominatim.openstreetmap.org/search?format=json&countrycodes=us&limit=5&q=${encodeURIComponent(q!)}`;
    }

    const res = await fetch(url, {
      headers: {
        "Accept-Language": "en",
        "User-Agent": "OrphanWellLocator/1.0",
      },
      cache: "force-cache", // Next.js 15 data cache instruction
    });

    if (!res.ok) {
      throw new Error(`Nominatim error: ${res.statusText}`);
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Geocoding failed" },
      { status: 500 }
    );
  }
}
