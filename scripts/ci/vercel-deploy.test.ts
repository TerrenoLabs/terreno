import {describe, it} from "bun:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {join} from "node:path";

const script = join(import.meta.dir, "vercel-deploy.sh");

const run = (
  args: string[],
  env: NodeJS.ProcessEnv = {}
): {status: number | null; stdout: string; stderr: string} => {
  const result = spawnSync("bash", [script, ...args], {
    encoding: "utf8",
    env: {...process.env, ...env},
  });
  return {status: result.status, stderr: result.stderr, stdout: result.stdout};
};

const plan = (args: string[]): Record<string, string[]> => {
  const result = run([...args, "--plan"]);
  assert.equal(result.status, 0, result.stderr);
  const entries: Record<string, string[]> = {};
  for (const line of result.stdout.trim().split("\n")) {
    const index = line.indexOf("=");
    const key = line.slice(0, index);
    entries[key] = [...(entries[key] ?? []), line.slice(index + 1)];
  }
  return entries;
};

describe("vercel-deploy.sh plan", () => {
  it("deploys production to the terrenolabs hosts and builds the frontend against them", () => {
    const frontend = plan(["frontend", "production"]);
    assert.deepEqual(frontend.host, ["terrenolabs-frontend.vercel.app"]);
    assert.deepEqual(frontend.api_url, ["https://terrenolabs-backend.vercel.app"]);
    assert.deepEqual(frontend.deployment_env, ["vercel-frontend"]);
    assert.equal(frontend.runtime_env, undefined);

    const backend = plan(["backend", "production"]);
    assert.deepEqual(backend.probe_url, ["https://terrenolabs-backend.vercel.app/health"]);
    assert.equal(backend.runtime_env, undefined);
  });

  it("points a PR frontend at the same PR's backend host", () => {
    const frontend = plan(["frontend", "preview", "42"]);
    assert.deepEqual(frontend.host, ["terrenolabs-frontend-pr-42.vercel.app"]);
    assert.deepEqual(frontend.api_url, ["https://terrenolabs-backend-pr-42.vercel.app"]);
    assert.deepEqual(frontend.deployment_env, ["vercel-frontend-preview-pr-42"]);
  });

  it("isolates a PR backend on the PR database and allows only that PR's frontend origins", () => {
    const backend = plan(["backend", "preview", "42"]);
    assert.deepEqual(backend.runtime_env, [
      "MONGO_DB_NAME=terreno-example-pr-42",
      "SEED_DEFAULTS=true",
      "BETTER_AUTH_URL=https://terrenolabs-backend-pr-42.vercel.app",
      "CORS_ORIGINS=https://terrenolabs-frontend-pr-42.vercel.app,https://terreno-frontend-*-terrenolabs.vercel.app",
    ]);
  });

  it("leaves the demo without a backend URL", () => {
    const demo = plan(["demo", "preview", "7"]);
    assert.deepEqual(demo.host, ["terrenolabs-demo-pr-7.vercel.app"]);
    assert.equal(demo.api_url, undefined);
  });
});

describe("vercel-deploy.sh argument and context checks", () => {
  it("rejects a preview without a numeric PR number", () => {
    const result = run(["demo", "preview", "pr-7", "--plan"]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /numeric PR number/);
  });

  it("rejects an unknown target", () => {
    const result = run(["docs", "production", "--plan"]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Unknown Vercel target: docs/);
  });

  it("exits 1 without compiling when the Vercel context is empty", () => {
    const result = run(["backend", "production"], {
      VERCEL_BACKEND_PROJECT_ID: "",
      VERCEL_ORG_ID: "",
      VERCEL_TOKEN: "",
    });
    assert.equal(result.status, 1, result.stdout);
    assert.match(
      result.stderr,
      /missing VERCEL_TOKEN VERCEL_ORG_ID VERCEL_BACKEND_PROJECT_ID \(terreno-vercel context\)/
    );
    assert.doesNotMatch(result.stdout, /compile/);
  });
});
