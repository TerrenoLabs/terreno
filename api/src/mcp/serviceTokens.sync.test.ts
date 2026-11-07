import {afterEach, beforeEach, describe, it} from "bun:test";
import {assert} from "chai";
import type express from "express";
import type mongoose from "mongoose";
import type {Server} from "socket.io";
import type TestAgent from "supertest/lib/agent";

import type {UserModel as AuthUserModel} from "../auth";
import {McpServiceToken} from "../models/mcpServiceToken";
import {emitSyncDeltaForChange} from "../realtime/changeStreamWatcher";
import {
  clearSyncRegistry,
  findSyncEntryByCollectionTag,
  type SyncRegistryEntry,
} from "../sync/registry";
import {syncRoomForStream} from "../sync/socketHandlers";
import {SyncApp} from "../sync/syncApp";
import type {SyncDelta, SyncSnapshotResponse} from "../sync/types";
import {TerrenoApp} from "../terrenoApp";
import {authAsUser, setupDb, UserModel} from "../tests";
import {MCP_SERVICE_TOKENS_SYNC_COLLECTION} from "./serviceTokens";

interface CreatedToken {
  id: string;
  token: string;
}

interface TrackedEmission {
  event: string;
  payload: unknown;
}

const buildApp = (): express.Application => {
  clearSyncRegistry();
  return new TerrenoApp({
    mcpServiceTokens: true,
    skipListen: true,
    userModel: UserModel as unknown as AuthUserModel,
  })
    .register(new SyncApp({}))
    .build();
};

const ownerStream = (userId: string): string =>
  `${MCP_SERVICE_TOKENS_SYNC_COLLECTION}|owner:${userId}`;

/** Socket.io stand-in with one socket for `userId` joined to `room`. */
const makeTrackedIo = (
  room: string,
  userId: string
): {emissions: TrackedEmission[]; io: Server} => {
  const emissions: TrackedEmission[] = [];
  const socket = {
    decodedToken: {admin: false, id: userId},
    emit: (event: string, payload: unknown): void => {
      emissions.push({event, payload});
    },
    id: "socket-owner",
  };
  const io = {
    sockets: {
      adapter: {rooms: new Map([[room, new Set([socket.id])]])},
      sockets: new Map([[socket.id, socket]]),
    },
    to: () => ({emit: (): void => undefined}),
  } as unknown as Server;
  return {emissions, io};
};

const assertNoTokenSecrets = (value: unknown, plaintext: string): void => {
  const serialized = JSON.stringify(value);
  assert.notInclude(serialized, "tokenHash");
  assert.notInclude(serialized, plaintext);
};

