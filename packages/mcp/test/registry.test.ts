/**
 * Registry unit tests. These cover the required behaviors:
 *   - a registered tool appears in the list,
 *   - calling it with valid args runs the handler,
 *   - invalid args return a structured validation error (not a throw),
 *   - an unknown tool name returns a proper error,
 *   - the registry is transport agnostic (no SDK, no transport involved).
 * No network and no live MCP transport are used.
 */
import { describe, it, expect } from "vitest";
import { ToolRegistry } from "../src/registry";
import { validateArgs } from "../src/validate";
import type { ConduitTool } from "../src/types";

function echoTool(): ConduitTool {
  return {
    name: "echo",
    description: "Echo a message back a number of times.",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string" },
        times: { type: "integer", minimum: 1, maximum: 5 },
      },
      required: ["message"],
      additionalProperties: false,
    },
    handler: async (args) => {
      const message = args.message as string;
      const times = (args.times as number | undefined) ?? 1;
      return {
        content: [{ type: "text", text: message.repeat(times) }],
        structuredContent: { message, times },
      };
    },
  };
}

describe("ToolRegistry.list", () => {
  it("exposes a registered tool in the list", () => {
    const reg = new ToolRegistry([echoTool()]);
    const list = reg.list();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("echo");
    expect(list[0].description).toContain("Echo");
    expect(list[0].inputSchema.required).toEqual(["message"]);
  });

  it("returns tools sorted by name", () => {
    const reg = new ToolRegistry();
    reg.register({ ...echoTool(), name: "zeta" });
    reg.register({ ...echoTool(), name: "alpha" });
    expect(reg.list().map((t) => t.name)).toEqual(["alpha", "zeta"]);
  });

  it("rejects duplicate tool names", () => {
    const reg = new ToolRegistry([echoTool()]);
    expect(() => reg.register(echoTool())).toThrow(/duplicate/);
  });
});

describe("ToolRegistry.call", () => {
  it("runs the handler with valid args", async () => {
    const reg = new ToolRegistry([echoTool()]);
    const outcome = await reg.call("echo", { message: "hi", times: 3 });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.content[0]).toEqual({ type: "text", text: "hihihi" });
      expect(outcome.result.structuredContent).toEqual({ message: "hi", times: 3 });
    }
  });

  it("applies schema defaults handled by the handler when optional args are omitted", async () => {
    const reg = new ToolRegistry([echoTool()]);
    const outcome = await reg.call("echo", { message: "yo" });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.content[0].text).toBe("yo");
    }
  });

  it("returns a structured validation error, not a throw, for invalid args", async () => {
    const reg = new ToolRegistry([echoTool()]);
    // Missing required `message`, and `times` above maximum, and an extra prop.
    const outcome = await reg.call("echo", { times: 99, extra: true });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe("invalid_arguments");
      expect(outcome.error.issues).toBeDefined();
      const paths = (outcome.error.issues ?? []).map((i) => i.path);
      expect(paths).toContain("message");
      expect(paths).toContain("times");
      expect(paths).toContain("extra");
    }
  });

  it("rejects a wrong type with a structured error", async () => {
    const reg = new ToolRegistry([echoTool()]);
    const outcome = await reg.call("echo", { message: 123 });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe("invalid_arguments");
      expect(outcome.error.issues?.[0].path).toBe("message");
    }
  });

  it("returns a proper error for an unknown tool name", async () => {
    const reg = new ToolRegistry([echoTool()]);
    const outcome = await reg.call("does-not-exist", {});
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe("unknown_tool");
      expect(outcome.error.message).toContain("does-not-exist");
    }
  });

  it("captures a handler throw as a structured handler_error", async () => {
    const reg = new ToolRegistry([
      {
        name: "boom",
        description: "Always throws.",
        inputSchema: { type: "object" },
        handler: async () => {
          throw new Error("kaboom");
        },
      },
    ]);
    const outcome = await reg.call("boom", {});
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe("handler_error");
      expect(outcome.error.message).toBe("kaboom");
    }
  });

  it("is transport agnostic: no transport or SDK is needed to list and call", async () => {
    // The registry is constructed and exercised with plain data only.
    const reg = new ToolRegistry([echoTool()]);
    expect(reg.has("echo")).toBe(true);
    const outcome = await reg.call("echo", { message: "x", times: 2 });
    expect(outcome.ok && outcome.result.content[0].text).toBe("xx");
  });
});

describe("validateArgs", () => {
  it("validates nested objects and arrays", () => {
    const schema = {
      type: "object" as const,
      properties: {
        filters: {
          type: "object" as const,
          properties: { status: { type: "string" as const, enum: ["open", "closed"] } },
          required: ["status"],
        },
        tags: { type: "array" as const, items: { type: "string" as const } },
      },
      required: ["filters"],
    };
    expect(validateArgs({ filters: { status: "open" }, tags: ["a", "b"] }, schema)).toEqual([]);

    const bad = validateArgs({ filters: { status: "nope" }, tags: ["a", 2] }, schema);
    const paths = bad.map((i) => i.path);
    expect(paths).toContain("filters.status");
    expect(paths).toContain("tags[1]");
  });
});
