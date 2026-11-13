import {describe, expect, it} from "bun:test";
import {sanitizeReturnTo} from "./returnTo";

describe("sanitizeReturnTo", () => {
  it("accepts an in-app path", () => {
    expect(sanitizeReturnTo("/todos")).toBe("/todos");
  });

  it("accepts a nested in-app path", () => {
    expect(sanitizeReturnTo("/User/abc123")).toBe("/User/abc123");
  });

  it("rejects a protocol-relative URL", () => {
    expect(sanitizeReturnTo("//evil.example")).toBeUndefined();
  });

  it("rejects an absolute URL", () => {
    expect(sanitizeReturnTo("https://evil.example")).toBeUndefined();
  });

  it("rejects a backslash after the leading slash", () => {
    expect(sanitizeReturnTo("/\\evil")).toBeUndefined();
  });

  it("rejects a path that does not start with a slash", () => {
    expect(sanitizeReturnTo("todos")).toBeUndefined();
  });

  it("rejects undefined", () => {
    expect(sanitizeReturnTo(undefined)).toBeUndefined();
  });

  it("takes the first value of an array", () => {
    expect(sanitizeReturnTo(["/a", "/b"])).toBe("/a");
  });

  // Added edge cases.
  it("rejects an empty string", () => {
    expect(sanitizeReturnTo("")).toBeUndefined();
  });

  it("rejects an empty array", () => {
    expect(sanitizeReturnTo([])).toBeUndefined();
  });

  it("rejects an array whose first value is unsafe", () => {
    expect(sanitizeReturnTo(["//evil.example", "/b"])).toBeUndefined();
  });

  it("rejects a javascript: scheme", () => {
    expect(sanitizeReturnTo("javascript:alert(1)")).toBeUndefined();
  });

  it("rejects a bare slash followed by a backslash host", () => {
    expect(sanitizeReturnTo("/\\/evil.example")).toBeUndefined();
  });
});
