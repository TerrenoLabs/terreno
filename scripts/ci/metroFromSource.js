/**
 * Metro resolution for CI web exports.
 *
 * Package `exports` point at `dist/`, so an Expo export normally waits on
 * `bun run compile`. With `TERRENO_METRO_FROM_SOURCE=1`, map those dist targets
 * onto the matching `src` file and bundle TypeScript directly. Compile can then
 * run beside the export: the export reads `src`, compile writes `dist`.
 */
const fs = require("node:fs");
const path = require("node:path");

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];

const packageDir = ({monorepoRoot, packageName}) => {
  const slug = packageName === "@terreno/mcp" ? "mcp-server" : packageName.replace("@terreno/", "");
  return path.join(monorepoRoot, slug);
};

const defaultTarget = (entry) => {
  if (typeof entry === "string") {
    return entry;
  }
  if (entry && typeof entry.default === "string") {
    return entry.default;
  }
  return null;
};

const exportTarget = ({exportsField, key}) => {
  if (!exportsField) {
    return null;
  }
  if (typeof exportsField === "string") {
    return key === "." ? exportsField : null;
  }
  if (exportsField[key]) {
    return defaultTarget(exportsField[key]);
  }
  const pattern = exportsField["./*"];
  if (key.startsWith("./") && pattern) {
    const star = defaultTarget(pattern);
    if (typeof star === "string") {
      return star.replace("*", key.slice(2));
    }
  }
  return null;
};

const sourceFileForDistTarget = ({packageRoot, target}) => {
  const normalized = target.replace(/^\.\//, "");
  if (!normalized.includes("dist/")) {
    return null;
  }
  const withoutExtension = normalized
    .replace("/dist/", "/src/")
    .replace(/^dist\//, "src/")
    .replace(/\.js$/, "");
  for (const extension of SOURCE_EXTENSIONS) {
    const candidate = path.join(packageRoot, `${withoutExtension}${extension}`);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
};

/**
 * Absolute `src` file for a `@terreno/*` import, or null to keep Metro's resolver.
 * Null when the flag is off, the package is not in this repo, or the export does
 * not point at `dist`.
 */
const resolveMetroFromSource = ({moduleName, monorepoRoot}) => {
  if (process.env.TERRENO_METRO_FROM_SOURCE !== "1") {
    return null;
  }
  const match = moduleName.match(/^(@terreno\/[^/]+)(?:\/(.*))?$/);
  if (!match) {
    return null;
  }
  const packageName = match[1];
  const subpath = match[2];
  const packageRoot = packageDir({monorepoRoot, packageName});
  const manifestPath = path.join(packageRoot, "package.json");
  if (!fs.existsSync(manifestPath)) {
    return null;
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const key = subpath ? `./${subpath}` : ".";
  const target =
    exportTarget({exportsField: manifest.exports, key}) ?? (key === "." ? manifest.main : null);
  if (!target) {
    return null;
  }
  return sourceFileForDistTarget({packageRoot, target});
};

/** Cap Metro's transform pool. CI containers report the host's CPU count. */
const applyCiMetroWorkerCap = (config) => {
  if (!process.env.CI) {
    return;
  }
  const raw = process.env.TERRENO_METRO_MAX_WORKERS ?? "4";
  const cap = Number(raw);
  config.maxWorkers = Number.isInteger(cap) && cap > 0 ? cap : 4;
};

module.exports = {applyCiMetroWorkerCap, resolveMetroFromSource};
