import {afterEach, describe, it} from "bun:test";
import {chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {assert} from "chai";

const repoRoot = join(import.meta.dir, "../..");
const waitScript = join(import.meta.dir, "wait-cloud-run-health.sh");
const authEnvScript = join(import.meta.dir, "backend-auth-env.sh");
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
    const deployIf = deployScript.indexOf(
      prodMarker,
      deployScript.indexOf('local revision_suffix=""')
    );
    const previewBranch = deployScript.slice(
      deployIf,
      deployScript.indexOf("rebuild-cloud-run-ready-traffic.sh")
    );
    assert.include(previewBranch, "GCS_FOLDER_PREFIX=pr-${PR_NUMBER}/");
    assert.notInclude(previewBranch.slice(0, previewBranch.indexOf("else")), "GCS_FOLDER_PREFIX");
  });

  it("turns on the OAuth handoff for the bearer web build on prod and previews", (): void => {
    // The shared env_vars line feeds both the prod and the pr-* deploy.
    const sharedEnv = deployScript.match(/^ {2}env_vars="NODE_ENV=production,.*$/m)?.[0] ?? "";
    assert.include(sharedEnv, "BETTER_AUTH_OAUTH_HANDOFF=true");
    assert.include(sharedEnv, "CROSS_DOMAIN_AUTH_COOKIES=true");
    // The handoff's web origins come from CORS_ORIGINS, which backend-auth-env.sh sets per deploy.
    assert.include(deployScript, 'scripts/ci/backend-auth-env.sh gcloud-env "$tag"');
    // The mock OIDC provider signs in anyone it names; no deploy may configure it.
    for (const config of [deployScript, cdWorkflow, setupConfig, continueConfig]) {
      assert.notInclude(config, "MOCK_OIDC");
    }
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

interface AuthEnvResult {
  env: Record<string, string>;
  exitCode: number;
  stderr: string;
}

// Runs backend-auth-env.sh with only the variables a case sets on top of PATH and HOME.
const runAuthEnv = async (
  args: string[],
  env: Record<string, string> = {}
): Promise<AuthEnvResult> => {
  const child = Bun.spawn(["bash", authEnvScript, ...args], {
    env: {HOME: Bun.env.HOME ?? "", PATH: Bun.env.PATH ?? "", ...env},
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  const parsed: Record<string, string> = {};
  for (const line of stdout.split("\n").filter(Boolean)) {
    const at = line.indexOf("=");
    parsed[line.slice(0, at)] = line.slice(at + 1);
  }
  return {env: parsed, exitCode, stderr};
};

const STABLE_RUN_APP = "https://terreno-backend-example-7knxlrnpqq-uc.a.run.app";
const STABLE_NETLIFY = "https://terreno-frontend.netlify.app";

describe("backend-auth-env.sh", (): void => {
  it("refuses a deploy tag that is not prod or pr-<number>", async (): Promise<void> => {
    for (const tag of ["pr-1;rm", "pr-", "pr-abc", "staging"]) {
      const result = await runAuthEnv(["env", tag]);
      assert.equal(result.exitCode, 2, `${tag} should be refused`);
      assert.include(result.stderr, "Unknown deploy tag");
    }
  });

  it("points stable at today's hosts and proxies to itself by default", async (): Promise<void> => {
    const result = await runAuthEnv(["env", "prod"]);

    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.env, {
      BETTER_AUTH_URL: STABLE_RUN_APP,
      CORS_ORIGINS: STABLE_NETLIFY,
      FRONTEND_URL: STABLE_NETLIFY,
      OAUTH_PROXY_PRODUCTION_URL: STABLE_RUN_APP,
    });
  });

  it("sends a preview's OAuth through stable and keeps passkeys on its own host", async (): Promise<void> => {
    const result = await runAuthEnv(["env", "pr-42"], {
      STABLE_BACKEND_URL: "https://api.example.com",
      STABLE_FRONTEND_URL: "https://app.example.com",
    });

    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.env, {
      BETTER_AUTH_URL: "https://pr-42---terreno-backend-example-7knxlrnpqq-uc.a.run.app",
      CORS_ORIGINS: "https://pr-42--terreno-frontend.netlify.app",
      FRONTEND_URL: "https://pr-42--terreno-frontend.netlify.app",
      OAUTH_PROXY_PRODUCTION_URL: "https://api.example.com",
    });
  });

  it("lets a named preview own the callbacks and proxies the other previews through it", async (): Promise<void> => {
    const owner = await runAuthEnv(["env", "pr-7"], {OAUTH_CALLBACK_TAG: "pr-7"});
    const other = await runAuthEnv(["env", "pr-42"], {OAUTH_CALLBACK_TAG: "pr-7"});
    const stable = await runAuthEnv(["env", "prod"], {OAUTH_CALLBACK_TAG: "pr-7"});

    const ownerBackend = "https://pr-7---terreno-backend-example-7knxlrnpqq-uc.a.run.app";
    assert.equal(owner.env.BETTER_AUTH_URL, ownerBackend);
    assert.equal(owner.env.OAUTH_PROXY_PRODUCTION_URL, ownerBackend);
    assert.equal(other.env.OAUTH_PROXY_PRODUCTION_URL, ownerBackend);
    assert.equal(stable.env.OAUTH_PROXY_PRODUCTION_URL, STABLE_RUN_APP);
  });

  it("refuses an OAUTH_CALLBACK_TAG that is not prod or pr-<number>", async (): Promise<void> => {
    const result = await runAuthEnv(["env", "prod"], {OAUTH_CALLBACK_TAG: "staging"});

    assert.equal(result.exitCode, 2);
    assert.include(result.stderr, "Unknown deploy tag");
  });

  it("moves stable onto one domain with two variables", async (): Promise<void> => {
    const result = await runAuthEnv(["env", "prod"], {
      STABLE_BACKEND_URL: "https://api.example.com/",
      STABLE_FRONTEND_URL: "https://app.example.com/",
    });

    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.env, {
      BETTER_AUTH_URL: "https://api.example.com",
      // The old Netlify host keeps working during the move.
      CORS_ORIGINS: `https://app.example.com,${STABLE_NETLIFY}`,
      FRONTEND_URL: "https://app.example.com",
      OAUTH_PROXY_PRODUCTION_URL: "https://api.example.com",
      PASSKEY_RP_ID: "example.com",
    });
  });

  it("finds the shared parent of deeper hosts", async (): Promise<void> => {
    const result = await runAuthEnv(["env", "prod"], {
      STABLE_BACKEND_URL: "https://api.terreno.example.co.uk",
      STABLE_FRONTEND_URL: "https://app.terreno.example.co.uk",
    });

    assert.equal(result.env.PASSKEY_RP_ID, "terreno.example.co.uk");
  });

  it("never binds passkeys to a shared hosting suffix", async (): Promise<void> => {
    const result = await runAuthEnv(["env", "prod"], {
      STABLE_BACKEND_URL: "https://api-example.netlify.app",
      STABLE_FRONTEND_URL: "https://app-example.netlify.app",
    });

    assert.equal(result.exitCode, 0, result.stderr);
    assert.notProperty(result.env, "PASSKEY_RP_ID");
  });

  it("refuses an unknown deploy tag", async (): Promise<void> => {
    const result = await runAuthEnv(["env", "staging"]);

    assert.equal(result.exitCode, 2);
    assert.include(result.stderr, "Unknown deploy tag");
  });

  // Runs `secrets <tag>` with a fake gcloud that finds a version only for the listed names.
  const runSecrets = async (
    tag: string,
    extraEnv: Record<string, string> = {}
  ): Promise<AuthEnvResult> => {
    const bin = mkdtempSync(join(tmpdir(), "fake-gcloud-"));
    try {
      const fakeGcloud = join(bin, "gcloud");
      writeFileSync(
        fakeGcloud,
        [
          "#!/usr/bin/env bash",
          'for arg in "$@"; do',
          '  case "$arg" in --secret=*) name="${arg#--secret=}" ;; esac',
          "done",
          '[[ " $FAKE_SECRETS " == *" $name "* ]]',
          "",
        ].join("\n")
      );
      chmodSync(fakeGcloud, 0o755);
      return await runAuthEnv(["secrets", tag], {
        FAKE_SECRETS: [
          "svc-github-client-id",
          "svc-github-client-secret",
          "svc-apple-client-id",
          "svc-apple-team-id",
          "svc-apple-key-id",
          "svc-apple-private-key",
        ].join(" "),
        GCP_BACKEND_SERVICE: "svc",
        PATH: `${bin}:${Bun.env.PATH ?? ""}`,
        ...extraEnv,
      });
    } finally {
      rmSync(bin, {force: true, recursive: true});
    }
  };

  it("mounts every OAuth secret that has a version on stable", async (): Promise<void> => {
    const result = await runSecrets("prod");

    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.env, {
      APPLE_CLIENT_ID: "svc-apple-client-id:latest",
      APPLE_KEY_ID: "svc-apple-key-id:latest",
      APPLE_PRIVATE_KEY: "svc-apple-private-key:latest",
      APPLE_TEAM_ID: "svc-apple-team-id:latest",
      GITHUB_CLIENT_ID: "svc-github-client-id:latest",
      GITHUB_CLIENT_SECRET: "svc-github-client-secret:latest",
    });
  });

  it("mounts only client IDs on a preview, never a client secret or the Apple key", async (): Promise<void> => {
    const result = await runSecrets("pr-42");

    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.env, {
      APPLE_CLIENT_ID: "svc-apple-client-id:latest",
      GITHUB_CLIENT_ID: "svc-github-client-id:latest",
    });
  });

  it("mounts every secret on the preview named by OAUTH_CALLBACK_TAG and only client IDs on stable", async (): Promise<void> => {
    const owner = await runSecrets("pr-7", {OAUTH_CALLBACK_TAG: "pr-7"});
    const stable = await runSecrets("prod", {OAUTH_CALLBACK_TAG: "pr-7"});

    assert.equal(owner.exitCode, 0, owner.stderr);
    assert.equal(owner.env.GITHUB_CLIENT_SECRET, "svc-github-client-secret:latest");
    assert.equal(owner.env.APPLE_PRIVATE_KEY, "svc-apple-private-key:latest");
    assert.deepEqual(stable.env, {
      APPLE_CLIENT_ID: "svc-apple-client-id:latest",
      GITHUB_CLIENT_ID: "svc-github-client-id:latest",
    });
  });

  it("never derives a country second level such as co.uk as the rpID", async (): Promise<void> => {
    const result = await runAuthEnv(["env", "prod"], {
      STABLE_BACKEND_URL: "https://foo.co.uk",
      STABLE_FRONTEND_URL: "https://bar.co.uk",
    });

    assert.equal(result.exitCode, 0, result.stderr);
    assert.notProperty(result.env, "PASSKEY_RP_ID");
  });

  it("derives no rpID when the backend is not on the frontend's parent domain", async (): Promise<void> => {
    const result = await runAuthEnv(["env", "prod"], {
      STABLE_BACKEND_URL: "https://api.other.com",
      STABLE_FRONTEND_URL: "https://app.example.com",
    });

    assert.notProperty(result.env, "PASSKEY_RP_ID");
  });

  it("takes the stable rpID from STABLE_PASSKEY_RP_ID", async (): Promise<void> => {
    const result = await runAuthEnv(["env", "prod"], {
      STABLE_BACKEND_URL: "https://api.bar.co.uk",
      STABLE_FRONTEND_URL: "https://bar.co.uk",
      STABLE_PASSKEY_RP_ID: "bar.co.uk",
    });

    assert.equal(result.env.PASSKEY_RP_ID, "bar.co.uk");
  });

  it("joins base and auth vars for gcloud, keeping a two-origin CORS_ORIGINS whole", async (): Promise<void> => {
    const child = Bun.spawn(
      ["bash", authEnvScript, "gcloud-env", "prod", "NODE_ENV=production,GCS_BUCKET=docs"],
      {
        env: {
          PATH: Bun.env.PATH ?? "",
          STABLE_BACKEND_URL: "https://api.example.com",
          STABLE_FRONTEND_URL: "https://app.example.com",
        },
        stderr: "pipe",
        stdout: "pipe",
      }
    );
    const [exitCode, stdout] = await Promise.all([child.exited, new Response(child.stdout).text()]);

    assert.equal(exitCode, 0);
    const value = stdout.trim();
    // gcloud's escaping: a leading ^;^ makes ";" the delimiter between KEY=VALUE pairs.
    assert.isTrue(value.startsWith("^;^"));
    const entries = value.slice(3).split(";");
    assert.include(entries, "NODE_ENV=production");
    assert.include(entries, "GCS_BUCKET=docs");
    assert.include(entries, `CORS_ORIGINS=https://app.example.com,${STABLE_NETLIFY}`);
    assert.include(entries, "PASSKEY_RP_ID=example.com");
    assert.lengthOf(entries, 7);
  });

  it("hands every auth variable to the backend deploy with a comma-safe delimiter", (): void => {
    assert.include(deployScript, 'scripts/ci/backend-auth-env.sh secrets "$tag"');
    assert.include(deployScript, 'scripts/ci/backend-auth-env.sh gcloud-env "$tag" "$env_vars"');
    assert.include(deployScript, '"--set-env-vars=${env_flag_value}"');
    // The shared Better Auth secret is what lets a preview read stable's proxied return.
    assert.include(deployScript, "BETTER_AUTH_SECRET=${better_auth_secret}:latest");
    // The web build calls the same stable backend URL the deploy names.
    assert.include(netlifyScript, `prod_url="\${STABLE_BACKEND_URL:-${STABLE_RUN_APP}}"`);
  });
});
