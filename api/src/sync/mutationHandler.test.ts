import {afterEach, beforeAll, beforeEach, describe, expect, it, spyOn} from "bun:test";
import {assert} from "chai";
import mongoose, {model, Schema} from "mongoose";
import type {ModelRouterOptions} from "../api";
import type {User} from "../auth";
import {APIError} from "../errors";
import {Permissions} from "../permissions";
import {createdUpdatedPlugin, type IsDeleted, isDeletedPlugin} from "../plugins";
import {setupDb} from "../tests";
import {
  type AdminWindowMutationAuditEvent,
  type AdminWindowMutationScope,
  clearAdminWindowMutationScopes,
  registerAdminWindowMutationScope,
} from "./adminWindowMutation";
import {computeStableFrontier, SyncCounter, SyncMutation} from "./models";
import {
  applySyncMutation,
  applySyncMutationBatch,
  docMatchesMutationData,
  MAX_SYNC_MUTATIONS_PER_BATCH,
  type SyncMutationOutcome,
  validateSyncMutationBatch,
} from "./mutationHandler";
import {clearSyncRegistry, registerSync} from "./registry";
import {syncPlugin} from "./syncSeqPlugin";
import type {SyncConfig, SyncMutateBatchResponse, SyncMutateRequest} from "./types";

interface MutStuff extends IsDeleted {
  _id: string;
  name: string;
  ownerId: string;
  created: Date;
  _syncSeq?: number;
}

const mutStuffSchema = new Schema<MutStuff>({
  name: {description: "The name of the item", required: true, type: String},
  ownerId: {description: "The user who owns this item", type: String},
});
mutStuffSchema.plugin(isDeletedPlugin);
mutStuffSchema.plugin(createdUpdatedPlugin);
mutStuffSchema.plugin(syncPlugin);
const MutStuffModel = model<MutStuff>("MutStuff", mutStuffSchema);

const owner = {_id: "mut-owner", admin: false, id: "mut-owner"} as unknown as User;
const stranger = {_id: "mut-stranger", admin: false, id: "mut-stranger"} as unknown as User;

const ownerOptions: ModelRouterOptions<MutStuff> = {
  permissions: {
    create: [Permissions.IsAuthenticated],
    delete: [Permissions.IsOwner],
    list: [Permissions.IsAny],
    read: [Permissions.IsAny],
    update: [Permissions.IsOwner],
  },
};

// For broadcast and tenant collections, where `ownerId` is not an owner binding.
const sharedOptions: ModelRouterOptions<MutStuff> = {
  permissions: {
    create: [Permissions.IsAuthenticated],
    delete: [Permissions.IsAuthenticated],
    list: [Permissions.IsAny],
    read: [Permissions.IsAny],
    update: [Permissions.IsAuthenticated],
  },
};

const registerMutStuff = (
  overrides: {config?: Partial<SyncConfig>; options?: ModelRouterOptions<MutStuff>} = {}
): void => {
  clearSyncRegistry();
  registerSync({
    config: {scope: {type: "owner"}, ...overrides.config},
    model: MutStuffModel,
    options: overrides.options ?? ownerOptions,
    routePath: "/mutStuff",
  });
};

const expectAck = (outcome: SyncMutationOutcome) => {
  expect(outcome.type).toBe("ack");
  if (outcome.type !== "ack") {
    throw new Error("expected ack");
  }
  return outcome.ack;
};

const expectNack = (outcome: SyncMutationOutcome) => {
  expect(outcome.type).toBe("nack");
  if (outcome.type !== "nack") {
    throw new Error("expected nack");
  }
  return outcome.nack;
};

