// MCP tool definitions (public contract — keep names/schemas backward compatible)
// and their handlers. Handlers never throw for expected failures; they return
// semantic results of the form { ok: false, reason, message }.

import { nominatimSearch, nominatimReverse, overpassPOI, osrmRoute, poiFilter, POI_OSM_FILTERS, ROUTE_MODES } from "./providers.js";
import { clampInt, isPlainObject, parseCoords, round6 } from "./util.js";

const MAX_ADDRESS_LENGTH = 500;

function fail(reason, message) {
  return { ok: false, reason, message };
}

function upstreamReason(e, fallback) {
  return e && e.timeout ? "upstream_timeout" : fallback;
}

export async function handleGeocode(args, cfg) {
  const { address } = args;
  if (address == null || (typeof address === "string" && address.trim() === "")) {
    return fail("missing_address", "address 参数必填");
  }
  if (typeof address !== "string") return fail("invalid_address", "address 必须是字符串");
  const query = address.trim();
  if (query.length > MAX_ADDRESS_LENGTH) return fail("invalid_address", `address 长度不能超过 ${MAX_ADDRESS_LENGTH} 个字符`);
  const limit = clampInt(args.limit, 1, 10, 1);
  try {
    const results = await nominatimSearch(cfg, query, limit);
    if (!results.length) return fail("not_found", `未找到地址: ${query}`);
    return {
      ok: true,
      query,
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
    return fail(upstreamReason(e, "geocode_error"), e.message);
  }
}

export async function handleReverseGeocode(args, cfg) {
  const { lat, lon } = args;
  if (lat == null || lon == null) return fail("missing_coords", "lat 和 lon 参数必填");
  const c = parseCoords(lat, lon);
  if (!c) return fail("invalid_coords", "lat 必须在 [-90, 90]，lon 必须在 [-180, 180] 范围内");
  try {
    const data = await nominatimReverse(cfg, c.lat, c.lon);
    if (!data || data.error) return fail("not_found", (data && data.error) || "not found");
    return {
      ok: true,
      lat: round6(c.lat),
      lon: round6(c.lon),
      display_name: data.display_name,
      address: data.address,
    };
  } catch (e) {
    return fail(upstreamReason(e, "reverse_error"), e.message);
  }
}

export async function handleFindPOI(args, cfg) {
  const { lat, lon, category = "restaurant" } = args;
  if (lat == null || lon == null) return fail("missing_coords", "lat 和 lon 参数必填");
  const c = parseCoords(lat, lon);
  if (!c) return fail("invalid_coords", "lat 必须在 [-90, 90]，lon 必须在 [-180, 180] 范围内");
  if (typeof category !== "string" || !poiFilter(category)) {
    return fail("invalid_category", `category 无效。可选: ${Object.keys(POI_OSM_FILTERS).join(", ")}`);
  }
  const radius = clampInt(args.radius_m, 1, 5000, 1000);
  const limit = clampInt(args.limit, 1, 50, 20);
  const center = { lat: round6(c.lat), lon: round6(c.lon) };
  try {
    const results = await overpassPOI(cfg, c.lat, c.lon, radius, category, limit);
    if (!results.length) {
      return { ok: true, center, results: [], count: 0, reason: "poi_not_found", message: `在 ${radius}m 半径内未找到 ${category} 类型设施` };
    }
    return { ok: true, center, results, count: results.length };
  } catch (e) {
    return fail(upstreamReason(e, "poi_error"), e.message);
  }
}

export async function handleRoute(args, cfg) {
  const { from, to, mode = "driving" } = args;
  if (!from || !to) return fail("missing_points", "from 和 to 参数必填，格式: {lat, lon}");
  if (!isPlainObject(from) || !isPlainObject(to) || from.lat == null || from.lon == null || to.lat == null || to.lon == null) {
    return fail("missing_coords", "from/to 必须包含 lat 和 lon");
  }
  const a = parseCoords(from.lat, from.lon);
  const b = parseCoords(to.lat, to.lon);
  if (!a || !b) return fail("invalid_coords", "lat 必须在 [-90, 90]，lon 必须在 [-180, 180] 范围内");
  if (!ROUTE_MODES.includes(mode)) return fail("invalid_mode", `mode 必须是 ${ROUTE_MODES.join(" / ")}`);
  try {
    const result = await osrmRoute(cfg, a.lat, a.lon, b.lat, b.lon, mode);
    return {
      ok: true,
      from: { lat: round6(a.lat), lon: round6(a.lon) },
      to: { lat: round6(b.lat), lon: round6(b.lon) },
      ...result,
    };
  } catch (e) {
    return fail(upstreamReason(e, "route_error"), e.message);
  }
}

export const TOOLS = [
  {
    name: "geo_geocode",
    description: "将结构化地址文本转换为经纬度坐标（正向地理编码）。仅接受路名、门牌号、小区名、地标等地理地址。⚠️ 不接受企业名/公司名/品牌名（如'中电金信'、'星巴克'），此类输入请先调用 search_mcp 获取实际地址文本，再将地址传入本工具。正确用法：'上海市徐汇区云锦路'。错误用法：'中电金信上海'。使用 OpenStreetMap Nominatim，免费无需 API key。",
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

export const TOOL_HANDLERS = {
  geo_geocode: handleGeocode,
  geo_reverse: handleReverseGeocode,
  geo_find_poi: handleFindPOI,
  geo_route: handleRoute,
};
