/**
 * Copies each Terreno package's `.ai/**` tree into `mcp-server/src/docs/guidelines/<package>/`
 * so the hosted MCP server can bundle them for `terreno_bootstrap_ai_rules`.
 */
import {cpSync, existsSync, mkdirSync, rmSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const mcpServerRoot = join(__dirname, "..");
const repoRoot = join(mcpServerRoot, "..");

const PACKAGES_WITH_AI = [
  "api",
  "ui",
  "syncdb",
  "admin-backend",
  "admin-frontend",
] as const;

const destRoot = join(mcpServerRoot, "src", "docs", "guidelines");

const main = (): void => {
  mkdirSync(destRoot, {recursive: true});

  for (const pkg of PACKAGES_WITH_AI) {
    const srcAi = join(repoRoot, pkg, ".ai");
    const destPkg = join(destRoot, pkg);
    rmSync(destPkg, {force: true, recursive: true});

    if (!existsSync(srcAi)) {
      continue;
    }

    mkdirSync(dirname(destPkg), {recursive: true});
    cpSync(srcAi, destPkg, {recursive: true});
  }

  console.info("sync-package-guidelines: synced .ai trees into src/docs/guidelines/");
};

main();
