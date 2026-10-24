import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {assertExportTargetsApi, webExportEnv} from "../e2e/helpers/webExport";

const API_URL = "http://localhost:51234";

describe("webExportEnv", () => {
  it("bakes the API URL in and gives Metro a per-run cache dir", () => {
    const env = webExportEnv({apiUrl: API_URL, cacheDir: "/scratch/run-1"});
    expect(env.EXPO_PUBLIC_API_URL).toBe(API_URL);
    expect(env.TMPDIR).toBe("/scratch/run-1");
  });
});

describe("assertExportTargetsApi", () => {
  let exportDir = "";

  const writeBundle = (contents: string): void => {
    const bundleDir = path.join(exportDir, "_expo", "static", "js", "web");
    fs.mkdirSync(bundleDir, {recursive: true});
    fs.writeFileSync(path.join(bundleDir, "entry-abc123.js"), contents);
  };

  beforeEach(() => {
    exportDir = fs.mkdtempSync(path.join(os.tmpdir(), "web-export-test-"));
  });

  afterEach(() => {
    fs.rmSync(exportDir, {force: true, recursive: true});
  });

  it("passes when the bundle targets the API URL", () => {
    writeBundle(`const baseUrl="${API_URL}";`);
    expect(() => assertExportTargetsApi({apiUrl: API_URL, exportDir})).not.toThrow();
  });

  it("rejects a bundle a stale cache built against another port", () => {
    writeBundle('const baseUrl="http://localhost:42857";');
    expect(() => assertExportTargetsApi({apiUrl: API_URL, exportDir})).toThrow(
      /does not contain http:\/\/localhost:51234/
    );
  });

  it("rejects an export with no web bundle", () => {
    expect(() => assertExportTargetsApi({apiUrl: API_URL, exportDir})).toThrow(/no JS bundle/);
  });
});
