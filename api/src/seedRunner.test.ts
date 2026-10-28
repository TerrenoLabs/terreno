import {afterEach, describe, it} from "bun:test";
import {assert} from "chai";
import mongoose, {Schema} from "mongoose";

import {APIError} from "./errors";
import {isDeletedPlugin} from "./plugins";
import {runSeedCli, runSeeds, type SeedStep, seedBetterAuthUser} from "./seedRunner";

interface SeedWidgetDocument {
  key: string;
  label: string;
}

const seedWidgetSchema = new Schema<SeedWidgetDocument>({
  key: {description: "Stable seed key", required: true, type: String, unique: true},
  label: {description: "Seeded display label", required: true, type: String},
});
const SeedWidget =
  (mongoose.models.SeedRunnerWidget as mongoose.Model<SeedWidgetDocument> | undefined) ??
  mongoose.model<SeedWidgetDocument>("SeedRunnerWidget", seedWidgetSchema);

const widgetStep = (label: string): SeedStep => ({
  name: "widgets",
  reset: async (context) => {
    await context.deleteMany(SeedWidget);
  },
  run: async (context) => {
    await context.upsert(SeedWidget, {key: "primary"}, {label});
  },
});

interface SeedSoftWidgetDocument {
  content?: Map<string, string>;
  deleted?: boolean;
  key: string;
  label: string;
  rules?: Array<{_id?: mongoose.Types.ObjectId; name: string}>;
}

const seedSoftWidgetSchema = new Schema<SeedSoftWidgetDocument>({
  content: {
    description: "Localized seed content",
    of: {description: "Localized string", type: String},
    type: Map,
  },
  key: {description: "Stable seed key", required: true, type: String},
  label: {description: "Seeded display label", required: true, type: String},
  rules: {
    description: "Nested seed payload",
    type: [
      {
        name: {description: "Nested rule name", required: true, type: String},
      },
    ],
  },
});
seedSoftWidgetSchema.plugin(isDeletedPlugin);
const SeedSoftWidget =
  (mongoose.models.SeedRunnerSoftWidget as mongoose.Model<SeedSoftWidgetDocument> | undefined) ??
  mongoose.model<SeedSoftWidgetDocument>("SeedRunnerSoftWidget", seedSoftWidgetSchema);

interface SeedDatedWidgetDocument {
  key: string;
  label: string;
  note?: string | null;
  publishedAt?: Date;
}

const seedDatedWidgetSchema = new Schema<SeedDatedWidgetDocument>({
  key: {description: "Stable seed key", required: true, type: String},
  label: {description: "Seeded display label", required: true, type: String},
  note: {description: "Optional note", type: String},
  publishedAt: {description: "Publish timestamp", type: Date},
});
const SeedDatedWidget =
  (mongoose.models.SeedRunnerDatedWidget as mongoose.Model<SeedDatedWidgetDocument> | undefined) ??
  mongoose.model<SeedDatedWidgetDocument>("SeedRunnerDatedWidget", seedDatedWidgetSchema);

afterEach(async () => {
  await SeedWidget.deleteMany({});
  await SeedSoftWidget.deleteMany({});
  await SeedDatedWidget.deleteMany({});
  process.env.NODE_ENV = "test";
});

