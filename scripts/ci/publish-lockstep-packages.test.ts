import {describe, it} from "bun:test";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {assert} from "chai";

import {PUBLISHED_PACKAGES} from "../check-license-coverage/lib";

const repoRoot = join(import.meta.dir, "../..");
const circleConfig = readFileSync(join(repoRoot, ".circleci/continue-config.yml"), "utf8");
const publishWorkflow = readFileSync(
  join(repoRoot, ".github/workflows/publish-on-tag.yml"),
  "utf8"
);
const changelog = readFileSync(join(repoRoot, "CHANGELOG.md"), "utf8");
const dogfoodSkill = readFileSync(
  join(repoRoot, ".rulesync/skills/build-terreno-app/SKILL.md"),
  "utf8"
);

describe("lockstep publish package lists", () => {
  it("includes announcements in CircleCI tag publish and master version bump", () => {
    assert.include(circleConfig, "announcements");
    assert.match(
      circleConfig,
      /api-health announcements comms feature-flags jobs create-terreno-app mcp-server syncdb/
    );
  });

  it("includes create-terreno-app in CircleCI tag publish and master version bump", () => {
    assert.match(
      circleConfig,
      /packages=\(\s*\n\s*api test blocks ui rtk admin-backend admin-frontend admin-spa ai\s*\n\s*api-health announcements comms feature-flags jobs create-terreno-app mcp-server syncdb\s*\n\s*\)/
    );
    assert.match(
      circleConfig,
      /for package in api test blocks ui rtk admin-backend admin-frontend admin-spa ai api-health announcements comms feature-flags jobs create-terreno-app mcp-server syncdb; do/
    );
  });

  it("publishes blocks before ui and ai because both depend on it at install time", () => {
    assert.include([...PUBLISHED_PACKAGES], "blocks");
    assert.match(publishWorkflow, /publish-blocks:[\s\S]*?working-directory: blocks/);
    assert.match(publishWorkflow, /publish-ui:\n {4}needs: \[check-changes, publish-blocks\]/);
    assert.match(
      publishWorkflow,
      /publish-ai:\n {4}needs: \[check-changes, publish-api, publish-test, publish-blocks, publish-jobs\]/
    );
    assert.match(
      publishWorkflow,
      /update_version blocks "\$\{\{ needs\.publish-blocks\.result \}\}"/
    );
    assert.match(publishWorkflow, /add_status "@terreno\/blocks"/);
    assert.match(publishWorkflow, /notify:[\s\S]*?needs: \[[^\]]*publish-blocks/);
  });

  it("publishes jobs before ai because ai's optional JobsRunner installs it as a dev dependency", () => {
    assert.match(publishWorkflow, /publish-ai:\n {4}needs: \[[^\]]*publish-jobs/);
  });

  it("includes create-terreno-app in GitHub tag publish fallback workflow", () => {
    assert.match(publishWorkflow, /publish-create-terreno-app:/);
    assert.match(publishWorkflow, /needs\.publish-create-terreno-app\.result/);
    assert.match(
      publishWorkflow,
      /update_version create-terreno-app "\$\{\{ needs\.publish-create-terreno-app\.result \}\}"/
    );
    assert.match(publishWorkflow, /add_status "create-terreno-app"/);
    assert.match(
      publishWorkflow,
      /needs: \[check-changes, publish-api, publish-test, publish-create-terreno-app\]/,
      "publish-mcp must wait for create-terreno-app because it depends on it at publish time"
    );
    assert.match(
      publishWorkflow,
      /publish-create-terreno-app:[\s\S]*?working-directory: create-terreno-app/
    );
    assert.match(
      publishWorkflow,
      /publish-mcp:[\s\S]*?key\.startsWith\('@terreno\/'\) \|\| key === 'create-terreno-app'/
    );
    assert.match(
      publishWorkflow,
      /update-version-on-master:[\s\S]*?needs: \[[^\]]*publish-create-terreno-app/
    );
    assert.match(
      publishWorkflow,
      /update-version-on-master:[\s\S]*?needs\.publish-create-terreno-app\.result == 'success'/
    );
    assert.match(publishWorkflow, /notify:[\s\S]*?needs: \[[^\]]*publish-create-terreno-app/);
  });

  it("covers license, changelog, and dogfood contracts", () => {
    assert.include([...PUBLISHED_PACKAGES], "create-terreno-app");
    assert.include([...PUBLISHED_PACKAGES], "announcements");
    assert.match(changelog, /unscoped `create-terreno-app` CLI are versioned in lockstep/);
    assert.match(changelog, /create-terreno-app/);
    assert.match(publishWorkflow, /publish-announcements:/);
    assert.match(publishWorkflow, /needs\.publish-announcements\.result/);
    assert.match(dogfoodSkill, /### Phase 2 — Scaffold[\s\S]*bunx create-terreno-app/);
    assert.notMatch(dogfoodSkill, /file dump as fallback/);
  });
});
