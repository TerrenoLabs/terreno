/**
 * Tests for applying, rolling back, and inspecting migration history, plus the
 * production wet-apply gate and the CI reverse-exercise helper.
 */
import {beforeEach, describe, expect, it} from "bun:test";
import {join} from "node:path";
import mongoose from "mongoose";

import {APIError} from "../errors";
import {setupDb} from "../tests";
import {
  assertMigrationsAllowed,
  exerciseReversibleMigrations,
  getMigrationStatus,
  runDownMigrations,
  runMigrations,
} from "./runner";
import {
  type LoadedMigration,
  MIGRATION_LOCK_ID,
  MIGRATIONS_COLLECTION,
  type MigrationStoreDoc,
} from "./types";

/** Stored rows, including legacy ones that kept timestamps as ISO strings. */
type StoredMigrationDoc = Omit<MigrationStoreDoc, "appliedAt" | "expiresAt"> & {
  appliedAt?: Date | string;
  expiresAt?: Date | string;
};

const collection = (): mongoose.Collection<StoredMigrationDoc> => {
  return mongoose.connection.collection<StoredMigrationDoc>(MIGRATIONS_COLLECTION);
};

const appliedIds = async (): Promise<string[]> => {
  const docs = await collection()
    .find({_id: {$ne: MIGRATION_LOCK_ID}})
    .project({id: 1})
    .toArray();
  return docs.map((doc) => String(doc.id));
};

const makeMigration = ({
  id,
  checksum,
  up,
}: {
  id: string;
  checksum: string;
  up: LoadedMigration["up"];
}): LoadedMigration => {
  return {checksum, id, up};
};

describe("runMigrations", () => {
  beforeEach(async () => {
    await setupDb();
    await collection().deleteMany({});
  });

  it("calls up with dryRun true and does not record history", async () => {
    const seen: boolean[] = [];
    const migrations = [
      makeMigration({
        checksum: "aaa",
        id: "20260910120000-dry",
        up: async (ctx) => {
          seen.push(ctx.dryRun);
        },
      }),
    ];

    const result = await runMigrations({
      connection: mongoose.connection,
      dryRun: true,
      migrations,
      mongoose,
    });

    expect(result.dryRun).toBe(true);
    expect(result.applied).toEqual(["20260910120000-dry"]);
    expect(seen).toEqual([true]);
    expect(await appliedIds()).toEqual([]);
  });

  it("records checksum and appliedAt on a wet run", async () => {
    const migrations = [
      makeMigration({
        checksum: "bbb",
        id: "20260910120000-wet",
        up: async () => undefined,
      }),
    ];

    const result = await runMigrations({
      connection: mongoose.connection,
      dryRun: false,
      migrations,
      mongoose,
    });

    expect(result.applied).toEqual(["20260910120000-wet"]);
    expect(result.skipped).toEqual([]);
    const stored = await collection().findOne({_id: "20260910120000-wet"});
    expect(stored?.id).toBe("20260910120000-wet");
    expect(stored?.checksum).toBe("bbb");
    expect(stored?.appliedAt).toBeInstanceOf(Date);
  });

  it("skips already-applied ids on a second wet run", async () => {
    let calls = 0;
    const migrations = [
      makeMigration({
        checksum: "ccc",
        id: "20260910120000-once",
        up: async () => {
          calls += 1;
        },
      }),
    ];
    const options = {
      connection: mongoose.connection,
      dryRun: false,
      migrations,
      mongoose,
    };

    await runMigrations(options);
    const second = await runMigrations(options);

    expect(calls).toBe(1);
    expect(second.applied).toEqual([]);
    expect(second.skipped).toEqual(["20260910120000-once"]);
  });

  it("throws when an applied id has a different checksum", async () => {
    await runMigrations({
      connection: mongoose.connection,
      dryRun: false,
      migrations: [
        makeMigration({
          checksum: "original",
          id: "20260910120000-edit",
          up: async () => undefined,
        }),
      ],
      mongoose,
    });

    await expect(
      runMigrations({
        connection: mongoose.connection,
        dryRun: false,
        migrations: [
          makeMigration({
            checksum: "edited",
            id: "20260910120000-edit",
            up: async () => undefined,
          }),
        ],
        mongoose,
      })
    ).rejects.toThrow("checksum");
  });
});

