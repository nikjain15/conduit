/**
 * The port binding: a thin `http.createServer` listener over the pure router.
 *
 * Its only jobs are to (1) parse the incoming Node request into a ParsedRequest,
 * (2) hand MCP transport paths (`/sse`, `/messages`) to `@conduit/mcp` behind the
 * same bearer auth, and (3) route everything else through `route()` and write the
 * `{ status, json }` back. No business logic lives here. Uses only Node built-ins
 * (`http`, `URL`), so the service needs no dependency install to run.
 */
import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { route, bearerToken } from "./router";
import { createGatewaySse } from "./mcp";
import type { GatewayDeps, ParsedRequest, Tenant } from "./types";

const MAX_BODY_BYTES = 1_000_000;

/** Read and JSON-parse the request body. Empty body -> undefined. */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error("payload too large");
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return undefined;
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (text.length === 0) return undefined;
  return JSON.parse(text);
}

function lowerHeaders(req: IncomingMessage): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    out[k] = Array.isArray(v) ? v.join(", ") : v;
  }
  return out;
}

function writeJson(res: ServerResponse, status: number, json: unknown): void {
  const body = JSON.stringify(json ?? null);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(body);
}

/** Resolve the tenant for MCP transport requests, mirroring /v1 auth. */
async function authTenant(
  headers: Record<string, string | undefined>,
  deps: GatewayDeps,
): Promise<Tenant | null> {
  const token = bearerToken(headers);
  if (!token) return null;
  return (await deps.lookupTenant(token)) ?? null;
}

/**
 * Build the HTTP server. Not started; the caller decides the port and lifecycle.
 * Injecting all cores keeps this deployable and testable.
 */
export function createGatewayServer(deps: GatewayDeps): http.Server {
  // One SSE handler per tenant, persisted across requests so a POST /messages
  // finds the session opened by that tenant's earlier GET /sse.
  const sseByTenant = new Map<string, Awaited<ReturnType<typeof createGatewaySse>>>();
  const getSse = async (tenant: Tenant) => {
    let handler = sseByTenant.get(tenant.id);
    if (!handler) {
      handler = await createGatewaySse(deps, tenant);
      sseByTenant.set(tenant.id, handler);
    }
    return handler;
  };

  return http.createServer((req: IncomingMessage, res: ServerResponse) => {
    void handle(req, res, deps, getSse).catch((err) => {
      const message = err instanceof Error ? err.message : "internal error";
      if (!res.headersSent) writeJson(res, 500, { error: "internal_error", message });
      else res.end();
    });
  });
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  deps: GatewayDeps,
  getSse: (tenant: Tenant) => Promise<Awaited<ReturnType<typeof createGatewaySse>>>,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname;
  const method = (req.method ?? "GET").toUpperCase();
  const headers = lowerHeaders(req);

  // MCP transport, behind the same bearer auth as /v1.
  if (path === "/sse" || path === "/messages") {
    const tenant = await authTenant(headers, deps);
    if (!tenant) return writeJson(res, 401, { error: "unauthorized" });
    const sse = await getSse(tenant);
    if (path === "/sse") return sse.handleSse(req, res);
    const sessionId = url.searchParams.get("sessionId") ?? "";
    return sse.handleMessage(sessionId, req, res);
  }

  let body: unknown;
  try {
    body = method === "GET" || method === "HEAD" ? undefined : await readJsonBody(req);
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid body";
    return writeJson(res, 400, { error: "invalid_request", message });
  }

  const parsed: ParsedRequest = { method, path, query: url.searchParams, headers, body };
  const result = await route(parsed, deps);
  writeJson(res, result.status, result.json);
}
