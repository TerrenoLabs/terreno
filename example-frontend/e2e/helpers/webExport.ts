import fs from "node:fs";
import path from "node:path";

/**
 * The placeholder API URL baked into the smoke's web export. The export is built once, outside
 * the smoke's time budget, so the smoke swaps this for its real API URL as it serves the bundle.
 * The `.invalid` host never resolves, so an unswapped bundle fails instead of reaching a stale
 * backend.
 */
export const SMOKE_PLACEHOLDER_API_URL = "http://smoke-api.invalid";

export interface SmokeExportPaths {
  apiUrl: string;
  /** Metro's cache for the smoke export. Only this export writes it, so it stays warm and right. */
  cacheDir: string;
  exportDir: string;
}

/** Where `export:smoke` writes the smoke's web export, and the placeholder API URL baked into it. */
export const smokeExportPaths = ({packageDir}: {packageDir: string}): SmokeExportPaths => ({
  apiUrl: SMOKE_PLACEHOLDER_API_URL,
  cacheDir: path.join(packageDir, ".expo", "smoke-metro-cache"),
  exportDir: path.join(packageDir, "dist-smoke"),
});

/**
 * Points an exported file at the smoke's real API. Only JS and HTML carry the baked URL; other
 * files pass through untouched.
 */
export const rewriteApiUrl = ({
  apiUrl,
  body,
  filePath,
}: {
  apiUrl: string;
  body: string;
  filePath: string;
}): string => {
  if (!/\.(html|js)$/.test(filePath)) {
    return body;
  }
  return body.replaceAll(SMOKE_PLACEHOLDER_API_URL, apiUrl);
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
