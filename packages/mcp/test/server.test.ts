/**
 * Server wiring tests. These verify that `buildMcpServer` registers the
 * `tools/list` and `tools/call` handlers on an SDK-shaped server and maps
 * registry outcomes to MCP `CallToolResult` shapes. A fake server captures the
 * handlers, so the real MCP SDK and a live transport are not required.
 */
import { describe, it, expect } from "vitest";
import { buildMcpServer, outcomeToCallResult, type McpRequest, type McpServerLike } from "../src/server";
import { ToolRegistry } from "../src/registry";
import type { ConduitTool } from "../src/types";

const LIST = Symbol("list");
const CALL = Symbol("call");

class FakeServer implements McpServerLike {
  handlers = new Map<unknown, (request: McpRequest) => Promise<unknown> | unknown>();
  setRequestHandler(schema: unknown, handler: (request: McpRequest) => Promise<unknown> | unknown): void {
    this.handlers.set(schema, handler);
  }
}

function pingTool(): ConduitTool {
  return {
    name: "ping",
    description: "Return pong.",
    inputSchema: { type: "object", properties: { n: { type: "integer" } } },
    handler: async (args) => ({
      content: [{ type: "text", text: `pong:${(args.n as number | undefined) ?? 0}` }],
    }),
  };
}

describe("buildMcpServer", () => {
  it("registers list and call handlers on the server", () => {
    const server = new FakeServer();
    buildMcpServer(server, new ToolRegistry([pingTool()]), { listSchema: LIST, callSchema: CALL });
    expect(server.handlers.has(LIST)).toBe(true);
    expect(server.handlers.has(CALL)).toBe(true);
  });

  it("list handler returns the registry's tools", async () => {
    const server = new FakeServer();
    buildMcpServer(server, new ToolRegistry([pingTool()]), { listSchema: LIST, callSchema: CALL });
    const result = (await server.handlers.get(LIST)!({})) as { tools: Array<{ name: string }> };
    expect(result.tools.map((t) => t.name)).toEqual(["ping"]);
  });

  it("call handler runs a tool and returns a CallToolResult", async () => {
    const server = new FakeServer();
    buildMcpServer(server, new ToolRegistry([pingTool()]), { listSchema: LIST, callSchema: CALL });
    const req: McpRequest = { params: { name: "ping", arguments: { n: 7 } } };
    const result = (await server.handlers.get(CALL)!(req)) as { content: Array<{ text: string }>; isError?: boolean };
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toBe("pong:7");
  });

  it("call handler maps an unknown tool to an error result", async () => {
    const server = new FakeServer();
    buildMcpServer(server, new ToolRegistry([pingTool()]), { listSchema: LIST, callSchema: CALL });
    const req: McpRequest = { params: { name: "nope", arguments: {} } };
    const result = (await server.handlers.get(CALL)!(req)) as {
      isError?: boolean;
      content: Array<{ text: string }>;
      structuredContent?: { error?: { code?: string } };
    };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("unknown_tool");
    expect(result.structuredContent?.error?.code).toBe("unknown_tool");
  });

  it("call handler maps invalid arguments to an error result", async () => {
    const server = new FakeServer();
    buildMcpServer(server, new ToolRegistry([pingTool()]), { listSchema: LIST, callSchema: CALL });
    const req: McpRequest = { params: { name: "ping", arguments: { n: "not-an-int" } } };
    const result = (await server.handlers.get(CALL)!(req)) as {
      isError?: boolean;
      structuredContent?: { error?: { code?: string } };
    };
    expect(result.isError).toBe(true);
    expect(result.structuredContent?.error?.code).toBe("invalid_arguments");
  });
});

describe("outcomeToCallResult", () => {
  it("passes success results through unchanged", () => {
    const result = outcomeToCallResult({ ok: true, result: { content: [{ type: "text", text: "ok" }] } });
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toBe("ok");
  });

  it("renders validation issues into the error text", () => {
    const result = outcomeToCallResult({
      ok: false,
      error: { code: "invalid_arguments", message: "bad", issues: [{ path: "x", message: "required" }] },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("x: required");
  });
});
