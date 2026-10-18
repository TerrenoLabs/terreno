import {describe, it} from "bun:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtempSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

const script = join(import.meta.dir, "resolve-preview-pr.sh");

const fakeCurl = (body: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "resolve-preview-pr-"));
  writeFileSync(
    join(dir, "curl"),
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$@" >> "${dir}/curl-args"
cat <<'JSON'
${body}
JSON
`,
    {mode: 0o755}
  );
  return dir;
};

const run = ({env, extraPath}: {env: NodeJS.ProcessEnv; extraPath?: string}): string => {
  const pathValue = extraPath ? `${extraPath}:${process.env.PATH ?? ""}` : process.env.PATH;
  const result = spawnSync("bash", [script], {
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_DEPLOYMENTS_TOKEN: "",
      GITHUB_REPOSITORY: "",
      GITHUB_TOKEN: "",
      ...env,
      PATH: pathValue,
    },
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};

const sameRepo = JSON.stringify({
  base: {repo: {full_name: "TerrenoLabs/terreno"}},
  head: {repo: {full_name: "TerrenoLabs/terreno"}},
});

describe("resolve-preview-pr.sh", () => {
  it("returns the PR number from CIRCLE_PULL_REQUEST", () => {
    assert.equal(
      run({
        env: {
          CIRCLE_PR_NUMBER: "",
          CIRCLE_PR_REPONAME: "",
          CIRCLE_PR_USERNAME: "",
          CIRCLE_PROJECT_REPONAME: "terreno",
          CIRCLE_PULL_REQUEST: "https://github.com/TerrenoLabs/terreno/pull/1222",
        },
        extraPath: fakeCurl(sameRepo),
      }),
      "1222"
    );
  });

  it("falls back to CIRCLE_PR_NUMBER", () => {
    assert.equal(
      run({
        env: {
          CIRCLE_PR_NUMBER: "88",
          CIRCLE_PR_REPONAME: "",
          CIRCLE_PR_USERNAME: "",
          CIRCLE_PROJECT_REPONAME: "terreno",
          CIRCLE_PULL_REQUEST: "",
        },
        extraPath: fakeCurl(sameRepo),
      }),
      "88"
    );
  });

  it("skips fork PRs from legacy CircleCI environment variables", () => {
    assert.equal(
      run({
        env: {
          CIRCLE_PR_NUMBER: "9",
          CIRCLE_PR_REPONAME: "fork-terreno",
          CIRCLE_PROJECT_REPONAME: "terreno",
          CIRCLE_PULL_REQUEST: "https://github.com/other/terreno/pull/9",
        },
      }),
      "skip-fork"
    );
  });

  it("skips GitHub App fork PRs that only show up in the pulls API", () => {
    assert.equal(
      run({
        env: {
          CIRCLE_PR_NUMBER: "",
          CIRCLE_PR_REPONAME: "",
          CIRCLE_PR_USERNAME: "",
          CIRCLE_PULL_REQUEST: "https://github.com/TerrenoLabs/terreno/pull/9",
        },
        extraPath: fakeCurl(
          JSON.stringify({
            base: {repo: {full_name: "TerrenoLabs/terreno"}},
            head: {repo: {full_name: "other/terreno"}},
          })
        ),
      }),
      "skip-fork"
    );
  });

  it("skips builds with no PR", () => {
    assert.equal(
      run({
        env: {
          CIRCLE_BRANCH: "feature",
          CIRCLE_PR_NUMBER: "",
          CIRCLE_PR_REPONAME: "",
          CIRCLE_PR_USERNAME: "",
          CIRCLE_PROJECT_REPONAME: "terreno",
          CIRCLE_PROJECT_USERNAME: "",
          CIRCLE_PULL_REQUEST: "",
          GITHUB_API_URL: "http://example.invalid",
        },
        extraPath: fakeCurl("[]"),
      }),
      "skip-missing"
    );
  });

  it("looks up an open PR on TerrenoLabs even when CircleCI names the old org", () => {
    const dir = fakeCurl('[{"number":1225}]');
    assert.equal(
      run({
        env: {
          CIRCLE_BRANCH: "cursor/circleci-auto-deploys-5c49",
          CIRCLE_PR_NUMBER: "",
          CIRCLE_PR_REPONAME: "",
          CIRCLE_PR_USERNAME: "",
          CIRCLE_PROJECT_REPONAME: "terreno",
          CIRCLE_PROJECT_USERNAME: "FlourishHealth",
          CIRCLE_PULL_REQUEST: "",
          GITHUB_API_URL: "http://example.invalid",
        },
        extraPath: dir,
      }),
      "1225"
    );
    const args = spawnSync("cat", [join(dir, "curl-args")], {encoding: "utf8"}).stdout;
    assert.match(args, /repos\/TerrenoLabs\/terreno\/pulls\?head=TerrenoLabs:/);
    assert.doesNotMatch(args, /FlourishHealth/);
  });
});
