# geo-mcp-worker

[![CI](https://github.com/Kerry1020/geo-mcp-worker/actions/workflows/ci.yml/badge.svg)](https://github.com/Kerry1020/geo-mcp-worker/actions/workflows/ci.yml)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![MCP](https://img.shields.io/badge/MCP-Streamable%20HTTP-6E56CF)](https://modelcontextprotocol.io)

English | [简体中文](README.zh-CN.md)

A stateless MCP server on Cloudflare Workers for geocoding, reverse geocoding, nearby POI search and routing, powered by free OpenStreetMap services (Nominatim / Overpass / OSRM). No API key needed.

## Features

- Four tools: `geo_geocode`, `geo_reverse`, `geo_find_poi`, `geo_route`
- Free upstreams, no API key, no KV, no sessions
- MCP over Streamable HTTP (JSON responses), protocol versions `2025-06-18`, `2025-03-26`, `2024-11-05`, JSON-RPC batches
- Real walking and cycling profiles (FOSSGIS routers), with car routing via the OSRM demo server
- Strict input validation; tool failures come back as structured `{ ok: false, reason }` payloads instead of protocol errors
- Optional bearer auth (`MCP_AUTH_TOKEN`), CORS origin allow-list, per-request upstream timeouts
- Every upstream URL can be pointed at a self-hosted instance
- No runtime dependencies; `node:test` suite with mocked upstreams

## Quick start

```bash
git clone https://github.com/Kerry1020/geo-mcp-worker.git
cd geo-mcp-worker
npm run dev                                   # http://localhost:8787
curl -s http://localhost:8787/health
```

Deploy to your own account:

```bash
npx wrangler login
npx wrangler secret put MCP_AUTH_TOKEN        # recommended for public deployments
npm run deploy
```

Then add `https://<your-worker>.workers.dev/mcp` to your MCP client (see [MCP client config](#mcp-client-config)).

## Tools

| Tool | Description | Arguments | Source |
|---|---|---|---|
| `geo_geocode` | Address text → lat/lon | `address` (string, required, ≤500 chars), `limit` (1–10, default 1) | Nominatim (OSM) |
| `geo_reverse` | Lat/lon → address | `lat` (−90..90, required), `lon` (−180..180, required) | Nominatim (OSM) |
| `geo_find_poi` | Nearby POIs, sorted by distance | `lat`, `lon` (required), `radius_m` (1–5000, default 1000), `category` (default `restaurant`), `limit` (1–50, default 20) | Overpass API (OSM) |
| `geo_route` | Point-to-point distance & duration | `from` `{lat, lon}`, `to` `{lat, lon}` (required), `mode` `driving` \| `walking` \| `cycling` (default `driving`) | OSRM |

**POI categories:** `restaurant`, `cafe`, `school`, `hospital`, `clinic`, `pharmacy`, `bank`, `atm`, `supermarket`, `convenience`, `subway`, `bus_stop`, `park`, `gym`, `cinema`, `library`, `kindergarten`, `police`, `fire_station`, `post_office`, `parking`, `fuel`, `marketplace`. Any other lowercase `[a-z0-9_]` value is queried as `amenity=<value>`.

Coordinates may be numbers or numeric strings. Out-of-range or non-numeric coordinates are rejected with `reason: "invalid_coords"` (they are not silently clamped).

## Endpoints & protocol

- `POST /mcp` — MCP endpoint (JSON-RPC 2.0 over Streamable HTTP, JSON responses only, no SSE)
- `GET /health` (also `/`, `/healthz`) — health check, always public
- `OPTIONS *` — CORS preflight

Supported methods: `initialize`, `ping`, `tools/list`, `tools/call`. Notifications (messages without `id`, e.g. `notifications/initialized`) are accepted with `202 Accepted` and no body. JSON-RPC batches are supported.

Protocol versions: `2025-06-18`, `2025-03-26`, `2024-11-05` (the client's version is echoed if supported, otherwise `2025-06-18`).

### Errors

Protocol errors use standard JSON-RPC codes:

| Code | When |
|---|---|
| `-32700` | Body is not valid JSON |
| `-32600` | Invalid request (missing `jsonrpc: "2.0"`/`method`, empty batch, unauthorized, forbidden origin, body > 1 MB) |
| `-32601` | Unknown method |
| `-32602` | Unknown tool name, or `arguments` is not an object |
| `-32603` | Unexpected internal error (no stack trace is returned) |

Tool-level failures are **not** JSON-RPC errors. They come back as a normal result with `isError: true` and a semantic payload in `structuredContent` (and as JSON text in `content[0].text`):

```json
{ "ok": false, "reason": "invalid_coords", "message": "..." }
```

`reason` values: `missing_address`, `invalid_address`, `missing_coords`, `invalid_coords`, `missing_points`, `invalid_category`, `invalid_mode`, `not_found`, `upstream_timeout`, `geocode_error`, `reverse_error`, `poi_error`, `route_error`, `internal_error`.

An empty POI search is a success: `{ "ok": true, "count": 0, "results": [], "reason": "poi_not_found", ... }`, so an agent can retry with a larger radius.

## Configuration

All configuration comes from environment variables. Defaults live in [`wrangler.toml`](./wrangler.toml) / [`src/config.js`](./src/config.js). Nothing is required.

| Name | Required | Secret | Default | Description |
|---|---|---|---|---|
| `MCP_AUTH_TOKEN` | No (recommended) | Yes | unset | If set, every request to `/mcp` requires `Authorization: Bearer <token>`. `/health` and CORS preflight stay public. |
| `ALLOWED_ORIGINS` | No | No | `*` | `*` or a comma-separated list of origins. With a list, requests to `/mcp` carrying another `Origin` get `403`. |
| `UPSTREAM_TIMEOUT_MS` | No | No | `10000` | Per-request timeout for upstream APIs, in ms (capped at 60000). |
| `USER_AGENT` | No | No | `geo-mcp-worker/1.1 (+https://github.com/Kerry1020/geo-mcp-worker)` | Sent upstream. The [Nominatim policy](https://operations.osmfoundation.org/policies/nominatim/) asks for an identifying UA, so put your own contact here. |
| `ACCEPT_LANGUAGE` | No | No | `zh` | `accept-language` sent to Nominatim. |
| `NOMINATIM_URL` | No | No | `https://nominatim.openstreetmap.org` | Nominatim base URL. |
| `OVERPASS_URL` | No | No | `https://overpass-api.de/api/interpreter` | Overpass interpreter URL. |
| `OSRM_URL_DRIVING` | No | No | `https://router.project-osrm.org` | OSRM base for `driving`. |
| `OSRM_URL_WALKING` | No | No | `https://routing.openstreetmap.de/routed-foot` | OSRM base for `walking`. |
| `OSRM_URL_CYCLING` | No | No | `https://routing.openstreetmap.de/routed-bike` | OSRM base for `cycling`. |
| `BUILD_SHA`, `BUILD_TIME` | No | No | `unknown` | Shown in `/health`; usually injected at deploy time. |

> The public OSRM demo server (`router.project-osrm.org`) only serves the car profile: it gives car routes for `foot`/`bike` requests too. That is why walking and cycling go to the FOSSGIS routers by default.

For local development, put secrets in `.dev.vars` (it is git-ignored):

```
MCP_AUTH_TOKEN=dev-token
```

## MCP client config

Claude Code (native Streamable HTTP):

```bash
claude mcp add --transport http geo https://<your-worker>.workers.dev/mcp

# with MCP_AUTH_TOKEN set on the worker
claude mcp add --transport http geo https://<your-worker>.workers.dev/mcp \
  --header "Authorization: Bearer <token>"
```

Claude Desktop, Cursor and other stdio-only clients via [`mcp-remote`](https://www.npmjs.com/package/mcp-remote):

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

Drop the `--header` arguments and `env` block if `MCP_AUTH_TOKEN` is not set.

## curl examples

```bash
URL=https://<your-worker>.workers.dev   # or http://localhost:8787 with `npm run dev`
AUTH="Authorization: Bearer $GEO_MCP_TOKEN"   # only needed when MCP_AUTH_TOKEN is set

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

## Example results

These were captured from a live deployment. Exact values change as OSM data changes.

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

School names work too: `{ "address": "向明中学浦江校区" }` → `lat=31.075575, lon=121.496283`.

> ⚠ Company and brand names (e.g. "中电金信") are not accepted. For those, use search-mcp first to get the street address, then pass the address to `geo_geocode`.

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

Each result also carries `lat`, `lon` and `tags` (`cuisine`, `opening_hours`, `phone`, `website`, `operator`, when available).

### `geo_route`

```json
{ "from": { "lat": 31.169501, "lon": 121.453866 }, "to": { "lat": 31.240168, "lon": 121.497945 }, "mode": "driving" }
```

```json
{ "ok": true, "from": { ... }, "to": { ... }, "distance_m": 12609, "duration_min": 14.7, "mode": "driving", "confidence": "high" }
```

> For walking routes longer than 2 km, `duration_min` is recalculated at 80 m/min (~4.8 km/h) and flagged `confidence: "low"`.

### Health

```json
{
  "ok": true,
  "name": "geo-mcp-worker",
  "version": "1.1.0",
  "build": { "sha": "<git sha>", "time": "<build time>" },
  "tools": ["geo_geocode", "geo_reverse", "geo_find_poi", "geo_route"],
  "data_sources": ["nominatim", "overpass", "osrm"]
}
```

## Search MCP integration

Geo MCP does spatial computation only. For semantic search, pair it with [search-mcp-worker](https://github.com/Kerry1020/search-mcp-worker):

```
User: "What subway stations are near 中电金信 Shanghai HQ?"

1. search_mcp("中电金信上海总部地址") → "上海市徐汇区云锦路XXX号"
2. geo_geocode("上海市徐汇区云锦路") → { lat: 31.17, lon: 121.45 }
3. geo_find_poi(lat, lon, category="subway", radius_m=1000) → 云锦路(0m), 龙华(772m)
4. geo_route(from=office, to=云锦路, mode="walking") → 3 min walk
```

## Security notes

- Without `MCP_AUTH_TOKEN`, `/mcp` is open to anyone who knows the URL, and they can spend your Workers quota and the fair-use budget of the public upstreams. For any public deployment, set a token: `npx wrangler secret put MCP_AUTH_TOKEN`. The token is compared in constant time.
- `/`, `/health`, `/healthz` and `OPTIONS` preflight are always unauthenticated. They return only name, version, build info and the tool list.
- `ALLOWED_ORIGINS` limits browser origins (requests with a non-listed `Origin` get `403`). It is not a substitute for the token: non-browser clients can omit `Origin`.
- Request bodies over 1 MB are rejected, and internal errors never return stack traces.
- Tool inputs (addresses, coordinates) are sent to the configured upstreams (by default OSM community services). Do not send data you would not share with them.

## Development

Requires Node.js ≥ 20. There are no runtime dependencies.

```bash
npm test          # node:test suite; upstream APIs are mocked, no network needed
npm run check     # syntax / import check
npm run dev       # local server via wrangler (http://localhost:8787)
```

Layout:

```
src/index.js      Worker entry: routing, CORS, auth, body parsing
src/protocol.js   MCP JSON-RPC handling
src/tools.js      Tool schemas + handlers (input validation)
src/providers.js  Nominatim / Overpass / OSRM clients (timeouts, errors)
src/config.js     Env var parsing and defaults
src/http.js       Response, CORS and auth helpers
src/util.js       Validation and geometry helpers
test/             node:test suites with a mocked global fetch
```

## Deploy

```bash
npx wrangler login
npx wrangler secret put MCP_AUTH_TOKEN      # optional, enables bearer auth
npx wrangler deploy \
  --var BUILD_SHA:$(git rev-parse --short HEAD) \
  --var BUILD_TIME:$(date -u +%FT%TZ)
```

Use a scoped Cloudflare API token (`CLOUDFLARE_API_TOKEN`, "Edit Cloudflare Workers" template) for CI or non-interactive deploys. Don't use the Global API Key.

### Usage limits of the public upstreams

The default upstreams are free community services with fair-use policies: Nominatim allows at most 1 request/second, and Overpass and the OSRM/FOSSGIS routers throttle heavy users. For production traffic, set `MCP_AUTH_TOKEN` so the endpoint isn't open to everyone, set an identifying `USER_AGENT`, and consider self-hosted instances (the `*_URL` vars).

## Expansion roadmap

See [docs/GEO_TRANSIT_RESEARCH_REPORT.md](./docs/GEO_TRANSIT_RESEARCH_REPORT.md) for the full survey of 28 projects.

| Layer | Solution | Coverage | Status |
|---|---|---|---|
| Layer 0 | OSRM + Nominatim + Overpass | Global driving/walking/POI | ✓ Deployed |
| Layer 1 | Transitous | International public transit | Researched, not deployed |
| Layer 2 | Amap (高德) API | China public transit | Researched, not deployed |

## Related projects

- [time-mcp-worker](https://github.com/Kerry1020/time-mcp-worker) — time zone lookup, conversion and time differences
- [memory-mcp-worker](https://github.com/Kerry1020/memory-mcp-worker) — persistent KV-backed memory for agents
- [webhook-inbox-mcp-worker](https://github.com/Kerry1020/webhook-inbox-mcp-worker) — receive webhooks into KV and read them as MCP tools
- [summarize-mcp-worker](https://github.com/Kerry1020/summarize-mcp-worker) — web page extraction and extractive summarization
- [image-mcp-worker](https://github.com/Kerry1020/image-mcp-worker) — image generation via any OpenAI-compatible images API
- [calc-mcp-worker](https://github.com/Kerry1020/calc-mcp-worker) — math: expressions, calculus, matrices, statistics
- [search-mcp-worker](https://github.com/Kerry1020/search-mcp-worker) — multi-engine web search with open, auditable ranking

## License

Licensed under the [GNU General Public License v3.0](LICENSE).
