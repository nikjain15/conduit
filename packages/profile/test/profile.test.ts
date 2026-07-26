import { describe, expect, it } from "vitest";
import {
  InMemoryProfileStore,
  Registry,
  resolveProfile,
  validateProfile,
} from "../src/index.ts";
import type { PartialProfile, UseCaseProfile } from "../src/index.ts";

/* ── Registry ─────────────────────────────────────────────────────────────── */

describe("Registry", () => {
  it("registers, reads, reports membership, and lists in insertion order", () => {
    const reg = new Registry<number>("test");
    expect(reg.has("a")).toBe(false);
    expect(reg.get("a")).toBeUndefined();

    reg.register("a", 1).register("b", 2);
    expect(reg.has("a")).toBe(true);
    expect(reg.get("a")).toBe(1);
    expect(reg.get("b")).toBe(2);
    expect(reg.list()).toEqual(["a", "b"]);
  });

  it("overwrites a name on re registration", () => {
    const reg = new Registry<string>("test");
    reg.register("x", "first");
    reg.register("x", "second");
    expect(reg.get("x")).toBe("second");
    expect(reg.list()).toEqual(["x"]);
  });
});

/* ── resolveProfile ───────────────────────────────────────────────────────── */

describe("resolveProfile", () => {
  it("applies defaults when the store has no record", async () => {
    const store = new InMemoryProfileStore();
    const p = await resolveProfile(store, "org:acme", "kb-search");
    expect(p.id).toBe("kb-search");
    expect(p.tenant).toBe("org:acme");
    expect(p.routing.main).toBe("anthropic/claude-haiku-4-5");
    expect(p.routing.cache).toBe(false);
    expect(p.retrieval).toBeNull();
    expect(p.agent).toEqual({ mode: "single", tools: [], skills: [] });
    expect(p.evals).toEqual([]);
    expect(p.slo).toEqual({});
  });

  it("reads a stored partial profile and fills the rest with defaults", async () => {
    const partial: PartialProfile = {
      id: "kb-search",
      name: "Knowledge search",
      tenant: "org:acme",
      routing: { main: "openrouter/meta-llama/llama-3.3-70b-instruct", capUsd: 2500 },
    };
    const store = new InMemoryProfileStore([partial]);
    const p = await resolveProfile(store, "org:acme", "kb-search");
    expect(p.name).toBe("Knowledge search");
    expect(p.routing.main).toBe("openrouter/meta-llama/llama-3.3-70b-instruct");
    expect(p.routing.capUsd).toBe(2500);
    // Unset sub sections still resolve to defaults.
    expect(p.agent?.mode).toBe("single");
    expect(p.prompt?.systemRef).toBe("");
  });

  it("round trips a put profile", async () => {
    const store = new InMemoryProfileStore();
    const full: UseCaseProfile = {
      id: "sales-draft",
      name: "Sales drafting",
      tenant: "org:acme",
      routing: { main: "openrouter/mistralai/mistral-large" },
      retrieval: null,
      agent: { mode: "single", tools: [], skills: [] },
      prompt: { systemRef: "sales.system" },
      guardrails: {},
      evals: [],
      slo: {},
    };
    await store.put(full);
    const p = await resolveProfile(store, "org:acme", "sales-draft");
    expect(p.prompt?.systemRef).toBe("sales.system");
    const listed = await store.list("org:acme");
    expect(listed.length).toBe(1);
  });
});

/* ── validateProfile ──────────────────────────────────────────────────────── */

describe("validateProfile", () => {
  function base(): UseCaseProfile {
    return {
      id: "kb-search",
      name: "Knowledge search",
      tenant: "org:acme",
      routing: { main: "anthropic/claude-sonnet-5" },
      retrieval: null,
      agent: { mode: "single", tools: [], skills: [] },
      prompt: { systemRef: "" },
      guardrails: {},
      evals: [],
      slo: {},
    };
  }

  it("passes a good profile with no issues", () => {
    const issues = validateProfile(base());
    expect(issues).toEqual([]);
  });

  it("catches a missing routing.main", () => {
    const p = base();
    p.routing = { main: "" };
    const issues = validateProfile(p);
    expect(issues.some((i) => i.path === "routing.main")).toBe(true);
  });

  it("catches a bad eval.when", () => {
    const p = base();
    p.evals = [
      { key: "grounding", method: "citation-match", when: "sometimes" as unknown as "inline" },
    ];
    const issues = validateProfile(p);
    expect(issues.some((i) => i.path === "evals[0].when")).toBe(true);
  });

  it("does not throw and collects multiple issues at once", () => {
    const p = base();
    p.routing = { main: "" };
    p.evals = [{ key: "", method: "", when: "batch" }];
    const issues = validateProfile(p);
    expect(issues.length).toBeGreaterThanOrEqual(3);
  });
});
