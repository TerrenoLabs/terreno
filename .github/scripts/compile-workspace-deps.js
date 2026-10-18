/**
 * Recursively compiles @terreno/* monorepo dependencies for the current package.
 *
 * During tag publish, workspace:* refs are replaced with semver before install.
 * Dependencies must still be compiled from sibling packages in this checkout
 * (npm installs do not include TypeScript sources for compile).
 *
 * Usage (from a package directory):
 *   node ../.github/scripts/compile-workspace-deps.js
 *
 * Optional extra package directories (absolute or relative to this script's cwd)
 * compile each package's @terreno/* deps in one process so a shared `compiled`
 * set skips duplicate `tsc` work. Packages with `tsconfig.server.json`
 * (admin-spa) compile that config so the published `src/dist` entry exists:
 *   node compile-workspace-deps.js /path/to/api /path/to/rtk
 */
const fs = require("fs");
const path = require("path");
const {execSync} = require("child_process");

const DEP_TYPES = ["dependencies", "devDependencies", "peerDependencies"];
const compiled = new Set();

const isTerrenoMonorepoDep = (name) =>
  name.startsWith("@terreno/") || name === "create-terreno-app";

const PACKAGE_DIR_ALIASES = {
  "@terreno/mcp": "mcp-server",
};

const resolveMonorepoPackageDir = (fromDir, packageName) => {
  const slug = PACKAGE_DIR_ALIASES[packageName] ?? packageName.replace("@terreno/", "");
  const relative = path.join(fromDir, "..", slug);
  const resolved = path.resolve(relative);
  const pkgPath = path.join(resolved, "package.json");
  if (!fs.existsSync(pkgPath)) {
    return null;
  }
  return resolved;
};

const compileCommandForDir = (dir) => {
  const resolved = path.resolve(dir);
  if (fs.existsSync(path.join(resolved, "tsconfig.server.json"))) {
    return "bun tsc -p tsconfig.server.json";
  }
  return "bun tsc";
};

const compile = (dir) => {
  const resolved = path.resolve(dir);
  if (compiled.has(resolved)) {
    return;
  }
  compiled.add(resolved);

  const pkgPath = path.join(resolved, "package.json");
  const depPkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

  for (const t of DEP_TYPES) {
    for (const [name] of Object.entries(depPkg[t] || {})) {
      if (!isTerrenoMonorepoDep(name)) {
        continue;
      }
      const depDir = resolveMonorepoPackageDir(resolved, name);
      if (depDir) {
        compile(depDir);
      }
    }
  }

  const compileCmd = compileCommandForDir(resolved);
  console.log(`Compiling ${depPkg.name} (${resolved}) with ${compileCmd}`);
  execSync(compileCmd, {cwd: resolved, stdio: "inherit"});
  if (depPkg.name === "@terreno/mcp") {
    fs.cpSync(path.join(resolved, "src", "docs"), path.join(resolved, "dist", "docs"), {
      recursive: true,
    });
  }
};

const run = () => {
  // The monorepo `bun run compile` uses `bun run --filter '*' compile`, which builds
  // packages in workspace-dependency order, so each @terreno/* dep's dist already exists
  // before its dependents compile. In that context recompiling deps here is redundant
  // duplicate work, so the root compile sets TERRENO_SKIP_WORKSPACE_DEPS=1 to skip it.
  // Isolated per-package compiles (CI per-package jobs, tag publish) do not set the flag,
  // so the script still builds sibling dists from source for them.
  if (process.env.TERRENO_SKIP_WORKSPACE_DEPS) {
    console.log("TERRENO_SKIP_WORKSPACE_DEPS set — skipping workspace dep compile");
    return;
  }

  const packageDirs =
    process.argv.slice(2).length > 0
      ? process.argv.slice(2).map((dir) => path.resolve(dir))
      : [process.cwd()];

  for (const packageDir of packageDirs) {
    const pkgPath = path.join(packageDir, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    for (const t of DEP_TYPES) {
      for (const [name] of Object.entries(pkg[t] || {})) {
        if (!isTerrenoMonorepoDep(name)) {
          continue;
        }
        const depDir = resolveMonorepoPackageDir(packageDir, name);
        if (depDir) {
          compile(depDir);
        }
      }
    }
  }

  if (compiled.size === 0) {
    console.log("No @terreno monorepo dependencies to compile");
  } else {
    console.log(`Compiled ${compiled.size} @terreno monorepo dependency(ies)`);
  }
};

if (require.main === module) {
  run();
}

module.exports = {compileCommandForDir};
