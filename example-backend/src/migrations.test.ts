import {describe, it} from "bun:test";
import {
  checkMigrationFiles,
  exerciseReversibleMigrations,
  MIGRATIONS_COLLECTION,
  type MigrationStoreDoc,
  runSeeds,
} from "@terreno/api";
import {assert} from "chai";
import mongoose from "mongoose";
import supertest from "supertest";
import {resolveExampleMigrationsDir} from "./migrationsDir";
import {seedSteps} from "./scripts/seed-test-data";
import {start} from "./server";

const expectedId = "20260910120000-todos-title-owner-index";

const migrationsCollection = (): mongoose.Collection<MigrationStoreDoc> => {
  return mongoose.connection.collection<MigrationStoreDoc>(MIGRATIONS_COLLECTION);
};

describe("example-backend migrations", () => {
  it("loads timestamped files from migrations/", async () => {
    const loaded = await checkMigrationFiles({dir: resolveExampleMigrationsDir()});
    assert.deepEqual(
      loaded.map((migration) => migration.id),
      [expectedId]
    );
    assert.isFunction(loaded[0]?.down);
    assert.exists(loaded[0]?.schemaAfter);
  });

  it("applies and reverses the example todos index", async () => {
    const result = await exerciseReversibleMigrations({
      connect: async () => mongoose.connection,
      dir: resolveExampleMigrationsDir(),
    });
    assert.deepEqual(result.applied, [expectedId]);
    assert.deepEqual(result.reversed, [expectedId]);
    assert.isNull(result.skippedIrreversible);
  });

  it("does not wipe terreno_migrations on seed reset", async () => {
    await migrationsCollection().insertOne({
      _id: "keep-me",
      appliedAt: new Date(),
      checksum: "abc",
      id: "keep-me",
    });

    await runSeeds({mode: "reset", name: "example-backend", steps: seedSteps});

    const kept = await migrationsCollection().findOne({_id: "keep-me"});
    assert.exists(kept);
    // A full seed hashes every user's password; on a loaded machine that passes Bun's 5s default.
  }, 30_000);

  it("mounts admin migrations on the example server", async () => {
    const app = await start(true);
    await supertest(app).get("/admin/migrations/status").expect(401);
  });
});