describe("applySyncMutation", () => {
  beforeAll(async () => {
    await setupDb();
    // The shared test database can be dropped by another test file mid-suite
    // (configurationPlugin.test.ts drops it in an afterAll); rebuild the unique indexes
    // the idempotency tests depend on.
    await Promise.all([SyncCounter.ensureIndexes(), SyncMutation.ensureIndexes()]);
  });

  beforeEach(async () => {
    registerMutStuff();
    await Promise.all([
      MutStuffModel.collection.deleteMany({}),
      SyncCounter.deleteMany({}),
      SyncMutation.deleteMany({}),
    ]);
  });

  describe("successful mutations", () => {
    it("applies a create and acks with the new id and seq", async () => {
      const outcome = await applySyncMutation({
        mutation: {
          collection: "mutStuff",
          data: {name: "created", ownerId: owner.id},
          mutationId: "m-create-1",
          operation: "create",
        },
        user: owner,
      });
      const ack = expectAck(outcome);
      expect(ack.mutationId).toBe("m-create-1");
      expect(ack.seq).toBe(1);

      const saved = await MutStuffModel.findById(ack.id);
      expect(saved?.name).toBe("created");
      expect(saved?._syncSeq).toBe(1);

      const row = await SyncMutation.findOne({mutationId: "m-create-1"});
      expect(row?.status).toBe("applied");
      expect(row?.resultId).toBe(ack.id);
      expect(row?.resultSeq).toBe(1);
    });

    it("honors a client-generated id on create", async () => {
      const id = new mongoose.Types.ObjectId().toString();
      const outcome = await applySyncMutation({
        mutation: {
          collection: "mutStuff",
          data: {name: "client id", ownerId: owner.id},
          id,
          mutationId: "m-create-id",
          operation: "create",
        },
        user: owner,
      });
      expect(expectAck(outcome).id).toBe(id);
      expect(await MutStuffModel.findById(id)).not.toBeNull();
    });

    it("applies an update with a matching baseVersion and advances the seq", async () => {
      const doc = await MutStuffModel.create({name: "original", ownerId: owner.id});
      expect(doc._syncSeq).toBe(1);

      const outcome = await applySyncMutation({
        mutation: {
          baseVersion: 1,
          collection: "mutStuff",
          data: {name: "changed"},
          id: doc._id.toString(),
          mutationId: "m-update-1",
          operation: "update",
        },
        user: owner,
      });
      const ack = expectAck(outcome);
      expect(ack.id).toBe(doc._id.toString());
      expect(ack.seq).toBe(2);
      const saved = await MutStuffModel.findById(doc._id);
      expect(saved?.name).toBe("changed");
    });

    it("applies a delete as a soft-delete tombstone and acks with the new seq", async () => {
      const doc = await MutStuffModel.create({name: "victim", ownerId: owner.id});
      const outcome = await applySyncMutation({
        mutation: {
          collection: "mutStuff",
          id: doc._id.toString(),
          mutationId: "m-delete-1",
          operation: "delete",
        },
        user: owner,
      });
      const ack = expectAck(outcome);
      expect(ack.seq).toBe(2);
      const tombstones = await MutStuffModel.find({_id: doc._id, deleted: true});
      expect(tombstones).toHaveLength(1);
    });

    it("ignores client-sent sync bookkeeping fields on update", async () => {
      const doc = await MutStuffModel.create({name: "original", ownerId: owner.id});
      const outcome = await applySyncMutation({
        mutation: {
          baseVersion: 1,
          collection: "mutStuff",
          data: {_syncPrevStream: "mutStuff|owner:elsewhere", _syncSeq: 777},
          id: doc._id.toString(),
          mutationId: "m-update-pinned-seq",
          operation: "update",
        },
        user: owner,
      });
      const ack = expectAck(outcome);
      expect(ack.seq).toBe(1);
      const saved = await MutStuffModel.findById(doc._id).lean();
      expect(saved?._syncSeq).toBe(1);
      expect((saved as {_syncPrevStream?: string | null})?._syncPrevStream ?? null).toBeNull();
    });

    it("stamps a fresh seq when a client-sent seq rides along with a real change", async () => {
      const doc = await MutStuffModel.create({name: "original", ownerId: owner.id});
      const outcome = await applySyncMutation({
        mutation: {
          baseVersion: 1,
          collection: "mutStuff",
          data: {_syncSeq: 999, name: "changed"},
          id: doc._id.toString(),
          mutationId: "m-update-seq-and-name",
          operation: "update",
        },
        user: owner,
      });
      expect(expectAck(outcome).seq).toBe(2);
      const saved = await MutStuffModel.findById(doc._id).lean();
      expect(saved?._syncSeq).toBe(2);
      expect(saved?.name).toBe("changed");
    });
  });

  describe("idempotency", () => {
    it("returns the recorded ack for a duplicate mutationId without re-applying", async () => {
      const mutation: SyncMutateRequest = {
        collection: "mutStuff",
        data: {name: "once", ownerId: owner.id},
        mutationId: "m-dup-1",
        operation: "create",
      };
      const first = expectAck(await applySyncMutation({mutation, user: owner}));
      const second = expectAck(await applySyncMutation({mutation, user: owner}));

      expect(second).toEqual(first);
      expect(await MutStuffModel.countDocuments({name: "once"})).toBe(1);
      expect(await SyncMutation.countDocuments({mutationId: "m-dup-1"})).toBe(1);
    });

    it("applies exactly once when two deliveries race on the same mutationId", async () => {
      const mutation: SyncMutateRequest = {
        collection: "mutStuff",
        data: {name: "raced", ownerId: owner.id},
        mutationId: "m-race-1",
        operation: "create",
      };
      const [a, b] = await Promise.all([
        applySyncMutation({mutation, user: owner}),
        applySyncMutation({mutation, user: owner}),
      ]);
      const ackA = expectAck(a);
      const ackB = expectAck(b);
      expect(ackA).toEqual(ackB);
      expect(await MutStuffModel.countDocuments({name: "raced"})).toBe(1);
    });

    it("returns the recorded conflict nack for a duplicate conflicted mutation", async () => {
      const doc = await MutStuffModel.create({name: "server v1", ownerId: owner.id});
      doc.name = "server v2";
      await doc.save(); // seq 2

      const mutation: SyncMutateRequest = {
        baseVersion: 1,
        collection: "mutStuff",
        data: {name: "stale client"},
        id: doc._id.toString(),
        mutationId: "m-dup-conflict",
        operation: "update",
      };
      const first = expectNack(await applySyncMutation({mutation, user: owner}));
      const second = expectNack(await applySyncMutation({mutation, user: owner}));

      expect(first.code).toBe("conflict");
      expect(second.code).toBe("conflict");
      expect(second.serverSeq).toBe(first.serverSeq);
      expect((second.serverDoc as {name: string}).name).toBe("server v2");
    });

    it("returns the recorded nack for a duplicate failed mutation", async () => {
      const mutation: SyncMutateRequest = {
        collection: "mutStuff",
        data: {ownerId: owner.id}, // missing required name
        mutationId: "m-dup-failed",
        operation: "create",
      };
      const first = expectNack(await applySyncMutation({mutation, user: owner}));
      expect(first.code).toBe("validation");

      const second = expectNack(await applySyncMutation({mutation, user: owner}));
      expect(second.code).toBe("validation");
      expect(second.message).toBe(first.message);
      expect(await SyncMutation.countDocuments({mutationId: "m-dup-failed"})).toBe(1);
    });

    it("nacks unauthorized when the mutationId was claimed by another user", async () => {
      const mutation: SyncMutateRequest = {
        collection: "mutStuff",
        data: {name: "mine", ownerId: owner.id},
        mutationId: "m-cross-user",
        operation: "create",
      };
      expectAck(await applySyncMutation({mutation, user: owner}));

      const nack = expectNack(await applySyncMutation({mutation, user: stranger}));
      expect(nack.code).toBe("unauthorized");
      expect(nack.message).toContain("another user");
      // The original outcome is untouched.
      const row = await SyncMutation.findOne({mutationId: "m-cross-user"});
      expect(row?.status).toBe("applied");
    });

    it("nacks error when a claimed mutation stays pending past the poll timeout", async () => {
      await SyncMutation.create({
        mutationId: "m-stuck",
        status: "pending",
        userId: String(owner.id),
      });
      const nack = expectNack(
        await applySyncMutation({
          mutation: {
            collection: "mutStuff",
            data: {name: "stuck", ownerId: owner.id},
            mutationId: "m-stuck",
            operation: "create",
          },
          user: owner,
        })
      );
      expect(nack.code).toBe("error");
      expect(nack.message).toContain("still in flight");
      // The row is left pending for the owning delivery to finalize.
      const row = await SyncMutation.findOne({mutationId: "m-stuck"});
      expect(row?.status).toBe("pending");
      expect(await MutStuffModel.countDocuments({name: "stuck"})).toBe(0);
    });
  });

  describe("C5 lease takeover (FIX 6)", () => {
    /** Simulate a crash: a `pending` row whose claimedAt is older than the lease. */
    const createStalePendingRow = async (mutationId: string, staleForMs: number): Promise<void> => {
      await SyncMutation.create({
        claimedAt: new Date(Date.now() - staleForMs),
        mutationId,
        status: "pending",
        userId: String(owner.id),
      });
    };

    it("retries and succeeds after the lease expires when the write never landed (create)", async () => {
      await createStalePendingRow("m-lease-create", 90_000);
      const ack = expectAck(
        await applySyncMutation({
          mutation: {
            collection: "mutStuff",
            data: {name: "recovered", ownerId: owner.id},
            mutationId: "m-lease-create",
            operation: "create",
          },
          user: owner,
        })
      );
      expect(ack.seq).toBe(1);
      expect(await MutStuffModel.countDocuments({name: "recovered"})).toBe(1);
      const row = await SyncMutation.findOne({mutationId: "m-lease-create"});
      expect(row?.status).toBe("applied");
    });

    it("does NOT take over a pending row within the lease window (regression guard)", async () => {
      await createStalePendingRow("m-lease-fresh", 5_000); // well under SYNC_MUTATION_LEASE_MS
      const nack = expectNack(
        await applySyncMutation({
          mutation: {
            collection: "mutStuff",
            data: {name: "should not apply", ownerId: owner.id},
            mutationId: "m-lease-fresh",
            operation: "create",
          },
          user: owner,
        })
      );
      expect(nack.code).toBe("error");
      expect(nack.message).toContain("still in flight");
      expect(await MutStuffModel.countDocuments({name: "should not apply"})).toBe(0);
    });

    it("create: tolerates the write having already landed (E11000 on the same _id) and reads back the doc as the ack", async () => {
      const entityId = new mongoose.Types.ObjectId().toHexString();
      // Simulate the crash: the doc write from the FIRST attempt landed, but
      // the process died before finalizing the ledger row `applied`.
      await MutStuffModel.create({_id: entityId, name: "already written", ownerId: owner.id});
      await createStalePendingRow("m-lease-create-e11000", 90_000);

      const ack = expectAck(
        await applySyncMutation({
          mutation: {
            collection: "mutStuff",
            data: {name: "already written", ownerId: owner.id},
            id: entityId,
            mutationId: "m-lease-create-e11000",
            operation: "create",
          },
          user: owner,
        })
      );
      expect(ack.id).toBe(entityId);
      expect(ack.seq).toBe(1);
      // Exactly one document — the retry did not double-create.
      expect(await MutStuffModel.countDocuments({_id: entityId})).toBe(1);
      const row = await SyncMutation.findOne({mutationId: "m-lease-create-e11000"});
      expect(row?.status).toBe("applied");
      expect(row?.resultId).toBe(entityId);
    });

    it("create: surfaces the E11000 as a nack when the colliding _id is not readable (soft-deleted)", async () => {
      const entityId = new mongoose.Types.ObjectId().toHexString();
      await MutStuffModel.create({
        _id: entityId,
        deleted: true,
        name: "tombstone",
        ownerId: owner.id,
      });
      await createStalePendingRow("m-lease-create-tombstone", 90_000);

      const nack = expectNack(
        await applySyncMutation({
          mutation: {
            collection: "mutStuff",
            data: {name: "tombstone", ownerId: owner.id},
            id: entityId,
            mutationId: "m-lease-create-tombstone",
            operation: "create",
          },
          user: owner,
        })
      );
      assert.notEqual(nack.code, "conflict");
      assert.equal(await MutStuffModel.countDocuments({_id: entityId, deleted: true}), 1);
    });

    it("update: tolerates the write having already landed (seq already advanced by exactly this mutation) and reads back the doc as the ack", async () => {
      const doc = await MutStuffModel.create({name: "v1", ownerId: owner.id});
      // Simulate the crash: the update write from the FIRST attempt landed
      // (seq advanced 1 -> 2 with the new name), but the ledger row was
      // never finalized.
      doc.name = "v2 (already written)";
      await doc.save();
      expect(doc._syncSeq).toBe(2);
      await createStalePendingRow("m-lease-update", 90_000);

      const ack = expectAck(
        await applySyncMutation({
          mutation: {
            baseVersion: 1, // the client's original (pre-write) baseVersion
            collection: "mutStuff",
            data: {name: "v2 (already written)"},
            id: doc._id.toString(),
            mutationId: "m-lease-update",
            operation: "update",
          },
          user: owner,
        })
      );
      expect(ack.seq).toBe(2);
      const saved = await MutStuffModel.findById(doc._id);
      expect(saved?.name).toBe("v2 (already written)");
      expect(saved?._syncSeq).toBe(2); // not bumped again
      const row = await SyncMutation.findOne({mutationId: "m-lease-update"});
      expect(row?.status).toBe("applied");
    });

    it("update: a GENUINE conflict (someone else wrote, not this mutation) still nacks even via lease takeover", async () => {
      const doc = await MutStuffModel.create({name: "v1", ownerId: owner.id});
      doc.name = "someone else's edit";
      await doc.save(); // seq 2, but NOT from this mutation
      await createStalePendingRow("m-lease-genuine-conflict", 90_000);

      const nack = expectNack(
        await applySyncMutation({
          mutation: {
            baseVersion: 1,
            collection: "mutStuff",
            data: {name: "my conflicting edit"},
            id: doc._id.toString(),
            mutationId: "m-lease-genuine-conflict",
            operation: "update",
          },
          user: owner,
        })
      );
      expect(nack.code).toBe("conflict");
      expect(nack.serverSeq).toBe(2);
    });

    it("replay after lease expiry returns the recorded ack for a subsequent duplicate delivery", async () => {
      await createStalePendingRow("m-lease-replay", 90_000);
      const first = expectAck(
        await applySyncMutation({
          mutation: {
            collection: "mutStuff",
            data: {name: "replay me", ownerId: owner.id},
            mutationId: "m-lease-replay",
            operation: "create",
          },
          user: owner,
        })
      );
      // A later duplicate delivery of the SAME mutationId (e.g. the
      // original client's transport retry finally reaches the server) reads
      // back the exact recorded outcome instead of double-applying.
      const second = expectAck(
        await applySyncMutation({
          mutation: {
            collection: "mutStuff",
            data: {name: "replay me", ownerId: owner.id},
            mutationId: "m-lease-replay",
            operation: "create",
          },
          user: owner,
        })
      );
      expect(second).toEqual(first);
      expect(await MutStuffModel.countDocuments({name: "replay me"})).toBe(1);
    });

    it("post-hook throw after a committed write: doc changed AND ack returned AND ledger applied (M5)", async () => {
      registerMutStuff({
        options: {
          ...ownerOptions,
          postCreate: () => {
            throw new Error("webhook unreachable");
          },
        },
      });
      const outcome = await applySyncMutation({
        mutation: {
          collection: "mutStuff",
          data: {name: "post-hook throws", ownerId: owner.id},
          mutationId: "m-posthook-throw",
          operation: "create",
        },
        user: owner,
      });
      // Still a full ack, not a nack — the write committed regardless of the
      // post-hook's fate.
      const ack = expectAck(outcome);
      expect(ack.warning).toContain("webhook unreachable");
      expect(await MutStuffModel.countDocuments({name: "post-hook throws"})).toBe(1);
      const row = await SyncMutation.findOne({mutationId: "m-posthook-throw"});
      expect(row?.status).toBe("applied");
    });

    it("post-hook throw on update also returns ack+warning with the ledger applied", async () => {
      const doc = await MutStuffModel.create({name: "before", ownerId: owner.id});
      registerMutStuff({
        options: {
          ...ownerOptions,
          postUpdate: () => {
            throw new Error("notification failed");
          },
        },
      });
      const outcome = await applySyncMutation({
        mutation: {
          baseVersion: 1,
          collection: "mutStuff",
          data: {name: "after"},
          id: doc._id.toString(),
          mutationId: "m-posthook-update-throw",
          operation: "update",
        },
        user: owner,
      });
      const ack = expectAck(outcome);
      expect(ack.warning).toContain("notification failed");
      const saved = await MutStuffModel.findById(doc._id);
      expect(saved?.name).toBe("after");
      const row = await SyncMutation.findOne({mutationId: "m-posthook-update-throw"});
      expect(row?.status).toBe("applied");
    });

    it("no warning field when the post-hook succeeds", async () => {
      let called = false;
      registerMutStuff({
        options: {
          ...ownerOptions,
          postCreate: () => {
            called = true;
          },
        },
      });
      const ack = expectAck(
        await applySyncMutation({
          mutation: {
            collection: "mutStuff",
            data: {name: "clean post-hook", ownerId: owner.id},
            mutationId: "m-posthook-ok",
            operation: "create",
          },
          user: owner,
        })
      );
      expect(called).toBe(true);
      expect(ack.warning).toBeUndefined();
    });
  });

  describe("conflicts", () => {
    it("nacks conflict with the canonical server doc on a stale baseVersion", async () => {
      const doc = await MutStuffModel.create({name: "v1", ownerId: owner.id});
      doc.name = "v2";
      await doc.save(); // seq 2

      const nack = expectNack(
        await applySyncMutation({
          mutation: {
            baseVersion: 1,
            collection: "mutStuff",
            data: {name: "stale"},
            id: doc._id.toString(),
            mutationId: "m-conflict-1",
            operation: "update",
          },
          user: owner,
        })
      );
      expect(nack.code).toBe("conflict");
      expect(nack.serverSeq).toBe(2);
      expect((nack.serverDoc as {name: string}).name).toBe("v2");

      const saved = await MutStuffModel.findById(doc._id);
      expect(saved?.name).toBe("v2");
      const row = await SyncMutation.findOne({mutationId: "m-conflict-1"});
      expect(row?.status).toBe("conflicted");
      expect(row?.nackCode).toBe("conflict");
      expect(row?.resultSeq).toBe(2);
      // Task 9.21: the ledger stores only the pointer, never document data.
      expect(row?.resultId).toBe(doc._id.toString());
      const rowFields = (row?.toObject() ?? {}) as unknown as Record<string, unknown>;
      expect(rowFields.serverDoc).toBeUndefined();
    });

    it("serializes the conflict server doc through the sync responseHandler", async () => {
      registerMutStuff({
        config: {
          responseHandler: (doc: Record<string, unknown>) => ({redacted: `x-${doc.name}`}),
          scope: {type: "owner"},
        },
      });
      const doc = await MutStuffModel.create({name: "secret", ownerId: owner.id});
      const nack = expectNack(
        await applySyncMutation({
          mutation: {
            baseVersion: 99,
            collection: "mutStuff",
            data: {name: "stale"},
            id: doc._id.toString(),
            mutationId: "m-conflict-serialized",
            operation: "update",
          },
          user: owner,
        })
      );
      expect(nack.code).toBe("conflict");
      expect(nack.serverDoc).toEqual({redacted: "x-secret"});
    });

    it("nacks conflict without a server doc when serialization fails", async () => {
      registerMutStuff({
        config: {
          responseHandler: () => {
            throw new Error("serializer exploded");
          },
          scope: {type: "owner"},
        },
      });
      const doc = await MutStuffModel.create({name: "unserializable", ownerId: owner.id});
      const nack = expectNack(
        await applySyncMutation({
          mutation: {
            baseVersion: 99,
            collection: "mutStuff",
            data: {name: "stale"},
            id: doc._id.toString(),
            mutationId: "m-conflict-serialize-fail",
            operation: "update",
          },
          user: owner,
        })
      );
      expect(nack.code).toBe("conflict");
      expect(nack.serverSeq).toBe(1);
      expect(nack.serverDoc).toBeUndefined();
      const row = await SyncMutation.findOne({mutationId: "m-conflict-serialize-fail"});
      expect(row?.status).toBe("conflicted");
    });

    it("Task 9.13: two concurrent updates with the SAME baseVersion produce one ack and one conflict", async () => {
      const doc = await MutStuffModel.create({name: "start", ownerId: owner.id});
      const id = doc._id.toString();
      const baseVersion = doc._syncSeq as number;

      const [a, b] = await Promise.all([
        applySyncMutation({
          mutation: {
            baseVersion,
            collection: "mutStuff",
            data: {name: "writer A"},
            id,
            mutationId: "m-race-a",
            operation: "update",
          },
          user: owner,
        }),
        applySyncMutation({
          mutation: {
            baseVersion,
            collection: "mutStuff",
            data: {name: "writer B"},
            id,
            mutationId: "m-race-b",
            operation: "update",
          },
          user: owner,
        }),
      ]);

      const acks = [a, b].filter((outcome) => outcome.type === "ack");
      const nacks = [a, b].filter((outcome) => outcome.type === "nack");
      expect(acks).toHaveLength(1);
      expect(nacks).toHaveLength(1);
      if (nacks[0].type !== "nack") {
        throw new Error("expected a nack");
      }
      expect(nacks[0].nack.code).toBe("conflict");

      // The winner's edit survived: the loser never overwrote it.
      const saved = await MutStuffModel.findById(id);
      const winner = acks[0].type === "ack" ? acks[0].ack : undefined;
      expect(saved?._syncSeq).toBe(winner?.seq);
      expect(["writer A", "writer B"]).toContain(saved?.name ?? "");
      // The conflict reports the CURRENT server state, not the loser's rejected edit.
      expect((nacks[0].nack.serverDoc as {name: string} | undefined)?.name).toBe(saved?.name);
      expect(nacks[0].nack.serverSeq).toBe(saved?._syncSeq);
    });

    it("Task 9.13: the version-conflicted loser releases its seq claim so the frontier still advances", async () => {
      const doc = await MutStuffModel.create({name: "start", ownerId: owner.id});
      const id = doc._id.toString();
      const baseVersion = doc._syncSeq as number;
      const stream = `mutStuff|owner:${owner.id}`;

      await Promise.all([
        applySyncMutation({
          mutation: {
            baseVersion,
            collection: "mutStuff",
            data: {name: "A"},
            id,
            mutationId: "m-frontier-a",
            operation: "update",
          },
          user: owner,
        }),
        applySyncMutation({
          mutation: {
            baseVersion,
            collection: "mutStuff",
            data: {name: "B"},
            id,
            mutationId: "m-frontier-b",
            operation: "update",
          },
          user: owner,
        }),
      ]);

      const counter = await SyncCounter.findOne({stream});
      expect(counter?.pending ?? []).toHaveLength(0);
      // A claim released rather than stranded means the frontier reaches the head.
      expect(await computeStableFrontier({stream})).toBe(counter?.seq as number);
    });
  });

  describe("permissions", () => {
    it("nacks unauthorized when a non-owner updates a document", async () => {
      const doc = await MutStuffModel.create({name: "owned", ownerId: owner.id});
      const nack = expectNack(
        await applySyncMutation({
          mutation: {
            baseVersion: 1,
            collection: "mutStuff",
            data: {name: "hijacked"},
            id: doc._id.toString(),
            mutationId: "m-perm-1",
            operation: "update",
          },
          user: stranger,
        })
      );
      expect(nack.code).toBe("unauthorized");
      const saved = await MutStuffModel.findById(doc._id);
      expect(saved?.name).toBe("owned");
      const row = await SyncMutation.findOne({mutationId: "m-perm-1"});
      expect(row?.status).toBe("failed");
      expect(row?.nackCode).toBe("unauthorized");
    });

    it("nacks unauthorized for method-level (405) denials", async () => {
      registerMutStuff({
        options: {
          permissions: {
            create: [Permissions.IsAdmin],
            delete: [Permissions.IsAdmin],
            list: [Permissions.IsAdmin],
            read: [Permissions.IsAdmin],
            update: [Permissions.IsAdmin],
          },
        },
      });
      const nack = expectNack(
        await applySyncMutation({
          mutation: {
            collection: "mutStuff",
            data: {name: "nope", ownerId: owner.id},
            mutationId: "m-perm-2",
            operation: "create",
          },
          user: owner,
        })
      );
      expect(nack.code).toBe("unauthorized");
    });

    it("nacks unauthorized when a non-owner deletes a document", async () => {
      const doc = await MutStuffModel.create({name: "keep", ownerId: owner.id});
      const nack = expectNack(
        await applySyncMutation({
          mutation: {
            collection: "mutStuff",
            id: doc._id.toString(),
            mutationId: "m-perm-3",
            operation: "delete",
          },
          user: stranger,
        })
      );
      expect(nack.code).toBe("unauthorized");
      const saved = await MutStuffModel.findById(doc._id);
      expect(saved?.deleted).toBe(false);
    });
  });

  describe("validation", () => {
    it("nacks validation when a required field is missing", async () => {
      const nack = expectNack(
        await applySyncMutation({
          mutation: {
            collection: "mutStuff",
            data: {ownerId: owner.id},
            mutationId: "m-invalid-1",
            operation: "create",
          },
          user: owner,
        })
      );
      expect(nack.code).toBe("validation");
      const row = await SyncMutation.findOne({mutationId: "m-invalid-1"});
      expect(row?.status).toBe("failed");
      expect(row?.nackCode).toBe("validation");
    });

    it("nacks validation for an unknown collection", async () => {
      const nack = expectNack(
        await applySyncMutation({
          mutation: {
            collection: "nope",
            data: {name: "x"},
            mutationId: "m-invalid-2",
            operation: "create",
          },
          user: owner,
        })
      );
      expect(nack.code).toBe("validation");
      expect(nack.message).toContain("Unknown sync collection");
    });

    it("nacks validation when an update omits baseVersion", async () => {
      const doc = await MutStuffModel.create({name: "no base", ownerId: owner.id});
      const nack = expectNack(
        await applySyncMutation({
          mutation: {
            collection: "mutStuff",
            data: {name: "changed"},
            id: String(doc._id),
            mutationId: "m-no-base-version",
            operation: "update",
          },
          user: owner,
        })
      );
      assert.equal(nack.code, "validation");
      assert.include(nack.message, "baseVersion is required");
      assert.equal(await SyncMutation.countDocuments({mutationId: "m-no-base-version"}), 0);
    });

    it("nacks validation when update or delete is missing an id", async () => {
      for (const operation of ["update", "delete"] as const) {
        const nack = expectNack(
          await applySyncMutation({
            mutation: {
              collection: "mutStuff",
              data: {name: "x"},
              mutationId: `m-noid-${operation}`,
              operation,
            },
            user: owner,
          })
        );
        expect(nack.code).toBe("validation");
        expect(nack.message).toContain("id is required");
      }
    });

    it("nacks validation when mutationId or collection is missing", async () => {
      const noMutationId = expectNack(
        await applySyncMutation({
          mutation: {collection: "mutStuff", operation: "create"} as SyncMutateRequest,
          user: owner,
        })
      );
      expect(noMutationId.code).toBe("validation");
      expect(noMutationId.mutationId).toBe("");

      const noCollection = expectNack(
        await applySyncMutation({
          mutation: {mutationId: "m-nocoll", operation: "create"} as SyncMutateRequest,
          user: owner,
        })
      );
      expect(noCollection.code).toBe("validation");
      expect(noCollection.message).toContain("collection");
    });

    it("nacks validation for an unknown operation", async () => {
      const nack = expectNack(
        await applySyncMutation({
          mutation: {
            collection: "mutStuff",
            mutationId: "m-badop",
            operation: "upsert",
          } as unknown as SyncMutateRequest,
          user: owner,
        })
      );
      expect(nack.code).toBe("validation");
      expect(nack.message).toContain("Unknown operation");
    });

    it("nacks validation when the target document does not exist", async () => {
      const nack = expectNack(
        await applySyncMutation({
          mutation: {
            baseVersion: 0,
            collection: "mutStuff",
            data: {name: "ghost"},
            id: new mongoose.Types.ObjectId().toString(),
            mutationId: "m-missing-doc",
            operation: "update",
          },
          user: owner,
        })
      );
      expect(nack.code).toBe("validation");
    });
  });

  describe("errors", () => {
    it("nacks error for unexpected server failures and records the message", async () => {
      registerMutStuff({
        options: {
          ...ownerOptions,
          preCreate: () => {
            throw new APIError({status: 500, title: "database exploded"});
          },
        },
      });
      const nack = expectNack(
        await applySyncMutation({
          mutation: {
            collection: "mutStuff",
            data: {name: "boom", ownerId: owner.id},
            mutationId: "m-error-1",
            operation: "create",
          },
          user: owner,
        })
      );
      expect(nack.code).toBe("error");
      expect(nack.message).toBe("database exploded");
      // Task 9.18: an error-class outcome is NOT recorded — it is non-deterministic, so
      // leaving it on the ledger would make the nack sticky for the 30-day TTL.
      expect(await SyncMutation.countDocuments({mutationId: "m-error-1"})).toBe(0);
    });

    it("Task 9.18: a transient error-class failure re-executes on replay of the same mutationId", async () => {
      let attempts = 0;
      registerMutStuff({
        options: {
          ...ownerOptions,
          preCreate: (body) => {
            attempts += 1;
            if (attempts === 1) {
              throw new APIError({status: 500, title: "transient DB hiccup"});
            }
            return body as MutStuff;
          },
        },
      });
      const mutation: SyncMutateRequest = {
        collection: "mutStuff",
        data: {name: "retried", ownerId: owner.id},
        mutationId: "m-transient-retry",
        operation: "create",
      };
      const first = expectNack(await applySyncMutation({mutation, user: owner}));
      expect(first.code).toBe("error");

      // The client's durable outbox resends the SAME mutationId; it must genuinely re-run.
      const ack = expectAck(await applySyncMutation({mutation, user: owner}));
      expect(attempts).toBe(2);
      const saved = await MutStuffModel.findById(ack.id);
      expect(saved?.name).toBe("retried");
      const row = await SyncMutation.findOne({mutationId: "m-transient-retry"});
      expect(row?.status).toBe("applied");
    });

    it("Task 9.18: a deterministic validation failure stays recorded and is NOT re-executed", async () => {
      let attempts = 0;
      registerMutStuff({
        options: {
          ...ownerOptions,
          preCreate: () => {
            attempts += 1;
            throw new APIError({status: 400, title: "name is not allowed"});
          },
        },
      });
      const mutation: SyncMutateRequest = {
        collection: "mutStuff",
        data: {name: "rejected", ownerId: owner.id},
        mutationId: "m-terminal-sticky",
        operation: "create",
      };
      expect(expectNack(await applySyncMutation({mutation, user: owner})).code).toBe("validation");
      expect(expectNack(await applySyncMutation({mutation, user: owner})).code).toBe("validation");
      expect(attempts).toBe(1);
      const row = await SyncMutation.findOne({mutationId: "m-terminal-sticky"});
      expect(row?.status).toBe("failed");
    });

    it("nacks error when a non-APIError escapes the executor pipeline", async () => {
      registerMutStuff({
        options: {
          permissions: {
            create: [
              () => {
                throw new Error("permission crashed");
              },
            ],
            delete: [Permissions.IsOwner],
            list: [Permissions.IsAny],
            read: [Permissions.IsAny],
            update: [Permissions.IsOwner],
          },
        },
      });
      const nack = expectNack(
        await applySyncMutation({
          mutation: {
            collection: "mutStuff",
            data: {name: "crash", ownerId: owner.id},
            mutationId: "m-plain-error",
            operation: "create",
          },
          user: owner,
        })
      );
      expect(nack.code).toBe("error");
      expect(nack.message).toContain("permission crashed");
      // Task 9.18: error-class outcomes release the claim rather than recording it.
      expect(await SyncMutation.countDocuments({mutationId: "m-plain-error"})).toBe(0);
    });

    it("rethrows a non-duplicate failure from the ledger claim insert", async () => {
      const createSpy = spyOn(SyncMutation, "create").mockImplementation((() => {
        throw new Error("ledger unavailable");
      }) as never);
      try {
        let thrown: unknown;
        try {
          await applySyncMutation({
            mutation: {
              collection: "mutStuff",
              data: {name: "never claimed", ownerId: owner.id},
              mutationId: "m-claim-crash",
              operation: "create",
            },
            user: owner,
          });
        } catch (error: unknown) {
          thrown = error;
        }
        assert.instanceOf(thrown, Error);
        assert.equal((thrown as Error).message, "ledger unavailable");
      } finally {
        createSpy.mockRestore();
      }
      assert.equal(await MutStuffModel.countDocuments({name: "never claimed"}), 0);
    });
  });

  describe("write scope enforcement", () => {
    it("skips the write-scope check for broadcast collections", async () => {
      registerMutStuff({config: {scope: {type: "broadcast"}}, options: sharedOptions});
      const ack = expectAck(
        await applySyncMutation({
          mutation: {
            collection: "mutStuff",
            data: {name: "broadcast", ownerId: stranger.id},
            mutationId: "m-broadcast-create",
            operation: "create",
          },
          user: owner,
        })
      );
      assert.equal(ack.seq, 1);
      const saved = await MutStuffModel.findById(ack.id);
      assert.equal(saved?.ownerId, stranger.id);
    });

    it("nacks error when a tenant-scoped collection has no scope resolver", async () => {
      registerMutStuff({config: {scope: {field: "ownerId", type: "tenant"}}});
      const nack = expectNack(
        await applySyncMutation({
          mutation: {
            collection: "mutStuff",
            data: {name: "tenant", ownerId: "tenant-1"},
            mutationId: "m-tenant-no-resolver",
            operation: "create",
          },
          user: owner,
        })
      );
      assert.equal(nack.code, "error");
      assert.include(nack.message, "no getUserScopes resolver");
      assert.equal(await MutStuffModel.countDocuments({name: "tenant"}), 0);
    });

    it("acks a tenant-scoped create when the resolver confirms the membership", async () => {
      registerMutStuff({
        config: {scope: {field: "ownerId", type: "tenant"}},
        options: sharedOptions,
      });
      const ack = expectAck(
        await applySyncMutation({
          mutation: {
            collection: "mutStuff",
            data: {name: "tenant ok", ownerId: "tenant-1"},
            mutationId: "m-tenant-member",
            operation: "create",
          },
          scopeResolver: async () => ["tenant-1", "tenant-2"],
          user: owner,
        })
      );
      assert.equal(ack.seq, 1);
    });
  });

  describe("recorded conflict replay", () => {
    const recordConflict = async (
      mutationId: string,
      resultId: string | undefined
    ): Promise<void> => {
      await SyncMutation.create({
        claimedAt: new Date(),
        error: "recorded conflict",
        mutationId,
        resultId,
        resultSeq: 3,
        status: "conflicted",
        userId: String(owner.id),
      });
    };

    const replay = (mutationId: string): Promise<SyncMutationOutcome> =>
      applySyncMutation({
        mutation: {
          baseVersion: 1,
          collection: "mutStuff",
          data: {name: "replayed"},
          id: new mongoose.Types.ObjectId().toHexString(),
          mutationId,
          operation: "update",
        },
        user: owner,
      });

    it("omits the server doc when the recorded conflict has no resultId", async () => {
      await recordConflict("m-conflict-no-id", undefined);
      const nack = expectNack(await replay("m-conflict-no-id"));
      assert.equal(nack.code, "conflict");
      assert.equal(nack.message, "recorded conflict");
      assert.equal(nack.serverSeq, 3);
      assert.isUndefined(nack.serverDoc);
    });

    it("omits the server doc when the recorded resultId no longer resolves to a document", async () => {
      await recordConflict("m-conflict-missing", new mongoose.Types.ObjectId().toHexString());
      const nack = expectNack(await replay("m-conflict-missing"));
      assert.equal(nack.code, "conflict");
      assert.isUndefined(nack.serverDoc);
    });

    it("omits the server doc when loading it throws", async () => {
      await recordConflict("m-conflict-bad-id", "not-an-object-id");
      const nack = expectNack(await replay("m-conflict-bad-id"));
      assert.equal(nack.code, "conflict");
      assert.isUndefined(nack.serverDoc);
    });
  });

  describe("admin window mutations", () => {
    const admin = {_id: "mut-admin", admin: true, id: "mut-admin"} as unknown as User;

    const registerAdminScope = (
      emitAudit?: AdminWindowMutationScope["emitAudit"]
    ): AdminWindowMutationScope => {
      const scope: AdminWindowMutationScope = {
        createPermissions: [Permissions.IsAdmin],
        deletePermissions: [Permissions.IsAdmin],
        emitAudit,
        modelName: MutStuffModel.modelName,
        permissions: {create: true, delete: true, update: true},
        stripMutationData: (data) => {
          const next = {...data};
          delete next.secret;
          return next;
        },
        updatePermissions: [Permissions.IsAdmin],
      };
      registerAdminWindowMutationScope(MutStuffModel.modelName, scope);
      return scope;
    };

    beforeEach(() => {
      clearAdminWindowMutationScopes();
      registerMutStuff({config: {adminBroadcast: true, scope: {type: "owner"}}});
    });

    afterEach(() => {
      clearAdminWindowMutationScopes();
    });

    it("applies an admin window create with stripped data and emits the audit event", async () => {
      const events: AdminWindowMutationAuditEvent[] = [];
      registerAdminScope(({event}) => {
        events.push(event);
      });
      const ack = expectAck(
        await applySyncMutation({
          mutation: {
            collection: "mutStuff",
            data: {name: "admin created", ownerId: owner.id, secret: "strip me"},
            mutationId: "m-admin-create",
            mutationMode: "adminWindow",
            operation: "create",
          },
          user: admin,
        })
      );
      assert.equal(ack.seq, 1);
      assert.isUndefined(ack.warning);
      const saved = await MutStuffModel.findById(ack.id);
      assert.equal(saved?.name, "admin created");
      assert.equal(saved?.ownerId, owner.id);
      assert.lengthOf(events, 1);
      assert.equal(events[0].verb, "created");
      assert.equal(events[0].recordId, ack.id);
    });

    it("still acks when the admin window audit hook throws after the write committed", async () => {
      registerAdminScope(() => {
        throw new Error("audit sink down");
      });
      const ack = expectAck(
        await applySyncMutation({
          mutation: {
            collection: "mutStuff",
            data: {name: "audited anyway", ownerId: owner.id},
            mutationId: "m-admin-audit-throw",
            mutationMode: "adminWindow",
            operation: "create",
          },
          user: admin,
        })
      );
      assert.isUndefined(ack.warning);
      assert.equal(await MutStuffModel.countDocuments({name: "audited anyway"}), 1);
      const row = await SyncMutation.findOne({mutationId: "m-admin-audit-throw"});
      assert.equal(row?.status, "applied");
    });
  });
});

