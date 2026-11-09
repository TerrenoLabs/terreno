import {existsSync} from "node:fs";
import {join} from "node:path";

import {resolveTerrenoProjectRoot} from "./projectRoot.js";

/**
 * Terreno bootstrap runs the backend from `backend/`; this monorepo uses
 * `example-backend/`. Some setups may use repo-root `.terreno/` instead.
 */
export const resolveTerrenoLogDirs = (): string[] => {
  const root = resolveTerrenoProjectRoot();
  const dirs = [
    join(root, "backend", ".terreno", "logs"),
    join(root, "example-backend", ".terreno", "logs"),
    join(root, ".terreno", "logs"),
  ];
  return [...new Set(dirs)];
};

export const resolveExistingAppLogPaths = (): string[] => {
  return resolveTerrenoLogDirs()
    .map((d) => join(d, "app.log"))
    .filter((p) => existsSync(p));
};

export const resolveExistingBrowserLogPaths = (): string[] => {
  return resolveTerrenoLogDirs()
    .map((d) => join(d, "browser.log"))
    .filter((p) => existsSync(p));
};
