import {describe, test} from "bun:test";
import {join} from "node:path";
import {assert} from "chai";

import {type KnipReport, unusedFilePathsFromKnipReport} from "./lib";

const REPO_ROOT = join(import.meta.dir, "../..");

const KNOWN_ENTRY_FILES = [
  "admin-frontend/src/isolated/AdminFieldRenderer.isolated.tsx",
  "ai/src/isolated/gptStream.isolated.ts",
  "syncdb/src/isolated/defaultPersisterFactoryNative.isolated.ts",
  "scripts/static-analysis/lib.test.ts",
  ".github/scripts/architectural-pr-review.test.ts",
] as const;

const FRONTEND_TOOL_BLIND_DEPENDENCIES = new Map<string, string[]>([
  [
    "admin-spa/package.json",
    [
      "@expo/vector-icons",
      "@react-native-async-storage/async-storage",
      "expo-font",
      "expo-splash-screen",
      "expo-status-bar",
      "expo-system-ui",
      "expo-updates",
      "jspdf",
    ],
  ],
  [
    "example-frontend/package.json",
    ["expo-crypto", "expo-print", "expo-sharing", "expo-system-ui", "jspdf"],
  ],
  [
    "demo/package.json",
    [
      "@expo-google-fonts/comfortaa",
      "@expo/vector-icons",
      "@react-native-community/datetimepicker",
      "@shopify/react-native-skia",
      "crypto-browserify",
      "expo-system-ui",
      "react-native-actions-sheet",
      "stream-browserify",
    ],
  ],
  [
    "ui/package.json",
    [
      "@react-native-community/blur",
      "@react-navigation/native",
      "expo-notifications",
      "react-date-picker",
      "react-native-permissions",
      "react-native-webview",
    ],
  ],
]);

const PUBLISHED_PUBLIC_SYMBOLS = new Set([
  "admin-spa/components/AppConfigGate.tsx:AdminSpaAppConfig",
  "api/src/rbac/roleManager.ts:RbacRoleDocument",
  "admin-frontend/src/types.ts:AdminHome",
]);

const isTask11UnusedFileLeak = (file: string): boolean => {
  if (file.includes(".isolated.")) {
    return true;
  }
  const isRepoScriptTest =
    (file.startsWith("scripts/") || file.startsWith(".github/scripts/")) && file.includes(".test.");
  return isRepoScriptTest;
};

const runKnipReport = ({isProduction = false}: {isProduction?: boolean} = {}): KnipReport => {
  const result = Bun.spawnSync({
    cmd: [
      "node",
      "node_modules/knip/bin/knip.js",
      "--cache",
      "--no-exit-code",
      "--reporter",
      "json",
      ...(isProduction ? ["--production"] : []),
    ],
    cwd: REPO_ROOT,
    stderr: "pipe",
    stdout: "pipe",
  });
  const stderr = result.stderr.toString().trim();
  if (result.exitCode !== 0) {
    throw new Error(stderr || "Knip failed without a diagnostic");
  }
  return JSON.parse(result.stdout.toString()) as KnipReport;
};

const dependencyIssueNames = ({file, report}: {file: string; report: KnipReport}): string[] => {
  const packageDirectory = file.replace("package.json", "");
  const packageIssues = report.issues.filter(
    (issue) =>
      issue.file === file ||
      (packageDirectory.length > 0 && issue.file.startsWith(packageDirectory))
  );
  return packageIssues
    .flatMap((issue) => [
      ...(issue.dependencies ?? []),
      ...(issue.devDependencies ?? []),
      ...(issue.optionalPeerDependencies ?? []),
      ...(issue.unlisted ?? []),
      ...(issue.binaries ?? []),
      ...(issue.catalog ?? []),
    ])
    .map((issue) => issue.name)
    .sort();
};

