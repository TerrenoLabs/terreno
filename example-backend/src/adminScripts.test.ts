import {beforeEach, describe, it} from "bun:test";
import {
  ConsentForm,
  Organization,
  TerrenoApp,
  type UserModel as TerrenoAuthUserModel,
} from "@terreno/api";
import {FeatureFlag} from "@terreno/feature-flags";
import {Job} from "@terreno/jobs";
import {assert} from "chai";
import {access} from "./access";
import {adminScripts, isDatabaseResetAllowed, resetExampleDatabase} from "./adminScripts";
import {createExampleJobsApp} from "./jobs/createExampleJobsApp";
import {Project} from "./models/project";
import {Todo} from "./models/todo";
import {User} from "./models/user";
import {seedDefaultData} from "./scripts/seed-test-data";

describe("resetDatabase admin script", () => {
  it("requires an explicit override for live production resets", () => {
    assert.isFalse(isDatabaseResetAllowed({isExplicitlyAllowed: false, isProduction: true}));
    assert.isTrue(isDatabaseResetAllowed({isExplicitlyAllowed: true, isProduction: true}));
    assert.isTrue(isDatabaseResetAllowed({isExplicitlyAllowed: false, isProduction: false}));
  });

  it("is registered for the admin script runner", () => {
    const script = adminScripts.find(({name}) => name === "resetDatabase");

    assert.exists(script);
    assert.match(script?.description ?? "", /restore defaults/i);
  });

  it("reports affected records without changing data during a dry run", async () => {
    await seedDefaultData();
    const before = await Todo.countDocuments();

    const result = await resetExampleDatabase(false);

    assert.isTrue(result.success);
    assert.match(result.results[0], /Dry run: would reset/);
    assert.equal(await Todo.countDocuments(), before);
  });

  it("clears example data, restores defaults, and preserves the superuser", async () => {
    await seedDefaultData();
    const user = await User.findByEmail("test@example.com");
    assert.exists(user);
    if (!user) {
      assert.fail("Seeded test user is required");
    }
    const organization = await Organization.findExactlyOne({name: "Alpha Workspace"});
    await Todo.create({ownerId: user._id, title: "Temporary reset record"});
    await Project.create({
      organizationId: String(organization._id),
      title: "Temporary reset project",
    });

    const result = await resetExampleDatabase(true);

    assert.isTrue(result.success);
    assert.equal(await Todo.countDocuments({deleted: {$ne: true}, ownerId: user._id}), 2);
    assert.equal(
      await Project.countDocuments({
        deleted: {$ne: true},
        organizationId: String(organization._id),
      }),
      2
    );
    assert.equal(await ConsentForm.countDocuments(), 3);
    assert.equal(await FeatureFlag.countDocuments(), 6);
    const superadmin = await User.findByEmail("superadmin@example.com");
    assert.exists(superadmin);
    assert.isTrue(superadmin?.admin);
    assert.include(superadmin?.roles ?? [], "superadmin");
  });
});

describe("seedChatSafetyDataset admin script", () => {
  it("is registered for the admin script runner", () => {
    const script = adminScripts.find(({name}) => name === "seedChatSafetyDataset");
    assert.exists(script);
    assert.match(script?.description ?? "", /chat-safety/i);
  });

  it("leaves the seeded dataset unchanged on dry and wet runs", async () => {
    await seedDefaultData();
    const script = adminScripts.find(({name}) => name === "seedChatSafetyDataset");
    if (!script) {
      assert.fail("seedChatSafetyDataset is not registered");
    }
    const dry = await script.runner(false);
    const wet = await script.runner(true);
    assert.isTrue(dry.success);
    assert.isTrue(wet.success);
    assert.isTrue(
      dry.results.some((line) => {
        return line.includes("left unchanged");
      })
    );
    assert.isTrue(
      wet.results.some((line) => {
        return line.includes("left unchanged");
      })
    );
  });
});

describe("enqueueDlqDemoJob admin script", () => {
  const typedUserModel = User as unknown as TerrenoAuthUserModel;

  beforeEach(async (): Promise<void> => {
    await Job.deleteMany({});
    const jobsApp = createExampleJobsApp({accessControl: access});
    new TerrenoApp({
      skipListen: true,
      userModel: typedUserModel,
    })
      .register(jobsApp)
      .build();
  });

  it("is registered for the admin script runner", () => {
    const script = adminScripts.find(({name}) => name === "enqueueDlqDemoJob");
    assert.exists(script);
    assert.match(script?.description ?? "", /dead-letter|DLQ/i);
  });

  it("reports a dry run without enqueueing a job", async () => {
    const script = adminScripts.find(({name}) => name === "enqueueDlqDemoJob");
    assert.exists(script);

    const result = await script.runner(false);
    assert.isTrue(result.success);
    assert.match(result.results[0], /Dry run/i);
    assert.equal(await Job.countDocuments(), 0);
  });

  it("enqueues example/dlq-demo on a wet run", async () => {
    const script = adminScripts.find(({name}) => name === "enqueueDlqDemoJob");
    assert.exists(script);

    const result = await script.runner(true);
    assert.isTrue(result.success);
    assert.match(result.results[0], /Enqueued example\/dlq-demo/);
    assert.equal(await Job.countDocuments(), 1);

    const job = await Job.findOne({});
    assert.equal(job?.name, "example/dlq-demo");
    assert.deepEqual(job?.payload, {source: "enqueueDlqDemoJob"});
  });
});
