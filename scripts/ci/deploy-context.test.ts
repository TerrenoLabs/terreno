import {describe, it} from "bun:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {join} from "node:path";

const netlifyScript = join(import.meta.dir, "netlify-deploy.sh");
const gcpScript = join(import.meta.dir, "gcp-deploy.sh");

const run = ({
  script,
  args,
  env,
}: {
  script: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}): {status: number | null; stdout: string; stderr: string} => {
  const result = spawnSync("bash", [script, ...args], {
    encoding: "utf8",
    env: {...process.env, ...env},
  });
  return {status: result.status, stderr: result.stderr, stdout: result.stdout};
};

describe("deploy scripts fail when CircleCI contexts are empty", () => {
  it("exits 1 from netlify-deploy.sh without compiling when auth or site id is missing", () => {
    const result = run({
      args: ["docs", "preview", "pr-1225"],
      env: {
        NETLIFY_AUTH_TOKEN: "",
        NETLIFY_DOCS_SITE_ID: "",
      },
      script: netlifyScript,
    });
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, /Cannot run Netlify docs preview deploy/);
    assert.doesNotMatch(result.stdout, /docusaurus/);
  });

  it("exits 1 from gcp-deploy.sh without authenticating when WIF or SA emails are missing", () => {
    const result = run({
      args: ["backend-preview"],
      env: {
        GCP_CD_DEPLOYER_SA_PROD: "",
        GCP_TF_ADMIN_SA_PROD: "",
        GCP_WIF_PROVIDER_PROD: "",
      },
      script: gcpScript,
    });
    assert.equal(result.status, 1, result.stdout);
    assert.match(
      result.stderr,
      /Missing required environment variables: GCP_WIF_PROVIDER_PROD GCP_TF_ADMIN_SA_PROD GCP_CD_DEPLOYER_SA_PROD/
    );
  });
});