describe("runSeeds", () => {
  it("creates, updates, and then leaves keyed seed data unchanged", async () => {
    const created = await runSeeds({name: "test", steps: [widgetStep("First")]});
    const updated = await runSeeds({name: "test", steps: [widgetStep("Second")]});
    const unchanged = await runSeeds({name: "test", steps: [widgetStep("Second")]});

    assert.equal(created.summary.created, 1);
    assert.equal(updated.summary.updated, 1);
    assert.equal(unchanged.summary.unchanged, 1);
    assert.equal((await SeedWidget.findOne({key: "primary"}))?.label, "Second");
  });

  it("previews sync and reset operations without writing", async () => {
    await SeedWidget.create({key: "primary", label: "Old"});

    const result = await runSeeds({
      dryRun: true,
      mode: "reset",
      name: "test",
      steps: [widgetStep("New")],
    });

    assert.equal(result.summary.deleted, 1);
    assert.equal(result.summary.updated, 1);
    assert.equal((await SeedWidget.findOne({key: "primary"}))?.label, "Old");
  });

  it("runs selected steps with dependencies in declared order", async () => {
    const calls: string[] = [];
    const steps: SeedStep[] = [
      {name: "users", run: async () => void calls.push("users")},
      {
        dependsOn: ["users"],
        name: "todos",
        run: async () => void calls.push("todos"),
      },
      {name: "flags", run: async () => void calls.push("flags")},
    ];

    const result = await runSeeds({name: "test", only: ["todos"], steps});

    assert.deepEqual(calls, ["users", "todos"]);
    assert.deepEqual(result.steps, ["users", "todos"]);
  });

  it("runs reset handlers in reverse dependency order before reseeding", async () => {
    const calls: string[] = [];
    const steps: SeedStep[] = [
      {
        name: "parents",
        reset: async () => void calls.push("reset parents"),
        run: async () => void calls.push("seed parents"),
      },
      {
        dependsOn: ["parents"],
        name: "children",
        reset: async () => void calls.push("reset children"),
        run: async () => void calls.push("seed children"),
      },
    ];

    await runSeeds({mode: "reset", name: "test", steps});

    assert.deepEqual(calls, ["reset children", "reset parents", "seed parents", "seed children"]);
  });

  it("revives a soft-deleted document instead of creating a duplicate", async () => {
    const created = await SeedSoftWidget.create({key: "primary", label: "Old"});
    created.deleted = true;
    await created.save();

    const result = await runSeeds({
      name: "test",
      steps: [
        {
          name: "widgets",
          run: async (context) => {
            await context.upsert(SeedSoftWidget, {key: "primary"}, {label: "Restored"});
          },
        },
      ],
    });

    assert.equal(result.summary.created, 0);
    assert.equal(result.summary.updated, 1);
    assert.equal(await SeedSoftWidget.countDocuments({key: "primary"}), 1);
    const revived = await SeedSoftWidget.findOne({key: "primary"});
    assert.equal(revived?.label, "Restored");
    assert.isNotTrue(revived?.deleted);
  });

  it("treats nested subdocuments as unchanged when only generated ids differ", async () => {
    await runSeeds({
      name: "test",
      steps: [
        {
          name: "widgets",
          run: async (context) => {
            await context.upsert(
              SeedSoftWidget,
              {key: "flag"},
              {label: "Flag", rules: [{name: "admin-users"}]}
            );
          },
        },
      ],
    });
    const unchanged = await runSeeds({
      name: "test",
      steps: [
        {
          name: "widgets",
          run: async (context) => {
            await context.upsert(
              SeedSoftWidget,
              {key: "flag"},
              {label: "Flag", rules: [{name: "admin-users"}]}
            );
          },
        },
      ],
    });

    assert.equal(unchanged.summary.unchanged, 1);
    assert.equal(unchanged.summary.updated, 0);
  });

  it("collapses duplicate live documents for the same seed key", async () => {
    await SeedSoftWidget.create({key: "primary", label: "First"});
    await SeedSoftWidget.create({key: "primary", label: "Second"});

    const result = await runSeeds({
      name: "test",
      steps: [
        {
          name: "widgets",
          run: async (context) => {
            await context.upsert(SeedSoftWidget, {key: "primary"}, {label: "Canonical"});
          },
        },
      ],
    });

    assert.equal(result.summary.deleted, 1);
    assert.equal(result.summary.updated, 1);
    assert.equal((await SeedSoftWidget.find({key: "primary"})).length, 1);
    const kept = await SeedSoftWidget.findOne({key: "primary"});
    assert.equal(kept?.label, "Canonical");
    assert.equal((await SeedSoftWidget.find({deleted: true, key: "primary"})).length, 1);
  });

  it("treats Map seed values as unchanged after Mongoose stores them", async () => {
    const content = new Map([["en", "Hello"]]);
    const step: SeedStep = {
      name: "widgets",
      run: async (context) => {
        await context.upsert(SeedSoftWidget, {key: "form"}, {content, label: "Form"});
      },
    };
    await runSeeds({name: "test", steps: [step]});
    const unchanged = await runSeeds({name: "test", steps: [step]});

    assert.equal(unchanged.summary.unchanged, 1);
    assert.equal(unchanged.summary.updated, 0);
  });

  it("treats null and Date seed values as unchanged after Mongoose stores them", async () => {
    const step: SeedStep = {
      name: "widgets",
      run: async (context) => {
        await context.upsert(
          SeedDatedWidget,
          {key: "dated"},
          {label: "Dated", note: null, publishedAt: new Date("2024-01-02T03:04:05.000Z")}
        );
      },
    };
    const created = await runSeeds({name: "test", steps: [step]});
    const unchanged = await runSeeds({name: "test", steps: [step]});

    assert.equal(created.summary.created, 1);
    assert.equal(unchanged.summary.unchanged, 1);
    assert.equal(unchanged.summary.updated, 0);
  });

  it("hard-deletes duplicate documents when the model has no soft delete", async () => {
    await SeedDatedWidget.create({key: "dup", label: "First"});
    await SeedDatedWidget.create({key: "dup", label: "Second"});

    const result = await runSeeds({
      name: "test",
      steps: [
        {
          name: "widgets",
          run: async (context) => {
            await context.upsert(SeedDatedWidget, {key: "dup"}, {label: "Canonical"});
          },
        },
      ],
    });

    assert.equal(result.summary.deleted, 1);
    assert.equal(result.summary.updated, 1);
    const remaining = await SeedDatedWidget.find({key: "dup"});
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0]?.label, "Canonical");
  });

  it("reports deleteMany as unchanged when nothing matches", async () => {
    const result = await runSeeds({
      name: "test",
      steps: [
        {
          name: "widgets",
          run: async (context) => {
            await context.deleteMany(SeedWidget, {key: "missing"});
          },
        },
      ],
    });

    assert.equal(result.summary.unchanged, 0);
    assert.equal(result.summary.deleted, 0);
    assert.deepEqual(result.changes, [
      {
        change: "unchanged",
        count: 0,
        key: JSON.stringify({key: "missing"}),
        model: "SeedRunnerWidget",
      },
    ]);
  });

  it("rejects duplicate step names", async () => {
    let thrown: unknown;
    try {
      await runSeeds({
        name: "test",
        steps: [
          {name: "same", run: async () => {}},
          {name: "same", run: async () => {}},
        ],
      });
    } catch (error: unknown) {
      thrown = error;
    }

    assert.instanceOf(thrown, APIError);
    assert.equal((thrown as APIError).title, "Seed step names must be unique");
  });

  it("rejects unknown --only steps with the available step names", async () => {
    let thrown: unknown;
    try {
      await runSeeds({
        name: "test",
        only: ["nope"],
        steps: [
          {name: "one", run: async () => {}},
          {name: "two", run: async () => {}},
        ],
      });
    } catch (error: unknown) {
      thrown = error;
    }

    assert.instanceOf(thrown, APIError);
    assert.equal((thrown as APIError).status, 400);
    assert.equal((thrown as APIError).title, "Unknown seed step");
    assert.include((thrown as APIError).detail ?? "", "one, two");
  });

  it("rejects dependency cycles when selecting steps", async () => {
    let thrown: unknown;
    try {
      await runSeeds({
        name: "test",
        only: ["a"],
        steps: [
          {dependsOn: ["b"], name: "a", run: async () => {}},
          {dependsOn: ["a"], name: "b", run: async () => {}},
        ],
      });
    } catch (error: unknown) {
      thrown = error;
    }

    assert.instanceOf(thrown, APIError);
    assert.equal((thrown as APIError).title, "Seed step dependency cycle");
    assert.equal((thrown as APIError).detail, "a -> b -> a");
  });

  it("includes a shared dependency only once", async () => {
    const calls: string[] = [];
    const result = await runSeeds({
      name: "test",
      only: ["left", "right"],
      steps: [
        {name: "base", run: async () => void calls.push("base")},
        {dependsOn: ["base"], name: "left", run: async () => void calls.push("left")},
        {dependsOn: ["base"], name: "right", run: async () => void calls.push("right")},
        {name: "skipped", run: async () => void calls.push("skipped")},
      ],
    });

    assert.deepEqual(result.steps, ["base", "left", "right"]);
    assert.deepEqual(calls, ["base", "left", "right"]);
  });

  it("blocks production resets unless forced and explicitly allowed", async () => {
    process.env.NODE_ENV = "production";

    let resetError: unknown;
    try {
      await runSeeds({force: true, mode: "reset", name: "test", steps: []});
    } catch (error: unknown) {
      resetError = error;
    }
    assert.match(String(resetError), /Production seed reset is disabled/);
    const result = await runSeeds({
      allowProductionReset: true,
      force: true,
      mode: "reset",
      name: "test",
      steps: [],
    });
    assert.isTrue(result.success);
  });
});

