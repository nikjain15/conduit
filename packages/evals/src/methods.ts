/**
 * The pluggable check-method registry.
 *
 * A check method is one declarative predicate over an answer. Each method has
 * the same narrow signature so a use case profile can name any of them by
 * string (profile.evals[i].method) and have both the INLINE gate (runGate) and
 * the OFFLINE harness (runBatch) run the exact same code. The built-ins here are
 * registered into @conduit/profile's shared methodRegistry so the profile layer
 * resolves a method name to a concrete implementation at run time.
 *
 * Every method is pure with respect to its context: it reads the answer, the
 * retrieved chunks, the raw input, and its declared params, and returns a
 * pass/label/detail verdict. The one method that needs a model, llm_judge, takes
 * the model call as an injected dependency (ctx.deps.judgeModelCall) and never
 * touches the network itself, so tests mock a single function.
 */
import { methodRegistry, type Registry } from "../../profile/src/registry.ts";
import { checkGroundedness } from "../../rag/src/failure-modes.ts";
import type { RetrievalResult } from "../../rag/src/types.ts";
import { llmJudgeCheck, type JudgeModelCall } from "./judgeCheck.ts";

/** Dependencies a method may need that are injected at run time, never declared
 *  in the profile. Only llm_judge uses one today. */
export interface MethodDeps {
  /** Injected, mockable model call for the llm_judge method. */
  judgeModelCall?: JudgeModelCall;
}

/** Everything a check method reads. `answer` is always present; the rest are
 *  optional so a method only reads what it needs. */
export interface MethodContext {
  /** The produced answer text to grade. */
  answer: string;
  /** Retrieved context chunks, when the use case grounds answers. */
  retrieved?: string[];
  /** The raw request input, for methods that grade against it. */
  input?: unknown;
  /** The spec's declared params from the profile (params, threshold folded in). */
  params?: Record<string, unknown>;
  /** Injected run-time dependencies (model call for llm_judge). */
  deps?: MethodDeps;
}

/** A method's verdict for one answer. */
export interface MethodResult {
  pass: boolean;
  label?: string;
  detail?: string;
}

/** The uniform signature every check method implements. May be sync or async. */
export type CheckMethod = (ctx: MethodContext) => MethodResult | Promise<MethodResult>;

/* ── Small param readers ───────────────────────────────────────────────────── */

function str(params: Record<string, unknown> | undefined, key: string): string | undefined {
  const v = params?.[key];
  return typeof v === "string" ? v : undefined;
}

function num(params: Record<string, unknown> | undefined, key: string): number | undefined {
  const v = params?.[key];
  return typeof v === "number" ? v : undefined;
}

function bool(params: Record<string, unknown> | undefined, key: string): boolean {
  return params?.[key] === true;
}

/** Every number-like figure in a string, normalized (commas and currency
 *  stripped) so "1,234.50" and "$1234.5" compare equal. */
function figures(text: string): number[] {
  const out: number[] = [];
  const matches = text.match(/-?\$?\d[\d,]*(?:\.\d+)?/g) ?? [];
  for (const m of matches) {
    const n = Number(m.replace(/[$,]/g, ""));
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

/* ── Built-in methods ──────────────────────────────────────────────────────── */

/** Answer matches a regular expression in params.pattern (optional params.flags). */
const regex: CheckMethod = (ctx) => {
  const pattern = str(ctx.params, "pattern");
  if (pattern === undefined) {
    return { pass: false, label: "misconfigured", detail: "regex needs params.pattern" };
  }
  const flags = str(ctx.params, "flags") ?? "";
  const re = new RegExp(pattern, flags);
  const pass = re.test(ctx.answer);
  return { pass, label: pass ? "match" : "no_match", detail: `/${pattern}/${flags}` };
};

/** Answer contains params.pattern as a substring. Case-insensitive unless
 *  params.caseSensitive is true. */
const contains: CheckMethod = (ctx) => {
  const needle = str(ctx.params, "pattern") ?? str(ctx.params, "value");
  if (needle === undefined) {
    return { pass: false, label: "misconfigured", detail: "contains needs params.pattern" };
  }
  const caseSensitive = bool(ctx.params, "caseSensitive");
  const hay = caseSensitive ? ctx.answer : ctx.answer.toLowerCase();
  const sub = caseSensitive ? needle : needle.toLowerCase();
  const pass = hay.includes(sub);
  return { pass, label: pass ? "contains" : "missing", detail: needle };
};

/** Answer parses as JSON and validates against params.schema (a JSON Schema
 *  subset: type, required, properties, items, enum). */
const json_schema: CheckMethod = (ctx) => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(ctx.answer);
  } catch {
    return { pass: false, label: "invalid_json", detail: "answer is not valid JSON" };
  }
  const schema = ctx.params?.schema;
  if (schema === undefined) {
    return { pass: false, label: "misconfigured", detail: "json_schema needs params.schema" };
  }
  const errors = validateJsonSchema(parsed, schema, "$");
  return errors.length === 0
    ? { pass: true, label: "valid" }
    : { pass: false, label: "schema_violation", detail: errors.slice(0, 3).join("; ") };
};

