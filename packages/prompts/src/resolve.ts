/**
 * The prompt resolver.
 *
 * resolvePrompt reads the active (or requested) version of a prompt, composes any
 * named template snippets into the text, and interpolates {{variable}} tokens. It
 * is deterministic and total: it never throws. A missing variable is left as its
 * literal placeholder and recorded as a warning; an unknown template include is
 * left in place and recorded too. Template expansion is bounded so a template that
 * references itself cannot loop forever.
 */
import type {
  PromptRecord,
  PromptStore,
  ResolveOptions,
  ResolveResult,
} from "./types.ts";

/** {{>name}} include token. */
const INCLUDE = /\{\{>\s*([\w.-]+)\s*\}\}/g;
/** {{name}} variable token. Does not match include tokens (they start with >). */
const VARIABLE = /\{\{\s*([\w.-]+)\s*\}\}/g;

/** Guard against a template that includes itself directly or in a cycle. */
const MAX_INCLUDE_PASSES = 10;

/** Pick the version to resolve: an explicit override, else the record's active. */
function pickVersion(record: PromptRecord, override?: string) {
  const wanted = override ?? record.active;
  const found = record.versions.find((v) => v.version === wanted);
  return { wanted, found };
}

/**
 * Expand {{>name}} includes against the merged template map, up to a bounded
 * number of passes so nested templates compose while a cycle stops safely. An
 * unknown include is left in place and its name pushed to `warnings` once.
 */
function expandIncludes(
  text: string,
  templates: Record<string, string>,
  warnings: string[],
): string {
  const missing = new Set<string>();
  let current = text;
  for (let pass = 0; pass < MAX_INCLUDE_PASSES; pass++) {
    if (!INCLUDE.test(current)) break;
    INCLUDE.lastIndex = 0;
    current = current.replace(INCLUDE, (whole, name: string) => {
      if (Object.prototype.hasOwnProperty.call(templates, name)) {
        return templates[name];
      }
      missing.add(name);
      return whole;
    });
  }
  for (const name of missing) warnings.push(`unknown template include: ${name}`);
  return current;
}

/**
 * Interpolate {{variable}} tokens from `variables`. A token with no matching
 * variable is left literally in the text and recorded once as a warning.
 */
function interpolate(
  text: string,
  variables: Record<string, string>,
  warnings: string[],
): string {
  const missing = new Set<string>();
  VARIABLE.lastIndex = 0;
  const out = text.replace(VARIABLE, (whole, name: string) => {
    if (Object.prototype.hasOwnProperty.call(variables, name)) {
      return variables[name];
    }
    missing.add(name);
    return whole;
  });
  for (const name of missing) warnings.push(`missing variable: ${name}`);
  return out;
}

/**
 * Resolve a prompt ref to its composed system text. Returns an empty text and a
 * warning when the ref or requested version is unknown, rather than throwing.
 */
export function resolvePrompt(
  store: PromptStore,
  ref: string,
  variables: Record<string, string> = {},
  options: ResolveOptions = {},
): ResolveResult {
  const warnings: string[] = [];
  const record = store.prompts[ref];
  if (!record) {
    return { ref, version: options.version ?? "", text: "", warnings: [`unknown prompt ref: ${ref}`] };
  }

  const { wanted, found } = pickVersion(record, options.version);
  if (!found) {
    return { ref, version: wanted, text: "", warnings: [`unknown prompt version: ${ref}@${wanted}`] };
  }

  const templates = { ...(record.templates ?? {}), ...(options.templates ?? {}) };
  const composed = expandIncludes(found.text, templates, warnings);
  const text = interpolate(composed, variables, warnings);

  return { ref, version: found.version, text, warnings };
}
