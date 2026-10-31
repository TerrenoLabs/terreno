import {beforeAll, beforeEach, describe, expect, it} from "bun:test";
import {type Model, model, Schema} from "mongoose";
import {createdUpdatedPlugin, type IsDeleted, isDeletedPlugin} from "../plugins";
import {setupDb} from "../tests";
import {SyncCounter, SyncScopeMove} from "./models";
import {clearSyncRegistry, registerSync} from "./registry";
import {syncPlugin} from "./syncSeqPlugin";
import type {SyncConfig} from "./types";

/**
 * Failure-path coverage for the `_syncSeq` plugin: the guards and recovery branches that
 * the happy-path suites (sync.test, syncFrontier.test, syncPhaseC.test) never reach —
 * schema contract violations, unregistered models, `$eq`/`$in` `_id` filters, confirm and
 * release failures, reaped-claim re-stamping, and the non-tenant scope kinds
 * (custom resolver / broadcast) on the query-write path.
 */

interface SeqTenantThing extends IsDeleted {
  _id: string;
  name: string;
  orgId?: string;
  _syncSeq?: number;
  _syncPrevStream?: string | null;
}

interface SeqCustomThing extends IsDeleted {
  _id: string;
  name: string;
  workspaceId: string;
  _syncSeq?: number;
}

interface SeqBroadcastThing extends IsDeleted {
  _id: string;
  name: string;
  _syncSeq?: number;
  _syncPrevStream?: string | null;
}

const tenantSchema = new Schema<SeqTenantThing>({
  name: {description: "The name of the thing", required: true, type: String},
  orgId: {description: "The organization this thing belongs to", type: String},
});
tenantSchema.plugin(isDeletedPlugin);
tenantSchema.plugin(createdUpdatedPlugin);
tenantSchema.plugin(syncPlugin);
// Registered AFTER syncPlugin so the save fails once its seq is claimed and registered —
// the window the error middleware releases the claim in.
tenantSchema.pre("save", function () {
  if (this.name === "kaboom") {
    throw new Error("simulated post-claim save failure");
  }
});
const TenantModel = model<SeqTenantThing>("SeqPluginTenantThing", tenantSchema);

const customSchema = new Schema<SeqCustomThing>({
  name: {description: "The name of the thing", required: true, type: String},
  workspaceId: {description: "The workspace this thing belongs to", required: true, type: String},
});
customSchema.plugin(isDeletedPlugin);
customSchema.plugin(createdUpdatedPlugin);
customSchema.plugin(syncPlugin);
const CustomModel = model<SeqCustomThing>("SeqPluginCustomThing", customSchema);

const broadcastSchema = new Schema<SeqBroadcastThing>({
  name: {description: "The name of the thing", required: true, type: String},
});
broadcastSchema.plugin(isDeletedPlugin);
broadcastSchema.plugin(createdUpdatedPlugin);
broadcastSchema.plugin(syncPlugin);
const BroadcastModel = model<SeqBroadcastThing>("SeqPluginBroadcastThing", broadcastSchema);

/** Carries syncPlugin but is never registered: every hook must no-op on it. */
const unregisteredSchema = new Schema<SeqBroadcastThing>({
  name: {description: "The name of the thing", required: true, type: String},
});
unregisteredSchema.plugin(isDeletedPlugin);
unregisteredSchema.plugin(createdUpdatedPlugin);
unregisteredSchema.plugin(syncPlugin);
const UnregisteredModel = model<SeqBroadcastThing>(
  "SeqPluginUnregisteredThing",
  unregisteredSchema
);

const stubOptions = {
  permissions: {create: [], delete: [], list: [], read: [], update: []},
};

const TENANT_TAG = "seqPluginTenantThings";
const CUSTOM_TAG = "seqPluginCustomThings";
const BROADCAST_TAG = "seqPluginBroadcastThings";

type LooseUpdateOne = (
  filter: Record<string, unknown>,
  update: Record<string, unknown>,
  options?: Record<string, unknown>
) => Promise<{modifiedCount?: number}>;

type LooseFindOneAndUpdate = (
  filter: Record<string, unknown>,
  update: unknown,
  options?: Record<string, unknown>
) => Promise<unknown>;

/**
 * Make the pending-claim `$pull` that `confirmSyncSeqs`/`releaseSyncSeqs` issue either
 * throw or report "nothing cleared" (the reaped-lease signature), optionally only for one
 * stream. Returns the restore function.
 */
