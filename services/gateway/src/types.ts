/**
 * Wire contracts and injection seams for the Conduit gateway.
 *
 * The gateway is deliberately thin: it owns auth, tenant isolation, and
 * metering, and delegates all real work to injected cores (`infer`, `retrieve`,
 * `runAgent`, `evaluate`) plus a metering sink. Everything the gateway touches
 * is an interface here, so the router can be unit tested with fakes and no
 * network, no clock, and no open port.
 */
import type { ChatMessage } from "@conduit/inference";
import type { CatalogModel } from "@conduit/catalog";

/**
 * The catalog source the gateway injects into the models endpoint. The live
 * OpenRouter fetch is a function so tests supply a mock and no network is hit;
 * the curated entries are static. The gateway caches the fetch result in
 * process, so this function should perform the real request each time it runs.
 */
export interface CatalogSource {
  fetchOpenRouter(): Promise<CatalogModel[]>;
  curated: CatalogModel[];
}

/** A resolved tenant. The gateway derives this from the API key and never
 *  trusts a client-supplied tenant field. */
export interface Tenant {
  id: string;
  name?: string;
}

/** Resolve a bearer API key to a tenant. Return null for unknown keys.
 *  Injected so tests supply their own key table. */
export type LookupTenant = (apiKey: string) => Tenant | null | Promise<Tenant | null>;

/** The inference task the gateway hands to the injected `infer` core. The
 *  tenant id is stamped by the gateway from the resolved key, not the body. */
export interface InferTask {
  useCase: string;
  messages: ChatMessage[];
  system?: string;
  maxTokens?: number;
  pinModel?: string;
}

/** What the injected `infer` core returns. Mirrors the POST /v1/infer body. */
export interface InferResult {
  output: string;
  model: string;
  provider: string;
  costUsd: number;
  latencyMs: number;
  decisionId: string;
}

export interface RetrieveTask {
  query: string;
  topK?: number;
}

export interface RetrieveChunk {
  id: string;
  text: string;
  score: number;
}

export interface RetrieveResult {
  chunks: RetrieveChunk[];
  grounded: boolean;
}

export interface AgentTask {
  goal: string;
  maxSteps?: number;
}

export interface AgentStep {
  thought?: string;
  action?: string;
  observation?: string;
}

export interface AgentResult {
  answer: string;
  steps: AgentStep[];
}

export interface EvalTask {
  datasetId: string;
}

export interface EvalResult {
  summary: string;
  metrics: Record<string, number>;
}

/** One metered decision, recorded per /v1/infer call. */
export interface Decision {
  tenant: string;
  useCase: string;
  model: string;
  costUsd: number;
  latencyMs: number;
  /** Epoch ms; defaults to Date.now() when the gateway records it. */
  at: number;
}

/**
 * The metering sink. The gateway writes one decision per inference and reads
 * them back, scoped to a tenant, to build /v1/usage. Injected so tests can
 * assert exactly what was recorded and so production can back it with a durable
 * store. `list` receives the tenant so a real store never scans across tenants.
 */
export interface MeterSink {
  record(decision: Decision): void | Promise<void>;
  list(tenant: string): Decision[] | Promise<Decision[]>;
}

/** Per-use-case usage rollup returned by GET /v1/usage. */
export interface UsageByUseCase {
  useCase: string;
  calls: number;
  costUsd: number;
}

export interface UsageResult {
  totalCostUsd: number;
  byUseCase: UsageByUseCase[];
}

/** The injected cores the gateway orchestrates. Each is tenant-scoped by the
 *  gateway passing the resolved tenant, never the request body. */
export interface GatewayCores {
  infer(task: InferTask, tenant: Tenant): Promise<InferResult>;
  retrieve(task: RetrieveTask, tenant: Tenant): Promise<RetrieveResult>;
  runAgent(task: AgentTask, tenant: Tenant): Promise<AgentResult>;
  evaluate(task: EvalTask, tenant: Tenant): Promise<EvalResult>;
}

/** Everything the router needs, all injectable. */
export interface GatewayDeps extends GatewayCores {
  lookupTenant: LookupTenant;
  meter: MeterSink;
  /** Clock seam, defaults to Date.now. */
  now?: () => number;
  /** Model catalog source for GET /v1/models. Optional so cores that do not
   *  serve the catalog endpoint need not provide it. */
  catalog?: CatalogSource;
}

/** Response shape of GET /v1/models. `recommended` is present only when a
 *  useCase is supplied. */
export interface ModelsResult {
  models: CatalogModel[];
  recommended?: string[];
}

/** A request parsed by the transport into a shape the router understands. The
 *  `tenant` field is filled in by the router after auth, never by the client. */
export interface ParsedRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Record<string, string | undefined>;
  body: unknown;
  tenant?: Tenant;
}

/** What every handler returns. The transport serializes `json` with `status`. */
export interface RouteResponse {
  status: number;
  json: unknown;
}
