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
  handleDecisions,
  handleUsage,
  handleSuqs,
  handleModels,
  handleHealthz,
} from "./handlers";
export {
  aggregateUsage,
  computeSuqs,
  percentile,
  withinWindow,
  parseWindow,
  InMemoryDecisionStore,
  DEFAULT_RETENTION,
  retentionCutoffs,
  applyRetention,
} from "./metering";
export { buildGatewayTools, createGatewaySse } from "./mcp";
export { createGatewayServer } from "./server";

export type {
  Tenant,
  App,
  Principal,
  LookupTenant,
  DecisionStore,
  DecisionQuery,
  Decision,
  RetentionPolicy,
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
  UsageApp,
  UsageUseCase,
  SuqsResult,
  SuqsApp,
  SuqsRow,
  SloTarget,
  SloTargetLookup,
  CatalogSource,
  ModelsResult,
} from "./types";
