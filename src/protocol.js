// MCP JSON-RPC 2.0 message handling (transport-agnostic).

import { SERVER_NAME, SERVER_VERSION } from "./config.js";
import { TOOLS, TOOL_HANDLERS } from "./tools.js";
import { isPlainObject } from "./util.js";

export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
export const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

export const ErrorCode = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
};

export function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function rpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function validId(id) {
  return id === null || typeof id === "string" || (typeof id === "number" && Number.isFinite(id));
}

function toolResult(result) {
  const out = {
    content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result) }],
    structuredContent: result,
  };
  if (result && result.ok === false) out.isError = true;
  return out;
}

async function callTool(params, cfg) {
  const name = params && params.name;
  const handler = typeof name === "string" && Object.prototype.hasOwnProperty.call(TOOL_HANDLERS, name) ? TOOL_HANDLERS[name] : null;
  if (!handler) return { error: [ErrorCode.INVALID_PARAMS, `unknown tool: ${name}`] };
  const args = params.arguments ?? {};
  if (!isPlainObject(args)) return { error: [ErrorCode.INVALID_PARAMS, "params.arguments must be an object"] };
  try {
    return { result: toolResult(await handler(args, cfg)) };
  } catch (e) {
    return { result: toolResult({ ok: false, reason: "internal_error", message: e && e.message ? e.message : String(e) }) };
  }
}

// Handles one JSON-RPC message. Returns a response object, or null when no
// response must be sent (notifications and client responses).
export async function handleMessage(msg, cfg) {
  if (!isPlainObject(msg)) return rpcError(null, ErrorCode.INVALID_REQUEST, "invalid request");

  const hasId = Object.prototype.hasOwnProperty.call(msg, "id");
  const isNotification = !hasId;

  // A response sent by the client (e.g. to a server request) — nothing to do.
  if (typeof msg.method !== "string" && hasId && ("result" in msg || "error" in msg)) return null;

  if (msg.jsonrpc !== "2.0" || typeof msg.method !== "string" || (hasId && !validId(msg.id))) {
    return rpcError(hasId && validId(msg.id) ? msg.id : null, ErrorCode.INVALID_REQUEST, "invalid request");
  }

  // Notifications (no id) never get a response, whatever the method.
  if (isNotification) return null;

  const { id, method } = msg;
  const params = msg.params;
  if (params !== undefined && !isPlainObject(params) && !Array.isArray(params)) {
    return rpcError(id, ErrorCode.INVALID_PARAMS, "params must be an object");
  }

  switch (method) {
    case "initialize": {
      const requested = params && params.protocolVersion;
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : LATEST_PROTOCOL_VERSION;
      return rpcResult(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      });
    }
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: TOOLS });
    case "tools/call": {
      if (!isPlainObject(params)) return rpcError(id, ErrorCode.INVALID_PARAMS, "params must be an object");
      const r = await callTool(params, cfg);
      return r.error ? rpcError(id, r.error[0], r.error[1]) : rpcResult(id, r.result);
    }
    default:
      return rpcError(id, ErrorCode.METHOD_NOT_FOUND, `method not found: ${method}`);
  }
}

// Handles a parsed request body (single message or batch).
// Returns a JSON-serialisable value, or null when nothing should be returned.
export async function handleBody(body, cfg) {
  if (Array.isArray(body)) {
    if (body.length === 0) return rpcError(null, ErrorCode.INVALID_REQUEST, "empty batch");
    const out = [];
    for (const msg of body) {
      const r = await handleMessage(msg, cfg);
      if (r) out.push(r);
    }
    return out.length ? out : null;
  }
  return await handleMessage(body, cfg);
}
