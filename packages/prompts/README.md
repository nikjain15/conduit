# @conduit/prompts

A versioned prompt registry and a deterministic resolver. It makes the system
prompt for a use case config driven: a profile names a prompt by ref
(`prompt.systemRef`) and the resolver produces the composed text at run time.

## What it does

- A prompt has a `ref`, a list of `versions` (each `{ version, text, createdAtRef }`),
  and an `active` version. Prior versions are immutable, so a version switch is a
  pointer move, not an edit.
- `resolvePrompt(store, ref, variables, options?)` returns the active version text
  (or an explicit `options.version`) with `{{variable}}` interpolation and
  `{{>template}}` snippet composition.
- It never throws. A missing variable leaves its `{{placeholder}}` in place and
  records a warning. An unknown template include is left literally and recorded.
  Template expansion is bounded, so a self referential snippet stops safely.

## Usage

```ts
import { createSampleStore, resolvePrompt } from "@conduit/prompts";

const store = createSampleStore();
const { text, version, warnings } = resolvePrompt(
  store,
  "support-triage.system",
  { product: "Acme", team: "Tier 1" },
);
```

The sample prompts register into `@conduit/profile`'s shared `promptRegistry` on
import, so a profile that names one of their refs resolves to a concrete prompt.

## Templates and variables

`{{>name}}` inlines a named snippet, then `{{name}}` fills a variable. A caller
can pass extra templates through `options.templates` (for example a profile's
`prompt.templates`) to override a stored snippet without editing the prompt.
