# geo-mcp-worker

Geo MCP 服务器 — 为 AI Agent 提供地理空间计算能力。

部署在 Cloudflare Workers，基于 Nominatim / Overpass / OSRM，**完全免费、无需 API Key、无状态**。
**[English](./README.md)** | 中文

## 工具列表

| 工具 | 功能 | 数据源 |
|---|---|---|
| `geo_geocode` | 地址文本 → 经纬度坐标 | Nominatim (OSM) |
| `geo_reverse` | 经纬度坐标 → 地址文本 | Nominatim (OSM) |
| `geo_find_poi` | 坐标周边 POI 搜索（23 类型） | Overpass API (OSM) |
| `geo_route` | 点到点路径距离/时间（驾车/步行/骑行） | OSRM |

## 协议

MCP (JSON-RPC 2.0)，与 [search-mcp-worker](https://github.com/Kerry1020/search-mcp-worker) 完全一致。

- `POST /mcp` — MCP 端点
- `GET /health` — 健康检查

## 快速开始

### 初始化

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

### 列出工具

```json
{ "jsonrpc": "2.0", "id": 2, "method": "tools/list" }
```

## 实测示例

### 1. 地址 → 坐标 (`geo_geocode`)

**请求：**
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

**响应：**
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

**学校名也支持：**
```json
{ "address": "向明中学浦江校区" }
→ lat=31.075575, lon=121.496283
→ "向明中学（浦江校区）, 浦锦路, 浦锦街道, 勤俭, 闵行区, 上海市, 201112, 中国"
```

> ⚠ 不支持企业名/品牌名（如"中电金信"）。此类输入请先通过 search-mcp 获取地址，再传入 geo_geocode。

### 2. 坐标 → 地址 (`geo_reverse`)

**请求：**
```json
{
  "name": "geo_reverse",
  "arguments": { "lat": 31.169501, "lon": 121.453866 }
}
```

**响应：**
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

### 3. 周边 POI 搜索 (`geo_find_poi`)

**搜索地铁站：**
```json
{
  "name": "geo_find_poi",
  "arguments": {
    "lat": 31.169501, "lon": 121.453866,
    "category": "subway", "radius_m": 1000, "limit": 5
  }
}
```

**响应：**
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

**搜索餐厅：**
```json
{ "lat": 31.240168, "lon": 121.497945, "category": "restaurant", "radius_m": 500 }
```
```
Yang's Dumplings — 223m
Morton's Grille — 319m | steak_house
Win House — 387m
Hooters — 457m | burger
```

**支持的 POI 类型：** `restaurant`, `cafe`, `school`, `hospital`, `clinic`, `pharmacy`, `bank`, `atm`, `supermarket`, `convenience`, `subway`, `bus_stop`, `park`, `gym`, `cinema`, `library`, `kindergarten`, `police`, `fire_station`, `post_office`, `parking`, `fuel`, `marketplace`

### 4. 路径规划 (`geo_route`)

**驾车：**
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

**步行（长距离自动校准）：**
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

> 步行距离 >2km 时，duration 按 80m/min（~4.8km/h）重新计算，标记 `confidence=low`。

### 5. 健康检查

```json
GET /health
{
  "ok": true,
  "name": "geo-mcp-worker",
  "version": "1.0.0",
  "build": { "sha": "<git sha>", "time": "<构建时间>" },
  "tools": ["geo_geocode", "geo_reverse", "geo_find_poi", "geo_route"],
  "data_sources": ["nominatim", "overpass", "osrm"]
}
```

## 与 Search MCP 协同

Geo MCP 只做空间计算，不做语义搜索。典型协同流程：

```
用户: "中电金信上海总部附近有什么地铁站？"

1. search_mcp("中电金信上海总部地址") → "上海市徐汇区云锦路XXX号"
2. geo_geocode("上海市徐汇区云锦路") → { lat: 31.17, lon: 121.45 }
3. geo_find_poi(lat, lon, category="subway", radius_m=1000) → 云锦路站(0m)、龙华站(772m)
4. geo_route(from=公司, to=云锦路站, mode="walking") → 步行3分钟
```

## 设计约束

- **无状态**：禁用 CF KV，所有数据实时 API 获取
- **零鉴权**：全部使用公开免费 API，无需 API Key
- **坐标精度**：统一 `toFixed(6)` 截断
- **步行校准**：OSRM 步行 >2km 自动按 80m/min 重算
- **语义化错误**：`{ ok: false, reason: "poi_not_found", message: "..." }` 供 Agent 判断重试策略

## 部署

```bash
# CF Workers 直接 API 上传
curl -X PUT \
  "https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/workers/scripts/geo-mcp-worker" \
  -H "X-Auth-Email: <EMAIL>" \
  -H "X-Auth-Key: <API_KEY>" \
  -F "metadata=@/tmp/metadata.json;type=application/json" \
  -F "index.js=@src/index.js;type=application/javascript+module"
```

`metadata.json`：
```json
{ "main_module": "index.js", "compatibility_date": "2026-04-08" }
```

## 扩展路线

详见 [GEO_TRANSIT_RESEARCH_REPORT.txt](./GEO_TRANSIT_RESEARCH_REPORT.txt)（28 个项目全量调研）。

| 层级 | 方案 | 覆盖 | 状态 |
|---|---|---|---|
| Layer 0 | OSRM + Nominatim + Overpass | 全球驾车/步行/POI | 已部署 |
| Layer 1 | Transitous | 海外公交/地铁 | 调研完成 |
| Layer 2 | 高德 API | 中国公交/地铁 | 调研完成 |

## 许可证

GPL-3.0
