import { describe, it, expect } from "vitest";
import { validate } from "../src/index";

describe("validate", () => {
  it("accepts a well-formed object", () => {
    const schema = {
      type: "object" as const,
      properties: { name: { type: "string" as const }, age: { type: "integer" as const, minimum: 0 } },
      required: ["name"],
    };
    expect(validate({ name: "ada", age: 36 }, schema).valid).toBe(true);
  });

  it("reports a missing required property", () => {
    const schema = { type: "object" as const, properties: { id: { type: "string" as const } }, required: ["id"] };
    const res = validate({}, schema);
    expect(res.valid).toBe(false);
    expect(res.errors[0].message).toContain("required");
  });

  it("reports a wrong type", () => {
    const res = validate({ n: "not-a-number" }, {
      type: "object" as const,
      properties: { n: { type: "number" as const } },
    });
    expect(res.valid).toBe(false);
  });

  it("enforces enum, bounds, and additionalProperties", () => {
    expect(validate("b", { enum: ["a", "b"] }).valid).toBe(true);
    expect(validate("z", { enum: ["a", "b"] }).valid).toBe(false);
    expect(validate(5, { type: "number" as const, maximum: 3 }).valid).toBe(false);
    expect(
      validate({ x: 1, y: 2 }, {
        type: "object" as const,
        properties: { x: { type: "integer" as const } },
        additionalProperties: false,
      }).valid,
    ).toBe(false);
  });

  it("validates array items", () => {
    const schema = { type: "array" as const, items: { type: "string" as const }, minItems: 1 };
    expect(validate(["a", "b"], schema).valid).toBe(true);
    expect(validate(["a", 2], schema).valid).toBe(false);
    expect(validate([], schema).valid).toBe(false);
  });
});
