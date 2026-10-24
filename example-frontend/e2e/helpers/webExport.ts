import fs from "node:fs";
import path from "node:path";

/**
 * Environment for an `expo export` that bakes `apiUrl` in. Metro keeps its transform cache under
 * `os.tmpdir()`, and its cache key ignores `EXPO_PUBLIC_*` values, so a shared warm cache can
 * ship an earlier run's API URL. Pointing `TMPDIR` at a per-run directory gives the export a cache
 * of its own.
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
    throw new Error(`The web export has no JS bundle in ${bundleDir}.`);
  }
  const isTargeted = bundles.some((file) =>
    fs.readFileSync(path.join(bundleDir, file), "utf8").includes(apiUrl)
  );
  if (!isTargeted) {
    throw new Error(
      `The web export does not contain ${apiUrl}, so it would call another API. A stale Metro cache is the usual cause.`
    );
  }
};
