import {afterAll, beforeEach, describe, expect, it} from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {coerceBuildNumber, resolveBuildNumber} from "./buildNumber";

describe("coerceBuildNumber", () => {
  it("returns undefined for undefined", () => {
    expect(coerceBuildNumber(undefined)).toBeUndefined();
  });

  it("returns undefined for null", () => {
    expect(coerceBuildNumber(null)).toBeUndefined();
  });

  it("returns the number for a valid positive integer", () => {
    expect(coerceBuildNumber(42)).toBe(42);
  });

  it("returns the number for zero", () => {
    expect(coerceBuildNumber(0)).toBe(0);
  });

  it("returns undefined for NaN", () => {
    expect(coerceBuildNumber(Number.NaN)).toBeUndefined();
  });

  it("returns undefined for Infinity", () => {
    expect(coerceBuildNumber(Number.POSITIVE_INFINITY)).toBeUndefined();
  });

  it("parses a valid numeric string", () => {
    expect(coerceBuildNumber("123")).toBe(123);
  });

  it("returns undefined for a non-numeric string", () => {
    expect(coerceBuildNumber("abc")).toBeUndefined();
  });

  it("returns the number for a negative integer", () => {
    expect(coerceBuildNumber(-5)).toBe(-5);
  });

  it("parses a string with leading zeros", () => {
    expect(coerceBuildNumber("007")).toBe(7);
  });
});

describe("resolveBuildNumber", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = {...ORIGINAL_ENV};
    delete process.env.EXPO_PUBLIC_BUILD_NUMBER;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it("returns override when provided", () => {
    expect(resolveBuildNumber({override: 99})).toBe(99);
  });

  it("returns configValue when override is not provided", () => {
    expect(resolveBuildNumber({configValue: 50})).toBe(50);
  });

  it("returns env var when override and configValue are not provided", () => {
    process.env.EXPO_PUBLIC_BUILD_NUMBER = "200";
    expect(resolveBuildNumber()).toBe(200);
  });

  it("uses custom envVar name", () => {
    process.env.CUSTOM_BUILD = "77";
    expect(resolveBuildNumber({envVar: "CUSTOM_BUILD"})).toBe(77);
  });

  it("prefers override over configValue", () => {
    expect(resolveBuildNumber({configValue: 10, override: 20})).toBe(20);
  });

  it("prefers configValue over env var", () => {
    process.env.EXPO_PUBLIC_BUILD_NUMBER = "300";
    expect(resolveBuildNumber({configValue: 15})).toBe(15);
  });

  it("falls back to git rev-list count when nothing else is set", () => {
    const result = resolveBuildNumber();
    // In a git repo, this should return a positive integer
    expect(typeof result).toBe("number");
    expect(result).toBeGreaterThan(0);
  });

  it("skips invalid env var values and falls through to git", () => {
    process.env.EXPO_PUBLIC_BUILD_NUMBER = "not-a-number";
    // Should fall through past the env var to git
    const result = resolveBuildNumber();
    expect(typeof result).toBe("number");
    expect(result).toBeGreaterThan(0);
  });

  it("skips undefined override and uses configValue", () => {
    expect(resolveBuildNumber({configValue: 42, override: undefined})).toBe(42);
  });

  it("skips invalid configValue and uses env var", () => {
    process.env.EXPO_PUBLIC_BUILD_NUMBER = "88";
    expect(resolveBuildNumber({configValue: "bad"})).toBe(88);
  });

  it("returns a number with default options", () => {
    const result = resolveBuildNumber();
    expect(result).toBeDefined();
    expect(typeof result).toBe("number");
  });

  it("prefers override over env var", () => {
    process.env.EXPO_PUBLIC_BUILD_NUMBER = "999";
    expect(resolveBuildNumber({override: 1})).toBe(1);
  });

  it("returns undefined when git rev-list fails (no git, detached HEAD, etc.)", () => {
    // Use a freshly-created mkdtemp directory that we know is not inside any git
    // worktree (parents won't be a repo because we create it under the OS temp dir
    // and no parent has a `.git` folder). This makes `git rev-list --count HEAD`
    // exit non-zero so execSync throws, exercising the catch branch.
    const originalCwd = process.cwd();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "syncdb-buildnumber-no-git-"));
    process.chdir(tmpDir);
    try {
      expect(resolveBuildNumber()).toBeUndefined();
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(tmpDir, {force: true, recursive: true});
    }
  });
});
