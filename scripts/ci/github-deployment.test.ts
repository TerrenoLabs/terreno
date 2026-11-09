import {afterEach, describe, it} from "bun:test";
import {join} from "node:path";
import {assert} from "chai";

const deploymentScript = join(import.meta.dir, "github-deployment.sh");
const deploymentLib = join(import.meta.dir, "github-deployment-lib.sh");

interface RecordedRequest {
  body: Record<string, unknown>;
  path: string;
}

interface RunResult {
  exitCode: number;
  requests: RecordedRequest[];
  stderr: string;
  stdout: string;
}

const servers: Bun.Server<unknown>[] = [];

const runWithFakeGitHub = async ({
  command,
  env = {},
  status = 201,
}: {
  command: string[];
  env?: Record<string, string>;
  status?: number;
}): Promise<RunResult> => {
  const requests: RecordedRequest[] = [];
  let nextId = 100;
  const server = Bun.serve({
    fetch: async (request: Request): Promise<Response> => {
      const body = (await request.json()) as Record<string, unknown>;
      requests.push({body, path: new URL(request.url).pathname});
      if (status !== 201) {
        return Response.json({message: "Resource not accessible by integration"}, {status});
      }
      nextId += 1;
      return Response.json({id: nextId}, {status});
    },
    port: 0,
  });
  servers.push(server);
  const process = Bun.spawn(command, {
    env: {
      ...Bun.env,
      CIRCLE_BUILD_URL: "https://circleci.example/job/42",
      CIRCLE_SHA1: "abc123",
      GITHUB_API_URL: `http://127.0.0.1:${server.port}`,
      GITHUB_DEPLOYMENTS_TOKEN: "test-token",
      GITHUB_REPOSITORY: "TerrenoLabs/terreno",
      ...env,
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  return {exitCode, requests, stderr, stdout};
};

const wrapped = (inner: string): string[] => [
  "bash",
  "-c",
  `set -euo pipefail; source ${deploymentLib}; with_github_deployment example-frontend-preview-pr-7 "frontend preview" https://pr-7--terreno-frontend.netlify.app ${inner}`,
];

afterEach((): void => {
  for (const server of servers.splice(0)) {
    server.stop(true);
  }
});

describe("GitHub deployment records", (): void => {
  it("creates a transient preview deployment and marks it in progress", async (): Promise<void> => {
    const result = await runWithFakeGitHub({
      command: ["bash", deploymentScript, "start", "demo-preview-pr-7", "demo preview pr-7"],
    });

    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout.trim(), "101");
    const [create, inProgress] = result.requests;
    assert.equal(create.path, "/repos/TerrenoLabs/terreno/deployments");
    assert.deepInclude(create.body, {
      auto_merge: false,
      environment: "demo-preview-pr-7",
      production_environment: false,
      ref: "abc123",
      required_contexts: [],
      transient_environment: true,
    });
    assert.equal(inProgress.path, "/repos/TerrenoLabs/terreno/deployments/101/statuses");
    assert.deepInclude(inProgress.body, {
      log_url: "https://circleci.example/job/42",
      state: "in_progress",
    });
  });

  it("posts to TerrenoLabs when CircleCI still names the old org", async (): Promise<void> => {
    const result = await runWithFakeGitHub({
      command: ["bash", deploymentScript, "start", "demo", "demo"],
      env: {
        CIRCLE_PROJECT_REPONAME: "terreno",
        CIRCLE_PROJECT_USERNAME: "FlourishHealth",
        GITHUB_REPOSITORY: "",
      },
    });

    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.requests[0].path, "/repos/TerrenoLabs/terreno/deployments");
  });

  it("marks production environments as production", async (): Promise<void> => {
    const result = await runWithFakeGitHub({
      command: ["bash", deploymentScript, "start", "example-backend-production", "backend"],
    });

    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepInclude(result.requests[0].body, {
      production_environment: true,
      transient_environment: false,
    });
  });

  it("records success with the environment URL after the wrapped command passes", async (): Promise<void> => {
    const result = await runWithFakeGitHub({command: wrapped("true")});

    assert.equal(result.exitCode, 0, result.stderr);
    const finish = result.requests[2];
    assert.equal(finish.path, "/repos/TerrenoLabs/terreno/deployments/101/statuses");
    assert.deepInclude(finish.body, {
      auto_inactive: true,
      environment_url: "https://pr-7--terreno-frontend.netlify.app",
      state: "success",
    });
  });

  it("records failure and keeps the wrapped command's exit status", async (): Promise<void> => {
    const result = await runWithFakeGitHub({command: wrapped("false")});

    assert.equal(result.exitCode, 1);
    assert.equal(result.requests[2].body.state, "failure");
  });

  it("stops the wrapped function at its first failing command", async (): Promise<void> => {
    const result = await runWithFakeGitHub({
      command: [
        "bash",
        "-c",
        `set -euo pipefail; source ${deploymentLib}; deploy() { false; echo "kept going"; }; with_github_deployment demo demo https://terreno-demo.netlify.app deploy`,
      ],
    });

    assert.equal(result.exitCode, 1);
    assert.notInclude(result.stdout, "kept going");
    assert.equal(result.requests[2].body.state, "failure");
  });

  it("skips without failing when the token is unset", async (): Promise<void> => {
    const result = await runWithFakeGitHub({
      command: wrapped("true"),
      env: {GITHUB_DEPLOYMENTS_TOKEN: ""},
    });

    assert.equal(result.exitCode, 0, result.stderr);
    assert.lengthOf(result.requests, 0);
    assert.include(result.stderr, "GITHUB_DEPLOYMENTS_TOKEN is unset");
  });

  it("warns without failing the deploy when GitHub rejects the record", async (): Promise<void> => {
    const result = await runWithFakeGitHub({command: wrapped("true"), status: 403});

    assert.equal(result.exitCode, 0, result.stderr);
    assert.include(result.stderr, "Resource not accessible by integration");
  });
});
