import worker from "../src/index.js";

const realFetch = globalThis.fetch;

// Installs a mock global fetch. `handler(url, init)` returns a Response
// (or a plain object, which is sent as JSON). Every call is recorded.
export function mockFetch(handler) {
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    calls.push({ url, init });
    if (init.signal && init.signal.aborted) throw init.signal.reason;
    const r = await handler(url, init);
    return r instanceof Response ? r : new Response(JSON.stringify(r), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  return calls;
}

export function restoreFetch() {
  globalThis.fetch = realFetch;
}

export function noUpstream() {
  return mockFetch((url) => {
    throw new Error(`unexpected upstream call: ${url}`);
  });
}

export async function call(path, { method = "POST", body, headers = {}, env = {} } = {}) {
  const init = { method, headers: { "Content-Type": "application/json", ...headers } };
  if (body !== undefined) init.body = typeof body === "string" ? body : JSON.stringify(body);
  const res = await worker.fetch(new Request(`https://geo.example.com${path}`, init), env, {});
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { res, data };
}

export async function rpc(method, params, { id = 1, env, headers } = {}) {
  const msg = { jsonrpc: "2.0", id, method };
  if (params !== undefined) msg.params = params;
  return call("/mcp", { body: msg, env, headers });
}

export async function tool(name, args, opts) {
  const { res, data } = await rpc("tools/call", { name, arguments: args }, opts);
  return { res, data, result: data && data.result, sc: data && data.result && data.result.structuredContent };
}
