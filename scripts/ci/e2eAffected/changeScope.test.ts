import {describe, it} from "bun:test";
import {assert} from "chai";

import {classifyChangedFile} from "./changeScope";

describe("classifyChangedFile", () => {
  it("treats docs, rules, demo, infrastructure, and tests as inert", () => {
    for (const path of [
      "docs/how-to/circleci.md",
      ".cursor/rules/ui/00-ui.mdc",
      "demo/stories/LineChart.stories.tsx",
      "ui/src/Button.test.tsx",
      "ui/src/__snapshots__/Field.test.tsx.snap",
      "scripts/charts/compareChartImages.ts",
      "biome.jsonc",
      "knip.jsonc",
      "changelog/unreleased/x.md",
      "terraform/modules/terreno-backend/main.tf",
      "infra/flourish/main.tf",
    ]) {
      assert.equal(classifyChangedFile({path}), "inert", path);
    }
  });

  it("decides package sources and app code by the import graph", () => {
    for (const path of [
      "ui/src/Box.tsx",
      "api/src/api.ts",
      "example-backend/src/api/todos.ts",
      "example-frontend/app/login.tsx",
      "example-frontend/e2e/login.spec.ts",
      "admin-spa/app/index.tsx",
    ]) {
      assert.equal(classifyChangedFile({path}), "source", path);
    }
  });

  it("decides manifests by lockfile resolution", () => {
    assert.equal(classifyChangedFile({path: "bun.lock"}), "manifest");
    assert.equal(classifyChangedFile({path: "ui/package.json"}), "manifest");
  });

  it("runs everything for unclassified files, including the gate itself", () => {
    for (const path of [
      "example-frontend/metro.config.js",
      "example-frontend/app.json",
      ".circleci/continue-config.yml",
      "scripts/ci/e2eAffected/affected.ts",
      "patches/expo.patch",
    ]) {
      assert.equal(classifyChangedFile({path}), "global", path);
    }
  });
});
