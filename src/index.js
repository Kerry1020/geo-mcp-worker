// geo-mcp-worker — Geo MCP Server for CF Workers
// Provides geocoding, POI search, and routing via Nominatim/Overpass/OSRM
// No KV, no auth, fully stateless

var SERVER_NAME = "geo-mcp-worker";
var SERVER_VERSION = "1.0.0";
var BUILD_SHA = "unknown";
var BUILD_TIME = "unknown";

// ── Helpers ──

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

function jsonRpcError(id, code, message, status = 400) {
  return json({ jsonrpc: "2.0", id, error: { code, message } }, status);
}

function mcpResult(id, content, structuredContent) {
  return json({
    jsonrpc: "2.0",
    id,
    result: {
      content: [{ type: "text", text: typeof content === "string" ? content : JSON.stringify(content) }],
      structuredContent: structuredContent || content,
    },
  });
}

function mcpError(id, code, message) {
  return json({
    jsonrpc: "2.0",
    id,
    error: { code, message },
  });
}

function safeLat(v) { return Math.max(-90, Math.min(90, Number(v) || 0)); }
function safeLon(v) { return Math.max(-180, Math.min(180, Number(v) || 0)); }
function round6(v) { return Number(Number(v).toFixed(6)); }

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── API Clients ──

async function nominatimSearch(query, limit = 1) {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=${limit}&accept-language=zh&addressdetails=1`;
  const res = await fetch(url, { headers: { "User-Agent": "GeoMCP/1.0" }, signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`nominatim_search: ${res.status}`);
  return await res.json();
}

async function nominatimReverse(lat, lon) {
  const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=zh&addressdetails=1`;
  const res = await fetch(url, { headers: { "User-Agent": "GeoMCP/1.0" }, signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`nominatim_reverse: ${res.status}`);
  return await res.json();
}

const POI_OSM_FILTERS = {
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

async function overpassPOI(lat, lon, radius = 1000, category = "restaurant", limit = 20) {
  const filter = POI_OSM_FILTERS[category] || `["amenity"="${category}"]`;
  const query = `[out:json][timeout:10];(node${filter}(around:${radius},${lat},${lon});way${filter}(around:${radius},${lat},${lon}););out body ${Math.min(limit, 50)};`;
  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "User-Agent": "GeoMCP/1.0", "Content-Type": "application/x-www-form-urlencoded" },
    body: `data=${encodeURIComponent(query)}`,
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`overpass: ${res.status}`);
  const data = await res.json();
  return (data.elements || []).map((e) => {
    const tags = e.tags || {};
    const elat = e.lat || (e.center && e.center.lat);
    const elon = e.lon || (e.center && e.center.lon);
    if (elat == null || elon == null) return null;
    return {
      name: tags.name || tags["name:zh"] || "",
      lat: round6(elat),
      lon: round6(elon),
      distance_m: Math.round(haversineMeters(lat, lon, elat, elon)),
      category,
      tags: { cuisine: tags.cuisine, opening_hours: tags.opening_hours, phone: tags.phone, website: tags.website, operator: tags.operator },
    };
  }).filter(Boolean).sort((a, b) => a.distance_m - b.distance_m).slice(0, limit);
}

