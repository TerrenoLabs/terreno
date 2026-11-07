import {describe, expect, it} from "bun:test";
import fs from "node:fs";
import path from "node:path";

/**
 * Route files and the server modules their loaders import are bundled by Metro, which resolves
 * backend-only packages to empty modules (`backendOnlyModules` in admin-spa/metro.config.js). An
 * import from one of them is `undefined` in the exported server build, so a loader that calls,
 * say, `logger.warn` from `@terreno/api` crashes there while unit tests (which resolve the real
 * package) pass. Loaders log with `console`, the frontend convention.
 */
const ROOT = path.resolve(import.meta.dir, "../..");
const BUNDLED_DIRS = ["app", "server", "components"];
const BACKEND_ONLY = /from\s+["']@terreno\/api["']/;

const sourceFiles = (dir: string): string[] => {
  const entries = fs.readdirSync(dir, {withFileTypes: true});
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(full);
    }
    const isSource = /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name);
    return isSource ? [full] : [];
  });
};

describe("bundled admin SPA modules", () => {
  const files = BUNDLED_DIRS.flatMap((dir) => sourceFiles(path.join(ROOT, dir)));

  it("finds the bundled route and server modules", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files.map((file) => [path.relative(ROOT, file), file]))(
    "%s imports nothing from @terreno/api (stubbed to an empty module in the bundle)",
    (_name, file) => {
      expect(BACKEND_ONLY.test(fs.readFileSync(file as string, "utf8"))).toBe(false);
    }
  );
});
