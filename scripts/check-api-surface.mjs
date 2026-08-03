#!/usr/bin/env node
/**
 * API surface gate. Enforces docs/VERSIONING.md.
 *
 * A versioning policy nobody checks is prose. This holds a committed snapshot
 * of the `/v1` HTTP surface and fails the build when the code drifts from it.
 *
 * WHAT IT CATCHES, and why that is the useful half. Adding a route or an
 * optional response field is allowed under the policy and shows up here as a
 * one-line snapshot update, visible in review. REMOVING or RENAMING one is
 * breaking, and it is the change that is easy to make by accident: a field
 * dropped in a refactor compiles cleanly, passes every unit test that does not
 * assert on it, and only fails at a consumer who has already shipped. There is
 * no taking that back once `/v1` is public. So a removal fails loudly here.
 *
 * WHAT IT CANNOT CATCH, stated rather than implied. The "same name, same type,
 * new meaning" break in VERSIONING.md §1 is invisible to any mechanical check,
 * including this one. A field called `cost` that silently switches from cents
 * to dollars passes every assertion below. That break is caught by changelog
 * discipline and review, and pretending otherwise would make this gate more
 * dangerous than no gate, because it would be trusted for something it does
 * not do.
 *
 * The snapshot is deliberately dumb: sorted lists compared as sets. It parses
 * the route table and the response interfaces out of the source with regexes
 * rather than a TypeScript AST, because the alternative is a compiler
 * dependency in a gate that has to stay trivially auditable.
 *
 * Usage:
 *   node scripts/check-api-surface.mjs          verify against the snapshot
 *   node scripts/check-api-surface.mjs --write  update the snapshot
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const SNAPSHOT = resolve(repo, "docs/api-surface.json");

/** Pull the `/v1` route table out of the router. */
function readRoutes() {
  const src = readFileSync(resolve(repo, "services/gateway/src/router.ts"), "utf8");
  const table = src.match(/const V1_ROUTES[^{]*\{([\s\S]*?)\n\};/);
  if (!table) throw new Error("could not find V1_ROUTES in services/gateway/src/router.ts");

  const routes = [];
  for (const line of table[1].split("\n")) {
    // "/v1/agent": { POST: handleAgent },
    const m = line.match(/"([^"]+)":\s*\{([^}]*)\}/);
    if (!m) continue;
    const path = m[1];
    const methods = [...m[2].matchAll(/\b(GET|POST|PUT|PATCH|DELETE)\b/g)].map((x) => x[1]);
    for (const method of methods) routes.push(`${method} ${path}`);
  }
  if (routes.length === 0) throw new Error("parsed zero routes; the router shape must have changed");
  return routes.sort();
}

/**
 * Field names of the response interfaces the gateway returns.
 *
 * Optionality is recorded (`name?`) because it is load-bearing in the policy:
 * turning an optional field required is a NARROWING and therefore breaking,
 * and it would otherwise look identical to leaving it alone.
 */
function readResponseShapes() {
  const src = readFileSync(resolve(repo, "services/gateway/src/types.ts"), "utf8");
  const wanted = [
    "InferResult",
    "RetrieveResult",
    "AgentResult",
    "EvalResult",
    "UsageResult",
    "SuqsResult",
    "ModelsResult",
  ];

  const shapes = {};
  for (const name of wanted) {
    const m = src.match(new RegExp(`export interface ${name}\\s*\\{([\\s\\S]*?)\\n\\}`));
    if (!m) continue; // not every name has to exist; absence is caught by the snapshot diff
    const fields = [];
    for (const raw of m[1].split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("//") || line.startsWith("*") || line.startsWith("/*")) continue;
      const f = line.match(/^([A-Za-z_][A-Za-z0-9_]*)(\??):/);
      if (f) fields.push(`${f[1]}${f[2]}`);
    }
    shapes[name] = fields.sort();
  }
  return shapes;
}

function currentSurface() {
  return { routes: readRoutes(), responses: readResponseShapes() };
}

/** Set difference, reported both ways so a rename reads as one of each. */
function diff(before, after) {
  const b = new Set(before);
  const a = new Set(after);
  return {
    removed: [...b].filter((x) => !a.has(x)).sort(),
    added: [...a].filter((x) => !b.has(x)).sort(),
  };
}

function main() {
  const write = process.argv.includes("--write");
  const surface = currentSurface();

  if (write) {
    writeFileSync(SNAPSHOT, `${JSON.stringify(surface, null, 2)}\n`);
    console.info(`api surface: snapshot written (${surface.routes.length} routes).`);
    return;
  }

  let snapshot;
  try {
    snapshot = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
  } catch {
    console.error(`api surface: no snapshot at ${SNAPSHOT}. Run with --write to create it.`);
    process.exit(1);
  }

  const problems = [];

  const routes = diff(snapshot.routes ?? [], surface.routes);
  for (const r of routes.removed) problems.push(`BREAKING: route removed: ${r}`);
  for (const r of routes.added) problems.push(`additive: route added: ${r} (update the snapshot)`);

  const names = new Set([...Object.keys(snapshot.responses ?? {}), ...Object.keys(surface.responses)]);
  for (const name of [...names].sort()) {
    const before = snapshot.responses?.[name];
    const after = surface.responses[name];
    if (before && !after) {
      problems.push(`BREAKING: response type removed: ${name}`);
      continue;
    }
    if (!before && after) {
      problems.push(`additive: response type added: ${name} (update the snapshot)`);
      continue;
    }
    const d = diff(before, after);
    for (const f of d.removed) {
      // A field going from `x?` to `x` is a NARROWING, not a removal. It shows
      // up here as `x?` removed and `x` added, so name it for what it is.
      const bare = f.replace(/\?$/, "");
      if (d.added.includes(bare) && f.endsWith("?")) {
        problems.push(`BREAKING: ${name}.${bare} became required (was optional)`);
      } else if (d.added.includes(`${bare}?`) && !f.endsWith("?")) {
        problems.push(`additive: ${name}.${bare} became optional (update the snapshot)`);
      } else {
        problems.push(`BREAKING: field removed: ${name}.${f}`);
      }
    }
    for (const f of d.added) {
      const bare = f.replace(/\?$/, "");
      if (d.removed.includes(bare) || d.removed.includes(`${bare}?`)) continue; // already reported
      if (f.endsWith("?")) problems.push(`additive: optional field added: ${name}.${f} (update the snapshot)`);
      else problems.push(`BREAKING: required field added: ${name}.${f}`);
    }
  }

  if (problems.length === 0) {
    console.info(
      `api surface: unchanged (${surface.routes.length} routes, ` +
        `${Object.keys(surface.responses).length} response types).`,
    );
    return;
  }

  const breaking = problems.filter((p) => p.startsWith("BREAKING"));
  for (const p of problems) console.error(`  ${p}`);
  console.error(
    `\napi surface: ${problems.length} change(s), ${breaking.length} breaking.\n` +
      `Additive changes are allowed under docs/VERSIONING.md: re-run with --write and commit the snapshot.\n` +
      `A BREAKING change must not land in /v1. See docs/VERSIONING.md for what to do instead.`,
  );
  process.exit(1);
}

main();
