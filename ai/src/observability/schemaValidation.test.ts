import {describe, expect, it} from "bun:test";

import {validateAgainstSchema} from "./schemaValidation";

const SCHEMA = {
  properties: {
    age: {type: "number"},
    name: {type: "string"},
  },
  required: ["age", "name"],
  type: "object",
};

describe("validateAgainstSchema", () => {
  it("accepts a matching value and skips a missing schema", () => {
    expect(validateAgainstSchema(SCHEMA, {age: 3, name: "a"})).toEqual([]);
    expect(validateAgainstSchema(undefined, {anything: true})).toEqual([]);
  });

  it("stops at the first error instead of walking the whole value", () => {
    const errors = validateAgainstSchema(SCHEMA, {age: "old", name: 7});
    expect(errors).toHaveLength(1);
    expect(errors[0]?.path).toBe("/age");
  });

  it("reports a root-level mismatch at /", () => {
    expect(validateAgainstSchema(SCHEMA, "nope")).toEqual([{message: "must be object", path: "/"}]);
  });
});