describe("runDownMigrations", () => {
  beforeEach(async () => {
    await setupDb();
    await collection().deleteMany({});
  });

  it("rolls back the last applied migration and deletes history", async () => {
    const events: string[] = [];
    const migrations: LoadedMigration[] = [
      {
        checksum: "one",
        down: async () => {
          events.push("down-a");
        },
        id: "20260910120000-a",
        up: async () => {
          events.push("up-a");
        },
      },
      {
        checksum: "two",
        down: async () => {
          events.push("down-b");
        },
        id: "20260910120001-b",
        up: async () => {
          events.push("up-b");
        },
      },
    ];

    await runMigrations({
      connection: mongoose.connection,
      dryRun: false,
      migrations,
      mongoose,
    });
    const result = await runDownMigrations({
      connection: mongoose.connection,
      dryRun: false,
      migrations,
      mongoose,
      steps: 1,
    });

    expect(result.reversed).toEqual(["20260910120001-b"]);
    expect(events).toEqual(["up-a", "up-b", "down-b"]);
    expect(await appliedIds()).toEqual(["20260910120000-a"]);
  });

  it("does not delete history on dry-run down", async () => {
    const migrations: LoadedMigration[] = [
      {
        checksum: "dry-down",
        down: async (ctx) => {
          expect(ctx.dryRun).toBe(true);
        },
        id: "20260910120000-dry-down",
        up: async () => undefined,
      },
    ];
    await runMigrations({
      connection: mongoose.connection,
      dryRun: false,
      migrations,
      mongoose,
    });

    const result = await runDownMigrations({
      connection: mongoose.connection,
      dryRun: true,
      migrations,
      mongoose,
      steps: 1,
    });

    expect(result.reversed).toEqual(["20260910120000-dry-down"]);
    expect(await appliedIds()).toEqual(["20260910120000-dry-down"]);
  });

  it("throws when the target migration has no down", async () => {
    const migrations: LoadedMigration[] = [
      {
        checksum: "irreversible",
        id: "20260910120000-irreversible",
        up: async () => undefined,
      },
    ];
    await runMigrations({
      connection: mongoose.connection,
      dryRun: false,
      migrations,
      mongoose,
    });

    await expect(
      runDownMigrations({
        connection: mongoose.connection,
        dryRun: false,
        migrations,
        mongoose,
        steps: 1,
      })
    ).rejects.toThrow("has no down");
    expect(await appliedIds()).toEqual(["20260910120000-irreversible"]);
  });

  it("rejects a non-positive or non-integer steps value before touching history", async () => {
    const migrations: LoadedMigration[] = [
      {
        checksum: "steps",
        down: async () => undefined,
        id: "20260910120000-steps",
        up: async () => undefined,
      },
    ];
    await runMigrations({connection: mongoose.connection, dryRun: false, migrations, mongoose});

    for (const steps of [0, -1, 1.5]) {
      await expect(
        runDownMigrations({
          connection: mongoose.connection,
          dryRun: false,
          migrations,
          mongoose,
          steps,
        })
      ).rejects.toThrow("Invalid down steps");
    }
    expect(await appliedIds()).toEqual(["20260910120000-steps"]);
  });

  it("stops before up when checkCancellation rejects", async () => {
    let ran = false;
    await expect(
      runMigrations({
        checkCancellation: async () => {
          throw new APIError({status: 409, title: "Task was cancelled"});
        },
        connection: mongoose.connection,
        dryRun: false,
        migrations: [
          makeMigration({
            checksum: "cancel",
            id: "20260910120000-cancel",
            up: async () => {
              ran = true;
            },
          }),
        ],
        mongoose,
      })
    ).rejects.toThrow("cancelled");
    expect(ran).toBe(false);
    expect(await appliedIds()).toEqual([]);
  });
});

describe("getMigrationStatus", () => {
  beforeEach(async () => {
    await setupDb();
    await collection().deleteMany({});
  });

  const migrations: LoadedMigration[] = [
    {checksum: "one", id: "20260910120000-a", up: async () => undefined},
    {checksum: "two", id: "20260910120001-b", up: async () => undefined},
  ];

  it("splits migrations into applied and pending with no lock", async () => {
    await runMigrations({
      connection: mongoose.connection,
      dryRun: false,
      migrations: [migrations[0]],
      mongoose,
    });

    const status = await getMigrationStatus({connection: mongoose.connection, migrations});

    expect(status.lock).toBeNull();
    expect(status.pending).toEqual([{checksum: "two", id: "20260910120001-b"}]);
    expect(status.applied).toHaveLength(1);
    expect(status.applied[0].id).toBe("20260910120000-a");
    expect(status.applied[0].checksum).toBe("one");
    expect(status.applied[0].appliedAt).toBeInstanceOf(Date);
  });

  it("reports the active lock holder and expiry", async () => {
    const expiresAt = new Date("2026-09-10T12:00:00.000Z");
    await collection().insertOne({_id: MIGRATION_LOCK_ID, expiresAt, holder: "worker-1"});

    const status = await getMigrationStatus({connection: mongoose.connection, migrations});

    expect(status.lock).toEqual({expiresAt, holder: "worker-1"});
    expect(status.applied).toEqual([]);
    expect(status.pending.map((m) => m.id)).toEqual(["20260910120000-a", "20260910120001-b"]);
  });

  it("defaults a lock holder to an empty string when missing", async () => {
    await collection().insertOne({
      _id: MIGRATION_LOCK_ID,
      expiresAt: "2026-09-10T12:00:00.000Z",
    });

    const status = await getMigrationStatus({connection: mongoose.connection, migrations});

    expect(status.lock?.holder).toBe("");
    expect(status.lock?.expiresAt).toEqual(new Date("2026-09-10T12:00:00.000Z"));
  });

  it("parses ISO string appliedAt values from legacy history docs", async () => {
    await collection().insertOne({
      _id: "20260910120000-a",
      appliedAt: "2026-09-10T11:00:00.000Z",
      checksum: "one",
      id: "20260910120000-a",
    });

    const status = await getMigrationStatus({connection: mongoose.connection, migrations});

    expect(status.applied[0].appliedAt).toEqual(new Date("2026-09-10T11:00:00.000Z"));
  });

  it("throws when a stored timestamp is not a valid date", async () => {
    await collection().insertOne({
      _id: "20260910120000-a",
      appliedAt: "not-a-date",
      checksum: "one",
      id: "20260910120000-a",
    });

    await expect(getMigrationStatus({connection: mongoose.connection, migrations})).rejects.toThrow(
      "Invalid migration timestamp"
    );
  });
});

