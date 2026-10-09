import {describe, expect, it} from "bun:test";

import {assetUri} from "./assetUri";

describe("assetUri", () => {
  it("passes a bundled URL string through", () => {
    expect(assetUri("/assets/roast-lamb.jpg")).toBe("/assets/roast-lamb.jpg");
  });

  it("reads the uri from a web asset object", () => {
    expect(assetUri({uri: "/assets/greens.jpg"})).toBe("/assets/greens.jpg");
  });

  it("resolves a native numeric asset id", () => {
    expect(assetUri(7, (id) => `asset://${id}`)).toBe("asset://7");
  });

  it("unwraps a default export, keeping the native resolver", () => {
    expect(assetUri({default: "/assets/crumble.jpg"})).toBe("/assets/crumble.jpg");
    expect(assetUri({default: 3}, (id) => `asset://${id}`)).toBe("asset://3");
  });

  it("returns undefined for anything else", () => {
    expect(assetUri(undefined)).toBeUndefined();
    expect(assetUri(null)).toBeUndefined();
    expect(assetUri({})).toBeUndefined();
    expect(assetUri({uri: 5})).toBeUndefined();
  });
});
