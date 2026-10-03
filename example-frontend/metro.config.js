const {getDefaultConfig} = require("expo/metro-config");
const path = require("path");
const fs = require("fs");

// Find the project and monorepo workspace directories
const projectRoot = __dirname;
// This can be replaced with `find-bun-workspace-root` or similar
const monorepoRoot = path.resolve(projectRoot, "..");

const config = getDefaultConfig(projectRoot);

// Expo Router treats every file under app/ as a route. Colocated bun tests live
// next to those screens for the new-file coverage gate, and must stay out of the bundle.
config.resolver.blockList = [
  ...(config.resolver.blockList ?? []),
  /[/\\]app[/\\].*\.(?:test|spec)\.[jt]sx?$/,
];

// Only list the packages within your monorepo that your app uses. No need to add anything else.
// If your monorepo tooling can give you the list of monorepo workspaces linked
// in your app workspace, you can automate this list instead of hardcoding them.
const monorepoPackages = {
  "@terreno/ui": path.resolve(monorepoRoot, "ui"),
  "@terreno/admin-frontend": path.resolve(monorepoRoot, "admin-frontend"),
  "@terreno/rtk": path.resolve(monorepoRoot, "rtk"),
  "@terreno/syncdb": path.resolve(monorepoRoot, "syncdb"),
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

const resolveDep = (packageName) =>
  resolveSymlink(
    require.resolve(`${packageName}/package.json`, {paths: [projectRoot, monorepoRoot]})
      .replace(/\/package\.json$/, "")
  );

// Ensure all packages use the same React instance to avoid "Invalid hook call" errors
// Use realpath to resolve through bun's hoisted node_modules (or leftover per-package installs)
const sharedDependencies = {
  react: resolveDep("react"),
  "react-dom": resolveDep("react-dom"),
  "react-native": resolveDep("react-native"),
  "react-native-web": resolveDep("react-native-web"),
};

const expoRouterEntryPath = resolveSymlink(require.resolve("expo-router/entry"));
const expoRouterEntryPathFromMonorepo = path.relative(monorepoRoot, expoRouterEntryPath);
const expoRouterEntryBundlePath = expoRouterEntryPathFromMonorepo
  .replace(/\\/g, "/")
  .replace(/\.js$/, ".bundle");

// Add the monorepo workspaces as `extraNodeModules` to Metro.
// If your monorepo tooling creates workspace symlinks in the `node_modules` folder,
// you can either add symlink support to Metro or set the `extraNodeModules` to avoid the symlinks.
// See: https://metrobundler.dev/docs/configuration/#extranodemodules
config.resolver.extraNodeModules = {
  ...sharedDependencies,
  ...monorepoPackages,
  // extraNodeModules maps `@terreno/syncdb` to the package root, which makes
  // `@terreno/syncdb/react` look for `syncdb/react` and skip package.json exports.
  "@terreno/syncdb/react": path.resolve(monorepoRoot, "syncdb/src/react/index.ts"),
  "@terreno/syncdb/testing": path.resolve(monorepoRoot, "syncdb/src/testing/index.ts"),
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

// Fix HMR resolution bug: when origin is monorepo root (terreno/.), relative imports like
// ./login, ./profile, or ./[model] fail because they resolve from the wrong directory.
// Dynamically discover all _layout.tsx files so this works at any nesting depth.
const isOriginMonorepoRoot = (originPath) => {
  const normalized = path.normalize(originPath);
  return normalized === monorepoRoot || normalized === path.join(monorepoRoot, ".");
};

const findLayoutFiles = (dir) => {
  const results = [];
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findLayoutFiles(fullPath));
    } else if (entry.name === "_layout.tsx") {
      results.push(fullPath);
    }
  }
  return results;
};

const appLayoutFiles = findLayoutFiles(path.resolve(projectRoot, "app"));

