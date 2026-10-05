import {describe, it} from "bun:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";

const scriptPath = join(import.meta.dir, "publish-package.sh");
const script = readFileSync(scriptPath, "utf8");
const circleConfig = readFileSync(
  join(import.meta.dir, "../../.circleci/continue-config.yml"),
  "utf8"
);
const publishReleaseJob = circleConfig.slice(
  circleConfig.indexOf("\n  publish-release:\n"),
  circleConfig.indexOf("\nworkflows:\n")
);

describe("publish-package.sh", () => {
  it("does not bun install after pinning workspace versions to the unpublished tag", () => {
    const prepareMarker = "prepare-package-publish.mjs";
    const prepareIndex = script.indexOf(prepareMarker);
    assert.notEqual(prepareIndex, -1, "expected prepare-package-publish.mjs");
    const afterPrepare = script.slice(prepareIndex + prepareMarker.length);
    assert.doesNotMatch(
      afterPrepare,
      /\(cd "\$package_directory" && bun install\)/,
      "reinstall after pinning workspace:* looks for sibling @terreno packages on npm before they exist"
    );
  });

  it("runs test:ci before falling back to test so watch-mode scripts cannot hang publish", () => {
    const testCiIndex = script.indexOf("bun run test:ci");
    const testIndex = script.indexOf("bun run test)");
    assert.notEqual(testCiIndex, -1, "expected bun run test:ci");
    assert.notEqual(testIndex, -1, "expected bun run test fallback");
    assert.ok(
      testCiIndex < testIndex,
      "test:ci must run before test; ui's test script is bun test --watch"
    );
    assert.match(script, /pkg\.scripts\?\.\['test:ci'\]/, "expected test:ci script detection");
  });

  it("skips npm publish when the tag version is already on the registry", () => {
    assert.match(
      script,
      /Already on npm: \$\{package_name\}@\$\{version\}; skipping/,
      "retries of a partial tag publish must skip versions that already exist"
    );
    assert.match(
      script,
      /npm view "\$\{package_name\}@\$\{version\}" version/,
      "expected npm view guard"
    );
  });

  it("skips per-package compile and tests when the release job prebuilt everything", () => {
    const gate = script.indexOf('if [ "${TERRENO_PUBLISH_PREBUILT:-}" != "1" ]; then');
    assert.notEqual(gate, -1, "expected TERRENO_PUBLISH_PREBUILT gate");
    assert.ok(gate < script.indexOf("compile-workspace-deps.js"));
    assert.ok(gate < script.indexOf("bun run test:ci"));
  });

  it("writes a per-invocation npmrc so parallel publishes keep their token", () => {
    assert.doesNotMatch(script, /\$HOME\/\.npmrc/);
    assert.match(script, /NPM_CONFIG_USERCONFIG="\$npmrc" npm publish/);
  });

  it("compiles every package the release publishes", () => {
    const lists = publishReleaseJob.matchAll(/packages=\(\n([\s\S]*?)\)/g);
    const packageLists = [...lists].map((match) =>
      match[1]
        .split("\n")
        .flatMap((line) => line.trim().split(/\s+/))
        .filter((token) => token.length > 0)
    );
    assert.equal(packageLists.length, 2, "expected a compile list and a publish list");
    const [compilePackages, publishPackages] = packageLists;
    assert.deepEqual(
      compilePackages,
      publishPackages,
      "a published package missing from the prebuild list fails typecheck"
    );
  });

  it("compiles once and publishes in parallel without a Mongo sidecar in publish-release", () => {
    assert.match(publishReleaseJob, /executor: node22\n/);
    assert.ok(!publishReleaseJob.includes("wait_for_mongo"), "release no longer runs tests");
    assert.match(
      publishReleaseJob,
      /TERRENO_SKIP_WORKSPACE_DEPS=1 bun run "\$\{filters\[@\]\}" compile/
    );
    assert.match(publishReleaseJob, /export TERRENO_PUBLISH_PREBUILT=1/);
    assert.match(publishReleaseJob, /xargs -P \d+/);
  });
});
