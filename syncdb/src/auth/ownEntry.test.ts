import {describe, expect, it} from "bun:test";

import {getOwnEntry} from "./ownEntry";

describe("getOwnEntry", () => {
  const map: Record<string, string> = {github: "GitHub"};

  it("returns an own entry", () => {
    expect(getOwnEntry(map, "github")).toBe("GitHub");
  });

  it("returns undefined for a missing key or a missing map", () => {
    expect(getOwnEntry(map, "gitlab")).toBeUndefined();
    expect(getOwnEntry(undefined, "github")).toBeUndefined();
  });

  it("ignores Object.prototype members", () => {
    expect(getOwnEntry(map, "__proto__")).toBeUndefined();
    expect(getOwnEntry(map, "constructor")).toBeUndefined();
    expect(getOwnEntry(map, "toString")).toBeUndefined();
  });
});
