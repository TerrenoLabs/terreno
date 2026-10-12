import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

import {runVercelBuild, withVercelManifest} from "./vercelBuild";

const appJson = {
  expo: {
    extra: {apiBaseUrl: "http://localhost:4000", authProvider: "better-auth", BASE_URL: "x"},
    name: "frontend",
  },
};

describe("withVercelManifest", (): void => {
  it("sets the manifest URL keys and websocket-only sockets, keeping the rest", (): void => {
    const result = withVercelManifest({apiUrl: "https://terreno-backend.vercel.app", appJson});
    expect(result.expo.extra).toEqual({
      apiBaseUrl: "https://terreno-backend.vercel.app",
      authProvider: "better-auth",
      BASE_URL: "https://terreno-backend.vercel.app",
      SOCKET_TRANSPORTS: "websocket",
    });
    expect(result.expo.name).toBe("frontend");
  });

  it("normalizes a URL with a path or trailing slash to its origin", (): void => {
    const result = withVercelManifest({apiUrl: "https://api.example.com/", appJson});
    expect(result.expo.extra?.BASE_URL).toBe("https://api.example.com");
  });

  it("rejects plain http for a deployed backend", (): void => {
    expect(() => withVercelManifest({apiUrl: "http://api.example.com", appJson})).toThrow(
      "must be https"
    );
  });

  it("rejects a value that is not a URL", (): void => {
    expect(() => withVercelManifest({apiUrl: "terreno-backend.vercel.app", appJson})).toThrow();
  });
});

describe("runVercelBuild", (): void => {
  let dir: string;
  let appJsonPath: string;

  beforeEach((): void => {
    dir = mkdtempSync(join(tmpdir(), "vercel-build-"));
    appJsonPath = join(dir, "app.json");
    writeFileSync(appJsonPath, JSON.stringify(appJson));
  });

  afterEach((): void => {
    rmSync(dir, {force: true, recursive: true});
  });

  it("fails without exporting when EXPO_PUBLIC_API_URL is missing", (): void => {
    const marker = join(dir, "exported");
    const status = runVercelBuild({
      apiUrl: undefined,
      appJsonPath,
      exportCommand: ["touch", marker],
    });
    expect(status).toBe(1);
    expect(existsSync(marker)).toBe(false);
    expect(JSON.parse(readFileSync(appJsonPath, "utf8"))).toEqual(appJson);
  });

  it("writes the manifest, then runs the export from the app directory", (): void => {
    // The export copies app.json as it sees it, proving the manifest is written first.
    const status = runVercelBuild({
      apiUrl: "https://terrenolabs-backend.vercel.app",
      appJsonPath,
      exportCommand: ["cp", "app.json", "seen-by-export.json"],
    });
    expect(status).toBe(0);
    const seen = JSON.parse(readFileSync(join(dir, "seen-by-export.json"), "utf8"));
    expect(seen.expo.extra).toMatchObject({
      BASE_URL: "https://terrenolabs-backend.vercel.app",
      SOCKET_TRANSPORTS: "websocket",
    });
  });

  it("returns the export's failing status", (): void => {
    expect(
      runVercelBuild({apiUrl: "https://api.example.com", appJsonPath, exportCommand: ["false"]})
    ).toBe(1);
  });
});
