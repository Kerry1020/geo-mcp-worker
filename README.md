# geo-mcp-worker

Geo MCP Server — Geospatial computation for AI agents.

Deployed on Cloudflare Workers. Powered by Nominatim / Overpass / OSRM. **Free, no API key, stateless.**
English | **[中文](./README.zh-CN.md)**

## Tools

| Tool | Description | Source |
|---|---|---|
| `geo_geocode` | Address text → lat/lon coordinates | Nominatim (OSM) |
| `geo_reverse` | Lat/lon → address text | Nominatim (OSM) |
| `geo_find_poi` | Nearby POI search (20+ categories) | Overpass API (OSM) |
| `geo_route` | Point-to-point distance & duration (driving/walking/cycling) | OSRM |

## Protocol

MCP (JSON-RPC 2.0), compatible with [search-mcp-worker](https://github.com/Kerry1020/search-mcp-worker).

- `POST /mcp` — MCP endpoint
- `GET /health` — Health check

## Quick Start

### Initialize

```json
POST /mcp
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-03-26",
    "capabilities": {},
    "clientInfo": { "name": "my-agent", "version": "1.0" }
  }
}
```

### List tools

```json
{ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }
```

## Live API Examples

### 1. Geocode (`geo_geocode`)

**Request:**
```json
{
  "jsonrpc": "2.0", "id": 1,
  "method": "tools/call",
  "params": {
    "name": "geo_geocode",
    "arguments": { "address": "上海市徐汇区云锦路", "limit": 1 }
  }
}
```

**Response:**
```json
{
  "ok": true,
  "query": "上海市徐汇区云锦路",
  "results": [
    {
      "lat": 31.169501,
      "lon": 121.453866,
      "display_name": "云锦路, 龙华, 龙华街道, 徐汇区, 上海市, 200232, 中国",
      "type": "residential",
      "importance": 0.42
    }
  ]
}
```

**School names work too:**
```json
{ "address": "向明中学浦江校区" }
→ lat=31.075575, lon=121.496283
→ "向明中学（浦江校区）, 浦锦路, 浦锦街道, 勤俭, 闵行区, 上海市, 201112, 中国"
```

> ⚠️ Does not accept company/brand names (e.g. "中电金信"). For such queries, use search-mcp first to get the street address, then pass it to geo_geocode.

### 2. Reverse Geocode (`geo_reverse`)

**Request:**
```json
{
  "name": "geo_reverse",
  "arguments": { "lat": 31.169501, "lon": 121.453866 }
}
```

**Response:**
```json
{
  "ok": true,
  "display_name": "云锦路, 龙华, 龙华街道, 徐汇区, 上海市, 200232, 中国",
  "address": {
    "road": "云锦路",
    "suburb": "龙华街道",
    "city": "徐汇区",
    "state": "上海市",
    "postcode": "200232",
    "country": "中国"
  }
}
```

### 3. Find Nearby POIs (`geo_find_poi`)

**Subway stations:**
```json
{
  "name": "geo_find_poi",
  "arguments": {
    "lat": 31.169501, "lon": 121.453866,
    "category": "subway", "radius_m": 1000, "limit": 5
  }
}
```

**Response:**
```json
{
  "ok": true,
  "count": 4,
  "results": [
    { "name": "云锦路",   "distance_m": 0,   "category": "subway" },
    { "name": "龙华",     "distance_m": 772, "category": "subway" },
    { "name": "龙耀路",   "distance_m": 897, "category": "subway" },
    { "name": "龙华",     "distance_m": 962, "category": "subway" }
  ]
}
```

**Restaurants:**
```json
{ "lat": 31.240168, "lon": 121.497945, "category": "restaurant", "radius_m": 500 }
```
```
Yang's Dumplings — 223m
Morton's Grille — 319m | steak_house
Win House — 387m
Hooters — 457m | burger
```

**Supported POI categories:** `restaurant`, `cafe`, `school`, `hospital`, `clinic`, `pharmacy`, `bank`, `atm`, `supermarket`, `convenience`, `subway`, `bus_stop`, `park`, `gym`, `cinema`, `library`, `kindergarten`, `police`, `fire_station`, `post_office`, `parking`, `fuel`, `marketplace`

### 4. Route Planning (`geo_route`)

**Driving:**
```json
{
  "name": "geo_route",
  "arguments": {
    "from": { "lat": 31.169501, "lon": 121.453866 },
    "to":   { "lat": 31.240168, "lon": 121.497945 },
    "mode": "driving"
  }
}
```
```
distance=12609m (12.6km)  duration=14.7min  confidence=high
```

**Walking (auto-calibrated for long distances):**
```json
{
  "from": { "lat": 31.075575, "lon": 121.496283 },
  "to":   { "lat": 31.127125, "lon": 121.489319 },
  "mode": "walking"
}
```
```
distance=7352m (7.4km)  duration=91.9min  confidence=low
```

> For walking distances >2km, duration is recalculated at 80m/min (~4.8km/h) and flagged as `confidence=low`.

### 5. Health Check

```json
GET /health
{
  "ok": true,
  "name": "geo-mcp-worker",
  "version": "1.0.0",
  "tools": ["geo_geocode", "geo_reverse", "geo_find_poi", "geo_route"],
  "data_sources": ["nominatim", "overpass", "osrm"]
}
```

## Search MCP Integration

Geo MCP handles spatial computation only. For semantic search, combine with [search-mcp-worker](https://github.com/Kerry1020/search-mcp-worker):

```
User: "What subway stations are near 中电金信 Shanghai HQ?"

1. search_mcp("中电金信上海总部地址") → "上海市徐汇区云锦路XXX号"
2. geo_geocode("上海市徐汇区云锦路") → { lat: 31.17, lon: 121.45 }
3. geo_find_poi(lat, lon, category="subway", radius_m=1000) → 云锦路(0m), 龙华(772m)
4. geo_route(from=office, to=云锦路, mode="walking") → 3min walk
```

## Design Constraints

- **Stateless**: No CF KV. All data fetched from upstream APIs in real-time.
- **Zero auth**: All upstream APIs are free and require no API key.
- **Coordinate precision**: All coordinates truncated to 6 decimal places via `toFixed(6)`.
- **Walking calibration**: OSRM walking durations >2km are recalculated at 80m/min.
- **Semantic errors**: `{ ok: false, reason: "poi_not_found", message: "..." }` — agents can decide whether to retry with a larger radius or abort.

## Deployment

```bash
# Upload via CF API
curl -X PUT \
  "https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/workers/scripts/geo-mcp-worker" \
  -H "X-Auth-Email: <EMAIL>" \
  -H "X-Auth-Key: <API_KEY>" \
  -F "metadata=@/tmp/metadata.json;type=application/json" \
  -F "index.js=@src/index.js;type=application/javascript+module"
```

`metadata.json`:
```json
{ "main_module": "index.js", "compatibility_date": "2026-04-08" }
```

## Expansion Roadmap

See [GEO_TRANSIT_RESEARCH_REPORT.txt](./GEO_TRANSIT_RESEARCH_REPORT.txt) for the full survey of 28 projects.

| Layer | Solution | Coverage | Status |
|---|---|---|---|
| Layer 0 | OSRM + Nominatim + Overpass | Global driving/walking/POI | ✅ Deployed |
| Layer 1 | Transitous | International public transit | 📋 Researched |
| Layer 2 | Amap (高德) API | China public transit | 📋 Researched |

## License

GPL-3.0
