/** @type {import("dependency-cruiser").IConfiguration} */
const generatedPath = "(^|/)(?:build|coverage|dist|dist-smoke|node_modules)(/|$)";

module.exports = {
  forbidden: [
    {
      comment: "Circular imports make initialization order fragile.",
      from: {pathNot: generatedPath},
      name: "no-circular",
      severity: "error",
      to: {circular: true, pathNot: generatedPath},
    },
    {
      comment: "Orphan modules should be modeled as entry points or removed.",
      from: {
        orphan: true,
        pathNot: [
          "(^|/)[.][^/]+[.](?:js|cjs|mjs|ts|cts|mts|json)$",
          "[.]d[.]ts$",
          "(^|/)tsconfig[.]json$",
          "(^|/)(?:babel|metro|playwright|webpack)[.]config[.](?:js|cjs|mjs|ts|cts|mts|json)$",
          "[.](?:spec|test|isolated)[.](?:js|jsx|mjs|cjs|ts|tsx|mts|cts)$",
          generatedPath,
        ],
      },
      name: "no-orphans",
      severity: "warn",
      to: {},
    },
    {
      comment: "Production modules must not import test modules.",
      from: {
        pathNot: [
          "[.](?:spec|test|isolated)[.](?:js|jsx|mjs|cjs|ts|tsx|mts|cts)$",
          generatedPath,
        ],
      },
      name: "not-to-tests",
      severity: "error",
      to: {
        path: "[.](?:spec|test|isolated)[.](?:js|jsx|mjs|cjs|ts|tsx|mts|cts)$",
      },
    },
  ],
  options: {
    combinedDependencies: true,
    doNotFollow: {path: ["node_modules"]},
    // Rule-level `pathNot` filters violations but still parses the file. Bundled web
    // builds under dist/ blow dependency-cruiser's call stack, so keep generated output
    // out of the graph entirely — otherwise a local `expo export` breaks analyze:full.
    exclude: {path: generatedPath},
    enhancedResolveOptions: {
      conditionNames: ["import", "require", "react-native", "browser", "node", "default", "types"],
      exportsFields: ["exports"],
      extensions: [".ts", ".tsx", ".js", ".jsx", ".d.ts", ".mjs", ".cjs"],
      mainFields: ["react-native", "browser", "module", "main", "types", "typings"],
    },
    moduleSystems: ["cjs", "es6"],
    skipAnalysisNotInRules: true,
  },
};
