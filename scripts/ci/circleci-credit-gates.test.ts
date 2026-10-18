import {describe, it} from "bun:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";

import {jobCommandBlock} from "../check-package-coverage-ci";

const repoRoot = join(import.meta.dir, "../..");
const continueConfig = readFileSync(join(repoRoot, ".circleci/continue-config.yml"), "utf8");

const netlifyJobs: {job: string; siteIdVar: string}[] = [
  {job: "deploy-demo", siteIdVar: "NETLIFY_DEMO_SITE_ID"},
  {job: "deploy-frontend", siteIdVar: "NETLIFY_FRONTEND_EXAMPLE_SITE_ID"},
  {job: "deploy-docs", siteIdVar: "NETLIFY_DOCS_SITE_ID"},
  {job: "deploy-demo-preview", siteIdVar: "NETLIFY_DEMO_SITE_ID"},
  {job: "deploy-frontend-preview", siteIdVar: "NETLIFY_FRONTEND_EXAMPLE_SITE_ID"},
  {job: "deploy-docs-preview", siteIdVar: "NETLIFY_DOCS_SITE_ID"},
];

describe("CircleCI credit gates", () => {
  it("does not enable Docker Layer Caching (200 credits per job)", () => {
    assert.doesNotMatch(continueConfig, /docker_layer_caching:\s*true/);
  });

  it("runs Playwright e2e shards on medium+ after the static export", () => {
    assert.match(
      continueConfig,
      /node22_browsers_mongo_rs:\n(?: {4}.+\n){1,8} {4}resource_class: medium\+/
    );
    const e2eJob = jobCommandBlock(continueConfig, "e2e");
    assert.ok(e2eJob);
    assert.match(e2eJob, /executor: node22_browsers_mongo_rs\n/);
    assert.doesNotMatch(e2eJob, /resource_class: large/);
  });

  it("keeps in-job export/compile browser jobs on the large executor", () => {
    for (const jobName of ["maestro-e2e", "e2e-load", "admin-spa-integration"]) {
      assert.match(
        continueConfig,
        new RegExp(`  ${jobName}:\\n    executor: node22_browsers_mongo_rs_heavy`),
        jobName
      );
    }
  });

  it("validates the Netlify context before bun install", () => {
    for (const {job, siteIdVar} of netlifyJobs) {
      const block = jobCommandBlock(continueConfig, job);
      assert.ok(block, job);
      const skipAt = block.indexOf("require_netlify_context");
      const bunAt = block.indexOf("install_bun_and_deps");
      assert.notEqual(skipAt, -1, `${job} must validate the Netlify context`);
      assert.notEqual(bunAt, -1, `${job} still installs deps after the gate`);
      assert.ok(skipAt < bunAt, `${job} must validate before bun install`);
      assert.match(block, new RegExp(`site-id-var: ${siteIdVar}`));
    }
  });

  it("halts GitHub App fork deploys before context validation", () => {
    const command = continueConfig.slice(
      continueConfig.indexOf("  skip_if_fork_deploy:"),
      continueConfig.indexOf("  require_netlify_context:")
    );
    assert.match(command, /Fork PR detected via GitHub API/);
    assert.match(command, /repos\/\$\{repository\}\/pulls\/\$\{pr\}/);
    for (const jobName of [
      "deploy-demo-preview",
      "deploy-frontend-preview",
      "deploy-docs-preview",
      "gcp-cd-preview",
    ]) {
      const block = jobCommandBlock(continueConfig, jobName);
      assert.ok(block, jobName);
      const skipAt = block.indexOf("skip_if_fork_deploy");
      const requireAt = block.search(/require_(netlify|gcp)_context/);
      assert.ok(skipAt !== -1 && requireAt !== -1 && skipAt < requireAt, jobName);
    }
  });

  it("validates terreno-gcp before checkout on GCP jobs", () => {
    for (const jobName of ["gcp-cd-prod", "gcp-cd-preview", "preview-cleanup"]) {
      const block = jobCommandBlock(continueConfig, jobName);
      assert.ok(block, jobName);
      const skipAt = block.indexOf("require_gcp_context");
      const checkoutAt = block.indexOf("- checkout");
      assert.notEqual(skipAt, -1, jobName);
      assert.ok(skipAt < checkoutAt, `${jobName} must validate before checkout`);
    }
  });

  it("does not bun-install or always-start remote Docker on GCP preview", () => {
    const block = jobCommandBlock(continueConfig, "gcp-cd-preview");
    assert.ok(block);
    assert.doesNotMatch(block, /install_bun_and_deps/);
    assert.match(block, /condition: << pipeline.parameters.run-cd-backend >>/);
    const backendWhen = block.slice(block.indexOf("run-cd-backend"));
    assert.match(backendWhen, /setup_remote_docker/);
  });

  it("installs workspace deps on preview-cleanup after the GCP check so mongodb import works", () => {
    const block = jobCommandBlock(continueConfig, "preview-cleanup");
    assert.ok(block);
    const skipAt = block.indexOf("require_gcp_context");
    const bunAt = block.indexOf("install_bun_and_deps");
    assert.notEqual(skipAt, -1);
    assert.notEqual(bunAt, -1);
    assert.ok(skipAt < bunAt);
  });
});
