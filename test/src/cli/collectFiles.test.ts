import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";

import {collectFiles, matchesAnyGlob, toPosixPath} from "./collectFiles";

let root = "";

const touch = (relativePath: string): void => {
  const fullPath = path.join(root, relativePath);
  mkdirSync(path.dirname(fullPath), {recursive: true});
  writeFileSync(fullPath, "");
};

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "terreno-collect-"));
  touch("a.test.ts");
  touch("src/b.test.tsx");
  touch("src/b.ts");
  touch("src/deep/c.test.ts");
  touch("node_modules/pkg/x.test.ts");
  touch("e2e/login.test.ts");
  touch("src/skip/d.test.ts");
});

afterAll(() => {
  rmSync(root, {force: true, recursive: true});
});

describe("collectFiles", () => {
  it("finds test files recursively, sorted, skipping default excluded dirs", () => {
    const {files, missingPaths} = collectFiles({cwd: root, paths: ["."]});
    expect(missingPaths).toEqual([]);
    expect(files).toEqual([
      "a.test.ts",
      "src/b.test.tsx",
      "src/deep/c.test.ts",
      "src/skip/d.test.ts",
    ]);
  });

  it("applies custom patterns, exclude globs, and extra excluded dirs", () => {
    const {files} = collectFiles({
      cwd: root,
      exclude: ["**/deep/**"],
      excludeDirs: ["skip"],
      paths: ["src"],
      patterns: ["**/*.test.ts"],
    });
    expect(files).toEqual([]);
    const withTsx = collectFiles({cwd: root, excludeDirs: ["skip"], paths: ["src"]});
    expect(withTsx.files).toEqual(["src/b.test.tsx", "src/deep/c.test.ts"]);
  });

  it("accepts explicit files, de-duplicates, and reports missing paths", () => {
    const {files, missingPaths} = collectFiles({
      cwd: root,
      paths: ["a.test.ts", "a.test.ts", "src/b.ts", "nope"],
    });
    expect(files).toEqual(["a.test.ts"]);
    expect(missingPaths).toEqual(["nope"]);
  });
});

describe("glob helpers", () => {
  it("matches any glob and normalizes separators", () => {
    expect(matchesAnyGlob({filePath: "x/y.test.ts", globs: ["**/*.test.ts"]})).toBe(true);
    expect(matchesAnyGlob({filePath: "x/y.ts", globs: []})).toBe(false);
    expect(toPosixPath("a\\b\\c")).toBe("a/b/c");
  });
});
