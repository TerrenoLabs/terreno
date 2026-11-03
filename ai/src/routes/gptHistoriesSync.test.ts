import {afterEach, beforeAll, describe, expect, it} from "bun:test";
import {SyncApp, TerrenoApp} from "@terreno/api";
import type express from "express";
import mongoose from "mongoose";

import {GptHistory} from "../models/gptHistory";
import {
  type AiTestUserDoc,
  authAsUser,
  authAsUserWithCredentials,
  ensureTestUsers,
  historyRouterOptions,
  terrenoUserModel,
} from "../tests/helpers";
import {addGptHistoryRoutes} from "./gptHistories";

const OTHER_USER = {
  admin: false,
  email: "sync-other@example.com",
  name: "Other",
  password: "password",
};

const OBJECT_ID_PATTERN = /^[0-9a-f]{24}$/;

interface SnapshotEntity {
  data: Record<string, unknown>;
  deleted: boolean;
  id: string;
  seq: number;
}

const ownerStream = (userId: string): string => `gpt/histories|owner:${userId}`;

const snapshotPath = (userId: string): string =>
  `/sync/snapshot?stream=${encodeURIComponent(ownerStream(userId))}`;

const idOf = (user: AiTestUserDoc): string =>
  String((user as AiTestUserDoc & {_id: mongoose.Types.ObjectId})._id);

const buildSyncApp = (): express.Application =>
  new TerrenoApp({
    configureApp: (router, options) => {
      addGptHistoryRoutes(router, historyRouterOptions(options));
    },
    skipListen: true,
    userModel: terrenoUserModel,
  })
    .register(new SyncApp())
    .build();

