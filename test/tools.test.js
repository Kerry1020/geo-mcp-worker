import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { tool, mockFetch, noUpstream, restoreFetch } from "./helpers.js";

afterEach(() => restoreFetch());

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

// ── geo_geocode ──

test("geocode: success maps Nominatim results", async () => {
  const calls = mockFetch(() => [
    { lat: "31.1695012345", lon: "121.4538661234", display_name: "云锦路, 徐汇区, 上海市", type: "residential", importance: 0.42, address: { road: "云锦路" } },
  ]);
  const { result, sc } = await tool("geo_geocode", { address: " 上海市徐汇区云锦路 ", limit: 3 });
  assert.equal(result.isError, undefined);
  assert.equal(sc.ok, true);
  assert.equal(sc.query, "上海市徐汇区云锦路");
  assert.deepEqual(sc.results[0], { lat: 31.169501, lon: 121.453866, display_name: "云锦路, 徐汇区, 上海市", type: "residential", importance: 0.42, address: { road: "云锦路" } });
  assert.deepEqual(JSON.parse(result.content[0].text), sc);
  const u = new URL(calls[0].url);
  assert.equal(u.origin + u.pathname, "https://nominatim.openstreetmap.org/search");
  assert.equal(u.searchParams.get("q"), "上海市徐汇区云锦路");
  assert.equal(u.searchParams.get("limit"), "3");
  assert.equal(u.searchParams.get("accept-language"), "zh");
  assert.match(calls[0].init.headers["User-Agent"], /geo-mcp-worker/);
  assert.ok(calls[0].init.signal, "request has a timeout signal");
});

test("geocode: limit is clamped to 1..10", async () => {
  const calls = mockFetch(() => []);
  await tool("geo_geocode", { address: "x", limit: 999 });
  await tool("geo_geocode", { address: "x", limit: -5 });
  await tool("geo_geocode", { address: "x", limit: "abc" });
  assert.deepEqual(calls.map((c) => new URL(c.url).searchParams.get("limit")), ["10", "1", "1"]);
});

test("geocode: not found", async () => {
  mockFetch(() => []);
  const { result, sc } = await tool("geo_geocode", { address: "nowhere" });
  assert.equal(sc.ok, false);
  assert.equal(sc.reason, "not_found");
  assert.equal(result.isError, true);
});

test("geocode: input validation", async () => {
  noUpstream();
  assert.equal((await tool("geo_geocode", {})).sc.reason, "missing_address");
  assert.equal((await tool("geo_geocode", { address: "   " })).sc.reason, "missing_address");
  assert.equal((await tool("geo_geocode", { address: 123 })).sc.reason, "invalid_address");
  assert.equal((await tool("geo_geocode", { address: "a".repeat(501) })).sc.reason, "invalid_address");
});

test("geocode: upstream HTTP error", async () => {
  mockFetch(() => json({}, 503));
  const { sc } = await tool("geo_geocode", { address: "x" });
  assert.deepEqual(sc, { ok: false, reason: "geocode_error", message: "nominatim_search: 503" });
});

test("geocode: upstream non-JSON body", async () => {
  mockFetch(() => new Response("<html>", { status: 200 }));
  const { sc } = await tool("geo_geocode", { address: "x" });
  assert.equal(sc.reason, "geocode_error");
  assert.match(sc.message, /invalid JSON/);
});

test("geocode: upstream timeout", async () => {
  mockFetch((url, init) => new Promise((_, reject) => {
    init.signal.addEventListener("abort", () => reject(init.signal.reason));
  }));
  const { sc } = await tool("geo_geocode", { address: "x" }, { env: { UPSTREAM_TIMEOUT_MS: "20" } });
  assert.equal(sc.ok, false);
  assert.equal(sc.reason, "upstream_timeout");
  assert.match(sc.message, /timeout after 20ms/);
});

test("geocode: network error", async () => {
  mockFetch(() => { throw new TypeError("fetch failed"); });
  const { sc } = await tool("geo_geocode", { address: "x" });
  assert.equal(sc.reason, "geocode_error");
  assert.match(sc.message, /network error/);
});

// ── geo_reverse ──

