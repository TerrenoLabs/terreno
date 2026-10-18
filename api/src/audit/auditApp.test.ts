import {afterEach, beforeEach, describe, it} from "bun:test";
import {assert} from "chai";
import type express from "express";
import mongoose from "mongoose";
import supertest from "supertest";

import type {UserModel as AuthUserModel} from "../auth";
import {TerrenoApp} from "../terrenoApp";
import {authAsUser, setupDb, UserModel} from "../tests";
import {AuditApp} from "./auditApp";
import {createAuditEventModel} from "./auditEventModel";
import {AUDIT_SECRET_HEADER} from "./cloudTasksEnqueue";
import {resetAuditRecorderForTests} from "./record";

const typedUserModel = UserModel as unknown as AuthUserModel;

const deleteAuditEventModel = (): void => {
  if (mongoose.connection.models.TerrenoAuditEvent) {
    mongoose.connection.deleteModel("TerrenoAuditEvent");
  }
};

const fetchWorker = async (
  app: express.Application,
  {
    body,
    secret,
  }: {
    body: Record<string, unknown>;
    secret: string;
  }
): Promise<supertest.Response> => {
  return supertest(app).post("/internal/audit-events").set(AUDIT_SECRET_HEADER, secret).send(body);
};

describe("AuditApp", () => {
  beforeEach(async () => {
    deleteAuditEventModel();
    resetAuditRecorderForTests();
    await setupDb();
    await mongoose.connection.collection("auditevents").deleteMany({});
  });

  afterEach(() => {
    resetAuditRecorderForTests();
    deleteAuditEventModel();
  });

  it("does not register AuditEvent on the default connection when @terreno/api is imported", async () => {
    deleteAuditEventModel();
    await import("../index");
    assert.isUndefined(mongoose.connection.models.TerrenoAuditEvent);
  });

  it("lets an admin list an empty audit log", async () => {
    const app = new TerrenoApp({
      skipListen: true,
      userModel: typedUserModel,
    })
      .register(new AuditApp())
      .build();
    const agent = await authAsUser(app, "admin");

    const res = await agent.get("/audit-events").expect(200);
    assert.deepEqual(res.body.data, []);
    assert.isUndefined(new AuditApp().getRetentionDays());
  });

  it("rejects a non-admin list", async () => {
    const app = new TerrenoApp({
      skipListen: true,
      userModel: typedUserModel,
    })
      .register(new AuditApp())
      .build();
    const agent = await authAsUser(app, "notAdmin");

    const res = await agent.get("/audit-events");
    // modelRouter permissionMiddleware uses 405 when list permissions fail.
    assert.equal(res.status, 405);
  });

  it("indexes created desc and modelName+recordId+created for per-record history", () => {
    deleteAuditEventModel();
    const model = createAuditEventModel(mongoose.connection);
    const specs = model.schema.indexes().map(([fields]) => fields as Record<string, number>);
    assert.isTrue(
      specs.some((fields) => fields.created === -1 && Object.keys(fields).length === 1)
    );
    assert.isTrue(
      specs.some(
        (fields) => fields.modelName === 1 && fields.recordId === 1 && fields.created === -1
      )
    );
  });

  it("does not expose create, update, or delete", async () => {
    const app = new TerrenoApp({
      skipListen: true,
      userModel: typedUserModel,
    })
      .register(new AuditApp())
      .build();
    const agent = await authAsUser(app, "admin");
    const model = createAuditEventModel(mongoose.connection);
    const row = await model.create({
      modelName: "Todo",
      operation: "create",
      source: "modelRouter",
      verb: "created",
    });

    const post = await agent.post("/audit-events").send({modelName: "Todo", verb: "created"});
    const patch = await agent.patch(`/audit-events/${row._id}`).send({recordLabel: "x"});
    const del = await agent.delete(`/audit-events/${row._id}`);
    const read = await agent.get(`/audit-events/${row._id}`).expect(200);
    assert.equal(read.body.data.modelName, "Todo");
    assert.equal(post.status, 405);
    assert.equal(patch.status, 405);
    assert.equal(del.status, 405);
  });

  it("does not add a TTL index by default", () => {
    deleteAuditEventModel();
    createAuditEventModel(mongoose.connection);
    const indexes = mongoose.connection.models.TerrenoAuditEvent.schema.indexes();
    assert.isFalse(indexes.some(([, options]) => options && "expireAfterSeconds" in options));
  });

  it("adds a TTL index on created when retentionDays is greater than 0", () => {
    deleteAuditEventModel();
    createAuditEventModel(mongoose.connection, {retentionDays: 1});
    const indexes = mongoose.connection.models.TerrenoAuditEvent.schema.indexes();
    const createdAsc = indexes.filter(
      ([fields]) => (fields as {created?: number}).created === 1 && Object.keys(fields).length === 1
    );
    const ttl = createdAsc[0];
    assert.ok(ttl);
    assert.equal((ttl[1] as {expireAfterSeconds?: number}).expireAfterSeconds, 86400);
  });

  it("disables admin create, update, and delete on the contribution", () => {
    const contribution = new AuditApp({retentionDays: 90}).adminContribution();
    assert.equal(new AuditApp({retentionDays: 90}).getRetentionDays(), 90);
    assert.deepEqual(contribution.models?.[0]?.admin.adminPermissions, {
      create: [],
      delete: [],
      update: [],
    });
  });

  it("persists an enqueued write on POST /internal/audit-events", async () => {
    const app = new TerrenoApp({
      skipListen: true,
      userModel: typedUserModel,
    })
      .register(
        new AuditApp({
          enqueue: async (): Promise<void> => {
            throw new Error("must not enqueue from the worker");
          },
          processQueuePath: "/internal/audit-events",
          processQueueSecret: "queue-secret",
        })
      )
      .build();
    const res = await fetchWorker(app, {
      body: {
        modelName: "Note",
        operation: "create",
        source: "modelRouter",
        verb: "created",
      },
      secret: "queue-secret",
    });
    assert.equal(res.status, 204);
    const count = await mongoose.connection.collection("auditevents").countDocuments();
    assert.equal(count, 1);
  });

  it("rejects enqueued writes with a bad secret", async () => {
    const app = new TerrenoApp({
      skipListen: true,
      userModel: typedUserModel,
    })
      .register(
        new AuditApp({
          enqueue: async (): Promise<void> => undefined,
          processQueuePath: "/internal/audit-events",
          processQueueSecret: "queue-secret",
        })
      )
      .build();
    const res = await fetchWorker(app, {
      body: {modelName: "Note", operation: "create", source: "modelRouter", verb: "created"},
      secret: "wrong",
    });
    assert.equal(res.status, 401);
  });

  it("acknowledges malformed enqueued writes without persisting them", async () => {
    const app = new TerrenoApp({
      skipListen: true,
      userModel: typedUserModel,
    })
      .register(
        new AuditApp({
          enqueue: async (): Promise<void> => undefined,
          processQueuePath: "/internal/audit-events",
          processQueueSecret: "queue-secret",
        })
      )
      .build();
    const res = await fetchWorker(app, {
      body: {modelName: "Note", operation: "create", source: "invalid", verb: "created"},
      secret: "queue-secret",
    });
    assert.equal(res.status, 204);
    assert.equal(await mongoose.connection.collection("auditevents").countDocuments(), 0);
  });

  it("rejects enqueued writes with no secret header", async () => {
    const app = new TerrenoApp({
      skipListen: true,
      userModel: typedUserModel,
    })
      .register(
        new AuditApp({
          enqueue: async (): Promise<void> => undefined,
          processQueuePath: "/internal/audit-events",
          processQueueSecret: "queue-secret",
        })
      )
      .build();
    const res = await supertest(app).post("/internal/audit-events").send({
      modelName: "Note",
      operation: "create",
      source: "modelRouter",
      verb: "created",
    });
    assert.equal(res.status, 401);
  });
});
