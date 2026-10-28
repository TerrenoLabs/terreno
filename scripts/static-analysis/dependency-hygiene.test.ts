import {describe, test} from "bun:test";
import {join} from "node:path";
import {assert} from "chai";

const REPO_ROOT = join(import.meta.dir, "../..");

const WORKSPACE_DEPENDENCY_TYPES = ["dependencies", "devDependencies", "peerDependencies"] as const;

interface WorkspaceManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  name?: string;
  peerDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
  workspaces?: string[];
}

const readManifest = async (manifestPath: string): Promise<WorkspaceManifest> =>
  (await Bun.file(join(REPO_ROOT, manifestPath)).json()) as WorkspaceManifest;

const readWorkspaceDependencyGraph = async (): Promise<Map<string, string[]>> => {
  const root = await readManifest("package.json");
  const graph = new Map<string, string[]>();
  for (const workspaceDir of root.workspaces ?? []) {
    const manifest = await readManifest(`${workspaceDir}/package.json`);
    if (!manifest.name) {
      continue;
    }
    const terrenoDependencies = new Set<string>();
    for (const dependencyType of WORKSPACE_DEPENDENCY_TYPES) {
      for (const dependencyName of Object.keys(manifest[dependencyType] ?? {})) {
        if (dependencyName.startsWith("@terreno/")) {
          terrenoDependencies.add(dependencyName);
        }
      }
    }
    graph.set(manifest.name, [...terrenoDependencies]);
  }
  return graph;
};

const findDependencyCycle = (graph: Map<string, string[]>): string[] | null => {
  const visited = new Set<string>();
  const stack: string[] = [];

  const walk = (packageName: string): string[] | null => {
    const cycleStart = stack.indexOf(packageName);
    if (cycleStart !== -1) {
      return [...stack.slice(cycleStart), packageName];
    }
    if (visited.has(packageName)) {
      return null;
    }
    visited.add(packageName);
    stack.push(packageName);
    for (const dependencyName of graph.get(packageName) ?? []) {
      if (!graph.has(dependencyName)) {
        continue;
      }
      const cycle = walk(dependencyName);
      if (cycle) {
        return cycle;
      }
    }
    stack.pop();
    return null;
  };

  for (const packageName of graph.keys()) {
    const cycle = walk(packageName);
    if (cycle) {
      return cycle;
    }
  }
  return null;
};

const UNUSED_DEV_DEPENDENCIES = new Map<string, string[]>([
  ["package.json", ["tsx"]],
  ["api/package.json", ["@types/bcrypt", "@types/cron", "@types/sinon", "sinon"]],
  ["example-backend/package.json", ["@types/lodash", "@types/winston", "mongodb"]],
  ["example-frontend/package.json", ["@types/lodash"]],
  // admin-backend and feature-flags keep passport-local-mongoose: their e2e smokes seed users
  // with it.
  ["ai/package.json", ["winston"]],
  [
    "demo/package.json",
    [
      "@babel/plugin-proposal-export-namespace-from",
      "@shopify/flash-list",
      "postcss",
      "prettier",
      "typedoc",
    ],
  ],
  [
    "ui/package.json",
    [
      "@expo/config-plugins",
      "@happy-dom/global-registrator",
      "@types/minimatch",
      "@types/react-datetime-picker",
      "@types/react-time-picker",
      "babel-preset-react-app",
      "prettier",
      "react-router",
      "react-router-dom",
    ],
  ],
]);

const UNUSED_RUNTIME_DEPENDENCIES = new Map<string, string[]>([
  [
    "example-backend/package.json",
    [
      "@google-cloud/logging",
      "@google-cloud/logging-winston",
      "@opentelemetry/instrumentation-mongoose",
      "lodash",
      "path-to-regexp",
      "qs",
    ],
  ],
  ["api/package.json", ["@sentry/profiling-node", "generaterr", "scmp"]],
  ["example-frontend/package.json", ["lodash"]],
  ["test/package.json", ["lodash"]],
  ["website/package.json", ["clsx"]],
]);

describe("dependency hygiene", (): void => {
  test("does not allow a Knip baseline", async (): Promise<void> => {
    assert.isFalse(
      await Bun.file(join(REPO_ROOT, "scripts/static-analysis/knip-baseline.json")).exists()
    );
    const rootManifest = await readManifest("package.json");
    assert.notProperty(rootManifest.scripts ?? {}, "analyze:baseline");
  });

  test("does not retain unused development dependencies", async (): Promise<void> => {
    for (const [manifestPath, dependencyNames] of UNUSED_DEV_DEPENDENCIES) {
      const manifest = (await Bun.file(join(REPO_ROOT, manifestPath)).json()) as {
        devDependencies?: Record<string, string>;
      };
      for (const dependencyName of dependencyNames) {
        assert.notProperty(
          manifest.devDependencies ?? {},
          dependencyName,
          `${manifestPath}: ${dependencyName}`
        );
      }
    }
  });

  test("does not retain unused runtime dependencies", async (): Promise<void> => {
    for (const [manifestPath, dependencyNames] of UNUSED_RUNTIME_DEPENDENCIES) {
      const manifest = (await Bun.file(join(REPO_ROOT, manifestPath)).json()) as {
        dependencies?: Record<string, string>;
      };
      for (const dependencyName of dependencyNames) {
        assert.notProperty(
          manifest.dependencies ?? {},
          dependencyName,
          `${manifestPath}: ${dependencyName}`
        );
      }
    }
  });

  test("declares @terreno workspace dependencies without a cycle", async (): Promise<void> => {
    const graph = await readWorkspaceDependencyGraph();
    const cycle = findDependencyCycle(graph);
    assert.isNull(
      cycle,
      `compile-workspace-deps.js compiles packages in dependency order, so a cycle breaks it: ${cycle?.join(" -> ")}`
    );
  });

  test("keeps admin SPA e2e-only luxon in devDependencies", async (): Promise<void> => {
    const manifest = (await Bun.file(join(REPO_ROOT, "admin-spa/package.json")).json()) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    assert.notProperty(manifest.dependencies ?? {}, "luxon");
    assert.property(manifest.devDependencies ?? {}, "luxon");
  });
});