const stubPendingPull = ({
  behavior,
  stream,
}: {
  behavior: "throw" | "reaped";
  stream?: string;
}): (() => void) => {
  const original = SyncCounter.updateOne.bind(SyncCounter) as unknown as LooseUpdateOne;
  const stub = (async (
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: Record<string, unknown>
  ) => {
    const isPull = Boolean(update) && Object.hasOwn(update, "$pull");
    if (isPull && (!stream || filter.stream === stream)) {
      if (behavior === "throw") {
        throw new Error("simulated pending-claim $pull failure");
      }
      const result = await original(filter, update, options);
      return {...result, modifiedCount: 0};
    }
    return original(filter, update, options);
  }) as unknown as typeof SyncCounter.updateOne;
  Object.assign(SyncCounter, {updateOne: stub});
  return () => {
    Object.assign(SyncCounter, {updateOne: original});
  };
};

/** Make a seq claim fail, optionally only for one stream. Returns the restore function. */
const stubClaimFailure = ({stream}: {stream?: string}): (() => void) => {
  const original = SyncCounter.findOneAndUpdate.bind(
    SyncCounter
  ) as unknown as LooseFindOneAndUpdate;
  const stub = (async (
    filter: Record<string, unknown>,
    update: unknown,
    options?: Record<string, unknown>
  ) => {
    if (!stream || filter.stream === stream) {
      throw new Error("simulated claim failure");
    }
    return original(filter, update, options);
  }) as unknown as typeof SyncCounter.findOneAndUpdate;
  Object.assign(SyncCounter, {findOneAndUpdate: stub});
  return () => {
    Object.assign(SyncCounter, {findOneAndUpdate: original});
  };
};

/**
 * Replace the raw-collection `updateOne` the reaped-claim re-stamp uses, so it can be made
 * to match nothing or throw. Returns the restore function.
 */
const stubRawUpdateOne = <T>({
  behavior,
  model: target,
}: {
  behavior: "noMatch" | "throw";
  model: Model<T>;
}): (() => void) => {
  const collection = target.collection;
  const original = collection.updateOne.bind(collection) as unknown as LooseUpdateOne;
  // Only the re-stamp writes `{$set: {_syncSeq}}` and nothing else; Mongoose's own
  // `doc.save()` goes through the same collection method and must still land.
  const isRestamp = (update: Record<string, unknown>): boolean => {
    const set = update.$set;
    if (Object.keys(update).length !== 1 || typeof set !== "object" || set === null) {
      return false;
    }
    const keys = Object.keys(set);
    return keys.length === 1 && keys[0] === "_syncSeq";
  };
  const stub = (async (
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    options?: Record<string, unknown>
  ) => {
    if (!isRestamp(update)) {
      return original(filter, update, options);
    }
    if (behavior === "throw") {
      throw new Error("simulated re-stamp failure");
    }
    return {matchedCount: 0, modifiedCount: 0};
  }) as unknown as typeof collection.updateOne;
  Object.assign(collection, {updateOne: stub});
  return () => {
    Object.assign(collection, {updateOne: original});
  };
};

describe("syncPlugin schema contract", () => {
  it("throws when the schema disabled its versionKey", () => {
    const schema = new Schema(
      {name: {description: "The name of the thing", type: String}},
      {versionKey: false}
    );
    expect(() => schema.plugin(syncPlugin)).toThrow(/requires a versionKey/);
  });
});

describe("syncPlugin on an unregistered model", () => {
  beforeAll(async () => {
    await setupDb();
    clearSyncRegistry();
  });

  beforeEach(async () => {
    await UnregisteredModel.collection.deleteMany({});
  });

  it("stamps nothing and blocks nothing: save, hydration, query-write and insertMany all no-op", async () => {
    const doc = await UnregisteredModel.create({name: "unstamped"});
    expect(doc._syncSeq).toBeUndefined();
    // post("init") must bail out without resolving a stream for an unregistered model.
    const hydrated = await UnregisteredModel.findById(doc._id);
    expect(hydrated?._syncSeq).toBeUndefined();
    // A non-_id query-write is only rejected for registered models.
    await UnregisteredModel.updateOne({name: "unstamped"}, {$set: {name: "renamed"}});
    expect((await UnregisteredModel.findById(doc._id))?.name).toBe("renamed");
    const inserted = await UnregisteredModel.insertMany([{name: "a"}, {name: "b"}]);
    expect(inserted).toHaveLength(2);
    expect(inserted.every((entry) => entry._syncSeq === undefined)).toBe(true);
  });
});