describe("docMatchesMutationData", () => {
  it("treats an absent mutation payload as matching any document", () => {
    assert.isTrue(docMatchesMutationData({name: "anything"}, undefined));
  });
});

describe("validateSyncMutationBatch", () => {
  it("accepts a batch within the size limit with no duplicate ids", () => {
    const mutations: SyncMutateRequest[] = Array.from({length: 10}, (_v, i) => ({
      collection: "mutStuff",
      data: {name: `item ${i}`},
      mutationId: `batch-ok-${i}`,
      operation: "create",
    }));
    expect(validateSyncMutationBatch(mutations)).toEqual({ok: true});
  });

  it("rejects a batch exceeding the maximum size", () => {
    const mutations: SyncMutateRequest[] = Array.from(
      {length: MAX_SYNC_MUTATIONS_PER_BATCH + 1},
      (_v, i) => ({
        collection: "mutStuff",
        data: {},
        mutationId: `batch-oversized-${i}`,
        operation: "create",
      })
    );
    const outcome = validateSyncMutationBatch(mutations);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) {
      throw new Error("expected rejection");
    }
    expect(outcome.response.results).toHaveLength(1);
    const [result] = outcome.response.results;
    expect(result.type).toBe("nack");
    if (result.type !== "nack") {
      throw new Error("expected nack");
    }
    expect(result.nack.code).toBe("validation");
    expect(result.nack.message).toContain(String(MAX_SYNC_MUTATIONS_PER_BATCH));
  });

  it("rejects a batch with an intra-batch duplicate mutationId", () => {
    const mutations: SyncMutateRequest[] = [
      {collection: "mutStuff", data: {}, mutationId: "dup-1", operation: "create"},
      {collection: "mutStuff", data: {}, mutationId: "dup-2", operation: "create"},
      {collection: "mutStuff", data: {}, mutationId: "dup-1", operation: "create"},
    ];
    const outcome = validateSyncMutationBatch(mutations);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) {
      throw new Error("expected rejection");
    }
    const [result] = outcome.response.results;
    expect(result.type).toBe("nack");
    if (result.type !== "nack") {
      throw new Error("expected nack");
    }
    expect(result.nack.code).toBe("validation");
    expect(result.nack.mutationId).toBe("dup-1");
  });
});

