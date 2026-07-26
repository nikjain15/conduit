/**
 * The declarative gate/batch runner.
 *
 * ONE list of eval specs (a use case profile's profile.evals) drives two
 * surfaces from the same code:
 *
 *   - runGate  the INLINE gate: filter the specs to when === "inline", run each
 *              named method from the registry against one live answer, and
 *              combine the verdicts FAIL CLOSED. A mandatory or floor spec that
 *              fails blocks the response; one whose method is missing or throws
 *              makes the gate failed_closed (an operator error, never shipped).
 *
 *   - runBatch the OFFLINE harness: filter to when === "batch" and run each spec
 *              over a labelled dataset through @conduit/evals runEval, rolling
 *              the per-case verdicts up into named confusion-matrix metrics.
 *
 * Both resolve method names against the same registry (@conduit/profile's shared
 * methodRegistry by default) and build the same MethodContext, so a spec means
 * the same thing inline and in batch.
 */
import { methodRegistry, type Registry } from "../../profile/src/registry.ts";
import type { EvalBinding, EvalWhen } from "../../profile/src/types.ts";
import { getMethod, type MethodContext, type MethodDeps } from "./methods.ts";
import { metrics as computeMetrics } from "./metrics.ts";
import { runEval } from "./runner.ts";
import type { Check, EvalCase, EvalDataset, EvalRun, Metrics } from "./types.ts";

/** The overall gate verdict. */
export type GateDecision = "passed" | "blocked" | "failed_closed";

/** One spec's result after running (or failing to run) its method. */
export interface GateSpecResult {
  key: string;
  method: string;
  when: EvalWhen;
  mandatory: boolean;
  floor: boolean;
  /** Whether the method was found and executed without throwing. */
  ran: boolean;
  /** The method's pass verdict. False when it did not run. */
  pass: boolean;
  /** True when no method was registered under this name. */
  missing: boolean;
  label?: string;
  detail?: string;
}

/** The full gate outcome: every spec's result plus the combined decision. */
export interface GateOutcome {
  decision: GateDecision;
  results: GateSpecResult[];
}

/** What a spec run needs at run time beyond the profile: the registry to resolve
 *  method names against and any injected method dependencies. */
export interface GateDeps extends MethodDeps {
  /** Registry to resolve method names against. Default methodRegistry. */
  registry?: Registry<unknown>;
}

/** The live-answer context runGate grades. */
export interface GateContext {
  answer: string;
  retrieved?: string[];
  input?: unknown;
}

/** A spec is blocking when a failure must not ship: mandatory or floor. */
function isBlocking(spec: EvalBinding): boolean {
  return spec.mandatory === true || spec.floor === true;
}

/** Fold a spec's declared params and threshold into the method context params. */
function paramsFor(spec: EvalBinding): Record<string, unknown> | undefined {
  if (spec.params === undefined && spec.threshold === undefined) return undefined;
  return { ...spec.params, ...(spec.threshold === undefined ? {} : { threshold: spec.threshold }) };
}

/**
 * Run the INLINE gate over the inline specs and return per-spec results plus a
 * fail-closed combined decision.
 */
export async function runGate(
  specs: EvalBinding[],
  ctx: GateContext,
  deps: GateDeps = {},
): Promise<GateOutcome> {
  const registry = deps.registry ?? methodRegistry;
  const inline = specs.filter((s) => s.when === "inline");
  const results: GateSpecResult[] = [];

  let anyFailedClosed = false;
  let anyBlocked = false;

  for (const spec of inline) {
    const blocking = isBlocking(spec);
    const method = getMethod(spec.method, registry);

    if (!method) {
      results.push({
        key: spec.key,
        method: spec.method,
        when: spec.when,
        mandatory: spec.mandatory === true,
        floor: spec.floor === true,
        ran: false,
        pass: false,
        missing: true,
        label: "missing_method",
        detail: `no method registered under "${spec.method}"`,
      });
      if (blocking) anyFailedClosed = true;
      continue;
    }

    const methodCtx: MethodContext = {
      answer: ctx.answer,
      retrieved: ctx.retrieved,
      input: ctx.input,
      params: paramsFor(spec),
      deps,
    };

    try {
      const r = await method(methodCtx);
      results.push({
        key: spec.key,
        method: spec.method,
        when: spec.when,
        mandatory: spec.mandatory === true,
        floor: spec.floor === true,
        ran: true,
        pass: r.pass,
        missing: false,
        label: r.label,
        detail: r.detail,
      });
      if (!r.pass && blocking) anyBlocked = true;
    } catch (err) {
      // A blocking method that throws fails closed; a non-blocking one is only
      // recorded so one flaky optional check never voids a shippable answer.
      results.push({
        key: spec.key,
        method: spec.method,
        when: spec.when,
        mandatory: spec.mandatory === true,
        floor: spec.floor === true,
        ran: false,
        pass: false,
        missing: false,
        label: "method_error",
        detail: err instanceof Error ? err.message.slice(0, 120) : String(err).slice(0, 120),
      });
      if (blocking) anyFailedClosed = true;
    }
  }

  const decision: GateDecision = anyFailedClosed
    ? "failed_closed"
    : anyBlocked
      ? "blocked"
      : "passed";

  return { decision, results };
}

/** One batch case: the answer to grade plus any retrieved context and raw input.
 *  This is the input type of the dataset runBatch consumes. */
export interface BatchInput {
  answer: string;
  retrieved?: string[];
  input?: unknown;
}

/** The metrics rollup for one batch spec. */
export interface BatchSpecMetrics {
  key: string;
  method: string;
  run: EvalRun;
  metrics: Metrics;
}

/** The full batch outcome: one metric bundle per batch spec. */
export interface BatchOutcome {
  evals: BatchSpecMetrics[];
}

/**
 * Run the OFFLINE harness over the batch specs. Each batch spec becomes one
 * runEval pass over the shared dataset, grading every case with that spec's
 * method, and its verdicts roll up into precision/recall/F1/accuracy. The same
 * specs and methods that gate a live answer measure quality here.
 */
export async function runBatch(
  specs: EvalBinding[],
  dataset: EvalDataset<BatchInput, unknown>,
  deps: GateDeps = {},
): Promise<BatchOutcome> {
  const registry = deps.registry ?? methodRegistry;
  const batch = specs.filter((s) => s.when === "batch");
  const evals: BatchSpecMetrics[] = [];

  for (const spec of batch) {
    const method = getMethod(spec.method, registry);
    const params = paramsFor(spec);

    const check: Check<BatchInput, unknown, BatchInput> = async (output) => {
      if (!method) {
        return { pass: false, label: "negative", rationale: `missing method "${spec.method}"` };
      }
      const r = await method({
        answer: output.answer,
        retrieved: output.retrieved,
        input: output.input,
        params,
        deps,
      });
      return {
        pass: r.pass,
        label: r.pass ? "positive" : "negative",
        rationale: r.detail,
      };
    };

    const run = await runEval<BatchInput, unknown, BatchInput>({
      dataset: { name: `${dataset.name}:${spec.key}`, cases: dataset.cases },
      generate: (input) => input,
      check,
    });

    evals.push({ key: spec.key, method: spec.method, run, metrics: computeMetrics(run.results) });
  }

  return { evals };
}

/** Re-exported so callers can build datasets without a second import. */
export type { EvalCase, EvalDataset };
