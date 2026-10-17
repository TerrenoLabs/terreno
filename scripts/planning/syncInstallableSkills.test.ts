import {describe, it} from "bun:test";
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {assert} from "chai";
import {
  buildInstallableSkillsTree,
  rewritePluginLinksForInstallable,
  rewriteSharedPluginLinks,
  syncInstallableSkills,
  syncRulesyncPluginReferences,
  validateSkillGroupings,
} from "./syncInstallableSkills.ts";

const ROOT_DIRECTORY = resolve(import.meta.dir, "../..");

const writeFile = (path: string, contents: string): void => {
  mkdirSync(join(path, ".."), {recursive: true});
  writeFileSync(path, contents);
};

describe("installable skills sync", (): void => {
  it("rewrites portable plugin reference links for a copied skill", (): void => {
    assert.equal(
      rewriteSharedPluginLinks("See [docs](../../references/documentation-contract.md)."),
      "See [docs](references/documentation-contract.md)."
    );
  });

  it("rewrites plugin-root docs links for the installable tree", (): void => {
    assert.equal(
      rewritePluginLinksForInstallable(
        "[skill](../../../../docs/reference/api.md) [ref](../../../../../docs/reference/ui.md)"
      ),
      "[skill](../../docs/reference/api.md) [ref](../../../docs/reference/ui.md)"
    );
  });

  it("uses the combined plugin as the installable Terreno skill source", (): void => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "terreno-skills-"));
    try {
      writeFile(
        join(fixtureRoot, ".rulesync/skills/mongoose-schema-safety/SKILL.md"),
        "from-rulesync\n"
      );
      writeFile(
        join(fixtureRoot, "plugins/terreno-planning/skills/terreno-1-grow/SKILL.md"),
        "Read [lifecycle](../../references/lifecycle-contract.md)\n"
      );
      writeFile(
        join(fixtureRoot, "plugins/terreno-planning/skills/mongoose-schema-safety/SKILL.md"),
        "from-plugin\n"
      );
      writeFile(
        join(fixtureRoot, "plugins/terreno-planning/references/lifecycle-contract.md"),
        "lifecycle\n"
      );
      writeFile(
        join(fixtureRoot, "plugins/terreno-planning/references/product-ci.md"),
        "product-ci-should-not-copy\n"
      );
      writeFile(
        join(fixtureRoot, "api/.ai/skills/mongoose-schema-safety/SKILL.md"),
        "from-package\n"
      );

      const destination = join(fixtureRoot, "skills");
      buildInstallableSkillsTree({destination, rootDirectory: fixtureRoot});

      assert.equal(
        readFileSync(join(destination, "mongoose-schema-safety/SKILL.md"), "utf8"),
        "from-plugin\n"
      );
      assert.equal(
        readFileSync(join(destination, "terreno-1-grow/SKILL.md"), "utf8"),
        "Read [lifecycle](references/lifecycle-contract.md)\n"
      );
      assert.equal(
        readFileSync(join(destination, "terreno-1-grow/references/lifecycle-contract.md"), "utf8"),
        "lifecycle\n"
      );
      assert.isFalse(existsSync(join(destination, "terreno-1-grow/references/product-ci.md")));
    } finally {
      rmSync(fixtureRoot, {force: true, recursive: true});
    }
  });

  it("keeps the committed installable tree in sync", (): void => {
    assert.deepEqual(syncInstallableSkills({check: true, rootDirectory: ROOT_DIRECTORY}), []);
  });

  it("does not copy unused plugin references into Roast", (): void => {
    assert.isFalse(
      existsSync(join(ROOT_DIRECTORY, "skills/terreno-3-roast/references/product-ci.md"))
    );
    assert.isFalse(
      existsSync(join(ROOT_DIRECTORY, "skills/terreno-3-roast/references/independent-review.md"))
    );
    assert.isTrue(
      existsSync(join(ROOT_DIRECTORY, "skills/terreno-3-roast/references/subagent-briefing.md"))
    );
    assert.isTrue(
      existsSync(join(ROOT_DIRECTORY, "skills/terreno-4-brew/references/product-ci.md"))
    );
  });

  it("bundles a linked lifecycle reference beside a repository skill and flags drift", (): void => {
    const root = mkdtempSync(join(tmpdir(), "terreno-rulesync-refs-"));
    try {
      mkdirSync(join(root, "plugins/terreno-planning/references"), {recursive: true});
      writeFileSync(
        join(root, "plugins/terreno-planning/references/push-ownership.md"),
        "# Push ownership\n"
      );
      mkdirSync(join(root, ".rulesync/skills/fix-conflicts"), {recursive: true});
      writeFileSync(
        join(root, ".rulesync/skills/fix-conflicts/SKILL.md"),
        "Follow [push ownership](references/push-ownership.md#escalation) and [local](references/local.md).\n"
      );
      const copy = join(root, ".rulesync/skills/fix-conflicts/references/push-ownership.md");

      assert.deepEqual(syncRulesyncPluginReferences({check: true, rootDirectory: root}), [
        ".rulesync/skills/fix-conflicts/references/push-ownership.md drifts from plugins/terreno-planning/references/push-ownership.md",
      ]);
      assert.deepEqual(syncRulesyncPluginReferences({rootDirectory: root}), []);
      assert.equal(readFileSync(copy, "utf8"), "# Push ownership\n");
      assert.isFalse(existsSync(join(root, ".rulesync/skills/fix-conflicts/references/local.md")));
      assert.deepEqual(syncRulesyncPluginReferences({check: true, rootDirectory: root}), []);
    } finally {
      rmSync(root, {force: true, recursive: true});
    }
  });

  it("rejects an ungrouped installable skill", (): void => {
    const errors = validateSkillGroupings(["terreno-1-grow", "mystery-skill"]);
    assert.isTrue(errors.some((error) => error.includes("mystery-skill")));
  });
});
