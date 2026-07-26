/**
 * conduit-gateway public surface.
 *
 * The control-plane service: bearer auth, tenant isolation, and per-tenant usage
 * metering over injected inference, retrieval, agent, and eval cores, plus an
 * MCP surface behind the same auth. The pure router and handlers are exported
 * for embedding and testing; `createGatewayServer` is the thin Node http binding.
 */
export { route, bearerToken } from "./router";
export {
  handleInfer,
  handleRetrieve,
  handleAgent,
  handleEvalsRun,
  handleUsage,
  handleHealthz,
} from "./handlers";
export { aggregateUsage, withinWindow, parseWindow, MemoryMeterSink } from "./metering";
export { buildGatewayTools, createGatewaySse } from "./mcp";
export { createGatewayServer } from "./server";

export type {
  Tenant,
  LookupTenant,
  MeterSink,
  Decision,
  GatewayDeps,
  GatewayCores,
  ParsedRequest,
  RouteResponse,
  InferTask,
  InferResult,
  RetrieveTask,
  RetrieveResult,
  AgentTask,
  AgentResult,
  EvalTask,
  EvalResult,
  UsageResult,
  UsageByUseCase,
} from "./types";
