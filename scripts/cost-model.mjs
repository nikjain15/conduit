#!/usr/bin/env node
/**
 * Conduit cost model. docs/COST.md.
 *
 * Conduit is the control plane the other products route through, so this model is
 * not about one app's bill. It answers a different question: what does the ROUTING
 * TABLE cost, and what is the routing decision itself worth?
 *
 * WHY A SCRIPT AND NOT A TABLE IN A DOC. A number typed into markdown is true on the
 * day it is typed. This parses `DEFAULT_ROUTING` and `DEFAULT_PRICES` out of
 * `packages/inference/src/core.ts`, so a re-route or a reprice moves the model with
 * it. `npm run cost:model` regenerates the tables in docs/COST.md.
 *
 * WHAT IS MEASURED, ESTIMATED, AND ASSUMED:
 *
 *   MEASURED from source   every use case, the model each routes to, and every
 *                          per-million-token price. Parsed, not retyped.
 *   ESTIMATED              token counts, via characters / 4. An approximation.
 *                          Anthropic's tokenizer is not available offline.
 *   ASSUMED                prompt and reply sizes per use case, and request mix.
 *
 * Conduit already records the truth: `computeCost` prices every call and the result
 * lands on the cost KPIs. One day of live traffic replaces the estimates here.
 *
 * Usage:
 *   node scripts/cost-model.mjs           print the model
 *   node scripts/cost-model.mjs --json    machine-readable
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CORE = resolve(ROOT, "packages/inference/src/core.ts");

/** Characters per token. Rough English-prose constant, the largest error source. */
export const CHARS_PER_TOKEN = 4;

/**
 * Per-use-case shape. Both numbers are ASSUMPTIONS about how Conduit is used.
 * Chosen to be defensible rather than flattering; `insights` and `content_draft`
 * carry more context and produce more text than a chat turn.
 */
export const SHAPES = {
  chat: { promptChars: 2_000, replyChars: 1_200, label: "a chat turn" },
  insights: { promptChars: 20_000, replyChars: 4_000, label: "an insights run over a corpus" },
  email_compose: { promptChars: 3_000, replyChars: 1_500, label: "a composed email" },
  content_draft: { promptChars: 6_000, replyChars: 6_000, label: "a drafted piece of content" },
};

/** Requests per day per tenant. ASSUMED. */
export const DAILY_MIX = { chat: 400, insights: 20, email_compose: 60, content_draft: 30 };
export const DAYS = 30;

const die = (m) => {
  console.error(`cost-model: ${m}`);
  process.exit(2);
};

/** Parse the price table out of source rather than restating it. */
export function readPrices(src = readFileSync(CORE, "utf8")) {
  const block = src.match(/export const DEFAULT_PRICES[^{]*\{([\s\S]*?)\n\};/);
  if (!block) die("DEFAULT_PRICES did not parse from core.ts. The source moved; fix this script.");
  const out = {};
  const re = /"([^"]+)":\s*\{\s*inputPerMTok:\s*([\d.]+),\s*outputPerMTok:\s*([\d.]+)\s*\}/g;
  let m;
  while ((m = re.exec(block[1]))) out[m[1]] = { in: Number(m[2]), out: Number(m[3]) };
  if (!Object.keys(out).length) die("DEFAULT_PRICES parsed to nothing.");
  return out;
}