test("reverse: success", async () => {
  const calls = mockFetch(() => ({ display_name: "云锦路", address: { road: "云锦路" } }));
  const { sc } = await tool("geo_reverse", { lat: 31.1695012, lon: "121.4538661" });
  assert.deepEqual(sc, { ok: true, lat: 31.169501, lon: 121.453866, display_name: "云锦路", address: { road: "云锦路" } });
  const u = new URL(calls[0].url);
  assert.equal(u.pathname, "/reverse");
  assert.equal(u.searchParams.get("lat"), "31.1695012");
});

test("reverse: Nominatim error payload", async () => {
  mockFetch(() => ({ error: "Unable to geocode" }));
  const { sc } = await tool("geo_reverse", { lat: 0, lon: 0 });
  assert.deepEqual(sc, { ok: false, reason: "not_found", message: "Unable to geocode" });
});

test("reverse: coordinate validation", async () => {
  noUpstream();
  assert.equal((await tool("geo_reverse", { lat: 1 })).sc.reason, "missing_coords");
  assert.equal((await tool("geo_reverse", { lat: 91, lon: 0 })).sc.reason, "invalid_coords");
  assert.equal((await tool("geo_reverse", { lat: 0, lon: -180.5 })).sc.reason, "invalid_coords");
  assert.equal((await tool("geo_reverse", { lat: "abc", lon: 0 })).sc.reason, "invalid_coords");
  assert.equal((await tool("geo_reverse", { lat: "", lon: 0 })).sc.reason, "invalid_coords");
  assert.equal((await tool("geo_reverse", { lat: true, lon: 0 })).sc.reason, "invalid_coords");
});

// ── geo_find_poi ──

const overpass = {
  elements: [
    { type: "node", lat: 31.176, lon: 121.4538, tags: { name: "Far", cuisine: "noodle" } },
    { type: "way", center: { lat: 31.1700, lon: 121.4539 }, tags: { "name:zh": "近处" } },
    { type: "way", tags: { name: "no coords" } },
  ],
};

test("find_poi: sorts by distance, keeps ways via center", async () => {
  const calls = mockFetch(() => overpass);
  const { sc } = await tool("geo_find_poi", { lat: 31.169501, lon: 121.453866, category: "cafe", radius_m: 2000, limit: 5 });
  assert.equal(sc.ok, true);
  assert.equal(sc.count, 2);
  assert.deepEqual(sc.center, { lat: 31.169501, lon: 121.453866 });
  assert.deepEqual(sc.results.map((r) => r.name), ["近处", "Far"]);
  assert.ok(sc.results[0].distance_m < sc.results[1].distance_m);
  assert.equal(sc.results[1].tags.cuisine, "noodle");
  assert.equal(calls[0].init.method, "POST");
  const q = decodeURIComponent(calls[0].init.body.replace(/^data=/, ""));
  assert.match(q, /node\["amenity"="cafe"\]\(around:2000,31\.169501,121\.453866\)/);
  assert.match(q, /out center \d+;/);
});

test("find_poi: limit truncates results", async () => {
  mockFetch(() => overpass);
  const { sc } = await tool("geo_find_poi", { lat: 31.17, lon: 121.45, limit: 1 });
  assert.equal(sc.count, 1);
});

test("find_poi: empty result is ok with poi_not_found", async () => {
  mockFetch(() => ({ elements: [] }));
  const { result, sc } = await tool("geo_find_poi", { lat: 31.17, lon: 121.45, category: "subway", radius_m: 99999 });
  assert.equal(sc.ok, true);
  assert.equal(sc.count, 0);
  assert.equal(sc.reason, "poi_not_found");
  assert.match(sc.message, /5000m/);
  assert.equal(result.isError, undefined);
});