describe("MCP service tokens as a synced collection", () => {
  let agent: TestAgent;
  let otherAgent: TestAgent;
  let ownerId: string;
  let created: CreatedToken;

  beforeEach(async () => {
    const [admin, notAdmin] = await setupDb();
    ownerId = String((notAdmin as {_id: mongoose.Types.ObjectId})._id);
    await McpServiceToken.collection.deleteMany({});
    const app = buildApp();
    agent = await authAsUser(app, "notAdmin");
    otherAgent = await authAsUser(app, "admin");
    assert.isDefined(admin);
    const res = await agent.post("/mcp/service-tokens/create").send({name: "Synced"});
    assert.equal(res.status, 200);
    created = res.body.data as CreatedToken;
  });

  afterEach(async () => {
    await McpServiceToken.collection.deleteMany({});
    clearSyncRegistry();
  });

  it("serves the owner's snapshot without tokenHash or the plaintext", async () => {
    const res = await agent.get(
      `/sync/snapshot?stream=${encodeURIComponent(ownerStream(ownerId))}`
    );

    assert.equal(res.status, 200);
    const page = res.body as SyncSnapshotResponse;
    assert.lengthOf(page.entities, 1);
    const [entity] = page.entities;
    assert.equal(entity.id, created.id);
    assert.isAbove(entity.seq, 0);
    const data = entity.data as Record<string, unknown>;
    assert.equal(data.name, "Synced");
    assert.equal(data.id, created.id);
    assert.equal(data.tokenPrefix, created.token.slice(4, 12));
    assert.notProperty(data, "tokenHash");
    assert.notProperty(data, "token");
    assertNoTokenSecrets(res.body, created.token);
  });

  it("strips tokenHash from batched snapshots and entity lookups", async () => {
    const batch = await agent
      .post("/sync/snapshot/batch")
      .send({streams: [{stream: ownerStream(ownerId)}]});
    const entities = await agent.get(
      `/sync/entities?collection=${encodeURIComponent(MCP_SERVICE_TOKENS_SYNC_COLLECTION)}&ids=${created.id}`
    );

    assert.equal(batch.status, 200);
    assert.equal(entities.status, 200);
    assert.lengthOf(batch.body.pages[0].entities, 1);
    assert.lengthOf(entities.body.entities, 1);
    assertNoTokenSecrets(batch.body, created.token);
    assertNoTokenSecrets(entities.body, created.token);
  });

  it("does not serve another user's stream", async () => {
    const res = await otherAgent.get(
      `/sync/snapshot?stream=${encodeURIComponent(ownerStream(ownerId))}`
    );

    assert.equal(res.status, 403);
    assertNoTokenSecrets(res.body, created.token);
  });

  it("emits deltas without tokenHash", async () => {
    const entry = findSyncEntryByCollectionTag(
      MCP_SERVICE_TOKENS_SYNC_COLLECTION
    ) as SyncRegistryEntry;
    // The change stream post-image is the raw stored row, tokenHash included.
    const fullDocument = (await McpServiceToken.collection.findOne({
      _id: created.id as never,
    })) as Record<string, unknown>;
    assert.isString(fullDocument.tokenHash);
    const stream = ownerStream(ownerId);
    const {emissions, io} = makeTrackedIo(syncRoomForStream(stream), ownerId);

    await emitSyncDeltaForChange({
      change: {
        documentKey: {_id: created.id},
        fullDocument,
        ns: {coll: "mcpservicetokens"},
        operationType: "insert",
      } as unknown as Parameters<typeof emitSyncDeltaForChange>[0]["change"],
      docId: created.id,
      entry,
      io,
      logDebug: () => undefined,
    });

    const delta = emissions.find((emission) => emission.event === "sync:delta")
      ?.payload as SyncDelta;
    assert.isDefined(delta);
    assert.equal(delta.stream, stream);
    const data = delta.data as Record<string, unknown>;
    assert.equal(data.name, "Synced");
    assert.notProperty(data, "tokenHash");
    assertNoTokenSecrets(delta, created.token);
  });

  it("rejects client sync create, update, and delete", async () => {
    const stored = await McpServiceToken.collection.findOne({_id: created.id as never});
    const baseVersion = stored?._syncSeq as number;
    const attempts = [
      {
        data: {name: "Forged", tokenHash: "forged", tokenPrefix: "forged", userId: ownerId},
        mutationId: "mcp-token-create",
        operation: "create",
      },
      {
        baseVersion,
        data: {name: "Renamed"},
        id: created.id,
        mutationId: "mcp-token-update",
        operation: "update",
      },
      {id: created.id, mutationId: "mcp-token-delete", operation: "delete"},
    ];

    for (const attempt of attempts) {
      const res = await agent
        .post("/sync/mutate")
        .send({...attempt, collection: MCP_SERVICE_TOKENS_SYNC_COLLECTION});
      assert.equal(res.status, 403, attempt.operation);
      assert.equal(res.body.nack?.code, "unauthorized", attempt.operation);
    }

    const rows = await McpServiceToken.collection.find({}).toArray();
    assert.lengthOf(rows, 1);
    assert.equal(rows[0].name, "Synced");
    assert.notOk(rows[0].revokedAt);
    assert.isFalse(rows[0].deleted);
  });

  it("syncs a revoke as an update that keeps the row", async () => {
    const before = await agent.get(
      `/sync/snapshot?stream=${encodeURIComponent(ownerStream(ownerId))}`
    );
    const revoked = await agent.post(`/mcp/service-tokens/${created.id}/revoke`);
    const after = await agent.get(
      `/sync/snapshot?stream=${encodeURIComponent(ownerStream(ownerId))}&cursor=${before.body.cursor}`
    );

    assert.equal(revoked.status, 200);
    assert.lengthOf(after.body.entities, 1);
    const [entity] = after.body.entities as SyncSnapshotResponse["entities"];
    assert.isFalse(entity.deleted);
    assert.isString((entity.data as {revokedAt?: unknown}).revokedAt);
    assertNoTokenSecrets(after.body, created.token);
  });
});
