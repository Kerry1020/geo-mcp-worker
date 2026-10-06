// Upstream API clients: Nominatim (geocoding), Overpass (POI), OSRM (routing).
// All calls go through fetchJson, which enforces a timeout and normalises errors.

import { haversineMeters, round6 } from "./util.js";

export class UpstreamError extends Error {
  constructor(source, message, { timeout = false, status } = {}) {
    super(`${source}: ${message}`);
    this.name = "UpstreamError";
    this.source = source;
    this.timeout = timeout;
    this.status = status;
  }
}

export async function fetchJson(source, url, init, cfg) {
  let res;
  try {
    res = await fetch(url, {
      ...init,
      headers: { "User-Agent": cfg.userAgent, Accept: "application/json", ...(init && init.headers) },
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });
  } catch (e) {
    if (e && (e.name === "TimeoutError" || e.name === "AbortError")) {
      throw new UpstreamError(source, `timeout after ${cfg.timeoutMs}ms`, { timeout: true });
    }
    throw new UpstreamError(source, `network error: ${e && e.message ? e.message : String(e)}`);
  }
  if (!res.ok) throw new UpstreamError(source, String(res.status), { status: res.status });
  try {
    return await res.json();
  } catch {
    throw new UpstreamError(source, "invalid JSON response", { status: res.status });
  }
}

// ── Nominatim ──

export async function nominatimSearch(cfg, query, limit = 1) {
  const params = new URLSearchParams({
    q: query,
    format: "json",
    limit: String(limit),
    "accept-language": cfg.acceptLanguage,
    addressdetails: "1",
  });
  const data = await fetchJson("nominatim_search", `${cfg.nominatimUrl}/search?${params}`, {}, cfg);
  return Array.isArray(data) ? data : [];
}

export async function nominatimReverse(cfg, lat, lon) {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    format: "json",
    "accept-language": cfg.acceptLanguage,
    addressdetails: "1",
  });
  return await fetchJson("nominatim_reverse", `${cfg.nominatimUrl}/reverse?${params}`, {}, cfg);
}

// ── Overpass ──

export const POI_OSM_FILTERS = {
  restaurant: '["amenity"="restaurant"]',
  cafe: '["amenity"="cafe"]',
  school: '["amenity"="school"]',
  hospital: '["amenity"="hospital"]',
  clinic: '["amenity"="clinic"]',
  pharmacy: '["amenity"="pharmacy"]',
  bank: '["amenity"="bank"]',
  atm: '["amenity"="atm"]',
  supermarket: '["shop"="supermarket"]',
  convenience: '["shop"="convenience"]',
  subway: '["station"="subway"]',
  bus_stop: '["highway"="bus_stop"]',
  park: '["leisure"="park"]',
  gym: '["leisure"="fitness_centre"]',
  cinema: '["amenity"="cinema"]',
  library: '["amenity"="library"]',
  kindergarten: '["amenity"="kindergarten"]',
  police: '["amenity"="police"]',
  fire_station: '["amenity"="fire_station"]',
  post_office: '["amenity"="post_office"]',
  parking: '["amenity"="parking"]',
  fuel: '["amenity"="fuel"]',
  marketplace: '["amenity"="marketplace"]',
};

// Unknown categories fall back to amenity=<category>; restrict them to a safe
// charset so user input can never break out of the Overpass QL string.
export const CUSTOM_CATEGORY_RE = /^[a-z0-9_]{1,40}$/;

export function poiFilter(category) {
  if (Object.prototype.hasOwnProperty.call(POI_OSM_FILTERS, category)) return POI_OSM_FILTERS[category];
  if (CUSTOM_CATEGORY_RE.test(category)) return `["amenity"="${category}"]`;
  return null;
}

export async function overpassPOI(cfg, lat, lon, radius, category, limit) {
  const filter = poiFilter(category);
  if (!filter) throw new Error(`invalid category: ${category}`);
  const qlTimeout = Math.max(1, Math.ceil(cfg.timeoutMs / 1000));
  // Overpass cannot sort by distance, so fetch a larger candidate set and sort locally.
  // `out center` gives ways a centre point (plain `out body` drops their coordinates).
  const fetchCount = Math.min(250, Math.max(100, limit * 5));
  const around = `(around:${radius},${lat},${lon})`;
  const query = `[out:json][timeout:${qlTimeout}];(node${filter}${around};way${filter}${around};);out center ${fetchCount};`;
  const data = await fetchJson(
    "overpass",
    cfg.overpassUrl,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
    },
    cfg,
  );
  return (Array.isArray(data && data.elements) ? data.elements : [])
    .map((e) => {
      const tags = e.tags || {};
      const elat = e.lat ?? (e.center && e.center.lat);
      const elon = e.lon ?? (e.center && e.center.lon);
      if (elat == null || elon == null) return null;
      return {
        name: tags.name || tags["name:zh"] || "",
        lat: round6(elat),
        lon: round6(elon),
        distance_m: Math.round(haversineMeters(lat, lon, elat, elon)),
        category,
        tags: {
          cuisine: tags.cuisine,
          opening_hours: tags.opening_hours,
          phone: tags.phone,
          website: tags.website,
          operator: tags.operator,
        },
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.distance_m - b.distance_m)
    .slice(0, limit);
}

// ── OSRM ──

export const ROUTE_MODES = ["driving", "walking", "cycling"];
const OSRM_PROFILE = { driving: "car", walking: "foot", cycling: "bike" };

export async function osrmRoute(cfg, fromLat, fromLon, toLat, toLon, mode = "driving") {
  const base = cfg.osrmUrls[mode];
  const profile = OSRM_PROFILE[mode];
  if (!base || !profile) throw new Error(`invalid mode: ${mode}`);
  const url = `${base}/route/v1/${profile}/${fromLon},${fromLat};${toLon},${toLat}?overview=false`;
  const data = await fetchJson("osrm", url, {}, cfg);
  if (!data || !Array.isArray(data.routes) || !data.routes.length) {
    throw new UpstreamError("osrm", data && data.code && data.code !== "Ok" ? `no route found (${data.code})` : "no route found");
  }
  const r = data.routes[0];
  const distance_m = Math.round(r.distance);
  let duration_min = +(r.duration / 60).toFixed(1);
  let confidence = "high";
  // Kept for backward compatibility: long walking legs are re-estimated at
  // 80 m/min (~4.8 km/h) and flagged as low confidence.
  if (mode === "walking" && distance_m > 2000) {
    duration_min = +(distance_m / 80).toFixed(1);
    confidence = "low";
  }
  return { distance_m, duration_min, mode, confidence };
}
