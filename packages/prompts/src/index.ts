/**
 * @conduit/prompts public surface.
 *
 * A versioned prompt store plus a deterministic resolver: resolvePrompt reads the
 * active (or requested) version, composes named template snippets, and interpolates
 * {{variable}} tokens without ever throwing. The sample prompts are registered into
 * @conduit/profile's shared promptRegistry on import so a profile that names a ref
 * (prompt.systemRef) resolves to a concrete prompt at run time.
 */
import { promptRegistry } from "@conduit/profile";
import type { PromptRecord } from "./types.ts";
import { createSampleStore } from "./store.ts";

export { resolvePrompt } from "./resolve.ts";
export {
  createPromptStore,
  putPrompt,
  addVersion,
  setActiveVersion,
  createSampleStore,
} from "./store.ts";

export type {
  PromptVersion,
  PromptRecord,
  PromptStore,
  ResolveOptions,
  ResolveResult,
} from "./types.ts";

/**
 * Register every prompt in a store into the shared prompt registry, keyed by ref.
 * Idempotent: re-registering a ref overwrites it.
 */
export function registerPrompts(store = createSampleStore()): void {
  for (const record of Object.values(store.prompts)) {
    promptRegistry.register(record.ref, record as PromptRecord);
  }
}

// Register the sample prompts on import so the demo profiles resolve their refs.
registerPrompts();
