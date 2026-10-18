import {afterEach, describe, it} from "bun:test";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {assert} from "chai";

const repoRoot = join(import.meta.dir, "../..");
const waitScript = join(import.meta.dir, "wait-cloud-run-health.sh");
const deployScript = readFileSync(join(import.meta.dir, "gcp-deploy.sh"), "utf8");
const cdWorkflow = readFileSync(join(repoRoot, ".github/workflows/cd.yml"), "utf8");
const deployRetryAction = readFileSync(
  join(repoRoot, ".github/actions/deploy-cloudrun-wif-retry/action.yml"),
  "utf8"
);
const netlifyScript = readFileSync(join(import.meta.dir, "netlify-deploy.sh"), "utf8");
const setupConfig = readFileSync(join(repoRoot, ".circleci/config.yml"), "utf8");
const continueConfig = readFileSync(join(repoRoot, ".circleci/continue-config.yml"), "utf8");
// CircleCI path-filtering regexes that rebuild the example frontend preview.
const FRONTEND_PREVIEW_PATHS = [
  "example-frontend/.*",
  "ui/.*",
  "rtk/.*",
  "admin-frontend/.*",
  "ai/.*",
  "blocks/.*",
  "syncdb/.*",
  "bun\\.lock",
];

interface WaitResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

const servers: Bun.Server<unknown>[] = [];

