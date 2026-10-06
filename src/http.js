// HTTP-level helpers: JSON responses, CORS, bearer auth.

export function corsHeaders(request, cfg) {
  const h = {
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept, Mcp-Session-Id, Mcp-Protocol-Version",
    "Access-Control-Max-Age": "86400",
  };
  if (cfg.allowedOrigins === "*") {
    h["Access-Control-Allow-Origin"] = "*";
  } else {
    const origin = request.headers.get("Origin");
    if (origin && cfg.allowedOrigins.includes(origin)) h["Access-Control-Allow-Origin"] = origin;
    h["Vary"] = "Origin";
  }
  return h;
}

export function originAllowed(request, cfg) {
  if (cfg.allowedOrigins === "*") return true;
  const origin = request.headers.get("Origin");
  return !origin || cfg.allowedOrigins.includes(origin);
}

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

// When MCP_AUTH_TOKEN is configured, require `Authorization: Bearer <token>`.
export function isAuthorized(request, cfg) {
  if (!cfg.authToken) return true;
  const header = request.headers.get("Authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(header);
  return !!m && timingSafeEqual(m[1].trim(), cfg.authToken);
}
