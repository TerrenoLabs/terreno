import {describe, expect, it} from "bun:test";

import {getTimePickerLayout} from "./timePickerLayout";

describe("getTimePickerLayout", () => {
  it("uses UIPickerView's natural 216pt height on iOS", () => {
    const layout = getTimePickerLayout({os: "ios", textColor: "#111111"});
    expect(layout.height).toBe(216);
    expect(layout.itemStyle).toEqual({height: 216});
  });

  it("passes the font size through to the iOS item style", () => {
    expect(getTimePickerLayout({fontSize: 16, os: "ios", textColor: "#111111"}).itemStyle).toEqual({
      fontSize: 16,
      height: 216,
    });
  });

  it("keeps the compact height and no item style on Android", () => {
    const layout = getTimePickerLayout({fontSize: 16, os: "android", textColor: "#111111"});
    expect(layout.height).toBe(104);
    expect(layout.itemStyle).toBeUndefined();
  });

  it("colors items with the theme text color on iOS as well as Android", () => {
    expect(getTimePickerLayout({os: "ios", textColor: "#111111"}).itemColor).toBe("#111111");
    expect(getTimePickerLayout({os: "android", textColor: "#111111"}).itemColor).toBe("#111111");
  });
});