async function osrmRoute(fromLat, fromLon, toLat, toLon, mode = "driving") {
  const profile = mode === "walking" ? "foot" : mode === "cycling" ? "bike" : "car";
  const url = `https://router.project-osrm.org/route/v1/${profile}/${fromLon},${fromLat};${toLon},${toLat}?overview=false`;
  const res = await fetch(url, { headers: { "User-Agent": "GeoMCP/1.0" }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`osrm: ${res.status}`);
  const data = await res.json();
  if (!data.routes || !data.routes.length) throw new Error("osrm: no route found");
  const r = data.routes[0];
  return { distance_m: Math.round(r.distance), duration_min: +(r.duration / 60).toFixed(1), mode };
}

// ── Tool Handlers ──

async function handleGeocode(args) {
  const { address, limit = 1 } = args;
  if (!address) return { ok: false, reason: "missing_address", message: "address 参数必填" };
  try {
    const results = await nominatimSearch(address, Math.min(limit, 10));
    if (!results.length) return { ok: false, reason: "not_found", message: `未找到地址: ${address}` };
    return {
      ok: true,
      query: address,
      results: results.map((r) => ({
        lat: round6(r.lat),
        lon: round6(r.lon),
        display_name: r.display_name,
        type: r.type,
        importance: r.importance,
        address: r.address,
      })),
    };
  } catch (e) {
    return { ok: false, reason: "geocode_error", message: e.message };
  }
}

async function handleReverseGeocode(args) {
  const { lat, lon } = args;
  if (lat == null || lon == null) return { ok: false, reason: "missing_coords", message: "lat 和 lon 参数必填" };
  try {
    const data = await nominatimReverse(safeLat(lat), safeLon(lon));
    if (data.error) return { ok: false, reason: "not_found", message: data.error };
    return {
      ok: true,
      lat: round6(lat),
      lon: round6(lon),
      display_name: data.display_name,
      address: data.address,
    };
  } catch (e) {
    return { ok: false, reason: "reverse_error", message: e.message };
  }
}

async function handleFindPOI(args) {
  const { lat, lon, radius_m = 1000, category = "restaurant", limit = 20 } = args;
  if (lat == null || lon == null) return { ok: false, reason: "missing_coords", message: "lat 和 lon 参数必填" };
  try {
    const results = await overpassPOI(safeLat(lat), safeLon(lon), Math.min(radius_m, 5000), category, Math.min(limit, 50));
    if (!results.length) return { ok: true, center: { lat: round6(lat), lon: round6(lon) }, results: [], count: 0, reason: "poi_not_found", message: `在 ${radius_m}m 半径内未找到 ${category} 类型设施` };
    return { ok: true, center: { lat: round6(lat), lon: round6(lon) }, results, count: results.length };
  } catch (e) {
    return { ok: false, reason: "poi_error", message: e.message };
  }
}

async function handleRoute(args) {
  const { from, to, mode = "driving" } = args;
  if (!from || !to) return { ok: false, reason: "missing_points", message: "from 和 to 参数必填，格式: {lat, lon}" };
  if (from.lat == null || from.lon == null || to.lat == null || to.lon == null) return { ok: false, reason: "missing_coords", message: "from/to 必须包含 lat 和 lon" };
  try {
    const result = await osrmRoute(safeLat(from.lat), safeLon(from.lon), safeLat(to.lat), safeLon(to.lon), mode);
    return {
      ok: true,
      from: { lat: round6(from.lat), lon: round6(from.lon) },
      to: { lat: round6(to.lat), lon: round6(to.lon) },
      ...result,
    };
  } catch (e) {
    return { ok: false, reason: "route_error", message: e.message };
  }
}

// ── MCP Tool Definitions ──

const TOOLS = [
  {
    name: "geo_geocode",
    description: "将地址文本转换为经纬度坐标（正向地理编码）。支持中文地址。使用 OpenStreetMap Nominatim，免费无需 API key。返回坐标、完整地址、类型和重要性。当 search_mcp 返回房源地址时，先用此工具转为坐标，再调用 geo_find_poi 查询周边设施。",
    inputSchema: {
      type: "object",
      properties: {
        address: { type: "string", description: "地址文本，如'上海市浦东新区陆家嘴环路1088号'" },
        limit: { type: "number", description: "返回结果数量上限（1-10，默认1）", default: 1 },
      },
      required: ["address"],
    },
  },
  {
    name: "geo_reverse",
    description: "将经纬度坐标转换为地址文本（逆向地理编码）。验证坐标对应的实际地址，返回省市区街道等结构化地址信息。",
    inputSchema: {
      type: "object",
      properties: {
        lat: { type: "number", description: "纬度" },
        lon: { type: "number", description: "经度" },
      },
      required: ["lat", "lon"],
    },
  },
  {
    name: "geo_find_poi",
    description: "搜索指定坐标周边的兴趣点（POI）。支持餐厅、学校、医院、地铁站、超市、公园等 20+ 类型。返回名称、距离、分类标签。用于评估房源周边生活配套：地铁站步行距离、最近的学校/医院等。基于 OpenStreetMap Overpass API，免费无需 API key。",
    inputSchema: {
      type: "object",
      properties: {
        lat: { type: "number", description: "中心点纬度" },
        lon: { type: "number", description: "中心点经度" },
        radius_m: { type: "number", description: "搜索半径（米），默认1000，最大5000", default: 1000 },
        category: { type: "string", description: "POI 类型。可选: restaurant, cafe, school, hospital, clinic, pharmacy, bank, atm, supermarket, convenience, subway, bus_stop, park, gym, cinema, library, kindergarten, police, fire_station, post_office, parking, fuel, marketplace", default: "restaurant" },
        limit: { type: "number", description: "返回结果数量上限（1-50，默认20）", default: 20 },
      },
      required: ["lat", "lon"],
    },
  },
  {
    name: "geo_route",
    description: "计算两个坐标点之间的路径距离和时间。支持驾车、步行、骑行三种模式。用于评估房源到地铁站/学校的实际通勤时间。基于 OSRM 开源路由引擎，免费无需 API key。",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "object", description: "起点坐标", properties: { lat: { type: "number" }, lon: { type: "number" } }, required: ["lat", "lon"] },
        to: { type: "object", description: "终点坐标", properties: { lat: { type: "number" }, lon: { type: "number" } }, required: ["lat", "lon"] },
        mode: { type: "string", description: "出行方式: driving / walking / cycling", default: "driving", enum: ["driving", "walking", "cycling"] },
      },
      required: ["from", "to"],
    },
  },
];

