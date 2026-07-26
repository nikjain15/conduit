# @conduit/agent

A pure, testable agent loop for Conduit. It runs a genuine bounded reason-act loop: on each step an injected model-call function proposes either a tool call or a final answer, read-only tools execute, observations are appended to the transcript, and the loop iterates until a final answer or a step cap.

The loop has no runtime globals. The model call and every tool effect are injected, mirroring the injection discipline in `@conduit/inference`, so the whole package is exercised with mocks under vitest.

## Public API

- `runAgent({ goal, tools, skills?, callModel, maxSteps, context?, system?, allowSideEffects? })` returns `{ answer?, steps, stoppedAtCap, loadedSkills }`.
- `Tool`: `{ name, description, jsonSchema, sideEffecting?, handler(args) }`. Arguments are validated against `jsonSchema` before the handler runs.
- `Skill`: `{ id, whenIntent(ctx), instructions }`. A declarative module: matching skills inject their instructions into the system prompt. Skills define capability, not hard-coded branches.
- `CallModel`: the injected model-call function, shaped like the inference core's resolve call. It takes `{ system, messages, tools? }` and returns a `ModelTurn` (`{ toolCall? }` or `{ finalAnswer? }`).
- `validate`, `selectSkills`, `toToolSpec` and their types are exported for reuse.

## No-authority invariant

A tool marked `sideEffecting: true` is REFUSED unless the run is invoked with `allowSideEffects: true`. Default deny. A refusal is fed back to the model as a structured observation, so the model can choose a read-only path; it is never thrown out of the loop. This keeps the loop safe to run against untrusted goals: without an explicit authority flag, nothing that mutates external state can fire.

## Error handling

Invalid tool arguments, unknown tool names, refused side effects, and handler throws all become structured error observations appended to the transcript. The loop never throws out on a tool problem; it records the error step and lets the model react.

## Skills load at runtime

The loop calls each skill's `whenIntent` predicate against the run context and injects only matching skills' instructions into the system prompt. Adding a capability means adding a skill, not editing the loop.

## Develop

- Typecheck: from the repo root, `npx tsc --noEmit -p tsconfig.json`.
- Test: `npx vitest run packages/agent`.