/** Parse the routing table, resolving the USE_CASE.* keys to their string values. */
export function readRouting(src = readFileSync(CORE, "utf8")) {
  const ucBlock = src.match(/export const USE_CASE = \{([\s\S]*?)\n\} as const;/);
  if (!ucBlock) die("USE_CASE did not parse from core.ts.");
  const uc = {};
  for (const m of ucBlock[1].matchAll(/(\w+):\s*"([^"]+)"/g)) uc[m[1]] = m[2];

  const block = src.match(/export const DEFAULT_ROUTING[^{]*\{([\s\S]*?)\n\};/);
  if (!block) die("DEFAULT_ROUTING did not parse from core.ts.");
  const out = {};
  for (const m of block[1].matchAll(
    /\[USE_CASE\.(\w+)\]:\s*\{\s*provider:\s*"([^"]+)",\s*model:\s*"([^"]+)"\s*\}/g,
  )) {
    const key = uc[m[1]];
    if (!key) die(`routing references USE_CASE.${m[1]} which USE_CASE does not define.`);
    out[key] = { provider: m[2], model: m[3] };
  }
  if (!Object.keys(out).length) die("DEFAULT_ROUTING parsed to nothing.");
  return out;
}

const tokens = (chars) => Math.ceil(chars / CHARS_PER_TOKEN);

export function computeModel() {
  const prices = readPrices();
  const routing = readRouting();

  // A use case in the routing table with no shape is a silent hole in this model.
  const unmodelled = Object.keys(routing).filter((u) => !(u in SHAPES));
  // A shape with no route is a stale assumption.
  const orphaned = Object.keys(SHAPES).filter((u) => !(u in routing));

  const priceOf = (model) => prices[model] ?? null;
  const cost = (p, inTok, outTok) => (inTok / 1e6) * p.in + (outTok / 1e6) * p.out;

  const dearest = Object.entries(prices).reduce((a, b) =>
    b[1].in + b[1].out > a[1].in + a[1].out ? b : a,
  );

  const rows = [];
  let asRouted = 0;
  let allDearest = 0;
  for (const [useCase, shape] of Object.entries(SHAPES)) {
    const route = routing[useCase];
    if (!route) continue;
    const p = priceOf(route.model);
    if (!p) die(`no price for "${route.model}" (routed by "${useCase}"). Add it to DEFAULT_PRICES.`);
    const inTok = tokens(shape.promptChars);
    const outTok = tokens(shape.replyChars);
    const per = cost(p, inTok, outTok);
    const perDearest = cost(dearest[1], inTok, outTok);
    const n = DAILY_MIX[useCase] ?? 0;
    rows.push({
      useCase,
      label: shape.label,
      model: route.model,
      provider: route.provider,
      inTok,
      outTok,
      perCallUsd: per,
      perDay: n,
      dayUsd: per * n,
      dayUsdIfDearest: perDearest * n,
      free: p.in === 0 && p.out === 0,
    });
    asRouted += per * n;
    allDearest += perDearest * n;
  }

  return {
    rows,
    unmodelled,
    orphaned,
    dearestModel: dearest[0],
    asRoutedPerDay: asRouted,
    asRoutedPerPeriod: asRouted * DAYS,
    allDearestPerDay: allDearest,
    allDearestPerPeriod: allDearest * DAYS,
    days: DAYS,
  };
}

const usd = (n) => (n === 0 ? "$0" : n < 0.01 ? `$${n.toFixed(5)}` : `$${n.toFixed(2)}`);

function main() {
  const r = computeModel();
  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(r, null, 2)}\n`);
    return;
  }

  console.log("\nConduit cost model");
  console.log("==================");
  console.log("Routing and prices parsed from packages/inference/src/core.ts.\n");
  console.log("| Use case | Routes to | ~In | ~Out | Per call | Calls/day | Cost/day |");
  console.log("|---|---|---|---|---|---|---|");
  for (const x of r.rows) {
    const model = x.free ? `${x.model.slice(0, 28)} (free tier)` : x.model;
    console.log(
      `| \`${x.useCase}\` | ${model} | ${x.inTok} | ${x.outTok} | ${usd(x.perCallUsd)} | ${x.perDay} | ${usd(x.dayUsd)} |`,
    );
  }

  console.log(`\nPer tenant, ${r.days} days:`);
  console.log(`  as routed                    ${usd(r.asRoutedPerPeriod)}`);
  console.log(`  everything on ${r.dearestModel}  ${usd(r.allDearestPerPeriod)}`);
  const saved = r.allDearestPerPeriod - r.asRoutedPerPeriod;
  const pct = r.allDearestPerPeriod > 0 ? (saved / r.allDearestPerPeriod) * 100 : 0;
  console.log(`  routing saves                ${usd(saved)}  (${pct.toFixed(0)}%)`);

  if (r.unmodelled.length) {
    console.log(`\nROUTED BUT NOT MODELLED: ${r.unmodelled.join(", ")}`);
    console.log("These carry real traffic and are missing from the totals above.");
  }
  if (r.orphaned.length) {
    console.log(`\nMODELLED BUT NOT ROUTED: ${r.orphaned.join(", ")}`);
    console.log("Stale assumptions: SHAPES describes a use case the router no longer has.");
  }

  console.log("\nRouting and prices are read from source. Token counts are ESTIMATED");
  console.log("(chars/4); prompt sizes, reply sizes and request mix are ASSUMED.");
  console.log("computeCost already prices every real call; live traffic replaces this.\n");
}

if (import.meta.url === `file://${process.argv[1]}`) main();
