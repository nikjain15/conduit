#!/usr/bin/env node
/**
 * Secret scan over tracked files.
 *
 * Deliberately high signal and low coverage: it looks for credential FORMATS
 * that are unambiguous (provider key prefixes, PEM private key blocks, a long
 * opaque string assigned to a secret-shaped name), not for the word "key".
 *
 * That choice is the same one the injection screen got wrong at first. A scanner
 * that flags every mention of "password" gets muted within a week, and a muted
 * scanner is worth less than none because it also removes the excuse to look.
 * The cost is real and is stated rather than hidden: a credential in a format
 * this does not know will pass. This finds the committed key, not every secret.
 *
 * It scans files git knows about, so build output and node_modules are out of
 * scope by construction.
 *
 * Usage: node scripts/secret-scan.mjs [path ...]
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const RULES = [
  { name: "anthropic_api_key", test: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: "openai_api_key", test: /\bsk-(?:proj-)?[A-Za-z0-9]{32,}/ },
  { name: "aws_access_key_id", test: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: "github_token", test: /\bgh[pousr]_[A-Za-z0-9]{36,}/ },
  { name: "slack_token", test: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: "google_api_key", test: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: "stripe_secret_key", test: /\b[sr]k_live_[A-Za-z0-9]{20,}/ },
  { name: "private_key_block", test: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: "supabase_service_key", test: /\bey[A-Za-z0-9_-]{10,}\.ey[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/ },
  {
    // A long opaque literal assigned to a secret-shaped name. Requires the
    // literal to be both long and mixed, so `apiKey: t.apiKey` and
    // `apiKey: "k"` in a test both stay quiet.
    name: "hardcoded_secret_literal",
    test: /(?:api[_-]?key|secret|password|passwd|token|credential)\s*[:=]\s*["'`][A-Za-z0-9+/_-]{24,}["'`]/i,
  },
];

/** A line that says "this is not a secret" and is checked by a human reviewer. */
const IGNORE_MARKER = /secret-scan:allow/;

const args = process.argv.slice(2);
const files = args.length
  ? args
  : execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" })
      .split("\0")
      .filter(Boolean);

const findings = [];
for (const rel of files) {
  const path = join(ROOT, rel);
  let stat;
  try {
    stat = statSync(path);
  } catch {
    continue;
  }
  if (!stat.isFile() || stat.size > 2_000_000) continue;
  // package-lock.json is machine written and full of long base64 integrity
  // hashes; scanning it produces only noise.
  if (rel.endsWith("package-lock.json")) continue;
  // This file contains the patterns themselves.
  if (rel === "scripts/secret-scan.mjs") continue;

  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    continue;
  }
  if (text.includes("\0")) continue; // binary

  text.split("\n").forEach((line, i) => {
    if (IGNORE_MARKER.test(line)) return;
    for (const rule of RULES) {
      if (rule.test.test(line)) {
        findings.push({ file: rel, line: i + 1, rule: rule.name });
      }
    }
  });
}

for (const f of findings) console.error(`SECRET ${f.rule} at ${f.file}:${f.line}`);
console.log(`secret scan: ${files.length} tracked files, ${findings.length} findings`);
if (findings.length > 0) {
  console.error(
    "secret scan FAILED. Rotate anything real that was committed: removing the line " +
      "does not un-publish it, the git history still holds it.",
  );
  process.exit(1);
}
console.log("secret scan passed");
