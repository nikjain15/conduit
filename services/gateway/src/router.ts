/**
 * The router: the pure control plane.
 *
 * `route(req, deps)` maps a parsed request to a `{ status, json }` response. It
 * owns three cross-cutting concerns and nothing else:
 *   - auth: /v1/* requires `Authorization: Bearer <apiKey>`; the key resolves to
 *     a tenant via `deps.lookupTenant`. Missing or unknown key -> 401.
 *   - tenant isolation: the resolved tenant is stamped onto the request and
 *     passed to handlers; a client-supplied tenant field is never consulted.
 *   - dispatch: (method, path) -> handler; anything unmatched -> 404.
 *
 * It calls `http.createServer` for nothing. The listener in `server.ts` parses a
 * real request and calls this. Tests call this directly.
 */
import {
  handleAgent,
  handleEvalsRun,
  handleHealthz,
  handleInfer,
  handleModels,
  handleRetrieve,
  handleUsage,
} from "./handlers";
import type { GatewayDeps, ParsedRequest, RouteResponse, Tenant } from "./types";

/** Pull a bearer token out of the Authorization header, or null. */
export function bearerToken(headers: Record<string, string | undefined>): string | null {
  const raw = headers.authorization ?? headers.Authorization;
  if (typeof raw !== "string") return null;
  const m = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return m ? m[1].trim() : null;
}

function unauthorized(): RouteResponse {
  return { status: 401, json: { error: "unauthorized", message: "missing or invalid API key" } };
}

function notFound(): RouteResponse {
  return { status: 404, json: { error: "not_found" } };
}

function methodNotAllowed(): RouteResponse {
  return { status: 405, json: { error: "method_not_allowed" } };
}

type AuthedHandler = (req: ParsedRequest, deps: GatewayDeps, tenant: Tenant) => Promise<RouteResponse> | RouteResponse;

/** (method, path) -> authed handler for the /v1 surface. */
const V1_ROUTES: Record<string, Partial<Record<string, AuthedHandler>>> = {
  "/v1/infer": { POST: handleInfer },
  "/v1/retrieve": { POST: handleRetrieve },
  "/v1/agent": { POST: handleAgent },
  "/v1/evals/run": { POST: handleEvalsRun },
  "/v1/usage": { GET: handleUsage },
  "/v1/models": { GET: handleModels },
};

/**
 * Route a parsed request. Async because auth and handlers may be async.
 * Never throws for expected conditions; those become 4xx responses.
 */
export async function route(req: ParsedRequest, deps: GatewayDeps): Promise<RouteResponse> {
  const { method, path } = req;

  if (path === "/healthz") {
    return method === "GET" ? handleHealthz() : methodNotAllowed();
  }

  if (path.startsWith("/v1/")) {
    const token = bearerToken(req.headers);
    if (!token) return unauthorized();
    const tenant = await deps.lookupTenant(token);
    if (!tenant) return unauthorized();

    const byMethod = V1_ROUTES[path];
    if (!byMethod) return notFound();
    const handler = byMethod[method];
    if (!handler) return methodNotAllowed();

    // Stamp the resolved tenant; handlers read this, never the body.
    const authedReq: ParsedRequest = { ...req, tenant };
    return handler(authedReq, deps, tenant);
  }

  return notFound();
}
