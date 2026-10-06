// Runtime configuration, read from Worker env vars (wrangler.toml [vars] / secrets).
// Nothing in here is secret by default; MCP_AUTH_TOKEN must be set as a secret.

export const SERVER_NAME = "geo-mcp-worker";
export const SERVER_VERSION = "1.1.0";

export const DEFAULTS = {
  UPSTREAM_TIMEOUT_MS: 10000,
  USER_AGENT: "geo-mcp-worker/1.1 (+https://github.com/Kerry1020/geo-mcp-worker)",
  ACCEPT_LANGUAGE: "zh",
  NOMINATIM_URL: "https://nominatim.openstreetmap.org",
  OVERPASS_URL: "https://overpass-api.de/api/interpreter",
  // The public OSRM demo server only hosts the car profile: any profile in the
  // URL is answered with car routing. FOSSGIS hosts real foot/bike profiles.
  OSRM_URL_DRIVING: "https://router.project-osrm.org",
  OSRM_URL_WALKING: "https://routing.openstreetmap.de/routed-foot",
  OSRM_URL_CYCLING: "https://routing.openstreetmap.de/routed-bike",
};

function str(v, fallback) {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : fallback;
}

function stripSlash(u) {
  return u.replace(/\/+$/, "");
}

export function getConfig(env = {}) {
  const timeout = Number(env.UPSTREAM_TIMEOUT_MS);
  const origins = str(env.ALLOWED_ORIGINS, "*");
  return {
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? Math.min(timeout, 60000) : DEFAULTS.UPSTREAM_TIMEOUT_MS,
    userAgent: str(env.USER_AGENT, DEFAULTS.USER_AGENT),
    acceptLanguage: str(env.ACCEPT_LANGUAGE, DEFAULTS.ACCEPT_LANGUAGE),
    nominatimUrl: stripSlash(str(env.NOMINATIM_URL, DEFAULTS.NOMINATIM_URL)),
    overpassUrl: str(env.OVERPASS_URL, DEFAULTS.OVERPASS_URL),
    osrmUrls: {
      driving: stripSlash(str(env.OSRM_URL_DRIVING, DEFAULTS.OSRM_URL_DRIVING)),
      walking: stripSlash(str(env.OSRM_URL_WALKING, DEFAULTS.OSRM_URL_WALKING)),
      cycling: stripSlash(str(env.OSRM_URL_CYCLING, DEFAULTS.OSRM_URL_CYCLING)),
    },
    authToken: str(env.MCP_AUTH_TOKEN, ""),
    allowedOrigins: origins === "*" ? "*" : origins.split(",").map((s) => s.trim()).filter(Boolean),
    build: { sha: str(env.BUILD_SHA, "unknown"), time: str(env.BUILD_TIME, "unknown") },
  };
}
