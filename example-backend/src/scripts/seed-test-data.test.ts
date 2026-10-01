import {describe, it} from "bun:test";
import {LocalDatasetStore, LocalEvaluatorStore, LocalPromptStore} from "@terreno/ai";
import {ConsentForm, Membership, Notification, Organization, runSeeds} from "@terreno/api";
import {CommsMessage} from "@terreno/comms";
import {assert} from "chai";
import {DateTime} from "luxon";
import {Project} from "../models/project";
import {Todo} from "../models/todo";
import {User} from "../models/user";
import {EXAMPLE_SUMMARIZE_PROMPT, seedDefaultData, seedSteps} from "./seed-test-data";

describe("seedDefaultData", () => {
  it("idempotently seeds the default users and example records", async () => {
    await seedDefaultData();
    await seedDefaultData();

    const admin = await User.findByEmail("admin@example.com");
    const operator = await User.findByEmail("operator@example.com");
    const alphaAdmin = await User.findByEmail("orgadmin-alpha@example.com");
    const betaAdmin = await User.findByEmail("orgadmin-beta@example.com");
    const superadmin = await User.findByEmail("superadmin@example.com");
    const user = await User.findByEmail("test@example.com");

    assert.exists(admin);
    assert.exists(operator);
    assert.exists(alphaAdmin);
    assert.exists(betaAdmin);
    assert.exists(superadmin);
    assert.exists(user);
    if (!admin || !operator || !alphaAdmin || !betaAdmin || !superadmin || !user) {
      assert.fail("Default users were not seeded");
    }

    assert.isTrue(admin.admin);
    assert.isTrue(superadmin.admin);
    assert.include(superadmin.roles, "superadmin");
    assert.include(operator.roles, "operator");
    const alpha = await Organization.findExactlyOne({name: "Alpha Workspace"});
    const beta = await Organization.findExactlyOne({name: "Beta Workspace"});
    assert.isTrue(await Membership.isOrgAdmin(alphaAdmin._id, alpha._id));
    assert.isTrue(await Membership.isOrgAdmin(betaAdmin._id, beta._id));
    assert.isTrue(await Membership.isMember(user._id, alpha._id));
    assert.equal(
      await User.countDocuments({
        email: {
          $in: [
            admin.email,
            operator.email,
            alphaAdmin.email,
            betaAdmin.email,
            superadmin.email,
            user.email,
          ],
        },
      }),
      6
    );
    assert.equal(await Project.countDocuments({organizationId: String(alpha._id)}), 2);
    assert.equal(await Todo.countDocuments({ownerId: user._id}), 2);
    assert.equal(await Notification.countDocuments({kind: "seed", ownerId: user._id}), 3);
    assert.equal(
      await Notification.countDocuments({
        archivedAt: {$ne: null},
        kind: "seed",
        ownerId: user._id,
      }),
      1
    );
    const archivedExample = await Notification.findExactlyOne({
      kind: "seed",
      ownerId: user._id,
      title: "Archived example",
    });
    assert.isOk(archivedExample.archivedAt);
    assert.isFalse(archivedExample.deleted);
    assert.isNumber(archivedExample.get("_syncSeq"));
    assert.equal(await ConsentForm.countDocuments({}), 3);
    assert.equal(await CommsMessage.countDocuments({"metadata.demoSeed": true}), 10);
    const promptStore = new LocalPromptStore();
    const prompt = (await promptStore.list({search: "example-summarize"})).find(
      (entry) => entry.name === "example-summarize"
    );
    assert.equal(prompt?.folder, "examples");
    assert.equal(prompt?.latestVersion, 2);
    assert.equal(prompt?.production, 1);
    assert.equal(prompt?.type, "chat");
    const promptDetail = await promptStore.getDetail("example-summarize");
    assert.equal(promptDetail.versions[0]?.system, EXAMPLE_SUMMARIZE_PROMPT.system);
    assert.equal(promptDetail.versions[0]?.template, EXAMPLE_SUMMARIZE_PROMPT.template);
    assert.equal(promptDetail.versions[0]?.variables[0]?.key, "text");
    assert.include(promptDetail.tags, "example");
    const evaluator = (await new LocalEvaluatorStore().list()).find(
      (entry) => entry.name === "correctness-human"
    );
    assert.equal(evaluator?.type, "human");
    assert.equal(evaluator?.dimensions[0]?.key, "correct");
    assert.equal(evaluator?.dimensions[0]?.dataType, "boolean");
    assert.isTrue(evaluator?.dimensions[0]?.required);
    assert.equal(evaluator?.runModes.liveSampleRate, 0);
    const schemaEvaluator = (await new LocalEvaluatorStore().list()).find(
      (entry) => entry.name === "schema-assert"
    );
    assert.equal(schemaEvaluator?.type, "json-assert");
    const dataset = (await new LocalDatasetStore(promptStore).list()).find(
      (entry) => entry.name === "example-gold"
    );
    assert.equal(dataset?.counts.total, 2);
    assert.equal(dataset?.counts.human, 2);
    assert.equal(dataset?.inputSchemaPromptName, "example-summarize");
    const screen = (await promptStore.list({search: "chat-safety-screen"})).find(
      (entry) => entry.name === "chat-safety-screen"
    );
    assert.equal(screen?.latestVersion, 2);
    assert.equal(screen?.production, 1);
    const judge = (await promptStore.list({search: "chat-safety-judge"})).find(
      (entry) => entry.name === "chat-safety-judge"
    );
    assert.equal(judge?.production, 1);
    const safetyEvaluator = (await new LocalEvaluatorStore().list()).find(
      (entry) => entry.name === "chat-safety-agreement"
    );
    assert.equal(safetyEvaluator?.type, "llm-judge");
    assert.equal(safetyEvaluator?.judgePromptName, "chat-safety-judge");
    assert.equal(safetyEvaluator?.dimensions.length, 5);
    assert.equal(safetyEvaluator?.target, "generation span");
    const safetyDataset = (await new LocalDatasetStore(promptStore).list()).find(
      (entry) => entry.name === "chat-safety-synthetic"
    );
    assert.equal(safetyDataset?.counts.total, 12);
    assert.equal(safetyDataset?.counts.human, 12);
    assert.equal(safetyDataset?.inputSchemaPromptName, "chat-safety-screen");
    if (!safetyDataset) {
      assert.fail("chat-safety-synthetic was not seeded");
    }
    const safetyItems = await new LocalDatasetStore(promptStore).listItems(safetyDataset.id);
    assert.equal(safetyItems.length, 12);
    assert.isTrue(
      safetyItems.every((item) => {
        return item.origin === "synthetic" && item.proofread;
      })
    );
    assert.equal(
      await CommsMessage.countDocuments({
        "metadata.demoSeed": true,
        status: {$in: ["bounced", "failed"]},
      }),
      2
    );
    const oldestSeededMessages = await CommsMessage.find({"metadata.demoSeed": true})
      .sort({created: 1})
      .limit(1);
    const oldestSeededMessage = oldestSeededMessages[0];
    assert.exists(oldestSeededMessage);
    assert.isTrue(
      DateTime.fromJSDate(
        oldestSeededMessage?.created ?? DateTime.utc().minus({days: 2}).toJSDate()
      ).diffNow("days").days > -1
    );
  });

  it("previews todo creates on a first-time dry-run", async () => {
    await User.deleteMany({});

    const preview = await runSeeds({
      dryRun: true,
      name: "example-backend",
      steps: seedSteps,
    });

    assert.isAtLeast(preview.summary.created, 2);
    assert.includeMembers(
      preview.changes.map((change) => change.model),
      ["ObsPrompt", "ObsEvaluator"]
    );
    assert.equal(await User.countDocuments({}), 0);
  });
});