describe("runSeedCli", () => {
  it("parses reset, dry-run, force, and repeated only options", async () => {
    const calls: string[] = [];
    const steps: SeedStep[] = [
      {
        name: "one",
        reset: async () => void calls.push("reset one"),
        run: async () => void calls.push("one"),
      },
      {name: "two", run: async () => void calls.push("two")},
    ];

    const cli = await runSeedCli({
      argv: ["--reset", "--dry-run", "--force", "--only", "one"],
      name: "bun run seed",
      steps,
    });

    assert.equal(cli.exitCode, 0);
    assert.equal(cli.result?.mode, "reset");
    assert.isTrue(cli.result?.dryRun);
    assert.deepEqual(calls, ["reset one", "one"]);
  });

  it("returns help without connecting and rejects unknown options", async () => {
    let didConnect = false;
    const help = await runSeedCli({
      argv: ["--help"],
      connect: async () => {
        didConnect = true;
      },
      name: "bun run seed",
      steps: [widgetStep("Example")],
    });
    const invalid = await runSeedCli({
      argv: ["--wat"],
      name: "bun run seed",
      steps: [],
    });

    assert.equal(help.exitCode, 0);
    assert.include(help.help ?? "", "--reset");
    assert.isFalse(didConnect);
    assert.equal(invalid.exitCode, 2);
    assert.include(invalid.help ?? "", "Unknown option(s): --wat");
  });

  it("parses --only=<step> and returns exit code 1 when seeding fails", async () => {
    const calls: string[] = [];
    const ok = await runSeedCli({
      argv: ["--only=two"],
      name: "bun run seed",
      steps: [
        {name: "one", run: async () => void calls.push("one")},
        {name: "two", run: async () => void calls.push("two")},
      ],
    });
    assert.equal(ok.exitCode, 0);
    assert.deepEqual(calls, ["two"]);

    const errors: string[] = [];
    const failed = await runSeedCli({
      argv: [],
      log: {
        catch: () => {},
        debug: () => {},
        error: (message: string) => void errors.push(message),
        info: () => {},
        warn: () => {},
      },
      name: "bun run seed",
      steps: [
        {
          name: "boom",
          run: async () => {
            throw new Error("seed exploded");
          },
        },
      ],
    });
    assert.equal(failed.exitCode, 1);
    assert.isUndefined(failed.result);
    assert.deepEqual(errors, ["Seed failed: seed exploded"]);
  });
});

