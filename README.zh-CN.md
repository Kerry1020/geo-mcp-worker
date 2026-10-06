# geo-mcp-worker

[![CI](https://github.com/Kerry1020/geo-mcp-worker/actions/workflows/ci.yml/badge.svg)](https://github.com/Kerry1020/geo-mcp-worker/actions/workflows/ci.yml)

Geo MCP 服务器 — 为 AI Agent 提供地理空间计算能力。

部署在 Cloudflare Workers，基于 Nominatim / Overpass / OSRM，**上游免费、无需 API Key、无状态**。

**[English](./README.md)** | 中文

## 工具列表

| 工具 | 功能 | 参数 | 数据源 |
|---|---|---|---|
| `geo_geocode` | 地址文本 → 经纬度 | `address`（字符串，必填，≤500 字符）、`limit`（1–10，默认 1） | Nominatim (OSM) |
| `geo_reverse` | 经纬度 → 地址文本 | `lat`（−90..90，必填）、`lon`（−180..180，必填） | Nominatim (OSM) |
| `geo_find_poi` | 周边 POI 搜索（按距离排序） | `lat`、`lon`（必填）、`radius_m`（1–5000，默认 1000）、`category`（默认 `restaurant`）、`limit`（1–50，默认 20） | Overpass API (OSM) |
| `geo_route` | 点到点距离/时间 | `from` `{lat, lon}`、`to` `{lat, lon}`（必填）、`mode` `driving` \| `walking` \| `cycling`（默认 `driving`） | OSRM |

**POI 类型：** `restaurant`, `cafe`, `school`, `hospital`, `clinic`, `pharmacy`, `bank`, `atm`, `supermarket`, `convenience`, `subway`, `bus_stop`, `park`, `gym`, `cinema`, `library`, `kindergarten`, `police`, `fire_station`, `post_office`, `parking`, `fuel`, `marketplace`。其他由小写 `[a-z0-9_]` 组成的值会按 `amenity=<值>` 查询。

坐标可以是数字或数字字符串。超出范围或非数字的坐标会返回 `reason: "invalid_coords"`，不会被静默截断。

## 端点与协议

- `POST /mcp` — MCP 端点（JSON-RPC 2.0，Streamable HTTP，只返回 JSON，不提供 SSE）
- `GET /health`（以及 `/`、`/healthz`）— 健康检查，始终公开
- `OPTIONS *` — CORS 预检

支持的方法：`initialize`、`ping`、`tools/list`、`tools/call`。通知（没有 `id` 的消息，如 `notifications/initialized`）返回 `202 Accepted`，无响应体。支持 JSON-RPC 批量请求。

协议版本：`2025-06-18`、`2025-03-26`、`2024-11-05`。客户端请求的版本受支持时原样返回，否则返回 `2025-06-18`。

### 错误

协议错误使用标准 JSON-RPC 错误码：

| 错误码 | 场景 |
|---|---|
| `-32700` | 请求体不是合法 JSON |
| `-32600` | 无效请求（缺少 `jsonrpc: "2.0"`/`method`、空批量、未授权、Origin 被拒、请求体 > 1 MB） |
| `-32601` | 未知方法 |
| `-32602` | 未知工具名，或 `arguments` 不是对象 |
| `-32603` | 内部错误（不会返回堆栈） |

工具层面的失败**不是** JSON-RPC 错误，而是正常的 result，带 `isError: true`，`structuredContent` 里是语义化的错误信息（`content[0].text` 里是同样内容的 JSON 文本）：

```json
{ "ok": false, "reason": "invalid_coords", "message": "..." }
```

`reason` 取值：`missing_address`、`invalid_address`、`missing_coords`、`invalid_coords`、`missing_points`、`invalid_category`、`invalid_mode`、`not_found`、`upstream_timeout`、`geocode_error`、`reverse_error`、`poi_error`、`route_error`、`internal_error`。

POI 搜索结果为空算成功：`{ "ok": true, "count": 0, "results": [], "reason": "poi_not_found", ... }`，Agent 可以据此扩大半径重试。

## 配置

所有配置都来自环境变量，默认值见 [`wrangler.toml`](./wrangler.toml) 和 [`src/config.js`](./src/config.js)。**没有必填变量。**

| 变量 | 类型 | 默认值 | 用途 |
|---|---|---|---|
| `MCP_AUTH_TOKEN` | **secret** | 不设置 | 设置后，`POST /mcp` 需要 `Authorization: Bearer <token>`。`/health` 和预检请求仍然公开。 |
| `ALLOWED_ORIGINS` | var | `*` | `*` 或逗号分隔的 Origin 列表。设为列表时，来自其他 Origin 的浏览器请求返回 `403`。 |
| `UPSTREAM_TIMEOUT_MS` | var | `10000` | 每个上游请求的超时（最大 60000）。 |
| `USER_AGENT` | var | `geo-mcp-worker/1.1 (+仓库地址)` | 发给上游的 UA。[Nominatim 使用政策](https://operations.osmfoundation.org/policies/nominatim/)要求可识别的 UA，请填上你自己的联系方式。 |
| `ACCEPT_LANGUAGE` | var | `zh` | Nominatim 返回结果的语言 |
| `NOMINATIM_URL` | var | `https://nominatim.openstreetmap.org` | Nominatim 地址 |
| `OVERPASS_URL` | var | `https://overpass-api.de/api/interpreter` | Overpass 地址 |
| `OSRM_URL_DRIVING` | var | `https://router.project-osrm.org` | `driving` 使用的 OSRM |
| `OSRM_URL_WALKING` | var | `https://routing.openstreetmap.de/routed-foot` | `walking` 使用的 OSRM |
| `OSRM_URL_CYCLING` | var | `https://routing.openstreetmap.de/routed-bike` | `cycling` 使用的 OSRM |
| `BUILD_SHA`、`BUILD_TIME` | var | `unknown` | 在 `/health` 中显示 |

> OSRM 公共演示服务器（`router.project-osrm.org`）只提供驾车 profile：`foot`/`bike` 请求返回的也是驾车路线。所以步行和骑行默认改用 FOSSGIS 的路由服务。

本地开发时，把 secret 写在 `.dev.vars`（已加入 .gitignore）：

```
MCP_AUTH_TOKEN=dev-token
```

## MCP 客户端配置

Claude Desktop / Cursor 等只支持 stdio 的客户端，可以通过 [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) 接入：

```json
{
  "mcpServers": {
    "geo": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://<your-worker>.workers.dev/mcp",
               "--header", "Authorization:${AUTH_HEADER}"],
      "env": { "AUTH_HEADER": "Bearer <token>" }
    }
  }
}
```

原生支持 Streamable HTTP 的客户端（例如 Claude Code）：

```bash
claude mcp add --transport http geo https://<your-worker>.workers.dev/mcp \
  --header "Authorization: Bearer <token>"
```

没有设置 `MCP_AUTH_TOKEN` 时，去掉 `Authorization` 头即可。

## curl 示例

```bash
URL=https://<your-worker>.workers.dev   # 或使用 `npm run dev` 时的 http://localhost:8787
AUTH="Authorization: Bearer $GEO_MCP_TOKEN"   # 仅在设置了 MCP_AUTH_TOKEN 时需要

curl -s $URL/health

curl -s $URL/mcp -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'

curl -s $URL/mcp -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

curl -s $URL/mcp -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"geo_geocode","arguments":{"address":"上海市徐汇区云锦路"}}}'

curl -s $URL/mcp -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"geo_find_poi","arguments":{"lat":31.169501,"lon":121.453866,"category":"subway","radius_m":1000,"limit":5}}}'

curl -s $URL/mcp -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"geo_route","arguments":{"from":{"lat":31.169501,"lon":121.453866},"to":{"lat":31.240168,"lon":121.497945},"mode":"driving"}}}'
```

## 实测示例

以下结果来自线上实测，具体数值会随 OSM 数据更新而变化。

### `geo_geocode`

```json
{ "address": "上海市徐汇区云锦路", "limit": 1 }
```

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

学校名也支持：`{ "address": "向明中学浦江校区" }` → `lat=31.075575, lon=121.496283`。

> ⚠ 不支持企业名/品牌名（如"中电金信"）。此类输入请先通过 search-mcp 获取地址，再传入 `geo_geocode`。

### `geo_reverse`

```json
{ "lat": 31.169501, "lon": 121.453866 }
```

```json
{
  "ok": true,
  "lat": 31.169501,
  "lon": 121.453866,
  "display_name": "云锦路, 龙华, 龙华街道, 徐汇区, 上海市, 200232, 中国",
  "address": { "road": "云锦路", "suburb": "龙华街道", "city": "徐汇区", "state": "上海市", "postcode": "200232", "country": "中国" }
}
```

### `geo_find_poi`

```json
{ "lat": 31.169501, "lon": 121.453866, "category": "subway", "radius_m": 1000, "limit": 5 }
```

```json
{
  "ok": true,
  "center": { "lat": 31.169501, "lon": 121.453866 },
  "count": 4,
  "results": [
    { "name": "云锦路", "distance_m": 0,   "category": "subway" },
    { "name": "龙华",   "distance_m": 772, "category": "subway" },
    { "name": "龙耀路", "distance_m": 897, "category": "subway" },
    { "name": "龙华",   "distance_m": 962, "category": "subway" }
  ]
}
```

每条结果还包含 `lat`、`lon` 和 `tags`（有数据时包括 `cuisine`、`opening_hours`、`phone`、`website`、`operator`）。

### `geo_route`

```json
{ "from": { "lat": 31.169501, "lon": 121.453866 }, "to": { "lat": 31.240168, "lon": 121.497945 }, "mode": "driving" }
```

```json
{ "ok": true, "from": { ... }, "to": { ... }, "distance_m": 12609, "duration_min": 14.7, "mode": "driving", "confidence": "high" }
```

> 步行距离超过 2 km 时，`duration_min` 按 80 m/min（约 4.8 km/h）重新计算，并标记 `confidence: "low"`。

### 健康检查

```json
{
  "ok": true,
  "name": "geo-mcp-worker",
  "version": "1.1.0",
  "build": { "sha": "<git sha>", "time": "<构建时间>" },
  "tools": ["geo_geocode", "geo_reverse", "geo_find_poi", "geo_route"],
  "data_sources": ["nominatim", "overpass", "osrm"]
}
```

## 与 Search MCP 协同

Geo MCP 只做空间计算，不做语义搜索。可以与 [search-mcp-worker](https://github.com/Kerry1020/search-mcp-worker) 配合使用：

```
用户: "中电金信上海总部附近有什么地铁站？"

1. search_mcp("中电金信上海总部地址") → "上海市徐汇区云锦路XXX号"
2. geo_geocode("上海市徐汇区云锦路") → { lat: 31.17, lon: 121.45 }
3. geo_find_poi(lat, lon, category="subway", radius_m=1000) → 云锦路站(0m)、龙华站(772m)
4. geo_route(from=公司, to=云锦路站, mode="walking") → 步行 3 分钟
```

## 开发

需要 Node.js ≥ 20，没有运行时依赖。

```bash
npm test          # node:test 测试，上游 API 全部 mock，无需联网
npm run check     # 语法 / 导入检查
npm run dev       # 通过 wrangler 启动本地服务（http://localhost:8787）
```

目录结构：

```
src/index.js      Worker 入口：路由、CORS、鉴权、请求体解析
src/protocol.js   MCP JSON-RPC 处理
src/tools.js      工具 schema 与处理函数（参数校验）
src/providers.js  Nominatim / Overpass / OSRM 客户端（超时、错误处理）
src/config.js     环境变量解析与默认值
src/http.js       响应、CORS、鉴权工具函数
src/util.js       校验与几何计算工具函数
test/             node:test 测试，mock 全局 fetch
```

## 部署

```bash
npx wrangler login
npx wrangler secret put MCP_AUTH_TOKEN      # 可选，启用 Bearer 鉴权
npx wrangler deploy \
  --var BUILD_SHA:$(git rev-parse --short HEAD) \
  --var BUILD_TIME:$(date -u +%FT%TZ)
```

CI 或非交互式部署请使用有权限范围的 Cloudflare API Token（环境变量 `CLOUDFLARE_API_TOKEN`，选 "Edit Cloudflare Workers" 模板），不要使用 Global API Key。

### 公共上游的使用限制

默认上游都是社区运营的免费服务，有合理使用政策：Nominatim 最多 1 次/秒，Overpass 和 OSRM/FOSSGIS 路由会限制高频用户。用于生产流量时，建议设置 `MCP_AUTH_TOKEN`，避免端点对所有人开放；设置可识别的 `USER_AGENT`；并考虑使用自建实例（各 `*_URL` 变量）。

## 扩展路线

详见 [docs/GEO_TRANSIT_RESEARCH_REPORT.md](./docs/GEO_TRANSIT_RESEARCH_REPORT.md)（28 个项目全量调研）。

| 层级 | 方案 | 覆盖 | 状态 |
|---|---|---|---|
| Layer 0 | OSRM + Nominatim + Overpass | 全球驾车/步行/POI | ✓ 已部署 |
| Layer 1 | Transitous | 海外公交/地铁 | 调研完成，未部署 |
| Layer 2 | 高德 API | 中国公交/地铁 | 调研完成，未部署 |

## 许可证

本项目采用 GNU General Public License v3.0 许可证，详见 [LICENSE](LICENSE)。
