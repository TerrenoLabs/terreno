/**
 * Tests for the migrate lock: wait, heartbeat, and steal after TTL.
 */
import {beforeEach, describe, expect, it} from "bun:test";
import {DateTime} from "luxon";
import mongoose from "mongoose";

import {setupDb} from "../tests";
import {withMigrationLock} from "./lock";
import {runMigrations} from "./runner";
import {
  type LoadedMigration,
  MIGRATION_LOCK_ID,
  MIGRATIONS_COLLECTION,
  type MigrationStoreDoc,
} from "./types";

const collection = (): mongoose.Collection<MigrationStoreDoc> => {
  return mongoose.connection.collection<MigrationStoreDoc>(MIGRATIONS_COLLECTION);
};

describe("withMigrationLock", () => {
  beforeEach(async () => {
    await setupDb();
    await collection().deleteMany({});
  });

  it("releases the lock in finally", async () => {
    await withMigrationLock({
      connection: mongoose.connection,
      fn: async () => "ok",
      ttlMs: 60_000,
    });

    const lock = await collection().findOne({_id: MIGRATION_LOCK_ID});
    expect(lock).toBeNull();
  });

  it("steals a lock whose expiresAt is in the past", async () => {
    await collection().insertOne({
      _id: MIGRATION_LOCK_ID,
      expiresAt: DateTime.now().minus({minutes: 11}).toJSDate(),
      heartbeatAt: DateTime.now().minus({minutes: 11}).toJSDate(),
      holder: "dead-holder",
    });

    let ran = false;
    await withMigrationLock({
      connection: mongoose.connection,
      fn: async () => {
        ran = true;
      },
      pollMs: 10,
      ttlMs: 60_000,
    });

    expect(ran).toBe(true);
    const lock = await collection().findOne({_id: MIGRATION_LOCK_ID});
    expect(lock).toBeNull();
  });

  it("heartbeats the lock while the critical section runs", async () => {
    await withMigrationLock({
      connection: mongoose.connection,
      fn: async () => {
        const first = await collection().findOne({_id: MIGRATION_LOCK_ID});
        await Bun.sleep(400);
        const second = await collection().findOne({_id: MIGRATION_LOCK_ID});
        expect(second?.heartbeatAt).toBeDefined();
        const firstBeat = DateTime.fromJSDate(first?.heartbeatAt as Date);
        const secondBeat = DateTime.fromJSDate(second?.heartbeatAt as Date);
        expect(secondBeat.toMillis()).toBeGreaterThan(firstBeat.toMillis());
      },
      holder: "heartbeat-holder",
      pollMs: 10,
      ttlMs: 150,
    });
    expect(await collection().findOne({_id: MIGRATION_LOCK_ID})).toBeNull();
  });

  it("rethrows non-duplicate insert errors while acquiring", async () => {
    const col = collection();
    const originalInsertOne = col.insertOne.bind(col);
    Object.assign(col, {
      insertOne: async () => {
        throw Object.assign(new Error("write concern"), {code: 50});
      },
    });
    try {
      await expect(
        withMigrationLock({
          connection: mongoose.connection,
          fn: async () => "ok",
          pollMs: 10,
          ttlMs: 60_000,
        })
      ).rejects.toThrow("write concern");
    } finally {
      Object.assign(col, {insertOne: originalInsertOne});
    }
  });
});

describe("runMigrations lock", () => {
  beforeEach(async () => {
    await setupDb();
    await collection().deleteMany({});
  });

  it("serializes overlapping wet runs", async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const migrations: LoadedMigration[] = [
      {
        checksum: "lock-1",
        id: "20260910130000-lock",
        up: async () => {
          concurrent += 1;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          await Bun.sleep(80);
          concurrent -= 1;
        },
      },
    ];
    const options = {
      connection: mongoose.connection,
      dryRun: false,
      migrations,
      mongoose,
    };

    await Promise.all([runMigrations(options), runMigrations(options)]);

    expect(maxConcurrent).toBe(1);
    const stored = await collection().findOne({_id: "20260910130000-lock"});
    expect(stored?.checksum).toBe("lock-1");
  });
});
