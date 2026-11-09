import {afterEach, describe, it} from "bun:test";
import {spawnSync} from "node:child_process";
import {copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {assert} from "chai";

import {jobCommandBlock} from "../check-package-coverage-ci";

const netlifyScript = join(import.meta.dir, "netlify-deploy.sh");
const continueConfig = readFileSync(
  join(import.meta.dir, "../../.circleci/continue-config.yml"),
  "utf8"
);

interface RecordedCall {
  args: string;
  cwd: string;
  tool: string;
  webBearer: string;
}

interface DeployRun {
  calls: RecordedCall[];
  root: string;
  status: number | null;
  stderr: string;
}

const tempDirs: string[] = [];

// Each stub appends `tool|cwd|EXPO_PUBLIC_BETTER_AUTH_WEB_BEARER|args` to calls.log.
const stubScript = (logPath: string, body = ""): string => `#!/usr/bin/env bash
set -euo pipefail
printf '%s|%s|%s|%s\\n' "$(basename "$0")" "$PWD" "\${EXPO_PUBLIC_BETTER_AUTH_WEB_BEARER:-}" "$*" >> "${logPath}"
${body}
`;

const writeExecutable = (path: string, content: string): void => {
  writeFileSync(path, content, {mode: 0o755});
};

/**
 * Runs a copy of netlify-deploy.sh inside a scratch repo whose compile, export, jq, asset-fix,
 * GitHub deployment and netlify-cli steps are all stubs, so nothing builds or touches the network.
 */
const runFrontendDeploy = (args: string[]): DeployRun => {
  const root = mkdtempSync(join(tmpdir(), "netlify-deploy-"));
  tempDirs.push(root);
  const logPath = join(root, "calls.log");
  const binDir = join(root, "bin");
  for (const dir of ["bin", "scripts/ci", "example-frontend", "demo/scripts"]) {
    mkdirSync(join(root, dir), {recursive: true});
  }
  copyFileSync(netlifyScript, join(root, "scripts/ci/netlify-deploy.sh"));
  writeFileSync(join(root, "example-frontend/app.json"), '{"expo":{"extra":{}}}\n');

  // `bun run export` in example-frontend leaves the dist directory the script publishes.
  writeExecutable(
    join(binDir, "bun"),
    stubScript(logPath, 'if [ "$*" = "run export" ]; then mkdir -p dist; fi')
  );
  writeExecutable(join(binDir, "bunx"), stubScript(logPath));
  writeExecutable(join(binDir, "node"), stubScript(logPath));
  // The script runs `jq --arg url <url> <filter> <file>`; echo the file back unchanged.
  writeExecutable(join(binDir, "jq"), stubScript(logPath, 'cat "${@: -1}"'));
  writeExecutable(join(root, "demo/scripts/fix-netlify-assets.sh"), stubScript(logPath));
  writeExecutable(
    join(root, "scripts/ci/github-deployment-lib.sh"),
    `with_github_deployment() {
  shift 3
  "$@"
}
`
  );

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NETLIFY_AUTH_TOKEN: "test-token",
    NETLIFY_FRONTEND_EXAMPLE_SITE_ID: "test-site",
    PATH: `${binDir}:${process.env.PATH ?? ""}`,
  };
  // CircleCI's BASH_ENV puts the real ~/.bun/bin back on PATH ahead of the stubs.
  delete env.BASH_ENV;
  delete env.ENV;
  delete env.EXPO_PUBLIC_BETTER_AUTH_WEB_BEARER;
  delete env.NETLIFY_WAIT_FOR_HEALTH_URL;

  const result = spawnSync("bash", [join(root, "scripts/ci/netlify-deploy.sh"), ...args], {
    encoding: "utf8",
    env,
  });
  const log = (() => {
    try {
      return readFileSync(logPath, "utf8");
    } catch {
      return "";
    }
  })();
  const calls = log
    .split("\n")
    .filter(Boolean)
    .map((line): RecordedCall => {
      const [tool, cwd, webBearer, ...rest] = line.split("|");
      return {args: rest.join("|"), cwd, tool, webBearer};
    });
  return {calls, root, status: result.status, stderr: result.stderr};
};

afterEach((): void => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, {force: true, recursive: true});
  }
});