describe("Knip entry graph", (): void => {
  test(
    "does not report isolated suites or repo script tests as unused files",
    (): void => {
      const unusedFiles = unusedFilePathsFromKnipReport(runKnipReport());
      for (const knownEntry of KNOWN_ENTRY_FILES) {
        assert.notInclude(unusedFiles, knownEntry);
      }
      assert.deepEqual(unusedFiles.filter(isTask11UnusedFileLeak), []);
    },
    {timeout: 180_000}
  );

  test(
    "does not report mcp-server tests as unused files",
    (): void => {
      const unusedFiles = unusedFilePathsFromKnipReport(runKnipReport());
      assert.notInclude(unusedFiles, "mcp-server/src/__tests__/tools.test.ts");
      assert.notInclude(unusedFiles, "mcp-server/src/__tests__/preload.ts");
      assert.deepEqual(
        unusedFiles.filter((file) => file.startsWith("mcp-server/src/__tests__/")),
        []
      );
    },
    {timeout: 180_000}
  );

  test(
    "does not report Metro stubs, Playwright, fingerprint, or Docusaurus theme files as unused",
    (): void => {
      const unusedFiles = unusedFilePathsFromKnipReport(runKnipReport());
      const knownToolEntries = [
        "example-frontend/jspdf-native-stub.js",
        "example-frontend/fingerprint.config.js",
        "example-frontend/playwright.circleci.config.ts",
        "demo/jspdf-native-stub.js",
        "demo/fingerprint.config.js",
        "admin-spa/jspdf-native-stub.js",
        "admin-spa/e2e/serveTestApp.ts",
        "ui/babel.config.js",
        "website/src/theme/DocItem/Footer/index.tsx",
        "scripts/ci/prepare-package-publish.mjs",
      ];
      for (const knownEntry of knownToolEntries) {
        assert.notInclude(unusedFiles, knownEntry);
      }
    },
    {timeout: 180_000}
  );

  test(
    "does not report generated Expo skill script copies as unused files",
    (): void => {
      const unusedFiles = unusedFilePathsFromKnipReport(runKnipReport());
      assert.deepEqual(
        unusedFiles.filter((file) => file.includes("expo-cicd-workflows/scripts/")),
        []
      );
    },
    {timeout: 180_000}
  );

  test(
    "does not report frontend runtime-only dependencies",
    (): void => {
      const report = runKnipReport();
      for (const [packageFile, dependencyNames] of FRONTEND_TOOL_BLIND_DEPENDENCIES) {
        const reportedNames = dependencyIssueNames({file: packageFile, report});
        for (const dependencyName of dependencyNames) {
          assert.notInclude(reportedNames, dependencyName, `${packageFile}: ${dependencyName}`);
        }
      }
    },
    {timeout: 180_000}
  );

  test(
    "does not report externally installed binaries, catalog pins, or public optional peers",
    (): void => {
      const report = runKnipReport();
      assert.notInclude(dependencyIssueNames({file: "package.json", report}), "maestro");
      assert.notInclude(
        dependencyIssueNames({file: "package.json", report}),
        "@sentry/react-native"
      );
      assert.notInclude(dependencyIssueNames({file: "demo/package.json", report}), "eas");
      assert.notInclude(
        dependencyIssueNames({file: "admin-frontend/package.json", report}),
        "react-native-webview"
      );
    },
    {timeout: 180_000}
  );

  test(
    "does not report declared optional, test-only, or type-only modules as unlisted",
    (): void => {
      const report = runKnipReport();
      const expectedDeclarations = [
        ["ai/package.json", "@ai-sdk/google-vertex"],
        ["ai/package.json", "express"],
        ["api/package.json", "ioredis"],
        ["website/package.json", "@docusaurus/plugin-content-docs"],
        ["test/package.json", "@terreno/api"],
      ] as const;
      for (const [packageFile, dependencyName] of expectedDeclarations) {
        assert.notInclude(
          dependencyIssueNames({file: packageFile, report}),
          dependencyName,
          `${packageFile}: ${dependencyName}`
        );
      }
    },
    {timeout: 180_000}
  );

  test(
    "traces example backend runtime imports in production mode",
    (): void => {
      const report = runKnipReport({isProduction: true});
      const reportedNames = dependencyIssueNames({
        file: "example-backend/package.json",
        report,
      });
      for (const runtimeDependency of [
        "@sentry/bun",
        "@terreno/admin-backend",
        "@terreno/api",
        "express",
        "luxon",
        "socket.io",
      ]) {
        assert.notInclude(reportedNames, runtimeDependency);
      }
    },
    {timeout: 180_000}
  );

  test(
    "does not report example frontend e2e and generated SDK contracts as unused",
    (): void => {
      const unusedFiles = unusedFilePathsFromKnipReport(runKnipReport());
      for (const retainedFile of [
        "example-frontend/e2e/auth.setup.ts",
        "example-frontend/e2e/helpers/mongoReplicaSet.ts",
        "example-frontend/e2e/helpers/offlineHelpers.ts",
        "example-frontend/store/apiSdk.ts",
        "example-frontend/store/syncDbSdk.ts",
      ]) {
        assert.notInclude(unusedFiles, retainedFile);
      }
    },
    {timeout: 180_000}
  );

  test(
    "does not report documented examples, executable scripts, fixtures, or demo tests as unused",
    (): void => {
      const unusedFiles = unusedFilePathsFromKnipReport(runKnipReport());
      for (const retainedFile of [
        "example-backend/src/scripts/configuration-example.ts",
        "example-backend/src/scripts/seed-admin-spa-admin.ts",
        "example-backend/src/scripts/seedConsents.ts",
        "api/src/example.ts",
        "api/src/tests/fixtures/compileAuthEntry.ts",
        "demo/generate-types.test.ts",
        "demo/components/palette/colorUtils.test.ts",
      ]) {
        assert.notInclude(unusedFiles, retainedFile);
      }
    },
    {timeout: 180_000}
  );

  test(
    "reports no unused files in default or production mode",
    (): void => {
      assert.deepEqual(unusedFilePathsFromKnipReport(runKnipReport()), []);
      assert.deepEqual(unusedFilePathsFromKnipReport(runKnipReport({isProduction: true})), []);
    },
    {timeout: 180_000}
  );

  test(
    "reports no unused internal symbols in scripts, examples, or demo",
    (): void => {
      const report = runKnipReport();
      const internalPrefixes = ["scripts/", "example-backend/", "example-frontend/", "demo/"];
      const findings = report.issues.flatMap((issue) => {
        if (!internalPrefixes.some((prefix) => issue.file.startsWith(prefix))) {
          return [];
        }
        return [
          ...(issue.exports ?? []).map((entry) => `${issue.file}:export:${entry.name}`),
          ...(issue.types ?? []).map((entry) => `${issue.file}:type:${entry.name}`),
        ];
      });
      assert.deepEqual(findings, []);
    },
    {timeout: 180_000}
  );

  test(
    "reports no unused internal symbols in published packages",
    (): void => {
      const report = runKnipReport();
      const privatePrefixes = ["scripts/", "example-backend/", "example-frontend/", "demo/"];
      const findings = report.issues.flatMap((issue) => {
        if (privatePrefixes.some((prefix) => issue.file.startsWith(prefix))) {
          return [];
        }
        return [...(issue.exports ?? []), ...(issue.types ?? [])]
          .map((entry) => `${issue.file}:${entry.name}`)
          .filter((entry) => !PUBLISHED_PUBLIC_SYMBOLS.has(entry));
      });
      assert.deepEqual(findings, []);
    },
    {timeout: 180_000}
  );

  test(
    "reports no unused exports or types in either mode",
    (): void => {
      for (const report of [runKnipReport(), runKnipReport({isProduction: true})]) {
        const findings = report.issues.flatMap((issue) => [
          ...(issue.exports ?? []).map((entry) => `${issue.file}:export:${entry.name}`),
          ...(issue.types ?? []).map((entry) => `${issue.file}:type:${entry.name}`),
        ]);
        assert.deepEqual(findings, []);
      }
    },
    {timeout: 180_000}
  );

  test(
    "reports no Knip issues in either mode",
    (): void => {
      assert.deepEqual(runKnipReport().issues, []);
      assert.deepEqual(runKnipReport({isProduction: true}).issues, []);
    },
    {timeout: 180_000}
  );
});
