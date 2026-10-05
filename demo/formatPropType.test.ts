import {describe, expect, it} from "bun:test";

import {formatPropType} from "./formatPropType";

describe("formatPropType", () => {
  it("formats intrinsic types", () => {
    expect(formatPropType({name: "string", type: "intrinsic"})).toBe("string");
  });

  it("formats reference types", () => {
    expect(formatPropType({name: "ReactNode", type: "reference"})).toBe("ReactNode");
  });

  it("formats reflection callback types as function", () => {
    expect(
      formatPropType({
        declaration: {signatures: [{}]},
        type: "reflection",
      })
    ).toBe("function");
  });

  it("formats union types", () => {
    expect(
      formatPropType({
        type: "union",
        types: [{name: "string", type: "intrinsic"}, {name: "number", type: "intrinsic"}],
      })
    ).toBe("string | number");
  });
});
