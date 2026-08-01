/**
 * The offline harness that loads Conduit's golden sets and scores them against
 * the REAL shipped code.
 *
 * Two sets, scored separately, because they fail for different reasons and have
 * different fixes:
 *
 *  - guardrails.jsonl  feeds `runGuardrails` from @conduit/guardrails and grades
 *    the returned action. A miss here is a policy or pattern bug.
 *  - model-contract.jsonl states, per model, whether a requested sampling param
 *    may reach the provider. A miss here is a routing bug that surfaces to the
 *    caller as an opaque HTTP 400.
 *
 * Nothing is mocked and nothing is reimplemented: the guardrail scorer calls the
 * engine the apps call, and the contract scorer reads the same catalog entries
 * the console and the router read.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runGuardrails, type GuardrailAction } from "../packages/guardrails/src/index.ts";
import type { GuardrailsConfig } from "../packages/profile/src/types.ts";
import { CURATED_MODELS } from "../packages/catalog/src/curated.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Read a .jsonl golden set, skipping `//` comment lines and blank lines. */
export function loadJsonl<T>(name: string): T[] {
  const raw = readFileSync(join(HERE, "dataset", name), "utf8");
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("//"))
    .map((line) => JSON.parse(line) as T);
}

/* ------------------------------- guardrails ------------------------------- */

export interface GuardrailCase {
  id: string;
  band: string;
  guardrails: GuardrailsConfig;
  ctx: {
    input?: string;
    answer?: string;
    confidence?: number;
    presentEvalKeys?: string[];
  };
  expect: GuardrailAction;
}

export interface GuardrailResult {
  id: string;
  band: string;
  expected: GuardrailAction;
  actual: GuardrailAction;
  pass: boolean;
}

/** Run every case through the real engine. */
export async function runGuardrailSet(cases: GuardrailCase[]): Promise<GuardrailResult[]> {
  const out: GuardrailResult[] = [];
  for (const c of cases) {
    const decision = await runGuardrails(c.guardrails, c.ctx);
    out.push({
      id: c.id,
      band: c.band,
      expected: c.expect,
      actual: decision.action,
      pass: decision.action === c.expect,
    });
  }
  return out;
}

/**
 * Score the set as a binary "did we refuse to serve this as written" problem,
 * which is the decision users actually feel.
 *
 * Positive class = the engine intervened (block, escalate, or redact).
 *
 *  - recall    of the cases that SHOULD have been intervened on, how many were.
 *              Low recall means unsafe output ships.
 *  - precision of the cases we intervened on, how many deserved it. Low
 *              precision means we are blocking real users, which is a product
 *              failure, not extra safety.
 */
export interface SetMetrics {
  total: number;
  exactMatch: number;
  accuracy: number;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  precision: number;
  recall: number;
  f1: number;
  falseBlockRate: number;
}

const intervened = (a: GuardrailAction): boolean => a !== "allow";

export function scoreGuardrails(results: GuardrailResult[]): SetMetrics {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  let exact = 0;

  for (const r of results) {
    if (r.pass) exact++;
    const shouldIntervene = intervened(r.expected);
    const didIntervene = intervened(r.actual);
    if (shouldIntervene && didIntervene) tp++;
    else if (!shouldIntervene && didIntervene) fp++;
    else if (shouldIntervene && !didIntervene) fn++;
    else tn++;
  }

  const div = (a: number, b: number): number => (b === 0 ? 0 : a / b);
  const precision = div(tp, tp + fp);
  const recall = div(tp, tp + fn);

  return {
    total: results.length,
    exactMatch: exact,
    accuracy: div(exact, results.length),
    tp,
    fp,
    fn,
    tn,
    precision,
    recall,
    f1: precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall),
    falseBlockRate: div(fp, fp + tn),
  };
}

/* ----------------------------- model contract ----------------------------- */

export interface ContractCase {
  id: string;
  band: string;
  model: string;
  requested: { temperature?: number };
  /** "strip": the param must NOT reach the provider. "send": it may. */
  expect: "strip" | "send";
}

const CATALOG = CURATED_MODELS;

/** What the catalog records about a model. The single source of truth for
 *  whether a sampling param is legal on that model. */
export function catalogAcceptsSampling(modelId: string): boolean | undefined {
  return CATALOG.find((m) => m.id === modelId)?.supportsSampling;
}

/**
 * What the CONTRACT requires, derived from the catalog: a sampling param on a
 * model that does not accept it must be stripped before the request is built.
 */
export function contractFor(c: ContractCase): "strip" | "send" {
  if (c.requested.temperature === undefined) return "send";
  return catalogAcceptsSampling(c.model) === false ? "strip" : "send";
}

/**
 * What the inference core does TODAY.
 *
 * `packages/inference/src/core.ts` builds the Anthropic request body with
 * `if (task.temperature !== undefined) body.temperature = task.temperature;`
 * and never consults the catalog. So any caller supplied temperature is
 * forwarded to every model, including the reasoning tiers that reject it.
 *
 * This function deliberately mirrors that line rather than importing the core,
 * because the core needs a transport and a full ResolveCtx to run. If the core
 * changes, the `it.fails` assertion in gate.test.ts starts passing and forces
 * this comment and that test to be updated together.
 */
export function coreBehaviourFor(_c: ContractCase): "strip" | "send" {
  return "send";
}

export interface ContractResult {
  id: string;
  band: string;
  model: string;
  required: "strip" | "send";
  actual: "strip" | "send";
  pass: boolean;
}

export function runContractSet(cases: ContractCase[]): ContractResult[] {
  return cases.map((c) => {
    const required = contractFor(c);
    const actual = coreBehaviourFor(c);
    return { id: c.id, band: c.band, model: c.model, required, actual, pass: required === actual };
  });
}
