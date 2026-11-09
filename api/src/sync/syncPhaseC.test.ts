import {beforeEach, describe, expect, it} from "bun:test";
import type express from "express";
import type {Collection} from "mongodb";
import {type Model, model, Schema} from "mongoose";
import supertest from "supertest";
import type TestAgent from "supertest/lib/agent";
import type {ModelRouterOptions, RESTMethod} from "../api";
import {type UserModel as AuthUserModel, addAuthRoutes, setupAuth, type User} from "../auth";
import {Permissions} from "../permissions";
import {createdUpdatedPlugin, type IsDeleted, isDeletedPlugin} from "../plugins";
import {DEFAULT_IGNORED_COLLECTIONS} from "../realtime/changeStreamWatcher";
import {authAsUser, getBaseServer, setupDb, UserModel} from "../tests";
import {SyncCounter, SyncKey, SyncMutation} from "./models";
import {
  clearSyncRegistry,
  ensureSyncIndexes,
  findSyncEntryByCollectionTag,
  registerSync,
  type SyncRegistryEntry,
} from "./registry";
import {compactEntryTombstones} from "./scripts/compactTombstones";
import {SyncApp} from "./syncApp";
import {syncPlugin} from "./syncSeqPlugin";

/**
 * Phase C route/scope tests: per-stream snapshot cursors (C2), legacy `_id` pagination
 * (C3), write-scope enforcement + snapshot read parity (C6), and the C8 minors.
 * C1 (frontier) and C4 (scope-move markers) have their own dedicated files.
 */

interface PhaseCTodo extends IsDeleted {
  _id: string;
  title: string;
  ownerId: string;
  _syncSeq?: number;
}

interface SnapshotEntity {
  id: string;
  seq: number;
  deleted: boolean;
  data: {title?: string} | null;
}

const phaseCTodoSchema = new Schema<PhaseCTodo>({
  ownerId: {description: "The owner", type: String},
  title: {description: "The title", required: true, type: String},
});
phaseCTodoSchema.plugin(isDeletedPlugin);
phaseCTodoSchema.plugin(createdUpdatedPlugin);
phaseCTodoSchema.plugin(syncPlugin);
const PhaseCTodoModel = model<PhaseCTodo>("SyncPhaseCTodo", phaseCTodoSchema);

interface PhaseCProject extends IsDeleted {
  _id: string;
  title: string;
  orgId: string;
  _syncSeq?: number;
}

interface PhaseCNote extends IsDeleted {
  _id: string;
  title: string;
  ownerId: string;
  _syncSeq?: number;
}

/**
 * Task 9.14: a STRING `_id` model — the shape synced models are designed around, since
 * clients mint their own ids offline. The legacy (seq-0) stratum must page these by raw
 * string comparison; casting the cursor to ObjectId either throws or matches nothing.
 */
const phaseCNoteSchema = new Schema<PhaseCNote>({
  _id: {description: "Client-minted string id", type: String},
  ownerId: {description: "The owner", type: String},
  title: {description: "The title", required: true, type: String},
});
phaseCNoteSchema.plugin(isDeletedPlugin);
phaseCNoteSchema.plugin(createdUpdatedPlugin);
phaseCNoteSchema.plugin(syncPlugin);
const PhaseCNoteModel = model<PhaseCNote>("SyncPhaseCNote", phaseCNoteSchema);

const phaseCProjectSchema = new Schema<PhaseCProject>({
  orgId: {description: "The organization", type: String},
  title: {description: "The title", required: true, type: String},
});
phaseCProjectSchema.plugin(isDeletedPlugin);
phaseCProjectSchema.plugin(createdUpdatedPlugin);
phaseCProjectSchema.plugin(syncPlugin);
const PhaseCProjectModel = model<PhaseCProject>("SyncPhaseCProject", phaseCProjectSchema);