// Backend-only modules that should not be bundled in web/native builds.
// @terreno/api pulls in @wesleytodd/openapi -> merge-deep -> clone-deep@0.2.4
// which uses lazy-cache syntax that Metro cannot parse.
const backendOnlyModules = [
  "@terreno/api",
  "express",
  "@wesleytodd/openapi",
  "expo-notifications",
];

const jspdfNativeStub = path.resolve(__dirname, "jspdf-native-stub.js");

config.resolver.resolveRequest = (context, moduleName, platform) => {
  // jspdf uses browser/node APIs (latin1 encoding, Buffer) unavailable in Hermes —
  // stub it on native, force ESM build on web (CJS entry uses AMD require() Metro can't parse).
  if (moduleName === "jspdf") {
    if (platform !== "web") {
      return {type: "sourceFile", filePath: jspdfNativeStub};
    }
    try {
      const uiDir = path.resolve(monorepoRoot, "ui");
      const adminFrontendDir = path.resolve(monorepoRoot, "admin-frontend");
      const jspdfDir = path.dirname(require.resolve("jspdf/package.json", {paths: [projectRoot, uiDir, adminFrontendDir, monorepoRoot]}));
      return {
        type: "sourceFile",
        filePath: path.join(jspdfDir, "dist", "jspdf.es.min.js"),
      };
    } catch {
      // jspdf not resolvable — let Metro handle it
    }
  }

  // @sentry/react-native uses TurboModuleRegistry.getEnforcing which hangs in Expo Go
  // without a custom dev build. Exclude it so only @sentry/react (browser-only) is used.
  if (moduleName === "@sentry/react-native" || moduleName.startsWith("@sentry/react-native/")) {
    return {
      type: "empty",
    };
  }

  // Exclude backend-only modules from frontend builds
  if (
    backendOnlyModules.some(
      (mod) => moduleName === mod || moduleName.startsWith(mod + "/")
    )
  ) {
    return {type: "empty"};
  }

  // Fix relative imports when HMR incorrectly uses monorepo root as origin.
  // 1. Try each app layout as origin (handles static routes like ./login, ./profile)
  // 2. Try default resolution (handles real monorepo imports like ./example-frontend/index)
  // 3. Resolve to app entry point (handles dynamic route URLs like ./admin/User that
  //    don't map to real files — the [model] segment makes them unresolvable as imports)
  if (moduleName.startsWith("./") && isOriginMonorepoRoot(context.originModulePath)) {
    for (const layoutPath of appLayoutFiles) {
      try {
        return context.resolveRequest(
          {...context, originModulePath: layoutPath},
          moduleName,
          platform,
        );
      } catch {
        // This layout doesn't contain the route, try the next one
      }
    }
    try {
      return context.resolveRequest(context, moduleName, platform);
    } catch {
      const entryPoint = `./${path.relative(monorepoRoot, path.resolve(projectRoot, "index.js"))}`;
      return context.resolveRequest(context, entryPoint, platform);
    }
  }

  // Check if this is a React-related import
  const packageName = reactPackages.find(
    (pkg) => moduleName === pkg || moduleName.startsWith(pkg + "/")
  );

  if (packageName && sharedDependencies[packageName]) {
    const newContext = {
      ...context,
      originModulePath: path.resolve(projectRoot, "index.js"),
    };
    return context.resolveRequest(newContext, moduleName, platform);
  }

  return context.resolveRequest(context, moduleName, platform);
};

const previousRewriteRequestUrl = config.server?.rewriteRequestUrl;
config.server = config.server || {};
config.server.rewriteRequestUrl = (requestUrl) => {
  const rewrittenUrl = previousRewriteRequestUrl ? previousRewriteRequestUrl(requestUrl) : requestUrl;

  // Guard against malformed HMR registration URL: `/?platform=web`.
  if (/^https?:\/\/[^/]+\/\?platform=web(?:&|$)/.test(rewrittenUrl)) {
    return rewrittenUrl.replace(
      /\/\?platform=web/,
      `/${expoRouterEntryBundlePath}?platform=web`
    );
  }

  return rewrittenUrl;
};

module.exports = config;