const runWait = async ({
  handler,
  timeoutSeconds = 3,
}: {
  handler: (request: Request) => Response;
  timeoutSeconds?: number;
}): Promise<WaitResult> => {
  const server = Bun.serve({fetch: handler, port: 0});
  servers.push(server);
  const process = Bun.spawn(
    ["bash", waitScript, `http://127.0.0.1:${server.port}`, `${timeoutSeconds}`],
    {
      env: {...Bun.env, WAIT_INTERVAL_SECONDS: "0.05"},
      stderr: "pipe",
      stdout: "pipe",
    }
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  return {exitCode, stderr, stdout};
};

afterEach((): void => {
  for (const server of servers.splice(0)) {
    server.stop(true);
  }
});

describe("Cloud Run preview readiness", (): void => {
  it("waits through the early-listen 503 until health is ready", async (): Promise<void> => {
    let requestCount = 0;
    const result = await runWait({
      handler: (): Response => {
        requestCount += 1;
        if (requestCount < 3) {
          return Response.json({details: {status: "starting"}, healthy: false}, {status: 503});
        }
        return Response.json({healthy: true});
      },
    });

    assert.equal(result.exitCode, 0, result.stderr);
    assert.isAtLeast(requestCount, 3);
    assert.include(result.stdout, "Cloud Run preview is healthy");
  });

  it("fails when the preview never becomes healthy", async (): Promise<void> => {
    const result = await runWait({
      handler: (): Response =>
        Response.json({details: {status: "starting"}, healthy: false}, {status: 503}),
      timeoutSeconds: 1,
    });

    assert.notEqual(result.exitCode, 0);
    assert.include(result.stderr, "Timed out waiting for Cloud Run preview health");
    assert.include(result.stderr, '"status":"starting"');
  });

  it("sets the documents bucket on every backend deploy and isolates preview prefixes", (): void => {
    assert.include(
      deployScript,
      'GCP_DOCUMENTS_BUCKET="${GCP_DOCUMENTS_BUCKET:-flourish-terreno-example-documents}"'
    );
    assert.include(deployScript, "GCS_BUCKET=${GCP_DOCUMENTS_BUCKET}");
    const prodMarker = 'if [ "$tag" = "prod" ]; then';
    const deployIf = deployScript.indexOf(prodMarker, deployScript.indexOf(prodMarker) + 1);
    const previewBranch = deployScript.slice(
      deployIf,
      deployScript.indexOf("rebuild-cloud-run-ready-traffic.sh")
    );
    assert.include(previewBranch, "GCS_FOLDER_PREFIX=pr-${PR_NUMBER}/");
    assert.notInclude(previewBranch.slice(0, previewBranch.indexOf("else")), "GCS_FOLDER_PREFIX");
  });

  it("keeps CPU allocated and gates the preview deployment on health", (): void => {
    assert.match(
      deployScript,
      /if \[ "\$tag" = "prod" \]; then[\s\S]*else[\s\S]*--no-cpu-throttling/
    );
    assert.match(
      deployScript,
      /if \[\[ "\$tag" == pr-\* \]\]; then[\s\S]*wait-cloud-run-health\.sh/
    );
  });

  it("prunes not-Ready traffic and tags the new preview revision after deploy", (): void => {
    const pruneAt = deployScript.indexOf("rebuild-cloud-run-ready-traffic.sh");
    const deployAt = deployScript.indexOf('gcloud "${args[@]}"');
    const tagAt = deployScript.indexOf(
      "--update-tags=${tag}=${GCP_BACKEND_SERVICE}-${revision_suffix}"
    );
    assert.isAbove(pruneAt, -1);
    assert.isBelow(pruneAt, deployAt);
    assert.isAbove(tagAt, deployAt);
    assert.include(deployScript, '"--revision-suffix=$revision_suffix"');
  });

  it("selectively retries WIF timeouts for every GitHub Cloud Run deploy", (): void => {
    const directDeployActionMatches = cdWorkflow.match(
      /uses: google-github-actions\/deploy-cloudrun@/g
    );
    const retryActionMatches = cdWorkflow.match(
      /uses: \.\/\.github\/actions\/deploy-cloudrun-wif-retry/g
    );

    assert.lengthOf(directDeployActionMatches ?? [], 0);
    assert.lengthOf(retryActionMatches ?? [], 5);
    assert.include(deployRetryAction, "scripts/ci/install-gcloud-wif-retry-shim.sh");
    assert.include(deployRetryAction, "uses: google-github-actions/deploy-cloudrun@v3");
    assert.include(deployRetryAction, ["value: $", "{{ steps.deploy.outputs.url }}"].join(""));
  });

  it("deploys an isolated backend for every frontend PR preview", (): void => {
    for (const path of FRONTEND_PREVIEW_PATHS) {
      assert.include(setupConfig, `            ${path} run-deploy-frontend true`, path);
      assert.include(setupConfig, `            ${path} run-cd-backend true`, path);
    }

    const frontendPreviewJob = continueConfig.slice(
      continueConfig.indexOf("  deploy-frontend-preview:"),
      continueConfig.indexOf("  deploy-docs-preview:")
    );
    assert.include(
      frontendPreviewJob,
      'export EXPO_PUBLIC_API_URL="https://pr-${PR_NUMBER}---terreno-backend-example-7knxlrnpqq-uc.a.run.app"'
    );
    assert.include(frontendPreviewJob, 'export NETLIFY_WAIT_FOR_HEALTH_URL="$EXPO_PUBLIC_API_URL"');
    assert.isBelow(
      netlifyScript.indexOf("wait-cloud-run-health.sh"),
      netlifyScript.indexOf("args=(deploy")
    );
  });
});

describe("netlify-deploy.sh monorepo filter", () => {
  it("filters each target to a real workspace package so netlify-cli does not prompt", () => {
    const targets = {
      demo: "demo",
      docs: "website",
      frontend: "example-frontend",
    };
    for (const [target, packageDir] of Object.entries(targets)) {
      const packageName = JSON.parse(
        readFileSync(join(repoRoot, packageDir, "package.json"), "utf8")
      ).name;
      const block = netlifyScript.slice(netlifyScript.indexOf(`  ${target})\n    site_id=`));
      assert.include(
        block.slice(0, block.indexOf(";;")),
        `netlify_filter="${packageName}"`,
        target
      );
    }
    assert.include(netlifyScript, 'args=(deploy --no-build --filter "$netlify_filter"');
  });

  it("skips netlify-cli's netlify.toml build because the script already built publish_dir", () => {
    assert.include(netlifyScript, "args=(deploy --no-build ");
  });
});
