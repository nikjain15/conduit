/**
 * The gateway's MCP surface.
 *
 * The same cores exposed over HTTP are also offered as MCP tools, so an MCP
 * client (an IDE, another agent) can drive Conduit through the registry in
 * `@conduit/mcp`. Tools are built bound to an already-resolved tenant, which
 * keeps tenant isolation identical to the HTTP path: the MCP transport is gated
 * by the same bearer auth, and every tool call runs against the caller's tenant.
 *
 * `buildGatewayTools` is pure (no SDK, no transport) so it is unit testable.
 * `createGatewaySse` is the thin runtime factory that pulls in the SSE transport
 * from `@conduit/mcp`; it is only used by the live server wrapper.
 */
import type { ConduitTool, ToolResult } from "../../../packages/mcp/src/index.ts";
import type { GatewayCores, Tenant } from "./types";

function ok(structured: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(structured) }], structuredContent: structured };
}

/** Build the Conduit tools bound to `tenant`, delegating to the injected cores. */
export function buildGatewayTools(cores: GatewayCores, tenant: Tenant): ConduitTool[] {
  return [
    {
      name: "infer",
      description: "Run a routed, priced inference for a use case.",
      inputSchema: {
        type: "object",
        properties: {
          useCase: { type: "string" },
          messages: {
            type: "array",
            items: {
              type: "object",
              properties: { role: { type: "string" }, content: { type: "string" } },
              required: ["role", "content"],
            },
          },
          system: { type: "string" },
          maxTokens: { type: "number" },
          pinModel: { type: "string" },
        },
        required: ["useCase", "messages"],
      },
      async handler(args) {
        const result = await cores.infer(
          {
            useCase: String(args.useCase),
            messages: (args.messages as { role: "system" | "user" | "assistant"; content: string }[]) ?? [],
            ...(typeof args.system === "string" ? { system: args.system } : {}),
            ...(typeof args.maxTokens === "number" ? { maxTokens: args.maxTokens } : {}),
            ...(typeof args.pinModel === "string" ? { pinModel: args.pinModel } : {}),
          },
          tenant,
        );
        return ok(result);
      },
    },
    {
      name: "retrieve",
      description: "Retrieve grounded chunks for a query.",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" }, topK: { type: "number" } },
        required: ["query"],
      },
      async handler(args) {
        const result = await cores.retrieve(
          { query: String(args.query), ...(typeof args.topK === "number" ? { topK: args.topK } : {}) },
          tenant,
        );
        return ok(result);
      },
    },
    {
      name: "agent",
      description: "Run a goal-directed agent loop.",
      inputSchema: {
        type: "object",
        properties: { goal: { type: "string" }, maxSteps: { type: "number" } },
        required: ["goal"],
      },
      async handler(args) {
        const result = await cores.runAgent(
          { goal: String(args.goal), ...(typeof args.maxSteps === "number" ? { maxSteps: args.maxSteps } : {}) },
          tenant,
        );
        return ok(result);
      },
    },
    {
      name: "evals_run",
      description: "Run an eval dataset and return summary metrics.",
      inputSchema: {
        type: "object",
        properties: { datasetId: { type: "string" } },
        required: ["datasetId"],
      },
      async handler(args) {
        const result = await cores.evaluate({ datasetId: String(args.datasetId) }, tenant);
        return ok(result);
      },
    },
  ];
}

/**
 * Create the SSE handler pair for a tenant, wired to the gateway's tools via
 * `@conduit/mcp`. Imported lazily by the server wrapper so the pure paths (and
 * their tests) never need the MCP SDK present.
 */
export async function createGatewaySse(cores: GatewayCores, tenant: Tenant) {
  const { createSseHandler } = await import("../../../packages/mcp/src/index.ts");
  return createSseHandler(
    { name: "conduit-gateway", version: "0.1.0", tools: buildGatewayTools(cores, tenant) },
    "/messages",
  );
}
