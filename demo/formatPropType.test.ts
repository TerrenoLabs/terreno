import {describe, expect, it} from "bun:test";

import {formatPropComment, formatPropType} from "./formatPropType";

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

  it("returns an empty string when the type is missing", () => {
    expect(formatPropType(undefined)).toBe("");
  });

  it("formats literal and array types", () => {
    expect(formatPropType({type: "literal", value: "sm"})).toBe('"sm"');
    expect(
      formatPropType({
        elementType: {name: "string", type: "intrinsic"},
        type: "array",
      })
    ).toBe("string[]");
  });

  it("formats object reflections and falls back to the type name", () => {
    expect(formatPropType({declaration: {}, type: "reflection"})).toBe("object");
    expect(formatPropType({name: "Custom", type: "tuple"})).toBe("Custom");
  });
});

describe("formatPropComment", () => {
  it("drops the typedoc type table and keeps the prose and default", () => {
    expect(
      formatPropComment([
        {
          text: "Animate the opening and closing of ActionSheet.\n\n| Type | Required |\n| ---- | -------- |\n| boolean | no |\n\nDefault: ",
        },
        {text: "`true`"},
      ])
    ).toBe("Animate the opening and closing of ActionSheet. Default: `true`");
  });

  it("keeps inline code that sits before the table", () => {
    expect(
      formatPropComment([
        {text: "Snap ActionSheet to this location if "},
        {text: "`closable`"},
        {text: " is set to false;\n\n\n| Type | Required |\n| ---- | -------- |\n| number | no |"},
      ])
    ).toBe("Snap ActionSheet to this location if `closable` is set to false;");
  });

  it("returns an empty string when the comment is missing", () => {
    expect(formatPropComment(undefined)).toBe("");
    expect(formatPropComment([])).toBe("");
  });
});
