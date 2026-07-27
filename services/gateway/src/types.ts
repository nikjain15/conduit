/**
 * Wire contracts and injection seams for the Conduit gateway.
 *
 * The gateway is deliberately thin: it owns auth, tenant isolation, and
 * metering, and delegates all real work to injected cores (`infer`, `retrieve`,
 * `runAgent`, `evaluate`) plus a decision store. Everything the gateway touches
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

/** A resolved app: the product the calling token belongs to. Like the tenant,
 *  it is a property of the caller derived from the bearer token, never read from
 *  the request body. Its `label` is the human name shown in the console. */
export interface App {
  id: string;
  label: string;
}

/**
 * The principal a bearer token resolves to: a tenant and the app it calls as.
 * Both are trusted only from the token, never from the request body, so a
 * client cannot spoof either the tenant or the app it reports under.
 */
export interface Principal {
  tenant: Tenant;
  app: App;
}

/** Resolve a bearer API key to a principal (`{ tenant, app }`). Return null for
 *  unknown keys. Injected so tests supply their own key table. */
export type LookupTenant = (apiKey: string) => Principal | null | Promise<Principal | null>;

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

/**
 * One metered decision. The gateway records one per inference (via /v1/infer)
 * and accepts externally reported ones (via /v1/decisions). Only `tenant`,
 * `useCase`, `model`, `costUsd`, `latencyMs`, and `at` are guaranteed; the token
 * counts, provider, and gate status are optional because not every producer has
 * them. The tenant and app are always stamped by the gateway from the resolved
 * API key, never trusted from a client body: `app` records which product the
 * decision belongs to (e.g. "founderfirst") and `appLabel` its display name.
 */
export interface Decision {
  tenant: string;
  /** The app the calling token belongs to. Stamped from the token, never the
   *  body, so a client-supplied app is ignored the same way tenant is. */
  app: string;
  /** Display name for `app`, denormalized onto the record so the usage and suqs
   *  rollups can label each app group without a separate registry lookup. */
  appLabel?: string;
  useCase: string;
  model: string;
  provider?: string;
  costUsd: number;
  latencyMs: number;
  tokensIn?: number;
  tokensOut?: number;
  /** Outcome of any inline gate: "pass" or "block" drive the SUQS block rate. */
  gateStatus?: "pass" | "block";
  /** Epoch ms; defaults to Date.now() when the gateway records it. */
  at: number;
}

/** Optional filter for a decision query. All bounds are inclusive of `since`
 *  and exclusive of `until` (epoch ms); `useCase` narrows to one use case. */
export interface DecisionQuery {
  since?: number;
  until?: number;
  useCase?: string;
}

/**
 * The persistent-capable decision store: the metering seam.
 *
 * The gateway appends one decision per metered event and queries them back,
 * always scoped to a single tenant, to build /v1/usage and /v1/suqs. It is an
 * interface so the default `InMemoryDecisionStore` can be swapped for a durable
 * backend (Postgres, SQLite, D1) without touching a handler: implement `append`
 * as an INSERT and `query` as a tenant-scoped SELECT with a WHERE over `at` and
 * `useCase`. `query` receives the tenant so a real store never scans across
 * tenants, which is what keeps tenant isolation a storage-layer invariant rather
 * than an application-layer filter.
 */
export interface DecisionStore {
  append(record: Decision): void | Promise<void>;
  query(tenant: string, filter?: DecisionQuery): Decision[] | Promise<Decision[]>;
}

/** One use case's summed cost inside an app's usage rollup. */
export interface UsageUseCase {
  useCase: string;
  costUsd: number;
}

/** One app's usage rollup: its total spend and the per-use-case breakdown. */
export interface UsageApp {
  app: string;
  appLabel: string;
  totalCostUsd: number;
  useCases: UsageUseCase[];
}

/**
 * Usage rollup returned by GET /v1/usage, grouped by app then use case.
 * `totalCostUsd` is the tenant-wide total; `byApp` holds one entry per app the
 * tenant has metered decisions under. Empty when the tenant has no records: an
 * honest empty state (`{ totalCostUsd: 0, byApp: [] }`), never a fabricated
 * figure.
 */
export interface UsageResult {
  totalCostUsd: number;
  byApp: UsageApp[];
}

/** A profile SLO target the SUQS endpoint compares measured values against. */
export interface SloTarget {
  p95LatencyMs?: number;
  costPerAnswerUsd?: number;
  gateBlockRate?: number;
}

/**
 * One computed SUQS row: real p95 latency, cost per answer, and gate block rate
 * for a use case, plus the profile target when one is known. Every number here
 * is derived from real recorded decisions; `target` is null when no SLO is
 * configured for the use case.
 */
export interface SuqsRow {
  useCase: string;
  calls: number;
  p95LatencyMs: number;
  costPerAnswerUsd: number;
  gateBlockRate: number;
  target: SloTarget | null;
}

/** One app's SUQS rollup: its use case rows grouped under the app. */
export interface SuqsApp {
  app: string;
  appLabel: string;
  useCases: SuqsRow[];
}

/** GET /v1/suqs result, grouped by app then use case. `byApp` is empty when the
 *  tenant has no records. */
export interface SuqsResult {
  byApp: SuqsApp[];
}

/** Resolve the SLO target for a tenant's use case, or undefined when none is
 *  configured. Injected so targets come from the profile store in production
 *  and from a fake in tests. */
export type SloTargetLookup = (
  tenant: Tenant,
  useCase: string,
) => SloTarget | undefined | Promise<SloTarget | undefined>;

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
  store: DecisionStore;
  /** SLO targets for /v1/suqs. Optional: when absent, SUQS rows carry a null
   *  target rather than an invented one. */
  sloTargets?: SloTargetLookup;
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
 *  `tenant` and `app` fields are filled in by the router after auth from the
 *  resolved principal, never by the client. */
export interface ParsedRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Record<string, string | undefined>;
  body: unknown;
  tenant?: Tenant;
  app?: App;
}

/** What every handler returns. The transport serializes `json` with `status`. */
export interface RouteResponse {
  status: number;
  json: unknown;
}