describe("/gpt/histories over sync", () => {
  let notAdminId: string;
  let otherId: string;

  beforeAll(async () => {
    const [, notAdmin] = await ensureTestUsers();
    const [other] = await ensureTestUsers([OTHER_USER]);
    notAdminId = idOf(notAdmin);
    otherId = idOf(other);
    await GptHistory.collection.deleteMany({});
  });

  afterEach(async () => {
    await GptHistory.collection.deleteMany({});
  });

  it("gives new histories a server-made ObjectId", async () => {
    const agent = await authAsUser(buildSyncApp(), "notAdmin");

    const res = await agent.post("/gpt/histories").send({title: "Fresh"}).expect(201);

    expect(res.body.data._id).toMatch(OBJECT_ID_PATTERN);
    const history = await GptHistory.findById(res.body.data._id);
    expect(history?.title).toBe("Fresh");
  });

  it("returns only the owner's histories in the snapshot of their stream", async () => {
    const app = buildSyncApp();
    const agent = await authAsUser(app, "notAdmin");
    const otherAgent = await authAsUserWithCredentials(app, OTHER_USER);
    const mine = await agent.post("/gpt/histories").send({title: "Mine"}).expect(201);
    await otherAgent.post("/gpt/histories").send({title: "Theirs"}).expect(201);
    await GptHistory.create({prompts: [], title: "Also theirs", userId: otherId});

    const streams = await agent.get("/sync/streams").expect(200);
    const res = await agent.get(snapshotPath(notAdminId)).expect(200);

    expect(JSON.stringify(streams.body)).toContain(ownerStream(notAdminId));
    const entities = res.body.entities as SnapshotEntity[];
    expect(entities.map((entity) => entity.id)).toEqual([mine.body.data._id]);
    expect(entities[0].data.title).toBe("Mine");
    expect(entities[0].deleted).toBe(false);
    expect(entities[0].seq).toBeGreaterThan(0);
  });

  it("refuses another user's stream", async () => {
    const agent = await authAsUser(buildSyncApp(), "notAdmin");

    await agent.get(snapshotPath(otherId)).expect(403);
  });

  it("leaves the paused turn's server-only fields out of synced pending asks", async () => {
    const agent = await authAsUser(buildSyncApp(), "notAdmin");
    const history = await GptHistory.create({
      pendingAsk: {
        created: new Date("2026-01-05T09:00:00.000Z"),
        input: {question: "Continue?"},
        kind: "confirm",
        promptIndex: 1,
        responseMessages: [{content: "secret", role: "assistant"}],
        simple: {buttons: [], question: "Continue?"},
        toolCallId: "call_confirm",
      },
      prompts: [{text: "Hello", type: "user"}],
      userId: notAdminId,
    });

    const res = await agent.get(snapshotPath(notAdminId)).expect(200);

    const entity = (res.body.entities as SnapshotEntity[]).find(
      (item) => item.id === String(history._id)
    );
    const pendingAsk = entity?.data.pendingAsk as Record<string, unknown>;
    expect(pendingAsk.toolCallId).toBe("call_confirm");
    expect(pendingAsk).not.toHaveProperty("promptIndex");
    expect(pendingAsk).not.toHaveProperty("responseMessages");
  });

  it("tombstones a deleted history in the owner's snapshot", async () => {
    const agent = await authAsUser(buildSyncApp(), "notAdmin");
    const created = await agent.post("/gpt/histories").send({title: "Gone"}).expect(201);

    await agent.delete(`/gpt/histories/${created.body.data._id}`).expect(204);
    const res = await agent.get(snapshotPath(notAdminId)).expect(200);

    const entity = (res.body.entities as SnapshotEntity[]).find(
      (item) => item.id === created.body.data._id
    );
    expect(entity?.deleted).toBe(true);
  });

  it("creates a history through sync with a client-minted ObjectId and edits it by that id", async () => {
    const agent = await authAsUser(buildSyncApp(), "notAdmin");
    const id = new mongoose.Types.ObjectId().toHexString();

    const created = await agent
      .post("/sync/mutate")
      .send({
        collection: "gpt/histories",
        data: {prompts: [], title: "Offline"},
        id,
        mutationId: `create-${id}`,
        operation: "create",
      })
      .expect(200);
    expect(created.body.ack.id).toBe(id);
    const stored = await GptHistory.findById(id);
    expect(stored?._id).toBeInstanceOf(mongoose.Types.ObjectId);
    expect(String(stored?.userId)).toBe(notAdminId);

    const renamed = await agent
      .post("/sync/mutate")
      .send({
        baseVersion: created.body.ack.seq,
        collection: "gpt/histories",
        data: {title: "Renamed"},
        id,
        mutationId: `rename-${id}`,
        operation: "update",
      })
      .expect(200);
    expect((await GptHistory.findById(id))?.title).toBe("Renamed");

    await agent
      .post("/sync/mutate")
      .send({
        collection: "gpt/histories",
        id,
        mutationId: `delete-${id}`,
        operation: "delete",
      })
      .expect(200);
    const res = await agent.get(snapshotPath(notAdminId)).expect(200);
    const entity = (res.body.entities as SnapshotEntity[]).find((item) => item.id === id);
    expect(entity?.deleted).toBe(true);
    expect(entity?.seq).toBeGreaterThan(renamed.body.ack.seq);
  });

  it("nacks a UUID history id as invalid_id without writing anything", async () => {
    const agent = await authAsUser(buildSyncApp(), "notAdmin");

    const res = await agent
      .post("/sync/mutate")
      .send({
        collection: "gpt/histories",
        data: {prompts: [], title: "UUID"},
        id: crypto.randomUUID(),
        mutationId: "create-uuid-history",
        operation: "create",
      })
      .expect(422);

    expect(res.body.nack.code).toBe("validation");
    expect(res.body.nack.reason).toBe("invalid_id");
    expect(await GptHistory.collection.countDocuments({})).toBe(0);
  });

  it("nacks id_collision when a client-minted id is another user's history", async () => {
    const agent = await authAsUser(buildSyncApp(), "notAdmin");
    const theirs = await GptHistory.create({prompts: [], title: "Theirs", userId: otherId});

    const res = await agent
      .post("/sync/mutate")
      .send({
        collection: "gpt/histories",
        data: {prompts: [], title: "Mine"},
        id: String(theirs._id),
        mutationId: "create-colliding-history",
        operation: "create",
      })
      .expect(422);

    expect(res.body.nack.reason).toBe("id_collision");
    expect(res.body.nack.message).toBe("Entity id already exists");
    const stored = await GptHistory.findById(theirs._id);
    expect(stored?.title).toBe("Theirs");
    expect(String(stored?.userId)).toBe(otherId);
  });
});
