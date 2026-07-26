# Connecting a client to a Conduit MCP server

This note covers the two ways an external client reaches a server built with
`@conduit/mcp`: a local stdio client and a hosted HTTP/SSE endpoint. Tool logic
is identical across both; only the transport differs.

## Local client over stdio

Local clients such as Claude Desktop start the server as a subprocess and speak
MCP over stdin and stdout. Provide a small entry script and register it in the
client's config.

Entry script:

```ts
import { startStdioServer } from "@conduit/mcp/stdio";
import { tools } from "./my-tools";

await startStdioServer({ name: "conduit", version: "0.1.0", tools });
```

Client config:

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

## Hosted server over HTTP/SSE

For hosted distribution the server exposes two endpoints, following the MCP SSE
transport:

- `GET /sse`: opens the long lived event stream.
- `POST /messages?sessionId=...`: carries client messages, correlated by the
  session id the SDK assigns on connect.

```ts
import { createSseHandler } from "@conduit/mcp/http";
import { tools } from "./my-tools";

const handler = await createSseHandler(
  { name: "conduit", version: "0.1.0", tools },
  "/messages",
);
// wire into your HTTP framework:
//   GET  /sse                    -> handler.handleSse(req, res)
//   POST /messages?sessionId=... -> handler.handleMessage(sessionId, req, res)
```

A client connects at the base URL of the `GET` endpoint, for example
`https://<your-host>/sse`. The SDK advertises the `POST` message path to the
client during the handshake, so the client does not need it configured
separately.

## What the client sees

Once connected, over either transport, the client can call `tools/list` to
discover the registered tools and `tools/call` to run one. Arguments are
validated against each tool's JSON Schema before its handler runs. Invalid
arguments, unknown tool names, and handler failures come back as MCP results
flagged with `isError`, carrying a structured error payload in
`structuredContent`.
