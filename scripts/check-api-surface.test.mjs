/**
 * Tests for the API surface gate.
 *
 * The gate's whole value is that it fails on a breaking change, so the tests
 * that matter are the ones that prove it FAILS. A gate that only ever passes is
 * indistinguishable from no gate, and that is the failure mode worth guarding:
 * a regex-based parser that silently matches nothing would report "unchanged"
 * forever while the surface drifted underneath it.
 *
 * Run as part of `npx vitest run`.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const script = resolve(repo, "scripts/check-api-surface.mjs");
const typesPath = resolve(repo, "services/gateway/src/types.ts");
const routerPath = resolve(repo, "services/gateway/src/router.ts");
const snapshotPath = resolve(repo, "docs/api-surface.json");

/** Run the gate in a throwaway copy of the repo's relevant files. */
function runIn(mutate) {
  const dir = mkdtempSync(join(tmpdir(), "api-surface-"));
  try {
    cpSync(resolve(repo, "scripts"), join(dir, "scripts"), { recursive: true });
    cpSync(resolve(repo, "services"), join(dir, "services"), { recursive: true });
    cpSync(resolve(repo, "docs/api-surface.json"), join(dir, "docs/api-surface.json"), {
      recursive: true,
    });
    mutate?.(dir);
    try {
      const out = execFileSync(process.execPath, [join(dir, "scripts/check-api-surface.mjs")], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { code: 0, out };
    } catch (err) {
      return { code: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const editTypes = (dir, from, to) => {
  const p = join(dir, "services/gateway/src/types.ts");
  const s = readFileSync(p, "utf8");
  if (!s.includes(from)) throw new Error(`fixture text not found: ${from}`);
  writeFileSync(p, s.replace(from, to));
};

describe("api surface gate", () => {
  it("passes on the committed surface", () => {
    const r = runIn();
    expect(r.code).toBe(0);
    expect(r.out).toContain("unchanged");
  });

  it("the snapshot is not empty, so a passing run means something", () => {
    // The silent-failure guard. A parser that matched nothing would also report
    // "unchanged", forever.
    const snap = JSON.parse(readFileSync(snapshotPath, "utf8"));
    expect(snap.routes.length).toBeGreaterThan(0);
    expect(Object.keys(snap.responses).length).toBeGreaterThan(0);
    expect(snap.routes).toContain("POST /v1/agent");
  });

  it("the snapshot matches the routes actually registered in the router", () => {
    // Ties the snapshot to the source rather than to itself.
    const router = readFileSync(routerPath, "utf8");
    const snap = JSON.parse(readFileSync(snapshotPath, "utf8"));
    for (const entry of snap.routes) {
      const path = entry.split(" ")[1];
      expect(router, `${path} is in the snapshot but not the router`).toContain(`"${path}"`);
    }
  });

  it("FAILS when a response field is removed", () => {
    const r = runIn((dir) => editTypes(dir, "  grounded: boolean;", ""));
    expect(r.code).toBe(1);
    expect(r.out).toContain("BREAKING");
    expect(r.out).toContain("grounded");
  });

  it("FAILS when a field is renamed, reporting it as a removal and an addition", () => {
    const r = runIn((dir) => editTypes(dir, "  answer: string;", "  reply: string;"));
    expect(r.code).toBe(1);
    expect(r.out).toContain("field removed: AgentResult.answer");
    expect(r.out).toContain("required field added: AgentResult.reply");
  });

  it("FAILS when an optional field is made required, and names the narrowing", () => {
    // The subtle one. Optional to required is a narrowing, and it would
    // otherwise look identical to leaving the field alone.
    const r = runIn((dir) => editTypes(dir, "  notice?: string;", "  notice: string;"));
    expect(r.code).toBe(1);
    expect(r.out).toContain("became required");
    expect(r.out).toContain("notice");
  });

  it("FAILS when a required field is added", () => {
    const r = runIn((dir) =>
      editTypes(dir, "export interface EvalResult {", "export interface EvalResult {\n  tenantId: string;"),
    );
    expect(r.code).toBe(1);
    expect(r.out).toContain("required field added");
  });

  it("FAILS on a new optional field too, so the snapshot cannot drift silently", () => {
    // Additive and allowed by the policy, but it still has to be recorded, or
    // the snapshot stops describing the surface.
    const r = runIn((dir) =>
      editTypes(dir, "export interface EvalResult {", "export interface EvalResult {\n  traceId?: string;"),
    );
    expect(r.code).toBe(1);
    expect(r.out).toContain("additive");
    expect(r.out).toContain("update the snapshot");
    // Reported, but NOT as breaking: the distinction the policy turns on.
    expect(r.out).toContain("0 breaking");
  });

  it("FAILS when a route is removed", () => {
    const r = runIn((dir) => {
      const p = join(dir, "services/gateway/src/router.ts");
      const s = readFileSync(p, "utf8");
      writeFileSync(p, s.replace('  "/v1/suqs": { GET: handleSuqs },\n', ""));
    });
    expect(r.code).toBe(1);
    expect(r.out).toContain("route removed");
    expect(r.out).toContain("/v1/suqs");
  });
});
