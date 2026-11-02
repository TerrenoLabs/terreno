import {beforeAll, beforeEach, describe, expect, it} from "bun:test";
import {DateTime} from "luxon";
import {model, Schema} from "mongoose";
import type {ModelRouterOptions} from "../../api";
import {Permissions} from "../../permissions";
import {createdUpdatedPlugin, type IsDeleted, isDeletedPlugin} from "../../plugins";
import {setupDb} from "../../tests";
import {getCompactedThroughSeq, SyncCounter, SyncScopeMove} from "../models";
import {clearSyncRegistry, registerSync, type SyncRegistryEntry} from "../registry";
import {syncPlugin} from "../syncSeqPlugin";
import {
  compactEntryTombstones,
  compactTombstones,
  DEFAULT_TOMBSTONE_RETENTION_DAYS,
} from "./compactTombstones";

interface CompactStuff extends IsDeleted {
  _id: string;
  name: string;
  ownerId: string;
  created: Date;
  updated?: Date;
  _syncSeq?: number;
}

const compactStuffSchema = new Schema<CompactStuff>({
  name: {description: "The name of the item", required: true, type: String},
  ownerId: {description: "The owner", type: String},
});
compactStuffSchema.plugin(isDeletedPlugin);
compactStuffSchema.plugin(createdUpdatedPlugin);
compactStuffSchema.plugin(syncPlugin);
const CompactStuffModel = model<CompactStuff>("SyncCompactStuff", compactStuffSchema);

const options = {
  permissions: {
    create: [Permissions.IsAuthenticated],
    delete: [Permissions.IsAuthenticated],
    list: [Permissions.IsAuthenticated],
    read: [Permissions.IsAuthenticated],
    update: [Permissions.IsAuthenticated],
  },
} as unknown as ModelRouterOptions<CompactStuff>;

beforeAll(async () => {
  await setupDb();
});

