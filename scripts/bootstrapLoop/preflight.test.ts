import {describe, expect, it} from "bun:test";
import {mkdirSync, mkdtempSync, readFileSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

import {ensureFreshInstall} from "./preflight";

const makeRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), "preflight-"));
  mkdirSync(join(root, "node_modules"));
  return root;
};

describe("ensureFreshInstall", () => {
  it("skips published versions", () => {
    let calls = 0;
    const error = ensureFreshInstall({
      readHead: () => "abc",
      refresh: () => {
        calls += 1;
        return 0;
      },
      repoRoot: makeRoot(),
      version: "58.1.0",
    });
    expect(error).toBeUndefined();
    expect(calls).toBe(0);
  });

  it("refreshes once per HEAD for local and stamps it", () => {
    const root = makeRoot();
    let calls = 0;
    const options = {
      readHead: () => "abc",
      refresh: () => {
        calls += 1;
        return 0;
      },
      repoRoot: root,
      version: "local",
    };
    expect(ensureFreshInstall(options)).toBeUndefined();
    expect(ensureFreshInstall(options)).toBeUndefined();
    expect(calls).toBe(1);
    expect(readFileSync(join(root, "node_modules/.bootstrap-loop-head"), "utf8").trim()).toBe(
      "abc"
    );
  });

  it("refreshes again when HEAD changes", () => {
    const root = makeRoot();
    writeFileSync(join(root, "node_modules/.bootstrap-loop-head"), "old\n");
    let calls = 0;
    ensureFreshInstall({
      readHead: () => "new",
      refresh: () => {
        calls += 1;
        return 0;
      },
      repoRoot: root,
      version: "local",
    });
    expect(calls).toBe(1);
  });

  it("reports a failed refresh and leaves no stamp", () => {
    const root = makeRoot();
    const error = ensureFreshInstall({
      readHead: () => "abc",
      refresh: () => 1,
      repoRoot: root,
      version: "local",
    });
    expect(error).toContain("exit code 1");
    expect(() => readFileSync(join(root, "node_modules/.bootstrap-loop-head"))).toThrow();
  });
});
