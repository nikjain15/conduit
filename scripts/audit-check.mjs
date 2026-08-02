#!/usr/bin/env node
/**
 * Dependency audit gate.
 *
 * Runs `npm audit --json` and fails the build on any HIGH or CRITICAL advisory
 * that is not explicitly allowlisted. Moderate and low are reported and do not
 * fail, so the gate stays actionable rather than becoming noise everyone learns
 * to skip.
 *
 * The allowlist is the interesting part. An exception without an expiry is a
 * permanent exception, and a permanent exception is how a known vulnerability
 * turns into a forgotten one. So every entry carries a reason and a date, and
 * BOTH are enforced here:
 *
 *  - an entry missing `reason`, `id`, or `expires` fails the build,
 *  - an entry whose `expires` has arrived fails the build, whether or not the
 *    advisory it covers is still open,
 *  - an entry that no longer matches anything is reported as stale, so the list
 *    does not silently accumulate.
 *
 * Usage:
 *   node scripts/audit-check.mjs                 run npm audit
 *   node scripts/audit-check.mjs --input f.json  score a saved audit report
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ALLOWLIST =
  process.env.CONDUIT_AUDIT_ALLOWLIST ?? join(ROOT, ".github", "security", "audit-allowlist.json");
const FAIL_ON = new Set(["high", "critical"]);

function fail(message) {
  console.error(`audit gate FAILED: ${message}`);
  process.exitCode = 1;
}

/** Read the audit report, either from a file or by running npm audit. */
function readReport() {
  const flag = process.argv.indexOf("--input");
  if (flag !== -1) return JSON.parse(readFileSync(process.argv[flag + 1], "utf8"));
  // npm audit exits non-zero when it finds anything, which is not an error here:
  // this script decides what counts as a failure, not npm's exit code.
  let raw;
  try {
    raw = execFileSync("npm", ["audit", "--json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    raw = err.stdout;
    if (!raw) {
      fail(`npm audit could not run: ${err.message}`);
      process.exit(1);
    }
  }
  return JSON.parse(raw);
}

/**
 * The advisory identifiers inside one npm audit node.
 *
 * npm groups every advisory affecting a package into a single node, so matching
 * on the package name alone would mean a NEW advisory for an already allowlisted
 * package is silently allowed too. To prevent that, `advisories` is returned
 * separately from the package name and every advisory in a node must be covered
 * for the node to pass.
 */
function identifiers(name, vuln) {
  const advisories = new Set();
  const seen = new Set();
  const walk = (via) => {
    if (typeof via === "string" || via == null) return;
    if (via.url) {
      const m = /(GHSA-[\w-]+|CVE-[\d-]+)/i.exec(via.url);
      if (m) advisories.add(m[1]);
      else advisories.add(via.url);
    } else if (via.source != null && !seen.has(via.source)) {
      seen.add(via.source);
      advisories.add(String(via.source));
    }
  };
  for (const via of vuln.via ?? []) walk(via);
  return { name, advisories: [...advisories] };
}

const today = new Date().toISOString().slice(0, 10);
const allowlist = JSON.parse(readFileSync(ALLOWLIST, "utf8")).allow ?? [];

// 1. The allowlist itself must be well formed and in date. Checked BEFORE the
//    audit, so an expired exception fails the build even on a clean audit.
const active = [];
for (const [i, entry] of allowlist.entries()) {
  const where = `allowlist entry ${i} (${entry.id ?? "no id"})`;
  if (!entry.id) fail(`${where} has no id`);
  if (!entry.reason || entry.reason.trim().length < 10) {
    fail(`${where} has no usable reason; say which code path is or is not reached`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.expires ?? "")) {
    fail(`${where} has no expiry date in YYYY-MM-DD form`);
  } else if (entry.expires <= today) {
    fail(`${where} expired on ${entry.expires}. Fix the advisory or renew the entry with a fresh reason.`);
  } else {
    active.push(entry);
  }
}

// 2. Score the audit.
const report = readReport();
const vulns = report.vulnerabilities ?? {};
const used = new Set();
let blocking = 0;
let ignoredBySeverity = 0;

for (const [name, vuln] of Object.entries(vulns)) {
  const severity = String(vuln.severity ?? "").toLowerCase();
  if (!FAIL_ON.has(severity)) {
    ignoredBySeverity++;
    continue;
  }
  const { advisories } = identifiers(name, vuln);
  // Covered only when EVERY advisory in the node is allowlisted. A blanket entry
  // on the package name also covers it, which is why package-name entries should
  // be rare and short lived.
  const covering = advisories.map((a) => active.find((e) => e.id === a || e.id === name));
  const uncovered = advisories.filter((_, i) => !covering[i]);
  if (advisories.length > 0 && uncovered.length === 0) {
    for (const e of covering) used.add(e.id);
    const until = covering.map((e) => e.expires).sort()[0];
    console.log(`allowed  ${severity.padEnd(8)} ${name} (${advisories.join(", ")}) until ${until}`);
    continue;
  }
  blocking++;
  console.error(
    `BLOCKING ${severity.padEnd(8)} ${name}  uncovered: ${uncovered.join(", ") || "(no advisory id)"}`,
  );
}

for (const entry of active) {
  if (!used.has(entry.id)) console.log(`stale    allowlist entry ${entry.id} matched nothing; remove it`);
}

console.log(
  `audit: ${Object.keys(vulns).length} advisories, ${blocking} blocking, ` +
    `${ignoredBySeverity} below the high threshold, ${active.length} allowlisted`,
);
if (blocking > 0) fail(`${blocking} high or critical advisories are not allowlisted`);
if (process.exitCode !== 1) console.log("audit gate passed");
