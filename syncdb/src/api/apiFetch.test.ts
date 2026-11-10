import {describe, expect, it} from "bun:test";

import {resolveApiUrl, trimTrailingSlashes} from "./apiFetch";

describe("trimTrailingSlashes", () => {
  it("drops every trailing slash and keeps the rest", () => {
    expect(trimTrailingSlashes("http://api.test///")).toBe("http://api.test");
    expect(trimTrailingSlashes("/api/auth/")).toBe("/api/auth");
    expect(trimTrailingSlashes("/")).toBe("");
    expect(trimTrailingSlashes("")).toBe("");
    expect(trimTrailingSlashes("a/b")).toBe("a/b");
  });

  it("stays fast on a long run of slashes that does not end the string", () => {
    const input = `${"/".repeat(100_000)}x`;
    const start = performance.now();
    expect(trimTrailingSlashes(input)).toBe(input);
    expect(performance.now() - start).toBeLessThan(100);
  });
});

describe("resolveApiUrl", () => {
  it("joins a base URL with trailing slashes to a relative path", () => {
    expect(resolveApiUrl({baseUrl: "http://api.test//", url: "/todos"})).toBe(
      "http://api.test/todos"
    );
    expect(resolveApiUrl({baseUrl: "http://api.test/", url: "todos"})).toBe(
      "http://api.test/todos"
    );
  });

  it("keeps absolute and protocol-relative URLs", () => {
    expect(resolveApiUrl({baseUrl: "http://api.test", url: "https://other.test/x"})).toBe(
      "https://other.test/x"
    );
    expect(resolveApiUrl({baseUrl: "http://api.test", url: "//cdn.test/x"})).toBe("//cdn.test/x");
  });

  it("stays fast on a base URL made of many slashes", () => {
    const baseUrl = `http://api.test${"/".repeat(100_000)}x`;
    const start = performance.now();
    resolveApiUrl({baseUrl, url: "/todos"});
    expect(performance.now() - start).toBeLessThan(100);
  });
});
