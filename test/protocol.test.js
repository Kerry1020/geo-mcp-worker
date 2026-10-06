import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { call, rpc, noUpstream, restoreFetch } from "./helpers.js";

beforeEach(() => noUpstream());
afterEach(() => restoreFetch());

test("initialize echoes a supported protocol version", async () => {
  const { res, data } = await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } });
  assert.equal(res.status, 200);
  assert.equal(data.jsonrpc, "2.0");
  assert.equal(data.id, 1);
  assert.equal(data.result.protocolVersion, "2025-03-26");
  assert.deepEqual(data.result.capabilities, { tools: { listChanged: false } });
  assert.equal(data.result.serverInfo.name, "geo-mcp-worker");
});

test("initialize falls back to latest version for unknown versions", async () => {
  const { data } = await rpc("initialize", { protocolVersion: "1999-01-01" });
  assert.equal(data.result.protocolVersion, "2025-06-18");
});

test("ping returns empty result", async () => {
  const { data } = await rpc("ping", undefined, { id: "abc" });
  assert.deepEqual(data, { jsonrpc: "2.0", id: "abc", result: {} });
});

test("tools/list returns the four tools with stable names", async () => {
  const { data } = await rpc("tools/list");
  assert.deepEqual(data.result.tools.map((t) => t.name), ["geo_geocode", "geo_reverse", "geo_find_poi", "geo_route"]);
  for (const t of data.result.tools) {
    assert.equal(t.inputSchema.type, "object");
    assert.ok(Array.isArray(t.inputSchema.required));
  }
});

test("notifications get 202 with no body", async () => {
  for (const method of ["notifications/initialized", "initialized", "notifications/cancelled", "something/unknown"]) {
    const { res, data } = await call("/mcp", { body: { jsonrpc: "2.0", method } });
    assert.equal(res.status, 202, method);
    assert.equal(data, null);
  }
});

test("client responses are accepted silently", async () => {
  const { res } = await call("/mcp", { body: { jsonrpc: "2.0", id: 5, result: {} } });
  assert.equal(res.status, 202);
});

test("unknown method returns -32601", async () => {
  const { data } = await rpc("resources/list");
  assert.equal(data.error.code, -32601);
});

test("unknown tool returns -32602", async () => {
  const { data } = await rpc("tools/call", { name: "nope", arguments: {} });
  assert.equal(data.error.code, -32602);
});

test("non-object arguments return -32602", async () => {
  const { data } = await rpc("tools/call", { name: "geo_geocode", arguments: "x" });
  assert.equal(data.error.code, -32602);
});

test("invalid JSON returns -32700", async () => {
  const { res, data } = await call("/mcp", { body: "{not json" });
  assert.equal(res.status, 400);
  assert.equal(data.error.code, -32700);
  assert.equal(data.id, null);
});

test("invalid request shapes return -32600", async () => {
  for (const body of [{ id: 1, method: "ping" }, { jsonrpc: "2.0", id: 1 }, 42, { jsonrpc: "2.0", id: {}, method: "ping" }]) {
    const { data } = await call("/mcp", { body });
    assert.equal(data.error.code, -32600, JSON.stringify(body));
  }
});

test("batch requests return only responses for requests", async () => {
  const { res, data } = await call("/mcp", {
    body: [
      { jsonrpc: "2.0", id: 1, method: "ping" },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
    ],
  });
  assert.equal(res.status, 200);
  assert.equal(data.length, 2);
  assert.deepEqual(data.map((r) => r.id), [1, 2]);
});

test("batch of only notifications returns 202", async () => {
  const { res } = await call("/mcp", { body: [{ jsonrpc: "2.0", method: "notifications/initialized" }] });
  assert.equal(res.status, 202);
});

test("empty batch is an invalid request", async () => {
  const { data } = await call("/mcp", { body: [] });
  assert.equal(data.error.code, -32600);
});
