const {getDefaultConfig} = require("expo/metro-config");
const path = require("path");
const fs = require("fs");

// Find the project and workspace directories
const projectRoot = __dirname;
// This can be replaced with `find-bun-workspace-root` or similar
const monorepoRoot = path.resolve(projectRoot, "..");

const config = getDefaultConfig(projectRoot);

// Only list the packages within your monorepo that your app uses. No need to add anything else.
// If your monorepo tooling can give you the list of monorepo workspaces linked
// in your app workspace, you can automate this list instead of hardcoding them.
const monorepoPackages = {
  "@terreno/ui": path.resolve(monorepoRoot, "ui"),
};

// 1. Watch the local app folder, and only the shared packages (limiting the scope and speeding it
// up) Note how we change this from `monorepoRoot` to `projectRoot`. This is part of the
// optimization!
config.watchFolders = [projectRoot, ...Object.values(monorepoPackages), monorepoRoot];

// Resolve symlinks to get actual paths for shared dependencies
// This ensures Metro treats all imports as the same module regardless of where they're imported from
const resolveSymlink = (modulePath) => {
  try {
    return fs.realpathSync(modulePath);
  } catch {
    return modulePath;
  }
};

// Ensure all packages use the same React instance to avoid "Invalid hook call" errors
// Use realpath to resolve through symlinks to the actual .bun cache location
const sharedDependencies = {
  react: resolveSymlink(path.resolve(projectRoot, "node_modules/react")),
  "react-dom": resolveSymlink(path.resolve(projectRoot, "node_modules/react-dom")),
  "react-native": resolveSymlink(path.resolve(projectRoot, "node_modules/react-native")),
  "react-native-web": resolveSymlink(path.resolve(projectRoot, "node_modules/react-native-web")),
};

// Add the monorepo workspaces as `extraNodeModules` to Metro.
// If your monorepo tooling creates workspace symlinks in the `node_modules` folder,
// you can either add symlink support to Metro or set the `extraNodeModules` to avoid the symlinks.
// See: https://metrobundler.dev/docs/configuration/#extranodemodules
config.resolver.extraNodeModules = {
  ...sharedDependencies,
  ...monorepoPackages,
};

// 2. Let Metro know where to resolve packages and in what order
// Include both bun's hoisted node_modules and local node_modules
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];

// Symlinks: default in SDK 56+; monorepo resolution uses extraNodeModules + realpath above.
// Force React-related imports to resolve to a single canonical path
// This prevents the "Invalid hook call" error caused by duplicate React instances
const reactPackages = ["react", "react-dom", "react-native", "react-native-web"];
const jspdfNativeStub = path.resolve(__dirname, "jspdf-native-stub.js");

config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Bundle @terreno/ui from source so demo picks up UI changes without a separate compile step.
  if (moduleName === "@terreno/ui") {
    return {
      type: "sourceFile",
      filePath: path.resolve(monorepoRoot, "ui/src/index.tsx"),
    };
  }

  // jspdf uses browser/node APIs (latin1 encoding, Buffer) unavailable in Hermes —
  // stub it on native, force ESM build on web (CJS entry uses AMD require() Metro can't parse).
  if (moduleName === "jspdf") {
    if (platform !== "web") {
      return {type: "sourceFile", filePath: jspdfNativeStub};
    }
    try {
      const uiDir = path.resolve(monorepoRoot, "ui");
      const jspdfDir = path.dirname(require.resolve("jspdf/package.json", {paths: [projectRoot, uiDir, monorepoRoot]}));
      return {
        type: "sourceFile",
        filePath: path.join(jspdfDir, "dist", "jspdf.es.min.js"),
      };
    } catch {
      // jspdf not resolvable — let Metro handle it
    }
  }

  // Check if this is a React-related import
  const packageName = reactPackages.find(
    (pkg) => moduleName === pkg || moduleName.startsWith(pkg + "/")
  );

  if (packageName && sharedDependencies[packageName]) {
    // Redirect to the canonical path
    const newContext = {
      ...context,
      originModulePath: path.resolve(projectRoot, "index.js"),
    };
    return context.resolveRequest(newContext, moduleName, platform);
  }

  return context.resolveRequest(context, moduleName, platform);
};

// Metro's HMR server crashes when jsc-safe-url receives a root-path URL with query params
// (e.g. "http://localhost:8085/?platform=web"). The web HMR client falls back to location.href
// when document.currentScript is unavailable, producing this invalid entry point URL.
// Rewrite root-path URLs to the actual entry file path (relative to the monorepo/server root).
const pkgMain = require(path.resolve(projectRoot, "package.json")).main;
const entryModuleName = path.relative(
  monorepoRoot,
  require.resolve(pkgMain.startsWith(".") ? pkgMain : `./${pkgMain}`, {paths: [projectRoot]})
);
const existingRewrite = config.server?.rewriteRequestUrl;
config.server.rewriteRequestUrl = (url) => {
  if (existingRewrite) {
    url = existingRewrite(url);
  }
  try {
    const parsed = new URL(url);
    if ((parsed.pathname === "/" || parsed.pathname === "") && parsed.search) {
      parsed.pathname = `/${entryModuleName.replace(/\.[^/.]+$/, "")}.bundle`;
      return parsed.toString();
    }
  } catch {}
  return url;
};

// CI containers report the host's CPU count, so Metro would start far more transform workers than
// the executor has cores and cold exports run out of memory. Cap the pool at the executor's size.
if (process.env.CI) {
  config.maxWorkers = 4;
}

module.exports = config;