describe("compactTombstones (C7 retention)", () => {
  beforeEach(async () => {
    clearSyncRegistry();
    await Promise.all([
      CompactStuffModel.collection.deleteMany({}),
      SyncCounter.deleteMany({}),
      SyncScopeMove.deleteMany({}),
    ]);
  });

  const registerWithRetention = (retentionDays?: number): void => {
    registerSync({
      config: {scope: {type: "owner"}, ...(retentionDays !== undefined ? {retentionDays} : {})},
      model: CompactStuffModel,
      options,
      routePath: "/compactStuff",
    });
  };

  it("hard-deletes tombstones older than the retention window and keeps recent ones", async () => {
    registerWithRetention();
    const oldCutoff = DateTime.now()
      .minus({days: DEFAULT_TOMBSTONE_RETENTION_DAYS + 5})
      .toJSDate();

    // Old tombstone (should be compacted): bypass mongoose so we can backdate `updated`.
    await CompactStuffModel.collection.insertMany([
      {created: oldCutoff, deleted: true, name: "old tombstone", ownerId: "u1", updated: oldCutoff},
      {
        created: new Date(),
        deleted: true,
        name: "recent tombstone",
        ownerId: "u1",
        updated: new Date(),
      },
      {created: new Date(), deleted: false, name: "live", ownerId: "u1", updated: new Date()},
    ]);

    const result = await compactTombstones();
    expect(result.totalTombstones).toBe(1);
    expect(result.byCollection.compactStuff.tombstones).toBe(1);

    const remaining = await CompactStuffModel.collection.find({}).toArray();
    const names = remaining.map((d) => d.name).sort();
    // The old tombstone is gone; the recent tombstone and the live doc remain.
    expect(names).toEqual(["live", "recent tombstone"]);
  });

  it("hard-deletes scope-move markers older than the retention window", async () => {
    registerWithRetention();
    const old = DateTime.now()
      .minus({days: DEFAULT_TOMBSTONE_RETENTION_DAYS + 1})
      .toJSDate();
    await SyncScopeMove.collection.insertMany([
      {
        collectionTag: "compactStuff",
        created: old,
        entityId: "e-old",
        fromStream: "compactStuff|owner:u1",
        seq: 5,
        toStream: "compactStuff|owner:u2",
      },
      {
        collectionTag: "compactStuff",
        created: new Date(),
        entityId: "e-new",
        fromStream: "compactStuff|owner:u1",
        seq: 6,
        toStream: "compactStuff|owner:u2",
      },
    ]);

    const result = await compactTombstones();
    expect(result.totalMarkers).toBe(1);
    const remaining = await SyncScopeMove.find({});
    expect(remaining.map((m) => m.entityId)).toEqual(["e-new"]);
  });

  it("honors a per-model retentionDays override", async () => {
    // 1-day retention: a 2-day-old tombstone is compacted even though the default (90) would keep it.
    registerWithRetention(1);
    const twoDaysAgo = DateTime.now().minus({days: 2}).toJSDate();
    await CompactStuffModel.collection.insertMany([
      {
        created: twoDaysAgo,
        deleted: true,
        name: "two days old",
        ownerId: "u1",
        updated: twoDaysAgo,
      },
    ]);
    const entry = clearSyncRegistryAndReRegister(1);
    const counts = await compactEntryTombstones(entry);
    expect(counts.tombstones).toBe(1);
    expect(await CompactStuffModel.collection.countDocuments({})).toBe(0);
  });

  it("leaves everything intact when nothing is past retention", async () => {
    registerWithRetention();
    await CompactStuffModel.collection.insertMany([
      {created: new Date(), deleted: true, name: "recent", ownerId: "u1", updated: new Date()},
    ]);
    const result = await compactTombstones();
    expect(result.totalTombstones).toBe(0);
    expect(await CompactStuffModel.collection.countDocuments({})).toBe(1);
  });

  // ── Task 9.15: the retention watermark ────────────────────────────────────────
  it("Task 9.15: records compactedThroughSeq per stream from the highest reaped tombstone seq", async () => {
    registerWithRetention();
    const old = DateTime.now()
      .minus({days: DEFAULT_TOMBSTONE_RETENTION_DAYS + 5})
      .toJSDate();
    await SyncCounter.create([
      {seq: 30, stream: "compactStuff|owner:u1"},
      {seq: 30, stream: "compactStuff|owner:u2"},
    ]);
    await CompactStuffModel.collection.insertMany([
      {_syncSeq: 4, created: old, deleted: true, name: "u1 low", ownerId: "u1", updated: old},
      {_syncSeq: 11, created: old, deleted: true, name: "u1 high", ownerId: "u1", updated: old},
      {_syncSeq: 7, created: old, deleted: true, name: "u2 only", ownerId: "u2", updated: old},
      // A recent tombstone is not reaped, so it must not raise the watermark.
      {
        _syncSeq: 29,
        created: new Date(),
        deleted: true,
        name: "u1 recent",
        ownerId: "u1",
        updated: new Date(),
      },
    ]);

    await compactTombstones();

    expect(await getCompactedThroughSeq({stream: "compactStuff|owner:u1"})).toBe(11);
    expect(await getCompactedThroughSeq({stream: "compactStuff|owner:u2"})).toBe(7);
  });

  it("Task 9.15: a reaped scope-move marker raises its OLD stream's watermark", async () => {
    registerWithRetention();
    const old = DateTime.now()
      .minus({days: DEFAULT_TOMBSTONE_RETENTION_DAYS + 1})
      .toJSDate();
    await SyncCounter.create([{seq: 20, stream: "compactStuff|owner:u1"}]);
    await SyncScopeMove.collection.insertMany([
      {
        collectionTag: "compactStuff",
        created: old,
        entityId: "e-old",
        fromStream: "compactStuff|owner:u1",
        seq: 9,
        toStream: "compactStuff|owner:u2",
      },
    ]);

    await compactTombstones();

    expect(await getCompactedThroughSeq({stream: "compactStuff|owner:u1"})).toBe(9);
    // The destination stream lost nothing, so it has no retention gap.
    expect(await getCompactedThroughSeq({stream: "compactStuff|owner:u2"})).toBe(0);
  });

  it("Task 9.15: the watermark never moves backwards across compaction passes", async () => {
    registerWithRetention(1);
    const old = DateTime.now().minus({days: 5}).toJSDate();
    await SyncCounter.create([{seq: 40, stream: "compactStuff|owner:u1"}]);
    await CompactStuffModel.collection.insertMany([
      {_syncSeq: 20, created: old, deleted: true, name: "high", ownerId: "u1", updated: old},
    ]);
    await compactTombstones();
    expect(await getCompactedThroughSeq({stream: "compactStuff|owner:u1"})).toBe(20);

    // A later pass reaping only a LOWER seq must not lower the watermark.
    await CompactStuffModel.collection.insertMany([
      {_syncSeq: 3, created: old, deleted: true, name: "low", ownerId: "u1", updated: old},
    ]);
    await compactTombstones();
    expect(await getCompactedThroughSeq({stream: "compactStuff|owner:u1"})).toBe(20);
  });
});

// Helper: re-register and return the entry (retentionDays override) for compactEntryTombstones.
const clearSyncRegistryAndReRegister = (retentionDays: number): SyncRegistryEntry => {
  clearSyncRegistry();
  registerSync({
    config: {retentionDays, scope: {type: "owner"}},
    model: CompactStuffModel,
    options,
    routePath: "/compactStuff",
  });
  return {
    collectionName: CompactStuffModel.collection.collectionName,
    collectionTag: "compactStuff",
    config: {retentionDays, scope: {type: "owner"} as const},
    modelName: CompactStuffModel.modelName,
    // The registry stores entries type-erased, as registerSync does.
    options: options as unknown as ModelRouterOptions<unknown>,
    routePath: "/compactStuff",
  };
};