interface SeedAuthUserDocument {
  betterAuthId?: string;
  email: string;
  name?: string;
}

const seedAuthUserSchema = new Schema<SeedAuthUserDocument>({
  betterAuthId: {description: "Better Auth id", type: String},
  email: {description: "Email", required: true, type: String},
  name: {description: "Name", type: String},
});
const SeedAuthUser =
  (mongoose.models.SeedRunnerAuthUser as mongoose.Model<SeedAuthUserDocument> | undefined) ??
  mongoose.model<SeedAuthUserDocument>("SeedRunnerAuthUser", seedAuthUserSchema);

describe("seedBetterAuthUser", () => {
  const seedUser = {email: "seed@example.com", name: "Seed User", password: "testpassword123"};

  afterEach(async () => {
    await SeedAuthUser.deleteMany({});
  });

  it("creates an application user from a successful sign-up", async () => {
    const authId = new mongoose.Types.ObjectId().toString();
    const auth = {
      api: {
        signUpEmail: async () => ({
          user: {email: seedUser.email, id: authId, name: seedUser.name},
        }),
      },
    };

    const user = await seedBetterAuthUser({
      auth: auth as never,
      user: seedUser,
      userModel: SeedAuthUser as never,
    });

    assert.equal(user.email, seedUser.email);
    assert.equal((user as {betterAuthId?: string}).betterAuthId, authId);
  });

  it("links an application user that already exists for the seeded email", async () => {
    const existing = await SeedAuthUser.create({email: seedUser.email, name: "Legacy Seed"});
    const authId = new mongoose.Types.ObjectId().toString();
    const auth = {
      api: {
        signUpEmail: async () => ({
          user: {email: seedUser.email, emailVerified: false, id: authId, name: seedUser.name},
        }),
      },
    };

    const user = await seedBetterAuthUser({
      auth: auth as never,
      user: seedUser,
      userModel: SeedAuthUser as never,
    });

    assert.equal(String((user as {_id?: unknown})._id), String(existing._id));
    assert.equal((user as {betterAuthId?: string}).betterAuthId, authId);
  });

  it("falls back to sign-in when sign-up fails", async () => {
    const authId = new mongoose.Types.ObjectId().toString();
    const auth = {
      api: {
        signInEmail: async () => ({
          user: {email: seedUser.email, id: authId, name: seedUser.name},
        }),
        signUpEmail: async () => {
          throw new Error("already exists");
        },
      },
    };

    const user = await seedBetterAuthUser({
      auth: auth as never,
      user: seedUser,
      userModel: SeedAuthUser as never,
    });

    assert.equal(user.email, seedUser.email);
    assert.equal((user as {betterAuthId?: string}).betterAuthId, authId);
  });

  it("throws APIError when Better Auth returns no user", async () => {
    const auth = {
      api: {
        signInEmail: async () => ({user: undefined}),
        signUpEmail: async () => {
          throw new Error("already exists");
        },
      },
    };

    let thrown: unknown;
    try {
      await seedBetterAuthUser({
        auth: auth as never,
        user: seedUser,
        userModel: SeedAuthUser as never,
      });
    } catch (error: unknown) {
      thrown = error;
    }

    assert.instanceOf(thrown, APIError);
    assert.equal((thrown as APIError).title, "Better Auth seed returned no user");
  });
});