/** Every expected figure appears among the answer's figures. params.expected is
 *  a number or an array of numbers. */
const numeric_match: CheckMethod = (ctx) => {
  const raw = ctx.params?.expected;
  const expected = Array.isArray(raw)
    ? raw.filter((n): n is number => typeof n === "number")
    : typeof raw === "number"
      ? [raw]
      : [];
  if (expected.length === 0) {
    return { pass: false, label: "misconfigured", detail: "numeric_match needs params.expected" };
  }
  const found = new Set(figures(ctx.answer));
  const missing = expected.filter((n) => !found.has(n));
  return missing.length === 0
    ? { pass: true, label: "figures_match" }
    : { pass: false, label: "figures_off", detail: `missing figures: ${missing.join(", ")}` };
};

/** Flag likely PII: email addresses, phone numbers, and card-like digit runs.
 *  A clean answer passes. This is a heuristic, not a compliance guarantee. */
const pii_scan: CheckMethod = (ctx) => {
  const hits: string[] = [];
  if (/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/.test(ctx.answer)) hits.push("email");
  if (/(?:\+?\d[\s-]?){10,}\d/.test(ctx.answer.replace(/[()]/g, ""))) hits.push("phone");
  if (/\b(?:\d[ -]?){13,16}\b/.test(ctx.answer)) hits.push("card");
  const pass = hits.length === 0;
  return {
    pass,
    label: pass ? "clean" : "pii_detected",
    detail: pass ? "heuristic scan found no PII" : `heuristic flagged: ${hits.join(", ")}`,
  };
};

/** Answer equals params.expected exactly. params.trim (default true) trims both. */
const exact_match: CheckMethod = (ctx) => {
  const expected = str(ctx.params, "expected");
  if (expected === undefined) {
    return { pass: false, label: "misconfigured", detail: "exact_match needs params.expected" };
  }
  const trim = ctx.params?.trim !== false;
  const a = trim ? ctx.answer.trim() : ctx.answer;
  const b = trim ? expected.trim() : expected;
  const pass = a === b;
  return { pass, label: pass ? "exact" : "differs" };
};

/** Every content-bearing sentence of the answer is supported by the retrieved
 *  chunks, via @conduit/rag's lexical-overlap heuristic. params.minOverlap tunes
 *  the threshold. Fails closed when there is nothing retrieved to ground against. */
const groundedness: CheckMethod = (ctx) => {
  const chunks: RetrievalResult[] = (ctx.retrieved ?? []).map((text, i) => ({
    id: `chunk-${i}`,
    score: 1,
    text,
  }));
  if (chunks.length === 0) {
    return { pass: false, label: "no_context", detail: "no retrieved chunks to ground against" };
  }
  const minOverlap = num(ctx.params, "minOverlap");
  const report = checkGroundedness(
    ctx.answer,
    chunks,
    minOverlap === undefined ? {} : { minOverlap },
  );
  return report.grounded
    ? { pass: true, label: "grounded", detail: report.method }
    : {
        pass: false,
        label: "unsupported",
        detail: `unsupported (${report.method}): ${report.unsupported.slice(0, 2).join(" | ")}`,
      };
};

