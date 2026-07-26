# Publishing the @conduit packages

This documents how the publishable `@conduit/*` packages are released to npm. Publishing requires Nik's npm credentials and is his to run.

## What ships and what does not

Publishable packages (all under `packages/*`):

- `@conduit/inference`
- `@conduit/rag`
- `@conduit/agent`
- `@conduit/evals`
- `@conduit/mcp`
- `@conduit/client`
- `@conduit/catalog`
- `@conduit/profile`
- `@conduit/prompts`
- `@conduit/guardrails`

Not published: `services/gateway` and `apps/console`. Both are marked `"private": true`, so npm refuses to publish them.

## Packages ship TypeScript source

Each package resolves through `main`, `types`, and `exports` that point at `./src`. The source uses explicit `.ts` extension imports, which the monorepo relies on for in-repo resolution and typechecking. Because of that, the packages publish their TypeScript `src/` directly rather than a compiled `dist/`, and consumers compile the source through their own bundler or `tsc`. The published `files` list is `["src", "README.md"]`, so only source and the readme are packed.

## One-time scope setup

The `@conduit` scope must exist and be owned before the first publish. Nik does this:

1. `npm login` with the account that will own the scope.
2. Create the scope as public (creating the first `@conduit/*` package with `publishConfig.access = "public"` also establishes it). Each package already sets `publishConfig.access = "public"`, so no `--access` flag is strictly required, but passing it is harmless.

## Publish order

Publish in dependency order so each package's `@conduit/*` dependencies already exist on the registry:

1. `inference`, `rag`, `agent` (no internal deps)
2. `evals`, `catalog`, `profile`
3. `client`, `mcp`
4. `prompts`, `guardrails`

## Commands

Per package:

```
npm publish -w packages/inference --access public
npm publish -w packages/rag --access public
npm publish -w packages/agent --access public
npm publish -w packages/evals --access public
npm publish -w packages/catalog --access public
npm publish -w packages/profile --access public
npm publish -w packages/client --access public
npm publish -w packages/mcp --access public
npm publish -w packages/prompts --access public
npm publish -w packages/guardrails --access public
```

Or publish every workspace at once (npm resolves nothing for order here, so prefer the ordered per-package form on a first release):

```
npm publish --workspaces --access public
```

The `private` gateway and console workspaces are skipped automatically.

## Notes

- Versions stay at `0.1.0` for this release. Bump per package before republishing.
- Publishing needs Nik's npm credentials and is his to run. Do not publish from automation.
