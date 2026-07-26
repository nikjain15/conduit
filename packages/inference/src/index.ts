/**
 * @conduit/inference public surface.
 *
 * The pure core (types, config, cost math, resolve()) is re-exported here for
 * workspace consumers (apps/admin reads these types in Phase 1). Per-runtime
 * adapters are imported directly by their runtime to avoid pulling runtime
 * globals into this entry:
 *   - Worker:    import { resolveOnWorkers } from "<rel>/packages/inference/src/adapters/workers"
 *   - Deno (fn): import { resolveOnDeno }    from "<rel>/packages/inference/src/adapters/deno.ts"
 *   - Node (CI): import { resolveOnNode }    from "@conduit/inference/adapters/node"
 */
export * from "./core";
export * from "./judge";
