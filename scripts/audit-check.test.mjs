/**
 * The audit gate's own tests.
 *
 * The expiry on an allowlist entry is the whole point of the allowlist, so it
 * gets a test. An expiry that is documented but not enforced is just a comment,
 * and a comment has never failed a build.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "audit-check.mjs");
const dir = mkdtempSync(join(tmpdir(), "conduit-audit-"));

/** One critical advisory, in the shape npm audit --json emits. */
const REPORT = {
  vulnerabilities: {
    leftpad: {
      severity: "critical",
      via: [{ source: 1, url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc" }],
    },
  },
};
const reportPath = join(dir, "report.json");
writeFileSync(reportPath, JSON.stringify(REPORT));

function run(allow) {
  const allowPath = join(dir, `allow-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(allowPath, JSON.stringify({ allow }));
  try {
    const stdout = execFileSync("node", [SCRIPT, "--input", reportPath], {
      encoding: "utf8",
      env: { ...process.env, CONDUIT_AUDIT_ALLOWLIST: allowPath },
    });
    return { code: 0, out: stdout };
  } catch (err) {
    return { code: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

const FUTURE = "2099-01-01";
const PAST = "2000-01-01";
const REASON = "dev tooling only, not reachable from any shipped package";

describe("audit gate", () => {
  it("fails on an unallowlisted critical advisory", () => {
    const r = run([]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("BLOCKING");
  });

  it("passes when the advisory is allowlisted and in date", () => {
    const r = run([{ id: "GHSA-aaaa-bbbb-cccc", reason: REASON, expires: FUTURE }]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("audit gate passed");
  });

  it("fails when the allowlist entry has expired, even though it matches", () => {
    const r = run([{ id: "GHSA-aaaa-bbbb-cccc", reason: REASON, expires: PAST }]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("expired on");
  });

  it("fails when an entry has no expiry at all", () => {
    const r = run([{ id: "GHSA-aaaa-bbbb-cccc", reason: REASON }]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("no expiry date");
  });

  it("fails when an entry has no usable reason", () => {
    const r = run([{ id: "GHSA-aaaa-bbbb-cccc", reason: "meh", expires: FUTURE }]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("no usable reason");
  });

  it("does not let an allowlisted package smuggle in a second advisory", () => {
    const two = {
      vulnerabilities: {
        leftpad: {
          severity: "critical",
          via: [
            { source: 1, url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc" },
            { source: 2, url: "https://github.com/advisories/GHSA-dddd-eeee-ffff" },
          ],
        },
      },
    };
    const twoPath = join(dir, "two.json");
    writeFileSync(twoPath, JSON.stringify(two));
    const allowPath = join(dir, "allow-one.json");
    writeFileSync(
      allowPath,
      JSON.stringify({ allow: [{ id: "GHSA-aaaa-bbbb-cccc", reason: REASON, expires: FUTURE }] }),
    );
    let code = 0;
    let out = "";
    try {
      out = execFileSync("node", [SCRIPT, "--input", twoPath], {
        encoding: "utf8",
        env: { ...process.env, CONDUIT_AUDIT_ALLOWLIST: allowPath },
      });
    } catch (err) {
      code = err.status ?? 1;
      out = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    }
    expect(code).toBe(1);
    expect(out).toContain("GHSA-dddd-eeee-ffff");
  });
});
