/**
 * Endpoint handlers: pure async functions over a ParsedRequest and the injected
 * deps, each returning `{ status, json }`. They do no IO of their own beyond the
 * injected cores and the meter, so every one is unit testable directly.
 *
 * By the time a /v1/* handler runs, the router has already authenticated the
 * request and stamped `req.tenant`. Handlers therefore treat `req.tenant` as the
 * single source of tenant identity and ignore any tenant-like field in the body.
 */
import type { ChatMessage } from "@conduit/inference";
import { aggregateUsage, parseWindow, withinWindow } from "./metering";
import type {
  AgentTask,
  Decision,
  EvalTask,
  GatewayDeps,
  InferTask,
  ParsedRequest,
  RetrieveTask,
  RouteResponse,
  Tenant,
} from "./types";

function badRequest(message: string): RouteResponse {
  return { status: 400, json: { error: "invalid_request", message } };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asMessages(v: unknown): ChatMessage[] | null {
  if (!Array.isArray(v)) return null;
  const out: ChatMessage[] = [];
  for (const m of v) {
    if (!isObject(m)) return null;
    const role = m.role;
    const content = m.content;
    if ((role !== "system" && role !== "user" && role !== "assistant") || typeof content !== "string") {
      return null;
    }
    out.push({ role, content });
  }
  return out;
}

/** POST /v1/infer. Records one metered decision on success. */
export async function handleInfer(
  req: ParsedRequest,
  deps: GatewayDeps,
  tenant: Tenant,
): Promise<RouteResponse> {
  const body = req.body;
  if (!isObject(body)) return badRequest("body must be a JSON object");
  if (typeof body.useCase !== "string" || body.useCase.length === 0) {
    return badRequest("useCase is required");
  }
  const messages = asMessages(body.messages);
  if (!messages) return badRequest("messages must be an array of {role, content}");

  // Note: a client-supplied `tenant`/`tenantId` in the body is deliberately
  // ignored. The tenant comes only from the resolved API key.
  const task: InferTask = {
    useCase: body.useCase,
    messages,
    ...(typeof body.system === "string" ? { system: body.system } : {}),
    ...(typeof body.maxTokens === "number" ? { maxTokens: body.maxTokens } : {}),
    ...(typeof body.pinModel === "string" ? { pinModel: body.pinModel } : {}),
  };

  const result = await deps.infer(task, tenant);

  const decision: Decision = {
    tenant: tenant.id,
    useCase: task.useCase,
    model: result.model,
    costUsd: result.costUsd,
    latencyMs: result.latencyMs,
    at: (deps.now ?? Date.now)(),
  };
  await deps.meter.record(decision);

  return { status: 200, json: result };
}

/** POST /v1/retrieve. */
export async function handleRetrieve(
  req: ParsedRequest,
  deps: GatewayDeps,
  tenant: Tenant,
): Promise<RouteResponse> {
  const body = req.body;
  if (!isObject(body)) return badRequest("body must be a JSON object");
  if (typeof body.query !== "string" || body.query.length === 0) {
    return badRequest("query is required");
  }
  const task: RetrieveTask = {
    query: body.query,
    ...(typeof body.topK === "number" ? { topK: body.topK } : {}),
  };
  const result = await deps.retrieve(task, tenant);
  return { status: 200, json: result };
}

/** POST /v1/agent. */
export async function handleAgent(
  req: ParsedRequest,
  deps: GatewayDeps,
  tenant: Tenant,
): Promise<RouteResponse> {
  const body = req.body;
  if (!isObject(body)) return badRequest("body must be a JSON object");
  if (typeof body.goal !== "string" || body.goal.length === 0) {
    return badRequest("goal is required");
  }
  const task: AgentTask = {
    goal: body.goal,
    ...(typeof body.maxSteps === "number" ? { maxSteps: body.maxSteps } : {}),
  };
  const result = await deps.runAgent(task, tenant);
  return { status: 200, json: result };
}

/** POST /v1/evals/run. */
export async function handleEvalsRun(
  req: ParsedRequest,
  deps: GatewayDeps,
  tenant: Tenant,
): Promise<RouteResponse> {
  const body = req.body;
  if (!isObject(body)) return badRequest("body must be a JSON object");
  if (typeof body.datasetId !== "string" || body.datasetId.length === 0) {
    return badRequest("datasetId is required");
  }
  const task: EvalTask = { datasetId: body.datasetId };
  const result = await deps.evaluate(task, tenant);
  return { status: 200, json: result };
}

/** GET /v1/usage?window=. Aggregates the tenant's own decisions only. */
export async function handleUsage(
  req: ParsedRequest,
  deps: GatewayDeps,
  tenant: Tenant,
): Promise<RouteResponse> {
  const now = (deps.now ?? Date.now)();
  const since = parseWindow(req.query.get("window"), now);
  const decisions = await deps.meter.list(tenant.id);
  const scoped = withinWindow(decisions, since);
  return { status: 200, json: aggregateUsage(scoped) };
}

/** GET /healthz. No auth. */
export function handleHealthz(): RouteResponse {
  return { status: 200, json: { ok: true } };
}