const authedOptions: ModelRouterOptions<unknown> = {
  permissions: {
    create: [Permissions.IsAuthenticated],
    delete: [Permissions.IsAuthenticated],
    list: [Permissions.IsAuthenticated],
    read: [Permissions.IsAuthenticated],
    update: [Permissions.IsAuthenticated],
  },
};

// Per-user tenant membership, mutable so join tests can extend it.
const userOrgs = new Map<string, string[]>();

describe("Phase C sync routes", () => {
  let app: express.Application;
  let server: TestAgent;
  let agent: TestAgent;
  let notAdminId: string;

  const ownerStream = (): string => `phaseCTodos|owner:${notAdminId}`;
  const enc = encodeURIComponent;

  beforeEach(async () => {
    const [, notAdmin] = await setupDb();
    notAdminId = String(notAdmin._id);
    userOrgs.clear();
    userOrgs.set(notAdminId, ["org1", "org2"]);

    clearSyncRegistry();
    registerSync({
      config: {scope: {type: "owner"}},
      model: PhaseCTodoModel as unknown as Model<unknown>,
      options: authedOptions,
      routePath: "/phaseCTodos",
    });
    registerSync({
      config: {scope: {field: "orgId", type: "tenant"}},
      model: PhaseCProjectModel as unknown as Model<unknown>,
      options: authedOptions,
      routePath: "/phaseCProjects",
    });
    registerSync({
      config: {scope: {type: "owner"}},
      model: PhaseCNoteModel as unknown as Model<unknown>,
      options: authedOptions,
      routePath: "/phaseCNotes",
    });

    await Promise.all([
      PhaseCTodoModel.collection.deleteMany({}),
      PhaseCNoteModel.collection.deleteMany({}),
      PhaseCProjectModel.collection.deleteMany({}),
      SyncCounter.deleteMany({}),
      SyncKey.deleteMany({}),
      SyncMutation.deleteMany({}),
    ]);

    app = getBaseServer();
    setupAuth(app, UserModel as unknown as AuthUserModel);
    addAuthRoutes(app, UserModel as unknown as AuthUserModel);
    new SyncApp({
      getUserScopes: (user: User, entry: SyncRegistryEntry) => {
        // Custom-scoped entries (used by the $or snapshotFilter test) resolve their
        // membership to the caller's own id (the custom scope value = ownerId).
        if (typeof entry.config.scope === "function") {
          return [String(user.id)];
        }
        return userOrgs.get(String(user.id)) ?? [];
      },
    }).register(app);
    // Task 9.9: no manual `ensureIndexes()` anywhere in this setup — registering SyncApp
    // enqueues the bookkeeping index builds, and this is the same await TerrenoApp.start()
    // performs before listening.
    await ensureSyncIndexes();

    server = supertest(app);
    agent = await authAsUser(app, "notAdmin");
  });

  // ── C2: per-stream cursors + /sync/streams ────────────────────────────────
  describe("C2 — per-stream cursors and /sync/streams", () => {
    it("GET /sync/streams returns owner + tenant streams reflecting memberships", async () => {
      const res = await agent.get("/sync/streams").expect(200);
      const streams: string[] = res.body.streams.map((s: {stream: string}) => s.stream);
      expect(streams).toContain(ownerStream());
      expect(streams).toContain("phaseCProjects|tenant:org1");
      expect(streams).toContain("phaseCProjects|tenant:org2");
      // Every entry carries its collection tag.
      for (const s of res.body.streams) {
        expect(typeof s.collection).toBe("string");
      }
    });

    it("requires authentication for /sync/streams", async () => {
      await server.get("/sync/streams").expect(401);
    });

    it("catches two tenant streams to independent cursors (the flattened-cursor bug does NOT reproduce)", async () => {
      // org1 has a high seq (many writes), org2 a low seq. Under the OLD flattened cursor,
      // catching org1 to its head would strand org2 behind org1's cursor. Per-stream, each
      // catches independently.
      for (let i = 1; i <= 6; i++) {
        await PhaseCProjectModel.create({orgId: "org1", title: `org1-${i}`});
      }
      await PhaseCProjectModel.create({orgId: "org2", title: "org2-only"});

      const org1 = await agent
        .get(`/sync/snapshot?stream=${enc("phaseCProjects|tenant:org1")}`)
        .expect(200);
      expect(org1.body.entities).toHaveLength(6);
      expect(org1.body.cursor).toBe(6);

      // org2's stream has its OWN counter — its single doc is seq 1, fully caught up
      // regardless of org1's cursor being at 6.
      const org2 = await agent
        .get(`/sync/snapshot?stream=${enc("phaseCProjects|tenant:org2")}`)
        .expect(200);
      expect(org2.body.entities).toHaveLength(1);
      expect(org2.body.entities[0].data.title).toBe("org2-only");
      expect(org2.body.entities[0].seq).toBe(1);
      expect(org2.body.cursor).toBe(1);
      expect(org2.body.hasMore).toBe(false);
    });

    it("reflects a tenant join in /sync/streams (new stream becomes available)", async () => {
      let res = await agent.get("/sync/streams").expect(200);
      expect(res.body.streams.map((s: {stream: string}) => s.stream)).not.toContain(
        "phaseCProjects|tenant:org3"
      );
      // Join org3.
      userOrgs.set(notAdminId, ["org1", "org2", "org3"]);
      res = await agent.get("/sync/streams").expect(200);
      expect(res.body.streams.map((s: {stream: string}) => s.stream)).toContain(
        "phaseCProjects|tenant:org3"
      );
      // And the newly-joined stream is now snapshottable.
      await PhaseCProjectModel.create({orgId: "org3", title: "joined"});
      const snap = await agent
        .get(`/sync/snapshot?stream=${enc("phaseCProjects|tenant:org3")}`)
        .expect(200);
      expect(snap.body.entities[0].data.title).toBe("joined");
    });

    it("403s snapshotting a tenant stream the user does not belong to", async () => {
      await agent.get(`/sync/snapshot?stream=${enc("phaseCProjects|tenant:orgOther")}`).expect(403);
    });
  });

  // ── C3: legacy _id pagination ──────────────────────────────────────────────
  describe("C3 — legacy _id-paged stratum", () => {
    it("drains a large legacy stratum via legacyCursor then continues by seq (no infinite loop)", async () => {
      // 1201 legacy docs (no _syncSeq) via raw insert; limit 500. The old first-page-only
      // logic looped forever; the _id stratum drains deterministically.
      const legacy = Array.from({length: 1201}, (_v, i) => ({
        deleted: false,
        name: undefined,
        ownerId: notAdminId,
        title: `legacy-${String(i).padStart(4, "0")}`,
      }));
      await PhaseCTodoModel.collection.insertMany(legacy);
      // A couple of modern (stamped) docs after the legacy stratum.
      await PhaseCTodoModel.create({ownerId: notAdminId, title: "modern-1"});
      await PhaseCTodoModel.create({ownerId: notAdminId, title: "modern-2"});

      const seen = new Set<string>();
      let cursor = 0;
      let legacyCursor: string | undefined;
      let pages = 0;
      const limit = 500;
      // Simulate the client loop: echo legacyCursor until absent, then page by seq.
      for (;;) {
        pages += 1;
        expect(pages).toBeLessThan(20); // termination guard
        const qs = new URLSearchParams({limit: String(limit), stream: ownerStream()});
        if (cursor > 0) {
          qs.set("cursor", String(cursor));
        }
        if (legacyCursor !== undefined) {
          qs.set("legacyCursor", legacyCursor);
        }
        const res = await agent.get(`/sync/snapshot?${qs.toString()}`).expect(200);
        for (const e of res.body.entities) {
          seen.add(e.id);
        }
        if (res.body.legacyCursor !== undefined) {
          legacyCursor = res.body.legacyCursor;
          continue;
        }
        // Legacy stratum drained; now paging by seq.
        legacyCursor = undefined;
        if (!res.body.hasMore) {
          break;
        }
        cursor = res.body.cursor;
      }
      // All 1201 legacy + 2 modern docs delivered, none missed.
      expect(seen.size).toBe(1203);
    }, 30_000);

    it("delivers a small legacy stratum then the seq stratum in order", async () => {
      await PhaseCTodoModel.collection.insertMany([
        {deleted: false, ownerId: notAdminId, title: "legacy-a"},
        {deleted: false, ownerId: notAdminId, title: "legacy-b"},
      ]);
      await PhaseCTodoModel.create({ownerId: notAdminId, title: "stamped"});

      const page1 = await agent
        .get(`/sync/snapshot?stream=${enc(ownerStream())}&limit=10`)
        .expect(200);
      // First page is the legacy stratum (seq 0), with a legacyCursor.
      expect(page1.body.entities.every((e: SnapshotEntity) => e.seq === 0)).toBe(true);
      expect(page1.body.legacyCursor).toBeDefined();
      expect(page1.body.hasMore).toBe(true);

      const page2 = await agent
        .get(
          `/sync/snapshot?stream=${enc(ownerStream())}&limit=10&legacyCursor=${enc(
            page1.body.legacyCursor
          )}`
        )
        .expect(200);
      // Legacy stratum exhausted; falls through to seq paging (no legacyCursor).
      expect(page2.body.legacyCursor).toBeUndefined();
      const stamped = page2.body.entities.find((e: SnapshotEntity) => e.data?.title === "stamped");
      expect(stamped?.seq).toBe(1);
    });

    it("serves soft-deleted legacy documents as data-less tombstones", async () => {
      await PhaseCTodoModel.collection.insertMany([
        {deleted: true, ownerId: notAdminId, title: "DUMMY-deleted-legacy"},
        {deleted: false, ownerId: notAdminId, title: "DUMMY-live-legacy"},
      ]);

      const page = await agent
        .get(`/sync/snapshot?stream=${enc(ownerStream())}&limit=10`)
        .expect(200);
      const entities = page.body.entities as SnapshotEntity[];
      expect(entities).toHaveLength(2);
      const tombstone = entities.find((e) => e.deleted);
      expect(tombstone).toMatchObject({data: null, deleted: true, seq: 0});
      const live = entities.find((e) => !e.deleted);
      expect(live?.data?.title).toBe("DUMMY-live-legacy");
      expect(JSON.stringify(page.body)).not.toContain("DUMMY-deleted-legacy");
    });

    it("Task 9.14: a string-_id model with more legacy docs than the limit bootstraps completely", async () => {
      // Non-hex, client-minted ids: casting the legacy cursor to ObjectId would throw
      // (500), and a hex-shaped string id would compare across BSON types and match
      // nothing — either way the stratum reported itself exhausted after one page and the
      // remaining docs were silently skipped forever.
      const noteStream = `phaseCNotes|owner:${notAdminId}`;
      const total = 25;
      const limit = 10;
      // The driver collection defaults to ObjectId keys; this model mints string ids.
      const rawNotes = PhaseCNoteModel.collection as unknown as Collection<PhaseCNote>;
      await rawNotes.insertMany(
        Array.from({length: total}, (_v, i) => ({
          _id: `note-${String(i).padStart(3, "0")}`,
          deleted: false,
          ownerId: notAdminId,
          title: `legacy note ${i}`,
        }))
      );
      await PhaseCNoteModel.create({
        _id: "note-modern",
        ownerId: notAdminId,
        title: "stamped note",
      });

      const seen = new Set<string>();
      let cursor = 0;
      let legacyCursor: string | undefined;
      for (let page = 0; page < 12; page++) {
        const qs = new URLSearchParams({limit: String(limit), stream: noteStream});
        if (cursor > 0) {
          qs.set("cursor", String(cursor));
        }
        if (legacyCursor !== undefined) {
          qs.set("legacyCursor", legacyCursor);
        }
        const res = await agent.get(`/sync/snapshot?${qs.toString()}`).expect(200);
        for (const entity of res.body.entities) {
          seen.add(entity.id);
        }
        if (res.body.legacyCursor !== undefined) {
          legacyCursor = res.body.legacyCursor;
          continue;
        }
        legacyCursor = undefined;
        if (!res.body.hasMore) {
          break;
        }
        cursor = res.body.cursor;
      }
      expect(seen.size).toBe(total + 1);
      expect(seen.has("note-000")).toBe(true);
      expect(seen.has("note-024")).toBe(true);
      expect(seen.has("note-modern")).toBe(true);
    });

    it("Task 9.14: 400s (not 500s) on a malformed legacyCursor for an ObjectId-keyed model", async () => {
      await PhaseCTodoModel.collection.insertMany([
        {deleted: false, ownerId: notAdminId, title: "legacy-a"},
      ]);
      await agent
        .get(`/sync/snapshot?stream=${enc(ownerStream())}&legacyCursor=not-an-object-id`)
        .expect(400);
    });
  });

  // ── C6: write-scope enforcement + snapshot read parity ─────────────────────
  describe("C6 — write-scope enforcement + read parity", () => {
    const create = (mutationId: string, data: Record<string, unknown>) => ({
      collection: "phaseCTodos",
      data,
      mutationId,
      operation: "create",
    });

    it("nacks unauthorized a create with a foreign ownerId (owner scope)", async () => {
      const res = await agent
        .post("/sync/mutate")
        .send(create("c6-owner-foreign", {ownerId: "someoneElse", title: "x"}))
        .expect(403);
      expect(res.body.nack.code).toBe("unauthorized");
      expect(await PhaseCTodoModel.countDocuments({title: "x"})).toBe(0);
    });

    it("allows a create with the caller's own ownerId", async () => {
      const res = await agent
        .post("/sync/mutate")
        .send(create("c6-owner-self", {ownerId: notAdminId, title: "mine"}))
        .expect(200);
      expect(res.body.ack.mutationId).toBe("c6-owner-self");
    });

    it("nacks unauthorized a tenant create for a non-member org", async () => {
      const res = await agent
        .post("/sync/mutate")
        .send({
          collection: "phaseCProjects",
          data: {orgId: "orgNotMine", title: "sneaky"},
          mutationId: "c6-tenant-foreign",
          operation: "create",
        })
        .expect(403);
      expect(res.body.nack.code).toBe("unauthorized");
    });

    it("allows a tenant create for a member org", async () => {
      await agent
        .post("/sync/mutate")
        .send({
          collection: "phaseCProjects",
          data: {orgId: "org1", title: "ours"},
          mutationId: "c6-tenant-member",
          operation: "create",
        })
        .expect(200);
    });

    it("snapshot omits per-doc read-denied docs but still advances the cursor past them", async () => {
      // A read permission that denies odd-titled docs.
      clearSyncRegistry();
      registerSync({
        config: {scope: {type: "owner"}},
        model: PhaseCTodoModel as unknown as Model<unknown>,
        options: {
          ...authedOptions,
          permissions: {
            ...authedOptions.permissions,
            read: [
              (_method: RESTMethod, _user?: User, doc?: unknown) => {
                if (!doc) {
                  return true;
                }
                return !String((doc as PhaseCTodo).title).endsWith("-secret");
              },
            ],
          },
        } as unknown as ModelRouterOptions<unknown>,
        routePath: "/phaseCTodos",
      });

      await PhaseCTodoModel.create({ownerId: notAdminId, title: "visible-1"});
      await PhaseCTodoModel.create({ownerId: notAdminId, title: "hidden-secret"});
      await PhaseCTodoModel.create({ownerId: notAdminId, title: "visible-2"});

      const res = await agent.get(`/sync/snapshot?stream=${enc(ownerStream())}`).expect(200);
      const titles = res.body.entities.map((e: SnapshotEntity) => e.data?.title);
      expect(titles).toEqual(["visible-1", "visible-2"]);
      // The cursor advanced past the denied doc (seq 3), so it is never re-fetched.
      expect(res.body.cursor).toBe(3);
    });

    it("advances the cursor past a full page of read-denied docs so bootstrap terminates", async () => {
      // A read permission denying every "denied-*" doc, so a whole page can be dropped.
      clearSyncRegistry();
      registerSync({
        config: {scope: {type: "owner"}},
        model: PhaseCTodoModel as unknown as Model<unknown>,
        options: {
          ...authedOptions,
          permissions: {
            ...authedOptions.permissions,
            read: [
              (_method: RESTMethod, _user?: User, doc?: unknown) => {
                if (!doc) {
                  return true;
                }
                return !String((doc as {title?: string}).title).startsWith("denied-");
              },
            ],
          },
        } as unknown as ModelRouterOptions<unknown>,
        routePath: "/phaseCTodos",
      });

      // 5 contiguous denied docs (more than the page limit of 2) then one visible doc.
      for (let i = 1; i <= 5; i++) {
        await PhaseCTodoModel.create({ownerId: notAdminId, title: `denied-${i}`});
      }
      await PhaseCTodoModel.create({ownerId: notAdminId, title: "visible"});

      const seenTitles: string[] = [];
      let cursor = 0;
      let pages = 0;
      for (;;) {
        pages += 1;
        expect(pages).toBeLessThan(10); // termination guard: the old cursor logic looped forever
        const qs = new URLSearchParams({limit: "2", stream: ownerStream()});
        if (cursor > 0) {
          qs.set("cursor", String(cursor));
        }
        const res = await agent.get(`/sync/snapshot?${qs.toString()}`).expect(200);
        for (const entity of res.body.entities) {
          seenTitles.push(entity.data?.title ?? `tombstone:${entity.id}`);
        }
        // Every page consumes seqs, so the cursor always moves forward.
        expect(res.body.cursor).toBeGreaterThan(cursor);
        cursor = res.body.cursor;
        if (!res.body.hasMore) {
          break;
        }
      }
      // Denied docs are never leaked, and the cursor ends at the stream head.
      expect(seenTitles).toEqual(["visible"]);
      expect(cursor).toBe(6);
    });

    it("composes a custom-scope $or snapshotFilter with $and (does not clobber deleted/seq)", async () => {
      // A custom scope whose snapshotFilter is an $or; the route must $and it with the
      // deleted/seq clauses so tombstones and seq bounds still apply.
      clearSyncRegistry();
      registerSync({
        config: {
          scope: (doc: Record<string, unknown>) => String(doc.ownerId),
          snapshotFilter: () => ({$or: [{ownerId: notAdminId}, {ownerId: "shared"}]}),
        },
        model: PhaseCTodoModel as unknown as Model<unknown>,
        options: authedOptions,
        routePath: "/phaseCTodos",
      });
      const mine = await PhaseCTodoModel.create({ownerId: notAdminId, title: "mine"});
      await PhaseCTodoModel.create({ownerId: "shared", title: "shared"});
      await PhaseCTodoModel.create({ownerId: "other", title: "other"});
      // Soft-delete one so the tombstone path is exercised under the $or filter.
      mine.deleted = true;
      await mine.save();

      const customStream = `phaseCTodos|custom:${notAdminId}`;
      const res = await agent.get(`/sync/snapshot?stream=${enc(customStream)}`).expect(200);
      const byTitle = new Map<string, SnapshotEntity>(
        res.body.entities.map((e: SnapshotEntity) => [e.id, e])
      );
      // "other" is excluded by the $or filter; "mine" appears as a tombstone (data null).
      const titles = res.body.entities
        .filter((e: SnapshotEntity) => !e.deleted)
        .map((e: SnapshotEntity) => e.data?.title)
        .sort();
      expect(titles).toEqual(["shared"]);
      const tombstone = byTitle.get(String(mine._id));
      expect(tombstone?.deleted).toBe(true);
      expect(tombstone?.data).toBeNull();
    });

    it("throws on a query updateOne with upsert:true (m8)", async () => {
      const doc = await PhaseCTodoModel.create({ownerId: notAdminId, title: "u"});
      // upsert:true on a synced model must throw at the plugin layer.
      let threw = false;
      try {
        await PhaseCTodoModel.updateOne({_id: doc._id}, {$set: {title: "u2"}}, {upsert: true});
      } catch (error) {
        threw = true;
        expect(String(error)).toMatch(/upsert/i);
      }
      expect(threw).toBe(true);
    });

    it("nacks validation an update with baseVersion omitted (C8)", async () => {
      const doc = await PhaseCTodoModel.create({ownerId: notAdminId, title: "needs base"});
      const res = await agent
        .post("/sync/mutate")
        .send({
          collection: "phaseCTodos",
          data: {title: "changed"},
          id: String(doc._id),
          mutationId: "c8-no-base",
          operation: "update",
          // baseVersion intentionally omitted
        })
        .expect(422);
      expect(res.body.nack.code).toBe("validation");
      expect(res.body.nack.message).toMatch(/baseVersion/i);
    });
  });

  // ── C8: minors ─────────────────────────────────────────────────────────────
  describe("C8 — minors", () => {
    it("returns an idempotent ack when deleting an already-deleted doc (not 404/validation)", async () => {
      const doc = await PhaseCTodoModel.create({ownerId: notAdminId, title: "to delete"});
      const first = await agent
        .post("/sync/mutate")
        .send({
          collection: "phaseCTodos",
          id: String(doc._id),
          mutationId: "c8-del-1",
          operation: "delete",
        })
        .expect(200);
      expect(first.body.ack).toBeDefined();

      // Second delete of the (now soft-deleted) doc, distinct mutationId: idempotent ack.
      const second = await agent
        .post("/sync/mutate")
        .send({
          collection: "phaseCTodos",
          id: String(doc._id),
          mutationId: "c8-del-2",
          operation: "delete",
        })
        .expect(200);
      expect(second.body.ack).toBeDefined();
      expect(second.body.ack.id).toBe(String(doc._id));
    });

    it("passes 'read' (not 'list') to the modelRouter responseHandler for single-entity sync serialization", async () => {
      const seenMethods: string[] = [];
      clearSyncRegistry();
      registerSync({
        config: {scope: {type: "owner"}},
        model: PhaseCTodoModel as unknown as Model<unknown>,
        options: {
          ...authedOptions,
          responseHandler: async (value: {title?: string}, method: string) => {
            seenMethods.push(method);
            return method === "read" ? {shape: "read", title: value.title} : value;
          },
        } as unknown as ModelRouterOptions<unknown>,
        routePath: "/phaseCTodos",
      });
      await PhaseCTodoModel.create({ownerId: notAdminId, title: "rh"});
      const res = await agent.get(`/sync/snapshot?stream=${enc(ownerStream())}`).expect(200);
      expect(seenMethods).toContain("read");
      expect(seenMethods).not.toContain("list");
      expect(res.body.entities[0].data).toEqual({shape: "read", title: "rh"});
    });

    it("rejects a duplicate collectionTag at registration", () => {
      clearSyncRegistry();
      registerSync({
        config: {scope: {type: "owner"}},
        model: PhaseCTodoModel as unknown as Model<unknown>,
        options: authedOptions,
        routePath: "/dupTag",
      });
      // A different model under the SAME tag must be rejected (the tag, not the model,
      // is the duplicate). PhaseCProjectModel's valid tenant scope passes the field check
      // so registration reaches the duplicate-tag guard.
      expect(() =>
        registerSync({
          config: {scope: {field: "orgId", type: "tenant"}},
          model: PhaseCProjectModel as unknown as Model<unknown>,
          options: authedOptions,
          routePath: "/dupTag",
        })
      ).toThrow(/already registered/i);
    });
  });

  // ── C7: change-stream watcher ignores sync bookkeeping collections ──────────
  describe("C7 — watcher ignores sync bookkeeping collections", () => {
    it("adds the sync bookkeeping collections to the watcher's default ignore list", () => {
      // The watcher's change-stream pipeline excludes these collections, so their own
      // internal writes (counter $inc, ledger rows, scope-move markers, key material)
      // never drive fan-out or get reprocessed as deltas.
      for (const coll of ["synccounters", "syncmutations", "syncscopemoves", "synckeys"]) {
        expect(DEFAULT_IGNORED_COLLECTIONS).toContain(coll);
      }
    });
  });

  // ── Task 9.15: retention watermark end-to-end ───────────────────────────────
  describe("Task 9.15 — retention watermark drives re-bootstrap", () => {
    /** The registered entry with retention forced to 0 so "now" is already past it. */
    const zeroRetentionEntry = (collectionTag: string): SyncRegistryEntry => {
      const entry = findSyncEntryByCollectionTag(collectionTag);
      if (!entry) {
        throw new Error(`${collectionTag} is not registered`);
      }
      return {...entry, config: {...entry.config, retentionDays: 0}};
    };

    it("a cursor older than the compaction watermark re-bootstraps and converges", async () => {
      // Three docs; the middle one is deleted (seq 4) and then compacted away. A client
      // whose cursor sits at 2 — above the retention floor the OLD min(seq) computation
      // would have reported, but below the deletion — must be told to re-bootstrap.
      const keep = await PhaseCTodoModel.create({ownerId: notAdminId, title: "keep"}); // seq 1
      const doomed = await PhaseCTodoModel.create({ownerId: notAdminId, title: "doomed"}); // seq 2
      await PhaseCTodoModel.create({ownerId: notAdminId, title: "later"}); // seq 3
      doomed.deleted = true;
      await doomed.save(); // seq 4 — the tombstone the stale cursor never saw

      const stream = ownerStream();
      // Nothing compacted yet: no retention gap to enforce.
      const before = await agent.get(`/sync/snapshot?stream=${enc(stream)}&cursor=2`).expect(200);
      expect(before.body.oldestRetainedSeq).toBe(0);

      const counts = await compactEntryTombstones(zeroRetentionEntry("phaseCTodos"));
      expect(counts.tombstones).toBe(1);

      const after = await agent.get(`/sync/snapshot?stream=${enc(stream)}&cursor=2`).expect(200);
      // The watermark is the reaped tombstone's seq, so the client's rule
      // (cursor > 0 && cursor < oldestRetainedSeq) fires.
      expect(after.body.oldestRetainedSeq).toBe(4);
      expect(after.body.cursor).toBeLessThan(after.body.oldestRetainedSeq + 1);

      // Re-bootstrapping from 0 converges on live state with the deleted doc absent.
      const rebootstrap = await agent
        .get(`/sync/snapshot?stream=${enc(stream)}&cursor=0`)
        .expect(200);
      const ids = rebootstrap.body.entities.map((e: SnapshotEntity) => e.id).sort();
      expect(ids).toEqual(
        [String(keep._id), String((await PhaseCTodoModel.findOne({title: "later"}))?._id)].sort()
      );
      expect(
        rebootstrap.body.entities.some((e: SnapshotEntity) => e.id === String(doomed._id))
      ).toBe(false);
    });

    it("a live never-deleted early doc no longer pins the retention floor", async () => {
      // The OLD computation returned min(retained seq) = 1 here, so every client with a
      // cursor of 0 was told there was a retention gap it could not have missed.
      await PhaseCTodoModel.create({ownerId: notAdminId, title: "early and alive"});
      const res = await agent.get(`/sync/snapshot?stream=${enc(ownerStream())}`).expect(200);
      expect(res.body.oldestRetainedSeq).toBe(0);
    });
  });
});
