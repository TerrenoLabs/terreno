import {afterEach, beforeEach, describe, expect, test} from "bun:test";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

import {getDocsRoot} from "../docsRoot.js";

const docsRootModulePath = fileURLToPath(new URL("../docsRoot.ts", import.meta.url));
const bundledDocsPath = join(dirname(docsRootModulePath), "docs");

describe("getDocsRoot", () => {
  let execFallbackTmp: string;

  beforeEach(() => {
    execFallbackTmp = mkdtempSync(join(tmpdir(), "terreno-mcp-docs-exec-"));
  });

  afterEach(() => {
    rmSync(execFallbackTmp, {force: true, recursive: true});
  });

  test("returns TERRENO_MCP_DOCS_DIR when set", () => {
    const previous = process.env.TERRENO_MCP_DOCS_DIR;
    process.env.TERRENO_MCP_DOCS_DIR = "/tmp/custom-docs-root";
    try {
      expect(getDocsRoot()).toBe("/tmp/custom-docs-root");
    } finally {
      if (previous === undefined) {
        delete process.env.TERRENO_MCP_DOCS_DIR;
      } else {
        process.env.TERRENO_MCP_DOCS_DIR = previous;
      }
    }
  });

  test("returns exec-adjacent docs when bundled docs are missing but exec docs exist", () => {
    const fakeExec = join(execFallbackTmp, "bun");
    writeFileSync(fakeExec, "");
    const execDocs = join(execFallbackTmp, "docs");
    mkdirSync(execDocs, {recursive: true});

    const resolved = getDocsRoot({
      execPath: fakeExec,
      existsSyncFn: (p) => {
        if (p === bundledDocsPath) {
          return false;
        }
        if (p === execDocs) {
          return true;
        }
        return false;
      },
    });

    expect(resolved).toBe(execDocs);
  });

  test("falls back to checkout source docs after bundled and exec-adjacent checks", (): void => {
    const sourceDocsPath = join(dirname(docsRootModulePath), "..", "src", "docs");
    const execDocsPath = join(execFallbackTmp, "docs");
    const checkedPaths: string[] = [];
    const resolved = getDocsRoot({
      execPath: join(execFallbackTmp, "bun"),
      existsSyncFn: (path): boolean => {
        checkedPaths.push(path);
        return checkedPaths.length === 3 && path === sourceDocsPath;
      },
    });

    expect(checkedPaths).toEqual([bundledDocsPath, execDocsPath, sourceDocsPath]);
    expect(resolved).toBe(sourceDocsPath);
  });

  test("returns bundled path when no docs directories exist", () => {
    const resolved = getDocsRoot({
      execPath: null,
      existsSyncFn: () => false,
    });

    expect(resolved).toBe(bundledDocsPath);
  });
});
