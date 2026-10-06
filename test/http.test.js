import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { call, rpc, noUpstream, restoreFetch } from "./helpers.js";

beforeEach(() => noUpstream());
afterEach(() => restoreFetch());

test("health endpoints", async () => {
  for (const p of ["/", "/health", "/healthz"]) {
    const { res, data } = await call(p, { method: "GET" });
    assert.equal(res.status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.name, "geo-mcp-worker");
    assert.deepEqual(data.tools, ["geo_geocode", "geo_reverse", "geo_find_poi", "geo_route"]);
    assert.deepEqual(data.build, { sha: "unknown", time: "unknown" });
  }
});

test("health reports build info from env", async () => {
  const { data } = await call("/health", { method: "GET", env: { BUILD_SHA: "abc123", BUILD_TIME: "t" } });
  assert.deepEqual(data.build, { sha: "abc123", time: "t" });
});

test("unknown path is 404", async () => {
  const { res } = await call("/nope", { method: "GET" });
  assert.equal(res.status, 404);
});

test("GET /mcp is 405 with Allow header", async () => {
  const { res } = await call("/mcp", { method: "GET" });
  assert.equal(res.status, 405);
  assert.match(res.headers.get("Allow"), /POST/);
});

test("CORS preflight allows Authorization and MCP headers", async () => {
  const { res } = await call("/mcp", { method: "OPTIONS" });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "*");
  assert.match(res.headers.get("Access-Control-Allow-Headers"), /Authorization/);
  assert.match(res.headers.get("Access-Control-Allow-Headers"), /Mcp-Protocol-Version/);
});

test("CORS header present on JSON responses", async () => {
  const { res } = await rpc("ping");
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "*");
  assert.equal(res.headers.get("Content-Type"), "application/json");
});

test("ALLOWED_ORIGINS restricts origins", async () => {
  const env = { ALLOWED_ORIGINS: "https://a.example, https://b.example" };
  const ok = await rpc("ping", undefined, { env, headers: { Origin: "https://b.example" } });
  assert.equal(ok.res.status, 200);
  assert.equal(ok.res.headers.get("Access-Control-Allow-Origin"), "https://b.example");
  const bad = await rpc("ping", undefined, { env, headers: { Origin: "https://evil.example" } });
  assert.equal(bad.res.status, 403);
  assert.equal(bad.res.headers.get("Access-Control-Allow-Origin"), null);
  const none = await rpc("ping", undefined, { env });
  assert.equal(none.res.status, 200);
});

test("bearer auth is enforced only when MCP_AUTH_TOKEN is set", async () => {
  const env = { MCP_AUTH_TOKEN: "s3cret" };
  const missing = await rpc("ping", undefined, { env });
  assert.equal(missing.res.status, 401);
  assert.match(missing.res.headers.get("WWW-Authenticate"), /Bearer/);
  const wrong = await rpc("ping", undefined, { env, headers: { Authorization: "Bearer nope" } });
  assert.equal(wrong.res.status, 401);
  const prefix = await rpc("ping", undefined, { env, headers: { Authorization: "Bearer s3cre" } });
  assert.equal(prefix.res.status, 401);
  const good = await rpc("ping", undefined, { env, headers: { Authorization: "Bearer s3cret" } });
  assert.equal(good.res.status, 200);
  // health stays public; preflight works without credentials
  assert.equal((await call("/health", { method: "GET", env })).res.status, 200);
  assert.equal((await call("/mcp", { method: "OPTIONS", env })).res.status, 204);
  // no token configured -> open
  assert.equal((await rpc("ping")).res.status, 200);
});

test("oversized body is rejected", async () => {
  const { res } = await call("/mcp", { body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", pad: "x".repeat(1024 * 1024) }) });
  assert.equal(res.status, 413);
});