describe("applySyncMutationBatch", () => {
  beforeAll(async () => {
    await setupDb();
    await Promise.all([SyncCounter.ensureIndexes(), SyncMutation.ensureIndexes()]);
  });

  beforeEach(async () => {
    registerMutStuff();
    await Promise.all([
      MutStuffModel.collection.deleteMany({}),
      SyncCounter.deleteMany({}),
      SyncMutation.deleteMany({}),
    ]);
  });

  const create = (mutationId: string, name: string): SyncMutateRequest => ({
    collection: "mutStuff",
    data: {name, ownerId: owner.id},
    mutationId,
    operation: "create",
  });

  it("applies every mutation strictly serially and returns one result per mutation", async () => {
    const mutations = Array.from({length: 10}, (_v, i) => create(`batch-serial-${i}`, `item ${i}`));
    const response = await applySyncMutationBatch({mutations, user: owner});
    expect(response.results).toHaveLength(10);
    expect(response.results.every((r) => r.type === "ack")).toBe(true);
    // Order proof: seqs are strictly increasing in request order (strictly serial,
    // no parallelism).
    const seqs = response.results.map((r) => (r.type === "ack" ? r.ack.seq : -1));
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(10);
  });

  it("stops at the first conflict: results shorter than the request, later mutations unledgered", async () => {
    const doc = await MutStuffModel.create({name: "server v1", ownerId: owner.id});
    doc.name = "server v2";
    await doc.save(); // seq 2

    const mutations: SyncMutateRequest[] = [
      create("batch-conflict-1", "item 1"),
      create("batch-conflict-2", "item 2"),
      create("batch-conflict-3", "item 3"),
      {
        baseVersion: 1, // stale — server is at seq 2
        collection: "mutStuff",
        data: {name: "stale write"},
        id: String(doc._id),
        mutationId: "batch-conflict-4",
        operation: "update",
      },
      create("batch-conflict-5", "item 5"),
      create("batch-conflict-6", "item 6"),
      create("batch-conflict-7", "item 7"),
      create("batch-conflict-8", "item 8"),
      create("batch-conflict-9", "item 9"),
      create("batch-conflict-10", "item 10"),
    ];

    const response = await applySyncMutationBatch({mutations, user: owner});
    expect(response.results).toHaveLength(4);
    expect(response.results.slice(0, 3).every((r) => r.type === "ack")).toBe(true);
    const fourth = response.results[3];
    expect(fourth.type).toBe("nack");
    if (fourth.type !== "nack") {
      throw new Error("expected nack");
    }
    expect(fourth.nack.code).toBe("conflict");

    // Mutations 5-10 were never attempted: no ledger row exists for them, and no
    // document was created for them.
    for (const mutationId of [
      "batch-conflict-5",
      "batch-conflict-6",
      "batch-conflict-7",
      "batch-conflict-8",
      "batch-conflict-9",
      "batch-conflict-10",
    ]) {
      expect(await SyncMutation.findOne({mutationId})).toBeNull();
    }
    expect(await MutStuffModel.countDocuments({name: {$in: ["item 5", "item 6", "item 10"]}})).toBe(
      0
    );

    // Resending mutations 4-10 as a new batch: #4 (the boundary mutation) reads
    // back its recorded conflict from the ledger idempotently; 5-10 apply.
    const resend = mutations.slice(3);
    const resendResponse = await applySyncMutationBatch({mutations: resend, user: owner});
    expect(resendResponse.results).toHaveLength(1);
    const [resentFourth] = resendResponse.results;
    expect(resentFourth.type).toBe("nack");
    if (resentFourth.type !== "nack") {
      throw new Error("expected nack");
    }
    expect(resentFourth.nack.code).toBe("conflict");

    // The client, having recorded #4 as conflicted, resends only 5-10 next.
    const tail = mutations.slice(4);
    const tailResponse = await applySyncMutationBatch({mutations: tail, user: owner});
    expect(tailResponse.results).toHaveLength(6);
    expect(tailResponse.results.every((r) => r.type === "ack")).toBe(true);
    for (const name of ["item 5", "item 6", "item 7", "item 8", "item 9", "item 10"]) {
      expect(await MutStuffModel.countDocuments({name})).toBe(1);
    }
  });

  it("a whole-batch duplicate resend is idempotent: all results served from the ledger, docs written once", async () => {
    const mutations = Array.from({length: 5}, (_v, i) => create(`batch-dup-${i}`, `dup ${i}`));
    const first = await applySyncMutationBatch({mutations, user: owner});
    expect(first.results.every((r) => r.type === "ack")).toBe(true);

    const second: SyncMutateBatchResponse = await applySyncMutationBatch({mutations, user: owner});
    expect(second.results).toHaveLength(5);
    expect(second).toEqual(first);

    for (let i = 0; i < 5; i++) {
      expect(await MutStuffModel.countDocuments({name: `dup ${i}`})).toBe(1);
    }
  });

  it("order proof: create, update, delete for one entity in one batch works", async () => {
    const entityId = new mongoose.Types.ObjectId().toString();
    const mutations: SyncMutateRequest[] = [
      {
        collection: "mutStuff",
        data: {name: "v1", ownerId: owner.id},
        id: entityId,
        mutationId: "order-create",
        operation: "create",
      },
      {
        baseVersion: 1,
        collection: "mutStuff",
        data: {name: "v2"},
        id: entityId,
        mutationId: "order-update",
        operation: "update",
      },
      {
        baseVersion: 2,
        collection: "mutStuff",
        id: entityId,
        mutationId: "order-delete",
        operation: "delete",
      },
    ];
    const response = await applySyncMutationBatch({mutations, user: owner});
    expect(response.results).toHaveLength(3);
    expect(response.results.every((r) => r.type === "ack")).toBe(true);
    const seqs = response.results.map((r) => (r.type === "ack" ? r.ack.seq : -1));
    expect(seqs).toEqual([1, 2, 3]);
    const tombstones = await MutStuffModel.find({_id: entityId, deleted: true});
    expect(tombstones).toHaveLength(1);
  });

  it("order proof reversed: a failing first mutation halts before the second/third are touched", async () => {
    const entityId = new mongoose.Types.ObjectId().toString();
    const mutations: SyncMutateRequest[] = [
      // Update against a non-existent document fails first.
      {
        baseVersion: 0,
        collection: "mutStuff",
        data: {name: "nope"},
        id: entityId,
        mutationId: "reversed-update",
        operation: "update",
      },
      {
        collection: "mutStuff",
        data: {name: "v1", ownerId: owner.id},
        id: entityId,
        mutationId: "reversed-create",
        operation: "create",
      },
      {
        collection: "mutStuff",
        id: entityId,
        mutationId: "reversed-delete",
        operation: "delete",
      },
    ];
    const response = await applySyncMutationBatch({mutations, user: owner});
    expect(response.results).toHaveLength(1);
    expect(response.results[0].type).toBe("nack");
    expect(await SyncMutation.findOne({mutationId: "reversed-create"})).toBeNull();
    expect(await SyncMutation.findOne({mutationId: "reversed-delete"})).toBeNull();
    expect(await MutStuffModel.findById(entityId)).toBeNull();
  });
});