const TOOL_MAP = {
  geo_geocode: handleGeocode,
  geo_reverse: handleReverseGeocode,
  geo_find_poi: handleFindPOI,
  geo_route: handleRoute,
};

// ── Request Handler ──

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" },
      });
    }

    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/health" || url.pathname === "/healthz") {
      return json({
        ok: true,
        name: SERVER_NAME,
        version: SERVER_VERSION,
        build: { sha: BUILD_SHA, time: BUILD_TIME },
        tools: TOOLS.map((t) => t.name),
        data_sources: ["nominatim", "overpass", "osrm"],
      });
    }

    if (url.pathname !== "/mcp") return jsonRpcError(null, -32004, "not found", 404);
    if (request.method !== "POST") return jsonRpcError(null, -32600, "POST required", 405);

    let body;
    try { body = await request.json(); } catch { return jsonRpcError(null, -32700, "invalid JSON", 400); }

    const isBatch = Array.isArray(body);
    const messages = isBatch ? body : [body];
    const responses = [];

    for (const msg of messages) {
      const id = msg?.id ?? null;

      if (msg?.method === "initialize") {
        responses.push({
          jsonrpc: "2.0", id,
          result: {
            protocolVersion: "2025-03-26",
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
          },
        });
        continue;
      }

      if (msg?.method === "notifications/initialized" || msg?.method === "initialized") {
        continue;
      }

      if (msg?.method === "tools/list") {
        responses.push({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
        continue;
      }

      if (msg?.method === "tools/call") {
        const toolName = msg?.params?.name;
        const args = msg?.params?.arguments || {};

        if (!TOOL_MAP[toolName]) {
          responses.push(mcpError(id, -32601, `unknown tool: ${toolName}`));
          continue;
        }

        try {
          const result = await TOOL_MAP[toolName](args);
          responses.push(mcpResult(id, result, result));
        } catch (e) {
          responses.push(mcpResult(id, { ok: false, reason: "internal_error", message: e.message }));
        }
        continue;
      }

      responses.push(mcpError(id, -32601, `method not found: ${msg?.method}`));
    }

    if (isBatch) {
      return json(responses.filter(Boolean));
    }
    return responses[0] || jsonRpcError(null, -32603, "empty response");
  },
};
