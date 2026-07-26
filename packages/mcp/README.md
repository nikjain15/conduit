# @conduit/mcp

Turn a set of Conduit tools into a Model Context Protocol (MCP) server.

The package is built in two layers:

1. A transport-agnostic tool registry. It holds `ConduitTool`s, answers
   `tools/list`, validates `tools/call` arguments against each tool's JSON
   Schema, and returns structured, non-throwing outcomes. It imports no MCP SDK
   and no transport, so it is unit testable on its own.
2. Thin transports. A stdio entry for local clients such as Claude Desktop, and
   an HTTP/SSE entry for hosted distribution. Both import the MCP SDK at call
   time and delegate all tool logic to the registry.

## The tool shape

```ts
import type { ConduitTool } from "@conduit/mcp";

const search: ConduitTool = {
  name: "search_docs",
  description: "Search internal docs and return the top matches.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", minLength: 1 },
      limit: { type: "integer", minimum: 1, maximum: 50 },
    },
    required: ["query"],
    additionalProperties: false,
  },
  handler: async (args) => ({
    content: [{ type: "text", text: `results for ${args.query as string}` }],
    structuredContent: { hits: [] },
  }),
};
```

The registry validates arguments against `inputSchema` before the handler runs.
Invalid arguments, unknown tool names, and handler throws all come back as
structured errors rather than exceptions.

## Public API

- `ConduitTool`, `ToolResult`, `ToolDescriptor`, `JsonSchema`, `ValidationIssue`,
  `RegistryError`, `CallOutcome`: the core shapes.
- `ToolRegistry`: `register`, `has`, `list`, `call`. Pure and transport free.
- `validateArgs(args, schema)`: the JSON Schema subset validator.
- `buildMcpServer(server, registry, schemas)`: register `tools/list` and
  `tools/call` handlers on an SDK-shaped server. `outcomeToCallResult` maps a
  registry outcome to an MCP `CallToolResult`.
- `createMcpServer({ name, version, tools })`: build a live SDK `Server` wired to
  a fresh registry.
- `startStdioServer(options)`: stdio transport entry.
- `createSseHandler(options, messageEndpoint?)`: HTTP/SSE transport entry.

## How the SDK is wired

The transports depend on `@modelcontextprotocol/sdk`. The SDK is imported only
inside the transport factories (`createMcpServer`, `startStdioServer`,
`createSseHandler`), so the registry, validator, and error handling stay
importable and testable without the SDK present. The compile-time surface of the
SDK that this package uses is declared in `src/sdk-shim.d.ts`; those ambient
declarations mirror the SDK's public API and act as a fallback when the SDK is
not yet installed in the workspace. When the SDK is installed, its own types
apply.

## Connecting an external client

### Local (stdio) client config

A local MCP client such as Claude Desktop launches the server as a subprocess
and speaks MCP over stdio. Point it at a small entry script that calls
`startStdioServer`:

```jsonc
{
  "mcpServers": {
    "conduit": {
      "command": "node",
      "args": ["./dist/conduit-mcp-stdio.js"]
    }
  }
}
```

The entry script wires the tools:

```ts
import { startStdioServer } from "@conduit/mcp/stdio";
import { tools } from "./my-tools";

await startStdioServer({ name: "conduit", version: "0.1.0", tools });
```

### Hosted (HTTP/SSE) shape

For hosted distribution the server exposes two endpoints, matching the MCP SSE
transport:

- `GET /sse`: opens the event stream. Handle it with `handler.handleSse(req, res)`.
- `POST /messages?sessionId=...`: carries client messages. Handle it with
  `handler.handleMessage(sessionId, req, res)`.

```ts
import { createSseHandler } from "@conduit/mcp/http";
import { tools } from "./my-tools";

const handler = await createSseHandler(
  { name: "conduit", version: "0.1.0", tools },
  "/messages",
);
// GET  /sse                    -> handler.handleSse(req, res)
// POST /messages?sessionId=... -> handler.handleMessage(sessionId, req, res)
```

A client connects to the hosted server at the base URL of the `GET` endpoint,
for example `https://<your-host>/sse`. The `POST` endpoint path is advertised to
the client by the SDK on connect.

## Tests

```
npx vitest run packages/mcp
```

The tests exercise the registry and the server wiring over pure data: a
registered tool appears in the list, valid arguments run the handler, invalid
arguments and unknown tool names return structured errors, and the wiring maps
outcomes to MCP results. No network and no live transport are used.