describe("syncPlugin write-path failure and recovery branches", () => {
  beforeAll(async () => {
    await setupDb();
    await SyncCounter.ensureIndexes();
    clearSyncRegistry();
    registerSync({
      config: {scope: {field: "orgId", type: "tenant"}} as SyncConfig,
      model: TenantModel,
      options: stubOptions,
      routePath: `/${TENANT_TAG}`,
    });
    registerSync({
      config: {
        scope: (doc: Record<string, unknown>) => String(doc.workspaceId),
        snapshotFilter: () => ({}),
      } as SyncConfig,
      model: CustomModel,
      options: stubOptions,
      routePath: `/${CUSTOM_TAG}`,
    });
    registerSync({
      config: {scope: {type: "broadcast"}} as SyncConfig,
      model: BroadcastModel,
      options: stubOptions,
      routePath: `/${BROADCAST_TAG}`,
    });
  });

  beforeEach(async () => {
    // deleteMany is blocked on synced models; clear via the native collections.
    await TenantModel.collection.deleteMany({});
    await CustomModel.collection.deleteMany({});
    await BroadcastModel.collection.deleteMany({});
    await SyncCounter.deleteMany({});
    await SyncScopeMove.deleteMany({});
  });

  // ── m9: single-`_id` filter shapes ────────────────────────────────────────
  it("accepts an `_id: {$eq}` filter and rejects `_id: {$in}` and a null `_id`", async () => {
    const doc = await TenantModel.create({name: "n", orgId: "org1"});
    const createSeq = doc._syncSeq as number;
    await TenantModel.updateOne({_id: {$eq: doc._id}}, {$set: {name: "eq-renamed"}});
    const reloaded = await TenantModel.findById(doc._id);
    expect(reloaded?.name).toBe("eq-renamed");
    expect(reloaded?._syncSeq).toBe(createSeq + 1);

    await expect(
      TenantModel.updateOne({_id: {$in: [doc._id]}}, {$set: {name: "x"}}).exec()
    ).rejects.toThrow(/must target a single document by _id/);
    await expect(TenantModel.updateOne({_id: null}, {$set: {name: "x"}}).exec()).rejects.toThrow(
      /must target a single document by _id/
    );
  });

  // ── C1: confirm failures never fail the user's write ──────────────────────
  it("a confirm failure after save is logged, not surfaced", async () => {
    const doc = await TenantModel.create({name: "n", orgId: "org1"});
    const restore = stubPendingPull({behavior: "throw"});
    try {
      doc.name = "renamed";
      await doc.save();
    } finally {
      restore();
    }
    expect((await TenantModel.findById(doc._id))?.name).toBe("renamed");
  });

  it("a confirm failure after a query write is logged, not surfaced", async () => {
    const doc = await TenantModel.create({name: "n", orgId: "org1"});
    const restore = stubPendingPull({behavior: "throw"});
    try {
      await TenantModel.updateOne({_id: doc._id}, {$set: {name: "renamed"}});
    } finally {
      restore();
    }
    expect((await TenantModel.findById(doc._id))?.name).toBe("renamed");
  });

  it("a confirm failure after insertMany is logged, not surfaced", async () => {
    const restore = stubPendingPull({behavior: "throw"});
    try {
      await TenantModel.insertMany([
        {name: "im-1", orgId: "org1"},
        {name: "im-2", orgId: "org1"},
      ]);
    } finally {
      restore();
    }
    const docs = await TenantModel.find({orgId: "org1"});
    expect(docs).toHaveLength(2);
    expect(docs.every((entry) => typeof entry._syncSeq === "number")).toBe(true);
  });

  it("insertMany of an empty batch claims nothing", async () => {
    await TenantModel.insertMany([]);
    expect(await SyncCounter.countDocuments({})).toBe(0);
  });

  // ── Task 9.13: a failed save releases its claim ───────────────────────────
  it("a release failure after a failed save is logged, not surfaced", async () => {
    const restore = stubPendingPull({behavior: "throw"});
    try {
      await expect(TenantModel.create({name: "kaboom", orgId: "org1"})).rejects.toThrow(
        /simulated post-claim save failure/
      );
    } finally {
      restore();
    }
    expect(await TenantModel.collection.countDocuments({})).toBe(0);
  });

  // ── Task 9.17: reaped-claim re-stamping ───────────────────────────────────
  it("a re-stamp that matches no document releases its claim and leaves the doc below the frontier", async () => {
    const doc = await TenantModel.create({name: "n", orgId: "org1"});
    const claimedSeq = doc._syncSeq as number;
    const restorePull = stubPendingPull({behavior: "reaped"});
    const restoreRaw = stubRawUpdateOne({behavior: "noMatch", model: TenantModel});
    try {
      doc.name = "renamed";
      await doc.save();
    } finally {
      restoreRaw();
      restorePull();
    }
    // The re-stamp never landed, so the in-memory doc keeps the seq its own save stamped.
    expect(doc._syncSeq).toBe(claimedSeq + 1);
  });

  it("a re-stamp whose own confirm is reaped keeps the new seq on the document", async () => {
    const doc = await TenantModel.create({name: "n", orgId: "org1"});
    const savedSeq = doc._syncSeq as number;
    const restore = stubPendingPull({behavior: "reaped"});
    try {
      doc.name = "renamed";
      await doc.save();
    } finally {
      restore();
    }
    const reStamped = doc._syncSeq as number;
    expect(reStamped).toBeGreaterThan(savedSeq + 1);
    expect((await TenantModel.findById(doc._id))?._syncSeq).toBe(reStamped);
  });

  it("a re-stamp that throws leaves the document's own seq in place", async () => {
    const doc = await TenantModel.create({name: "n", orgId: "org1"});
    const claimedSeq = doc._syncSeq as number;
    const restorePull = stubPendingPull({behavior: "reaped"});
    const restoreRaw = stubRawUpdateOne({behavior: "throw", model: TenantModel});
    try {
      doc.name = "renamed";
      await doc.save();
    } finally {
      restoreRaw();
      restorePull();
    }
    expect(doc._syncSeq).toBe(claimedSeq + 1);
  });

  // ── C4: scope-move marker failures ────────────────────────────────────────
  it("a scope-move marker whose seq claim fails writes no marker and never fails the move", async () => {
    const doc = await TenantModel.create({name: "n", orgId: "org1"});
    const restore = stubClaimFailure({stream: `${TENANT_TAG}|tenant:org1`});
    try {
      doc.orgId = "org2";
      await doc.save();
    } finally {
      restore();
    }
    expect(await SyncScopeMove.countDocuments({entityId: String(doc._id)})).toBe(0);
    expect((await TenantModel.findById(doc._id))?.orgId).toBe("org2");
  });

  it("a scope-move marker whose confirm fails still writes the marker", async () => {
    const doc = await TenantModel.create({name: "n", orgId: "org1"});
    const restore = stubPendingPull({behavior: "throw", stream: `${TENANT_TAG}|tenant:org1`});
    try {
      doc.orgId = "org2";
      await doc.save();
    } finally {
      restore();
    }
    const markers = await SyncScopeMove.find({entityId: String(doc._id)});
    expect(markers).toHaveLength(1);
    expect(markers[0].fromStream).toBe(`${TENANT_TAG}|tenant:org1`);
  });

  // ── query-write scope resolution for non-tenant scope kinds ───────────────
  it("a custom scope resolver resolves the query-write's stream from the merged document", async () => {
    const doc = await CustomModel.create({name: "n", workspaceId: "w1"});
    await CustomModel.updateOne({_id: doc._id}, {$set: {workspaceId: "w2"}});
    const reloaded = await CustomModel.findById(doc._id);
    expect(reloaded?._syncSeq).toBe(1);
    const markers = await SyncScopeMove.find({entityId: String(doc._id)});
    expect(markers).toHaveLength(1);
    expect(markers[0].fromStream).toBe(`${CUSTOM_TAG}|custom:w1`);
    expect(markers[0].toStream).toBe(`${CUSTOM_TAG}|custom:w2`);
  });

  it("a broadcast scope stamps the single all-stream and never reports a move", async () => {
    const doc = await BroadcastModel.create({name: "n"});
    await BroadcastModel.updateOne({_id: doc._id}, {$set: {name: "renamed"}});
    const reloaded = await BroadcastModel.findById(doc._id);
    expect(reloaded?._syncSeq).toBe((doc._syncSeq as number) + 1);
    expect(reloaded?._syncPrevStream ?? null).toBeNull();
    expect(await SyncScopeMove.countDocuments({})).toBe(0);
    const counter = await SyncCounter.findOne({stream: `${BROADCAST_TAG}|all`});
    expect(counter?.seq).toBe(2);
  });
});
