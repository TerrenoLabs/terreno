import {afterEach, beforeEach, describe, it} from "bun:test";
import {assert} from "chai";
import mongoose from "mongoose";

import type {UserModel as AuthUserModel} from "../auth";
import {TerrenoApp} from "../terrenoApp";
import {setupDb, UserModel} from "../tests";
import {AuditApp} from "./auditApp";
import {persistRbacAuditToAuditEvent} from "./rbacSink";
import {flushAuditRecorderForTests, resetAuditRecorderForTests} from "./record";

const typedUserModel = UserModel as unknown as AuthUserModel;

const deleteAuditEventModel = (): void => {
  if (mongoose.connection.models.TerrenoAuditEvent) {
    mongoose.connection.deleteModel("TerrenoAuditEvent");
  }
};

describe("persistRbacAuditToAuditEvent", () => {
  beforeEach(async () => {
    deleteAuditEventModel();
    resetAuditRecorderForTests();
    await setupDb();
    await mongoose.connection.collection("auditevents").deleteMany({});
    new TerrenoApp({
      skipListen: true,
      userModel: typedUserModel,
    })
      .register(new AuditApp())
      .build();
  });

  afterEach(() => {
    resetAuditRecorderForTests();
    deleteAuditEventModel();
  });

  it("maps role.create to source rbac with created verb and permissionDelta", async () => {
    const actorId = new mongoose.Types.ObjectId().toString();
    await persistRbacAuditToAuditEvent({
      action: "role.create",
      actorId,
      permissionDelta: {gained: {todo: ["read"]}, lost: {}},
      targetRoleName: "manager",
    });
    await flushAuditRecorderForTests();
    const events = await mongoose.connection.collection("auditevents").find({}).toArray();
    assert.equal(events.length, 1);
    assert.equal(events[0]?.source, "rbac");
    assert.equal(events[0]?.verb, "created");
    assert.equal(events[0]?.operation, "create");
    assert.equal(events[0]?.modelName, "RbacRole");
    assert.equal(events[0]?.recordLabel, "manager");
    assert.deepEqual((events[0]?.after as {gained?: unknown})?.gained, {todo: ["read"]});
  });

  it("maps denied actions to updated", async () => {
    const actorId = new mongoose.Types.ObjectId().toString();
    await persistRbacAuditToAuditEvent({
      action: "role.create",
      actorId,
      denied: true,
      permissionDelta: {gained: {todo: ["delete"]}, lost: {}},
      targetUserId: actorId,
    });
    await flushAuditRecorderForTests();
    const events = await mongoose.connection.collection("auditevents").find({}).toArray();
    assert.equal(events[0]?.verb, "updated");
    assert.equal(events[0]?.source, "rbac");
    assert.equal(events[0]?.modelName, "User");
  });

  it("omits a 12-character actorId that mongoose would otherwise coerce", async () => {
    await persistRbacAuditToAuditEvent({
      action: "role.create",
      actorId: "microsoft123",
      permissionDelta: {gained: {todo: ["read"]}, lost: {}},
      targetRoleName: "manager",
    });
    await flushAuditRecorderForTests();
    const event = await mongoose.connection.collection("auditevents").findOne({});
    assert.equal(event?.modelName, "RbacRole");
    assert.isUndefined(event?.actorId);
  });
});