const runDemoDeploy = (args: string[]): DeployRun => {
  const root = mkdtempSync(join(tmpdir(), "netlify-deploy-demo-"));
  tempDirs.push(root);
  const logPath = join(root, "calls.log");
  const binDir = join(root, "bin");
  for (const dir of ["bin", "scripts/ci", "demo/scripts"]) {
    mkdirSync(join(root, dir), {recursive: true});
  }
  copyFileSync(netlifyScript, join(root, "scripts/ci/netlify-deploy.sh"));

  writeExecutable(
    join(binDir, "bun"),
    stubScript(logPath, 'if [ "$*" = "run export" ]; then mkdir -p dist; fi')
  );
  writeExecutable(join(binDir, "bunx"), stubScript(logPath));
  writeExecutable(join(binDir, "node"), stubScript(logPath));
  writeExecutable(join(root, "demo/scripts/fix-netlify-assets.sh"), stubScript(logPath));
  writeExecutable(
    join(root, "scripts/ci/github-deployment-lib.sh"),
    `with_github_deployment() {
  shift 3
  "$@"
}
`
  );

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NETLIFY_AUTH_TOKEN: "test-token",
    NETLIFY_DEMO_SITE_ID: "test-demo-site",
    PATH: `${binDir}:${process.env.PATH ?? ""}`,
  };
  delete env.BASH_ENV;
  delete env.ENV;
  delete env.NETLIFY_WAIT_FOR_HEALTH_URL;

  const result = spawnSync("bash", [join(root, "scripts/ci/netlify-deploy.sh"), ...args], {
    encoding: "utf8",
    env,
  });
  return {calls: [], root, status: result.status, stderr: result.stderr};
};

describe("netlify-deploy.sh demo deep links", (): void => {
  it("rewrites unknown demo paths to index.html", (): void => {
    const run = runDemoDeploy(["demo", "preview", "pr-1617"]);

    assert.equal(run.status, 0, run.stderr);
    assert.equal(
      readFileSync(join(run.root, "demo/dist/_redirects"), "utf8"),
      "/*    /index.html   200\n"
    );
  });
});

describe("netlify-deploy.sh frontend web bearer build", (): void => {
  for (const args of [
    ["frontend", "production"],
    ["frontend", "preview", "pr-7"],
  ]) {
    it(`builds the example frontend in bearer mode for ${args[1]}`, (): void => {
      const run = runFrontendDeploy(args);

      assert.equal(run.status, 0, run.stderr);
      const exportCall = run.calls.find(
        (call) => call.tool === "bun" && call.args === "run export"
      );
      assert.isDefined(exportCall, "the script exports the web build");
      assert.match(exportCall?.cwd ?? "", /\/example-frontend$/);
      assert.equal(exportCall?.webBearer, "true");
      assert.isTrue(
        run.calls.some((call) => call.tool === "bunx" && call.args.includes("netlify-cli")),
        "the deploy reaches the stubbed netlify-cli"
      );
    });
  }
});

describe("deployed web bearer smoke in CircleCI", (): void => {
  it("smokes the PR preview after deploy-frontend-preview publishes it", (): void => {
    const job = jobCommandBlock(continueConfig, "deploy-frontend-preview");
    assert.ok(job);
    const deployAt = job.indexOf('scripts/ci/netlify-deploy.sh frontend preview "pr-${PR_NUMBER}"');
    const installAt = job.indexOf("bunx playwright install --with-deps chromium");
    const smokeAt = job.indexOf("bun run smoke:deployed");
    assert.notEqual(deployAt, -1);
    assert.isAbove(installAt, deployAt);
    assert.isAbove(smokeAt, installAt);
    assert.include(
      job,
      'export SMOKE_BASE_URL="https://pr-${PR_NUMBER}--terreno-frontend.netlify.app"'
    );
    assert.include(
      job,
      'export SMOKE_API_URL="https://pr-${PR_NUMBER}---terreno-backend-example-7knxlrnpqq-uc.a.run.app"'
    );
    assert.include(job, "destination: deployed-bearer-smoke-playwright-report");
  });

  it("never smokes production, where it would create users", (): void => {
    const job = jobCommandBlock(continueConfig, "deploy-frontend");
    assert.ok(job);
    assert.include(job, "scripts/ci/netlify-deploy.sh frontend production");
    assert.notInclude(job, "smoke:deployed");
  });
});
