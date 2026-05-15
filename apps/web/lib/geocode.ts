// Pluggable geocoder. Defaults to Nominatim (free, no key) for dev; set
// GEOCODER=mapbox + MAPBOX_TOKEN for production.

export interface GeocodeResult {
  lat: number;
  lng: number;
  matched: string;
  source: "nominatim" | "mapbox";
}

const AU_BOUNDS = {
  minLat: -43.7,
  maxLat: -9.0,
  minLng: 112.0,
  maxLng: 154.0,
};

function inAustralia(lat: number, lng: number) {
  return (
    lat >= AU_BOUNDS.minLat &&
    lat <= AU_BOUNDS.maxLat &&
    lng >= AU_BOUNDS.minLng &&
    lng <= AU_BOUNDS.maxLng
  );
}

async function geocodeNominatim(address: string): Promise<GeocodeResult | null> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", `${address}, Australia`);
  url.searchParams.set("format", "json");
  url.searchParams.set("countrycodes", "au");
  url.searchParams.set("limit", "1");
  url.searchParams.set("addressdetails", "0");

  const res = await fetch(url, {
    headers: {
      // Nominatim usage policy requires identifying UA + contact.
      "user-agent": "democracy.au/0.1 (+https://democracy.au)",
      "accept-language": "en-AU,en;q=0.9",
    },
  });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  const arr = (await res.json()) as Array<{
    lat: string;
    lon: string;
    display_name: string;
  }>;
  const hit = arr[0];
  if (!hit) return null;
  const lat = Number(hit.lat);
  const lng = Number(hit.lon);
  if (!inAustralia(lat, lng)) return null;
  return { lat, lng, matched: hit.display_name, source: "nominatim" };
}

async function geocodeMapbox(address: string): Promise<GeocodeResult | null> {
  const token = process.env.MAPBOX_TOKEN;
  if (!token) throw new Error("MAPBOX_TOKEN missing");
  const url = new URL(
    `https://api.mapbox.com/search/geocode/v6/forward`,
  );
  url.searchParams.set("q", `${address}, Australia`);
  url.searchParams.set("country", "au");
  url.searchParams.set("limit", "1");
  url.searchParams.set("access_token", token);

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Mapbox HTTP ${res.status}`);
  const json = (await res.json()) as {
    features?: Array<{
      properties: { full_address?: string; place_formatted?: string };
      geometry: { coordinates: [number, number] };
    }>;
  };
  const f = json.features?.[0];
  if (!f) return null;
  const [lng, lat] = f.geometry.coordinates;
  if (!inAustralia(lat, lng)) return null;
  return {
    lat,
    lng,
    matched: f.properties.full_address ?? f.properties.place_formatted ?? "",
    source: "mapbox",
  };
}

export async function geocode(address: string): Promise<GeocodeResult | null> {
  const provider = (process.env.GEOCODER ?? "nominatim").toLowerCase();
  if (provider === "mapbox" && process.env.MAPBOX_TOKEN) {
    return geocodeMapbox(address);
  }
  return geocodeNominatim(address);
}
