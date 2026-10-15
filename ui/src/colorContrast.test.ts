import {describe, expect, it} from "bun:test";

import {contrastRatio, readableTextColor} from "./colorContrast";

describe("contrastRatio", () => {
  it("returns 21 for black on white", () => {
    expect(Math.round(contrastRatio("#000000", "#ffffff"))).toBe(21);
  });

  it("returns 1 for an unparsed color", () => {
    expect(contrastRatio("transparent", "#ffffff")).toBe(1);
  });
});

describe("readableTextColor", () => {
  it("keeps primary text when it already meets 4.5:1", () => {
    expect(readableTextColor("#1C1C1C", "#FFFFFF", "#FFFFFF")).toBe("primary");
  });

  it("uses inverted text on the dark-mode error fill", () => {
    expect(readableTextColor("#FFFFFF", "#353535", "#EDA1A1")).toBe("inverted");
  });

  it("uses inverted text on the light-mode error fill", () => {
    expect(readableTextColor("#1C1C1C", "#FFFFFF", "#BD1111")).toBe("inverted");
  });
});
