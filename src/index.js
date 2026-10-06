// geo-mcp-worker — Geo MCP Server for Cloudflare Workers.
// Geocoding, POI search and routing via Nominatim / Overpass / OSRM.
// Stateless: no KV, no sessions. Optional bearer auth via MCP_AUTH_TOKEN.

import { SERVER_NAME, SERVER_VERSION, getConfig } from "./config.js";
import { corsHeaders, isAuthorized, json, originAllowed } from "./http.js";
import { ErrorCode, handleBody, rpcError } from "./protocol.js";
import { TOOLS } from "./tools.js";

const MAX_BODY_BYTES = 1024 * 1024;

async function route(request, cfg, cors) {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  if (url.pathname === "/" || url.pathname === "/health" || url.pathname === "/healthz") {
    return json({
      ok: true,
      name: SERVER_NAME,
      version: SERVER_VERSION,
      build: cfg.build,
      tools: TOOLS.map((t) => t.name),
      data_sources: ["nominatim", "overpass", "osrm"],
    }, 200, cors);
  }

  if (url.pathname !== "/mcp") return json(rpcError(null, -32004, "not found"), 404, cors);

  if (!originAllowed(request, cfg)) return json(rpcError(null, ErrorCode.INVALID_REQUEST, "origin not allowed"), 403, cors);

  if (!isAuthorized(request, cfg)) {
    return json(rpcError(null, ErrorCode.INVALID_REQUEST, "unauthorized"), 401, { ...cors, "WWW-Authenticate": 'Bearer realm="geo-mcp-worker"' });
  }

  // Streamable HTTP: this server offers no SSE stream, so GET is not allowed.
  if (request.method !== "POST") {
    return json(rpcError(null, ErrorCode.INVALID_REQUEST, "POST required"), 405, { ...cors, Allow: "POST, OPTIONS" });
  }

  const len = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(len) && len > MAX_BODY_BYTES) {
    return json(rpcError(null, ErrorCode.INVALID_REQUEST, "request body too large"), 413, cors);
  }

  let text;
  try {
    text = await request.text();
  } catch {
    return json(rpcError(null, ErrorCode.PARSE_ERROR, "could not read body"), 400, cors);
  }
  if (text.length > MAX_BODY_BYTES) return json(rpcError(null, ErrorCode.INVALID_REQUEST, "request body too large"), 413, cors);

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return json(rpcError(null, ErrorCode.PARSE_ERROR, "invalid JSON"), 400, cors);
  }

  const out = await handleBody(body, cfg);
  if (out == null) return new Response(null, { status: 202, headers: cors });
  return json(out, 200, cors);
}

export default {
  async fetch(request, env, ctx) {
    const cfg = getConfig(env);
    const cors = corsHeaders(request, cfg);
    try {
      return await route(request, cfg, cors);
    } catch (e) {
      // Never leak stack traces to clients.
      console.error("unhandled error", e);
      return json(rpcError(null, ErrorCode.INTERNAL_ERROR, "internal error"), 500, cors);
    }
  },
};
