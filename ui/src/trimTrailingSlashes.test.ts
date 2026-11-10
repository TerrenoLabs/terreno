import {describe, expect, it} from "bun:test";

import {trimTrailingSlashes} from "./trimTrailingSlashes";

describe("trimTrailingSlashes", () => {
  it("drops every trailing slash and keeps the rest", () => {
    expect(trimTrailingSlashes("/todos///")).toBe("/todos");
    expect(trimTrailingSlashes("/")).toBe("");
    expect(trimTrailingSlashes("/todos/1")).toBe("/todos/1");
  });

  it("stays fast on a long run of slashes that does not end the string", () => {
    const input = `/todos${"/".repeat(100_000)}x`;
    const start = performance.now();
    expect(trimTrailingSlashes(input)).toBe(input);
    expect(performance.now() - start).toBeLessThan(100);
  });
});
