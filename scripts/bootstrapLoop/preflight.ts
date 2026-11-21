import {existsSync, readFileSync, writeFileSync} from "node:fs";
import {join} from "node:path";

const STAMP = "node_modules/.bootstrap-loop-head";

interface PreflightOptions {
  repoRoot: string;
  version: string;
  readHead?: (repoRoot: string) => string;
  refresh?: (repoRoot: string) => number;
}

const gitHead = (repoRoot: string): string => {
  const result = Bun.spawnSync({cmd: ["git", "rev-parse", "HEAD"], cwd: repoRoot});
  return result.stdout.toString().trim();
};

const bootstrapUpdate = (repoRoot: string): number =>
  Bun.spawnSync({
    cmd: ["bun", "run", "bootstrap:update"],
    cwd: repoRoot,
    stderr: "inherit",
    stdout: "inherit",
  }).exitCode;

/**
 * A `local` run builds from this checkout, so installed packages and compiled workspace dist
 * must match the checked-out commit. Switching branches leaves them stale (typecheck fails on
 * mismatched `ai` types, the app crashes on old dist). Reinstall and recompile once per HEAD.
 * Published versions use `create-terreno-app` and need no refresh.
 * Returns an error message, or undefined when the checkout is ready.
 */
export const ensureFreshInstall = ({
  readHead = gitHead,
  refresh = bootstrapUpdate,
  repoRoot,
  version,
}: PreflightOptions): string | undefined => {
  if (version !== "local") {
    return undefined;
  }
  const head = readHead(repoRoot);
  const stampPath = join(repoRoot, STAMP);
  if (head && existsSync(stampPath) && readFileSync(stampPath, "utf8").trim() === head) {
    return undefined;
  }
  console.info(`Preflight: refreshing install for ${head || "unknown HEAD"} (bootstrap:update)`);
  const exitCode = refresh(repoRoot);
  if (exitCode !== 0) {
    return `bun run bootstrap:update failed with exit code ${exitCode}`;
  }
  if (head) {
    writeFileSync(stampPath, `${head}\n`);
  }
  return undefined;
};
