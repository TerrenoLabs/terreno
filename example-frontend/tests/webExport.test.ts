import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assertExportTargetsApi,
  rewriteApiUrl,
  SMOKE_PLACEHOLDER_API_URL,
  smokeExportPaths,
  webExportEnv,
} from "../e2e/helpers/webExport";

const API_URL = "http://localhost:51234";

describe("webExportEnv", () => {
  it("bakes the API URL in and gives Metro a per-run cache dir", () => {
    const env = webExportEnv({apiUrl: API_URL, cacheDir: "/scratch/run-1"});
    expect(env.EXPO_PUBLIC_API_URL).toBe(API_URL);
    expect(env.TMPDIR).toBe("/scratch/run-1");
  });
});

describe("smokeExportPaths", () => {
  it("bakes the placeholder API URL into an export kept in the package", () => {
    const paths = smokeExportPaths({packageDir: "/repo/example-frontend"});
    expect(paths.apiUrl).toBe(SMOKE_PLACEHOLDER_API_URL);
    expect(paths.exportDir).toBe("/repo/example-frontend/dist-smoke");
    expect(paths.cacheDir).toBe("/repo/example-frontend/.expo/smoke-metro-cache");
  });
});

describe("rewriteApiUrl", () => {
  const bundle = `const c={envApiUrl:"${SMOKE_PLACEHOLDER_API_URL}"};fetch("${SMOKE_PLACEHOLDER_API_URL}/health");`;

  it("points every placeholder in a JS bundle at the real API", () => {
    const body = rewriteApiUrl({apiUrl: API_URL, body: bundle, filePath: "/x/index-abc.js"});
    expect(body).not.toContain(SMOKE_PLACEHOLDER_API_URL);
    expect(body.split(API_URL)).toHaveLength(3);
  });

  it("rewrites HTML pages too", () => {
    const html = `<script>window.api="${SMOKE_PLACEHOLDER_API_URL}"</script>`;
    expect(rewriteApiUrl({apiUrl: API_URL, body: html, filePath: "/x/index.html"})).toContain(
      API_URL
    );
  });

  it("leaves other files untouched", () => {
    expect(rewriteApiUrl({apiUrl: API_URL, body: bundle, filePath: "/x/app.css"})).toBe(bundle);
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
    expect(() => assertExportTargetsApi({apiUrl: API_URL, exportDir})).toThrow(
      /no JS bundle.*bun run --cwd example-frontend export:smoke/s
    );
  });
});