/** LLM-as-judge: wraps @conduit/evals llmJudgeCheck, which itself drives the
 *  @conduit/inference judge panel. The model call is injected via
 *  ctx.deps.judgeModelCall; params.criteria is the grading rubric. */
const llm_judge: CheckMethod = async (ctx) => {
  const modelCall = ctx.deps?.judgeModelCall;
  if (!modelCall) {
    return { pass: false, label: "misconfigured", detail: "llm_judge needs deps.judgeModelCall" };
  }
  const criteria = str(ctx.params, "criteria") ?? "The answer is correct and helpful.";
  const check = llmJudgeCheck<string, unknown, string>({ modelCall, criteria });
  const outcome = await check(ctx.answer, {
    id: "inline",
    input: typeof ctx.input === "string" ? ctx.input : "",
  });
  return { pass: outcome.pass, label: outcome.label, detail: outcome.rationale };
};

/** The built-in methods, keyed by the name a profile uses. */
export const builtInMethods: Record<string, CheckMethod> = {
  regex,
  contains,
  json_schema,
  numeric_match,
  pii_scan,
  exact_match,
  groundedness,
  llm_judge,
};

/** The names of every built-in method, in a stable order. */
export const builtInMethodNames: string[] = Object.keys(builtInMethods);

/**
 * Register the built-in methods into a registry. Defaults to @conduit/profile's
 * shared methodRegistry so the profile layer can resolve a method name to code.
 * Idempotent: re-registering a name overwrites it.
 */
export function registerBuiltInMethods(
  registry: Registry<unknown> = methodRegistry,
): Registry<unknown> {
  for (const [name, method] of Object.entries(builtInMethods)) {
    registry.register(name, method);
  }
  return registry;
}

/** Read a check method by name from a registry (defaults to methodRegistry). */
export function getMethod(
  name: string,
  registry: Registry<unknown> = methodRegistry,
): CheckMethod | undefined {
  return registry.get(name) as CheckMethod | undefined;
}

/* ── Minimal JSON Schema validator (subset) ────────────────────────────────── */

/**
 * Validate a parsed value against a small JSON Schema subset and return a list
 * of dotted-path error messages (empty when valid). Supports type, required,
 * properties, items, and enum. Intentionally small: it covers the shapes a
 * structured-output gate declares without pulling a dependency.
 */
function validateJsonSchema(value: unknown, schema: unknown, path: string): string[] {
  if (schema === null || typeof schema !== "object") return [];
  const s = schema as Record<string, unknown>;
  const errors: string[] = [];

  if (typeof s.type === "string" && !typeMatches(value, s.type)) {
    errors.push(`${path}: expected ${s.type}`);
    return errors;
  }

  if (Array.isArray(s.enum) && !s.enum.some((e) => e === value)) {
    errors.push(`${path}: not one of enum`);
  }

  if (s.type === "object" && value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (Array.isArray(s.required)) {
      for (const key of s.required) {
        if (typeof key === "string" && !(key in obj)) errors.push(`${path}.${key}: required`);
      }
    }
    if (s.properties && typeof s.properties === "object") {
      const props = s.properties as Record<string, unknown>;
      for (const [key, sub] of Object.entries(props)) {
        if (key in obj) errors.push(...validateJsonSchema(obj[key], sub, `${path}.${key}`));
      }
    }
  }

  if (s.type === "array" && Array.isArray(value) && s.items) {
    value.forEach((item, i) => {
      errors.push(...validateJsonSchema(item, s.items, `${path}[${i}]`));
    });
  }

  return errors;
}

function typeMatches(value: unknown, type: string): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "object":
      return value !== null && typeof value === "object" && !Array.isArray(value);
    case "array":
      return Array.isArray(value);
    case "null":
      return value === null;
    default:
      return true;
  }
}
