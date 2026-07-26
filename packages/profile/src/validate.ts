/**
 * Structural validation for a use case profile.
 *
 * validateProfile collects every problem it finds and returns them; it never
 * throws. It checks structure and enumerations, not policy: whether a model ref
 * exists or a method is registered is the executor's job. Deeper per section
 * rules land with the workstream that owns each section.
 */
import type { UseCaseProfile, ValidationIssue } from "./types.ts";

const EVAL_WHEN = new Set(["inline", "batch"]);
const AGENT_MODE = new Set(["single", "loop"]);

/** Run structural checks over a profile and return the collected issues. */
export function validateProfile(profile: UseCaseProfile): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!profile.id) issues.push({ path: "id", message: "id is required" });
  if (!profile.name) issues.push({ path: "name", message: "name is required" });
  if (!profile.tenant) {
    issues.push({ path: "tenant", message: "tenant is required" });
  }

  if (!profile.routing || !profile.routing.main) {
    issues.push({ path: "routing.main", message: "routing.main is required" });
  }
  if (profile.routing?.capUsd !== undefined && profile.routing.capUsd < 0) {
    issues.push({ path: "routing.capUsd", message: "capUsd must not be negative" });
  }

  if (profile.retrieval) {
    const r = profile.retrieval;
    if (!r.source) {
      issues.push({ path: "retrieval.source", message: "retrieval.source is required when retrieval is set" });
    }
    if (r.chunking && r.chunking.overlap >= r.chunking.size) {
      issues.push({ path: "retrieval.chunking", message: "chunking.overlap must be smaller than chunking.size" });
    }
    if (r.topK !== undefined && r.topK <= 0) {
      issues.push({ path: "retrieval.topK", message: "topK must be positive" });
    }
  }

  if (profile.agent && !AGENT_MODE.has(profile.agent.mode)) {
    issues.push({ path: "agent.mode", message: `agent.mode must be one of ${[...AGENT_MODE].join(", ")}` });
  }

  if (profile.evals) {
    profile.evals.forEach((e, i) => {
      if (!e.key) issues.push({ path: `evals[${i}].key`, message: "eval key is required" });
      if (!e.method) issues.push({ path: `evals[${i}].method`, message: "eval method is required" });
      if (!EVAL_WHEN.has(e.when)) {
        issues.push({ path: `evals[${i}].when`, message: `eval when must be one of ${[...EVAL_WHEN].join(", ")}` });
      }
    });
  }

  return issues;
}
