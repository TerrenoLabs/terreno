import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import fs from "node:fs";
import {createServer, type Server} from "node:net";
import os from "node:os";
import path from "node:path";
import {
  assertExportTargetsApi,
  assertPortFree,
  SMOKE_API_PORT,
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
  it("bakes a fixed localhost API port into an export kept in the package", () => {
    const paths = smokeExportPaths({packageDir: "/repo/example-frontend"});
    expect(paths.apiUrl).toBe(`http://localhost:${SMOKE_API_PORT}`);
    expect(paths.exportDir).toBe("/repo/example-frontend/dist-smoke");
    expect(paths.cacheDir).toBe("/repo/example-frontend/.expo/smoke-metro-cache");
  });
});

describe("assertPortFree", () => {
  let server: Server | undefined;

  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = undefined;
  });

  it("resolves for a port nothing listens on", async () => {
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", () => resolve()));
    const {port} = probe.address() as {port: number};
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    await expect(assertPortFree(port)).resolves.toBeUndefined();
  });

  it("rejects a port another server holds, so the smoke never talks to a stale backend", async () => {
    server = createServer();
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", () => resolve()));
    const {port} = server.address() as {port: number};
    await expect(assertPortFree(port)).rejects.toThrow(`Port ${port} is in use`);
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