describe("assertMigrationsAllowed", () => {
  it("allows dry-run in production without ALLOW_MIGRATIONS or force", () => {
    expect(() => {
      assertMigrationsAllowed({
        allowEnv: false,
        dryRun: true,
        force: false,
        isProduction: true,
      });
    }).not.toThrow();
  });

  it("allows wet runs outside production without force", () => {
    expect(() => {
      assertMigrationsAllowed({
        allowEnv: false,
        dryRun: false,
        force: false,
        isProduction: false,
      });
    }).not.toThrow();
  });

  it("denies wet production when ALLOW_MIGRATIONS is unset", () => {
    expect(() => {
      assertMigrationsAllowed({
        allowEnv: false,
        dryRun: false,
        force: true,
        isProduction: true,
      });
    }).toThrow(APIError);
    try {
      assertMigrationsAllowed({
        allowEnv: false,
        dryRun: false,
        force: true,
        isProduction: true,
      });
    } catch (error) {
      expect(error).toBeInstanceOf(APIError);
      expect((error as APIError).status).toBe(403);
      expect((error as APIError).title).toBe("Migrations not allowed");
    }
  });

  it("denies wet production when ALLOW_MIGRATIONS is set but force is missing", () => {
    expect(() => {
      assertMigrationsAllowed({
        allowEnv: true,
        dryRun: false,
        force: false,
        isProduction: true,
      });
    }).toThrow("Migrations not allowed");
  });

  it("allows wet production when ALLOW_MIGRATIONS and force are both set", () => {
    expect(() => {
      assertMigrationsAllowed({
        allowEnv: true,
        dryRun: false,
        force: true,
        isProduction: true,
      });
    }).not.toThrow();
  });
});

describe("exerciseReversibleMigrations", () => {
  const fixtures = (...parts: string[]): string => {
    return join(__dirname, "fixtures", ...parts);
  };

  const sortedAppliedIds = async (): Promise<string[]> => {
    const docs = await mongoose.connection
      .collection<MigrationStoreDoc>(MIGRATIONS_COLLECTION)
      .find({_id: {$ne: MIGRATION_LOCK_ID}})
      .project({id: 1})
      .toArray();
    return docs.map((doc) => String(doc.id)).sort();
  };

  beforeEach(async () => {
    await setupDb();
    await mongoose.connection.collection(MIGRATIONS_COLLECTION).deleteMany({});
  });

  it("applies all files then rolls back until an irreversible file stops the chain", async () => {
    const result = await exerciseReversibleMigrations({
      connect: async () => mongoose.connection,
      dir: fixtures("valid"),
    });

    expect(result.applied).toEqual(["20260910120000-alpha", "20260910120001-beta"]);
    expect(result.reversed).toEqual(["20260910120001-beta"]);
    expect(result.skippedIrreversible).toBe("20260910120000-alpha");
    expect(await sortedAppliedIds()).toEqual(["20260910120000-alpha"]);
  });

  it("reverses every file when all have down", async () => {
    const result = await exerciseReversibleMigrations({
      connect: async () => mongoose.connection,
      dir: fixtures("all-down"),
    });

    expect(result.applied).toEqual(["20260910120000-one", "20260910120001-two"]);
    expect(result.reversed).toEqual(["20260910120001-two", "20260910120000-one"]);
    expect(result.skippedIrreversible).toBeNull();
    expect(await sortedAppliedIds()).toEqual([]);
  });
});
