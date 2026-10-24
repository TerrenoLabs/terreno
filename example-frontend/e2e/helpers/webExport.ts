import fs from "node:fs";
import {createServer} from "node:net";
import path from "node:path";

/**
 * The API port the smoke's web export is built against. The export bakes its API URL in, so a
 * fixed port lets one export (built once, outside the smoke's time budget) serve every run.
 */
export const SMOKE_API_PORT = 4310;

export interface SmokeExportPaths {
  apiUrl: string;
  /** Metro's cache for the smoke export. Only this export writes it, so it stays warm and right. */
  cacheDir: string;
  exportDir: string;
}

/** Where `export:smoke` writes the smoke's web export, and the API URL baked into it. */
export const smokeExportPaths = ({packageDir}: {packageDir: string}): SmokeExportPaths => ({
  apiUrl: `http://localhost:${SMOKE_API_PORT}`,
  cacheDir: path.join(packageDir, ".expo", "smoke-metro-cache"),
  exportDir: path.join(packageDir, "dist-smoke"),
});

/**
 * Throws if anything listens on `port`, so the smoke never mistakes a stale backend's `/health`
 * for the one it started.
 */
export const assertPortFree = async (port: number): Promise<void> => {
  const server = createServer();
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => resolve());
    });
  } catch (error: unknown) {
    throw new Error(
      `Port ${port} is in use, and the smoke's web export calls the API there. Stop the process on it and rerun. (${error instanceof Error ? error.message : String(error)})`
    );
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
};

/**
 * Environment for an `expo export` that bakes `apiUrl` in. Metro keeps its transform cache under
 * `os.tmpdir()`, and its cache key ignores `EXPO_PUBLIC_*` values, so a shared warm cache can
 * ship another build's API URL. Pointing `TMPDIR` at `cacheDir` gives the export a cache of its
 * own.
 */
export const webExportEnv = ({
  apiUrl,
  cacheDir,
}: {
  apiUrl: string;
  cacheDir: string;
}): Record<string, string> => ({
  CI: "true",
  EXPO_NO_TELEMETRY: "1",
  EXPO_PUBLIC_API_URL: apiUrl,
  NODE_OPTIONS: process.env.NODE_OPTIONS ?? "--max-old-space-size=3072",
  TMPDIR: cacheDir,
});

/**
 * Throws unless the export's web bundle contains `apiUrl`, so a bundle built against another API
 * fails here instead of as a sign-in timeout in the browser.
 */
export const assertExportTargetsApi = ({
  apiUrl,
  exportDir,
}: {
  apiUrl: string;
  exportDir: string;
}): void => {
  const bundleDir = path.join(exportDir, "_expo", "static", "js", "web");
  const bundles = fs.existsSync(bundleDir)
    ? fs.readdirSync(bundleDir).filter((file) => file.endsWith(".js"))
    : [];
  if (bundles.length === 0) {
    throw new Error(
      `The web export has no JS bundle in ${bundleDir}. Build it with \`bun run --cwd example-frontend export:smoke\`.`
    );
  }
  const isTargeted = bundles.some((file) =>
    fs.readFileSync(path.join(bundleDir, file), "utf8").includes(apiUrl)
  );
  if (!isTargeted) {
    throw new Error(
      `The web export does not contain ${apiUrl}, so it would call another API. Rebuild it with \`bun run --cwd example-frontend export:smoke\`.`
    );
  }
};
