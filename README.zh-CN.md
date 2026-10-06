# geo-mcp-worker

[![CI](https://github.com/Kerry1020/geo-mcp-worker/actions/workflows/ci.yml/badge.svg)](https://github.com/Kerry1020/geo-mcp-worker/actions/workflows/ci.yml)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![MCP](https://img.shields.io/badge/MCP-Streamable%20HTTP-6E56CF)](https://modelcontextprotocol.io)

[English](README.md) | 简体中文

运行在 Cloudflare Workers 上的无状态 MCP 服务器，提供地理编码、逆地理编码、周边 POI 搜索和路线规划，数据来自免费的 OpenStreetMap 服务（Nominatim / Overpass / OSRM），无需 API Key。

## 功能特性

- 四个工具：`geo_geocode`、`geo_reverse`、`geo_find_poi`、`geo_route`
- 上游免费，无需 API Key；不用 KV，也没有会话状态
- 基于 Streamable HTTP 的 MCP（只返回 JSON），支持协议版本 `2025-06-18`、`2025-03-26`、`2024-11-05`，支持 JSON-RPC 批量请求
- 步行、骑行走 FOSSGIS 的真实路由 profile，驾车走 OSRM 演示服务器
- 参数校验严格；工具失败时返回结构化的 `{ ok: false, reason }`，而不是协议错误
- 可选 Bearer 鉴权（`MCP_AUTH_TOKEN`）、CORS Origin 白名单、上游请求超时
- 所有上游地址都可以换成自建实例
- 无运行时依赖；`node:test` 测试套件，上游全部 mock

## 快速开始

```bash
git clone https://github.com/Kerry1020/geo-mcp-worker.git
cd geo-mcp-worker
npm run dev                                   # http://localhost:8787
curl -s http://localhost:8787/health
```

部署到自己的账号：

```bash
npx wrangler login
npx wrangler secret put MCP_AUTH_TOKEN        # 公开部署时建议设置
npm run deploy
```

然后在 MCP 客户端里添加 `https://<your-worker>.workers.dev/mcp`（见下文 [MCP 客户端配置](#mcp-客户端配置)）。

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

所有配置都来自环境变量，默认值见 [`wrangler.toml`](./wrangler.toml) 和 [`src/config.js`](./src/config.js)。**没有必填项。**

| 名称 | 必填 | Secret | 默认值 | 说明 |
|---|---|---|---|---|
| `MCP_AUTH_TOKEN` | 否（建议设置） | 是 | 不设置 | 设置后，所有 `/mcp` 请求都需要 `Authorization: Bearer <token>`。`/health` 和 CORS 预检仍然公开。 |
| `ALLOWED_ORIGINS` | 否 | 否 | `*` | `*` 或逗号分隔的 Origin 列表。设为列表时，带其他 `Origin` 的 `/mcp` 请求返回 `403`。 |
| `UPSTREAM_TIMEOUT_MS` | 否 | 否 | `10000` | 每个上游请求的超时，单位毫秒（上限 60000）。 |
| `USER_AGENT` | 否 | 否 | `geo-mcp-worker/1.1 (+https://github.com/Kerry1020/geo-mcp-worker)` | 发给上游的 UA。[Nominatim 使用政策](https://operations.osmfoundation.org/policies/nominatim/)要求可识别的 UA，请填上你自己的联系方式。 |
| `ACCEPT_LANGUAGE` | 否 | 否 | `zh` | 发给 Nominatim 的 `accept-language`。 |
| `NOMINATIM_URL` | 否 | 否 | `https://nominatim.openstreetmap.org` | Nominatim 地址。 |
| `OVERPASS_URL` | 否 | 否 | `https://overpass-api.de/api/interpreter` | Overpass 地址。 |
| `OSRM_URL_DRIVING` | 否 | 否 | `https://router.project-osrm.org` | `driving` 使用的 OSRM。 |
| `OSRM_URL_WALKING` | 否 | 否 | `https://routing.openstreetmap.de/routed-foot` | `walking` 使用的 OSRM。 |
| `OSRM_URL_CYCLING` | 否 | 否 | `https://routing.openstreetmap.de/routed-bike` | `cycling` 使用的 OSRM。 |
| `BUILD_SHA`、`BUILD_TIME` | 否 | 否 | `unknown` | 在 `/health` 中显示，一般在部署时注入。 |

> OSRM 公共演示服务器（`router.project-osrm.org`）只提供驾车 profile：`foot`/`bike` 请求返回的也是驾车路线。所以步行和骑行默认改用 FOSSGIS 的路由服务。

本地开发时，把 secret 写在 `.dev.vars`（已加入 .gitignore）：

```
MCP_AUTH_TOKEN=dev-token
```

## MCP 客户端配置

Claude Code（原生支持 Streamable HTTP）：

```bash
claude mcp add --transport http geo https://<your-worker>.workers.dev/mcp

# Worker 设置了 MCP_AUTH_TOKEN 时
claude mcp add --transport http geo https://<your-worker>.workers.dev/mcp \
  --header "Authorization: Bearer <token>"
```

Claude Desktop、Cursor 等只支持 stdio 的客户端，通过 [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) 接入：

```json
{
  "mcpServers": {
    "geo": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote",
        "https://<your-worker>.workers.dev/mcp",
        "--header",
        "Authorization: Bearer ${AUTH_TOKEN}"
      ],
      "env": {
        "AUTH_TOKEN": "<token>"
      }
    }
  }
}
```

没有设置 `MCP_AUTH_TOKEN` 时，去掉 `--header` 两个参数和 `env` 即可。

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

## 安全说明

- 不设置 `MCP_AUTH_TOKEN` 时，任何知道地址的人都能调用 `/mcp`，消耗你的 Workers 额度和公共上游的使用配额。公开部署请务必设置：`npx wrangler secret put MCP_AUTH_TOKEN`。Token 比较采用常量时间。
- `/`、`/health`、`/healthz` 和 `OPTIONS` 预检始终无需鉴权，只返回名称、版本、构建信息和工具列表。
- `ALLOWED_ORIGINS` 只限制浏览器来源（带非白名单 `Origin` 的请求返回 `403`），不能代替 Token：非浏览器客户端完全可以不带 `Origin`。
- 超过 1 MB 的请求体会被拒绝；内部错误不会返回堆栈。
- 工具输入（地址、坐标）会发送给配置的上游（默认是 OSM 社区服务），不想让对方看到的数据就别传。

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

## 相关项目

- [time-mcp-worker](https://github.com/Kerry1020/time-mcp-worker) — 时区查询、时间换算与时间差计算
- [memory-mcp-worker](https://github.com/Kerry1020/memory-mcp-worker) — 基于 KV 的 Agent 持久化记忆
- [webhook-inbox-mcp-worker](https://github.com/Kerry1020/webhook-inbox-mcp-worker) — 把 Webhook 收进 KV，再通过 MCP 工具读取
- [summarize-mcp-worker](https://github.com/Kerry1020/summarize-mcp-worker) — 网页正文提取与抽取式摘要
- [image-mcp-worker](https://github.com/Kerry1020/image-mcp-worker) — 对接任意 OpenAI 兼容图像接口生成图片
- [calc-mcp-worker](https://github.com/Kerry1020/calc-mcp-worker) — 数学计算：表达式、微积分、矩阵、统计
- [search-mcp-worker](https://github.com/Kerry1020/search-mcp-worker) — 多引擎网页搜索，排序逻辑公开可审计

## 许可证

本项目采用 [GNU General Public License v3.0](LICENSE) 许可证。
