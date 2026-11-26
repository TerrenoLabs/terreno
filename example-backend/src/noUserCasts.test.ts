import {describe, expect, it} from "bun:test";
import {readdirSync, readFileSync, statSync} from "node:fs";
import path from "node:path";

const SRC_DIR = path.resolve(import.meta.dir);
const USER_CAST = /\b(User|user|req\.user|doc|appUser)\s+as unknown as\b/;

const findUserCasts = (source: string): number[] => {
  const lines = source.split("\n");
  const hits: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (USER_CAST.test(lines[i])) {
      hits.push(i + 1);
    }
  }
  return hits;
};

const listSourceFiles = (dir: string): string[] => {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "tests") {
        continue;
      }
      files.push(...listSourceFiles(full));
      continue;
    }
    if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      files.push(full);
    }
  }
  return files;
};

describe("example-backend user casts", () => {
  it("has no `user as unknown as` casts in non-test sources", () => {
    const matches: string[] = [];
    for (const file of listSourceFiles(SRC_DIR)) {
      for (const line of findUserCasts(readFileSync(file, "utf8"))) {
        matches.push(`${path.relative(SRC_DIR, file)}:${line}`);
      }
    }
    expect(matches.length > 0 ? `user casts found:\n${matches.join("\n")}` : "").toBe("");
  });

  it("the matcher catches a cast (the guard can fail)", () => {
    const sample = "const m = User as unknown as TerrenoAuthUserModel;";
    expect(findUserCasts(sample)).toEqual([1]);
  });

  it("the matcher ignores non-user casts", () => {
    expect(findUserCasts("const x = payload as unknown as Foo;")).toEqual([]);
  });
});