test("find_poi: default category and clamped radius", async () => {
  const calls = mockFetch(() => ({ elements: [] }));
  await tool("geo_find_poi", { lat: 31.17, lon: 121.45, radius_m: -10 });
  const q = decodeURIComponent(calls[0].init.body.replace(/^data=/, ""));
  assert.match(q, /\["amenity"="restaurant"\]\(around:1,/);
});

test("find_poi: custom safe category falls back to amenity", async () => {
  const calls = mockFetch(() => ({ elements: [] }));
  await tool("geo_find_poi", { lat: 31.17, lon: 121.45, category: "bar" });
  assert.match(decodeURIComponent(calls[0].init.body), /\["amenity"="bar"\]/);
});

test("find_poi: rejects Overpass QL injection in category", async () => {
  noUpstream();
  for (const category of ['x"];out;', "Restaurant", "", 5, "a b"]) {
    const { sc } = await tool("geo_find_poi", { lat: 31.17, lon: 121.45, category });
    assert.equal(sc.reason, "invalid_category", String(category));
  }
});

test("find_poi: coordinate validation", async () => {
  noUpstream();
  assert.equal((await tool("geo_find_poi", { lon: 1 })).sc.reason, "missing_coords");
  assert.equal((await tool("geo_find_poi", { lat: -91, lon: 1 })).sc.reason, "invalid_coords");
});

test("find_poi: upstream error", async () => {
  mockFetch(() => json({}, 429));
  const { sc } = await tool("geo_find_poi", { lat: 31.17, lon: 121.45 });
  assert.deepEqual(sc, { ok: false, reason: "poi_error", message: "overpass: 429" });
});

// ── geo_route ──

const from = { lat: 31.169501, lon: 121.453866 };
const to = { lat: 31.240168, lon: 121.497945 };

test("route: driving uses OSRM car profile, lon,lat order", async () => {
  const calls = mockFetch(() => ({ code: "Ok", routes: [{ distance: 12609.4, duration: 882 }] }));
  const { sc } = await tool("geo_route", { from, to });
  assert.deepEqual(sc, { ok: true, from, to, distance_m: 12609, duration_min: 14.7, mode: "driving", confidence: "high" });
  assert.equal(calls[0].url, "https://router.project-osrm.org/route/v1/car/121.453866,31.169501;121.497945,31.240168?overview=false");
});

test("route: walking uses foot router and long-distance calibration", async () => {
  const calls = mockFetch(() => ({ code: "Ok", routes: [{ distance: 7352, duration: 5000 }] }));
  const { sc } = await tool("geo_route", { from, to, mode: "walking" });
  assert.equal(sc.duration_min, 91.9);
  assert.equal(sc.confidence, "low");
  assert.match(calls[0].url, /^https:\/\/routing\.openstreetmap\.de\/routed-foot\/route\/v1\/foot\//);
});

test("route: short walk keeps OSRM duration", async () => {
  mockFetch(() => ({ code: "Ok", routes: [{ distance: 500, duration: 360 }] }));
  const { sc } = await tool("geo_route", { from, to, mode: "walking" });
  assert.equal(sc.duration_min, 6);
  assert.equal(sc.confidence, "high");
});

test("route: cycling uses bike router; URLs overridable via env", async () => {
  const calls = mockFetch(() => ({ code: "Ok", routes: [{ distance: 1, duration: 60 }] }));
  await tool("geo_route", { from, to, mode: "cycling" });
  assert.match(calls[0].url, /routed-bike\/route\/v1\/bike\//);
  await tool("geo_route", { from, to, mode: "cycling" }, { env: { OSRM_URL_CYCLING: "https://osrm.internal/" } });
  assert.match(calls[1].url, /^https:\/\/osrm\.internal\/route\/v1\/bike\//);
});

test("route: no route found", async () => {
  mockFetch(() => ({ code: "NoRoute", routes: [] }));
  const { sc } = await tool("geo_route", { from, to });
  assert.equal(sc.reason, "route_error");
  assert.match(sc.message, /no route found/);
});

test("route: validation", async () => {
  noUpstream();
  assert.equal((await tool("geo_route", { from })).sc.reason, "missing_points");
  assert.equal((await tool("geo_route", { from: { lat: 1 }, to })).sc.reason, "missing_coords");
  assert.equal((await tool("geo_route", { from: "31,121", to })).sc.reason, "missing_coords");
  assert.equal((await tool("geo_route", { from: { lat: 100, lon: 0 }, to })).sc.reason, "invalid_coords");
  assert.equal((await tool("geo_route", { from, to, mode: "flying" })).sc.reason, "invalid_mode");
});
