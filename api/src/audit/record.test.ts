import {afterEach, beforeEach, describe, it, spyOn} from "bun:test";
import {assert} from "chai";
import type express from "express";
import mongoose from "mongoose";

import type {UserModel as AuthUserModel} from "../auth";
import {logger} from "../logger";
import {ORGANIZATION_ID_HEADER, runWithOrgContext} from "../orgs/orgContext";
import {TerrenoApp} from "../terrenoApp";
import {setupDb, UserModel} from "../tests";
import {AuditApp} from "./auditApp";
import {type AuditEventModel, createAuditEventModel} from "./auditEventModel";
import {
  actorIdForAuditWrite,
  installAuditRecorder,
  isAuditRecorderInstalled,
  maybeRecordAdminAudit,
  maybeRecordModelRouterAudit,
  recordAuditEvent,
  resetAuditRecorderForTests,
  snapshotAuditBefore,
} from "./record";

const typedUserModel = UserModel as unknown as AuthUserModel;

const deleteAuditEventModel = (): void => {
  if (mongoose.connection.models.TerrenoAuditEvent) {
    mongoose.connection.deleteModel("TerrenoAuditEvent");
  }
};

const registerAuditApp = (): void => {
  new TerrenoApp({
    skipListen: true,
    userModel: typedUserModel,
  })
    .register(new AuditApp())
    .build();
};

describe("audit record helpers", () => {
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

  it("reports whether the recorder is installed", () => {
    assert.isFalse(isAuditRecorderInstalled());
    registerAuditApp();
    assert.isTrue(isAuditRecorderInstalled());
  });

  it("records admin created, updated, and deleted verbs", async () => {
    registerAuditApp();
    const actorId = new mongoose.Types.ObjectId().toString();
    const req = {user: {id: actorId}} as express.Request;
    await maybeRecordAdminAudit({
      after: {_id: "food-1", name: "Soup"},
      modelName: "Food",
      recordLabel: "Soup",
      req,
      verb: "created",
    });
    await maybeRecordAdminAudit({
      after: {_id: "food-1", name: "Stew"},
      before: {_id: "food-1", name: "Soup"},
      modelName: "Food",
      req,
      verb: "updated",
    });
    await maybeRecordAdminAudit({
      before: {_id: "food-1", name: "Stew"},
      modelName: "Food",
      req,
      verb: "deleted",
    });
    const events = await mongoose.connection
      .collection("auditevents")
      .find({})
      .sort({created: 1})
      .toArray();
    assert.equal(events.length, 3);
    assert.deepEqual(
      events.map((row) => row.operation),
      ["create", "update", "delete"]
    );
    assert.equal(events[0]?.recordLabel, "Soup");
    assert.equal(String(events[0]?.actorId), actorId);
    assert.equal(events[0]?.source, "admin");
  });

  it("omits hidden fields from admin diffs", async () => {
    registerAuditApp();
    await maybeRecordAdminAudit({
      after: {_id: "food-2", name: "Soup", ssn: "111-11-1111", tokenHash: "abc"},
      extraRedact: ["ssn"],
      modelName: "Food",
      req: {user: {id: new mongoose.Types.ObjectId().toString()}} as express.Request,
      verb: "created",
    });
    const event = await mongoose.connection.collection("auditevents").findOne({});
    const after = event?.after as Record<string, unknown> | undefined;
    assert.equal(after?.name, "Soup");
    assert.isUndefined(after?.ssn);
    assert.isUndefined(after?.tokenHash);
  });

  it("uses user._id when user.id is missing", async () => {
    registerAuditApp();
    const actorId = new mongoose.Types.ObjectId();
    await maybeRecordAdminAudit({
      after: {_id: "2", title: "Note"},
      modelName: "Note",
      req: {user: {_id: actorId}} as express.Request,
      verb: "created",
    });
    const event = await mongoose.connection.collection("auditevents").findOne({});
    assert.equal(String(event?.actorId), actorId.toString());
  });

  it("omits actorId when the request has no user id", async () => {
    registerAuditApp();
    await maybeRecordAdminAudit({
      after: {_id: "3", title: "Anon"},
      modelName: "Note",
      req: {user: {}} as express.Request,
      verb: "created",
    });
    const event = await mongoose.connection.collection("auditevents").findOne({});
    assert.isUndefined(event?.actorId);
  });

  it("keeps the event when the actor id is not an ObjectId", async () => {
    registerAuditApp();
    const errorSpy = spyOn(logger, "error").mockImplementation(() => logger);
    const warnSpy = spyOn(logger, "warn").mockImplementation(() => logger);
    await maybeRecordAdminAudit({
      after: {_id: "4", title: "String actor"},
      modelName: "Note",
      req: {user: {id: "auth-user-abc"}} as express.Request,
      verb: "created",
    });
    const event = await mongoose.connection.collection("auditevents").findOne({});
    assert.equal(event?.modelName, "Note");
    assert.isUndefined(event?.actorId);
    assert.equal(errorSpy.mock.calls.length, 0);
    assert.isTrue(
      warnSpy.mock.calls.some((call) => String(call[0]).includes("recording without an actor"))
    );
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("does not treat a 12-character string as an actor ObjectId", async () => {
    registerAuditApp();
    await maybeRecordAdminAudit({
      after: {_id: "5", title: "Twelve"},
      modelName: "Note",
      req: {user: {id: "microsoft123"}} as express.Request,
      verb: "created",
    });
    const event = await mongoose.connection.collection("auditevents").findOne({});
    assert.equal(event?.modelName, "Note");
    assert.isUndefined(event?.actorId);
  });

  it("skips snapshotting when audit is off", () => {
    const doc = {
      toJSON: (): never => {
        throw new Error("should not run");
      },
    };
    assert.isUndefined(snapshotAuditBefore({doc}));
  });

  it("returns undefined when the audit snapshot toJSON throws", () => {
    const errorSpy = spyOn(logger, "error").mockImplementation(() => logger);
    const previous = snapshotAuditBefore({
      audit: true,
      doc: {
        toJSON: (): never => {
          throw new Error("circular");
        },
      },
    });
    assert.isUndefined(previous);
    assert.isTrue(
      errorSpy.mock.calls.some((call) => String(call[0]).includes("Failed to snapshot"))
    );
    errorSpy.mockRestore();
  });

  it("rejects 12-character actor ids that mongoose.isValidObjectId accepts", () => {
    assert.isUndefined(actorIdForAuditWrite("microsoft123"));
    assert.equal(actorIdForAuditWrite("507f1f77bcf86cd799439011"), "507f1f77bcf86cd799439011");
  });

  it("does not throw when admin audit serialization fails", async () => {
    registerAuditApp();
    const errorSpy = spyOn(logger, "error").mockImplementation(() => logger);
    const after = {
      toJSON: (): never => {
        throw new Error("circular");
      },
    };
    await maybeRecordAdminAudit({
      after,
      modelName: "Note",
      req: {} as express.Request,
      verb: "created",
    });
    assert.equal(await mongoose.connection.collection("auditevents").countDocuments(), 0);
    assert.isTrue(
      errorSpy.mock.calls.some((call) => String(call[0]).includes("Failed to persist"))
    );
    errorSpy.mockRestore();
  });

  it("skips modelRouter writes when audit is unset", async () => {
    registerAuditApp();
    await maybeRecordModelRouterAudit({
      after: {_id: "4", title: "Off"},
      modelName: "Note",
      operation: "create",
      recordId: "4",
      req: {} as express.Request,
      verb: "created",
    });
    assert.equal(await mongoose.connection.collection("auditevents").countDocuments(), 0);
  });

  it("applies extra redact from modelRouter audit options", async () => {
    registerAuditApp();
    await maybeRecordModelRouterAudit({
      after: {_id: "5", secret: "hidden", title: "Safe"},
      audit: {redact: ["secret"]},
      modelName: "Note",
      operation: "create",
      recordId: "5",
      req: {} as express.Request,
      verb: "created",
    });
    const event = await mongoose.connection.collection("auditevents").findOne({});
    assert.notProperty(event?.after as object, "secret");
    assert.equal((event?.after as {title?: string})?.title, "Safe");
  });

  it("treats empty audit options as default redact", async () => {
    registerAuditApp();
    await maybeRecordModelRouterAudit({
      after: {_id: "6", password: "p", title: "Has default"},
      audit: {},
      modelName: "Note",
      operation: "create",
      recordId: "6",
      req: {} as express.Request,
      verb: "created",
    });
    const event = await mongoose.connection.collection("auditevents").findOne({});
    assert.notProperty(event?.after as object, "password");
    assert.equal((event?.after as {title?: string})?.title, "Has default");
  });

  it("reads organization from request context, header, and document fields", async () => {
    registerAuditApp();
    await maybeRecordModelRouterAudit({
      after: {_id: "7", title: "Req org"},
      audit: true,
      modelName: "Note",
      operation: "create",
      recordId: "7",
      req: {organization: "org-string"} as express.Request & {organization: string},
      verb: "created",
    });
    await maybeRecordModelRouterAudit({
      after: {_id: {_id: "8"}, organizationId: {_id: "org-nested"}, title: "Nested"},
      audit: true,
      modelName: "Note",
      operation: "create",
      recordId: "8",
      req: {} as express.Request,
      verb: "created",
    });
    await maybeRecordAdminAudit({
      after: {_id: "8.5", title: "Header org"},
      modelName: "Note",
      req: {
        header: (name: string): string | undefined => {
          return name === ORGANIZATION_ID_HEADER ? "org-from-header" : undefined;
        },
      } as express.Request,
      verb: "created",
    });
    await runWithOrgContext({organization: {_id: "org-from-als"} as never}, async () => {
      await maybeRecordAdminAudit({
        after: {_id: "8.6", title: "Als org"},
        modelName: "Note",
        req: {} as express.Request,
        verb: "created",
      });
    });
    await maybeRecordModelRouterAudit({
      after: {_id: "9", organizationId: "", title: "Empty org"},
      audit: true,
      modelName: "Note",
      operation: "create",
      recordId: "9",
      req: {organization: {_id: "org-from-id", id: null}} as express.Request & {
        organization: {_id: string; id: null};
      },
      verb: "created",
    });
    await maybeRecordModelRouterAudit({
      after: {_id: "10", title: "Org id field"},
      audit: true,
      modelName: "Note",
      operation: "create",
      recordId: "10",
      req: {organization: {id: "org-id-field"}} as express.Request & {
        organization: {id: string};
      },
      verb: "created",
    });
    await maybeRecordModelRouterAudit({
      after: {_id: "11", organizationId: 42, title: "Numeric org"},
      audit: true,
      modelName: "Note",
      operation: "create",
      recordId: "11",
      req: {} as express.Request,
      verb: "created",
    });
    const events = await mongoose.connection
      .collection("auditevents")
      .find({})
      .sort({recordId: 1})
      .toArray();
    assert.equal(events.find((row) => row.recordId === "7")?.organizationId, "org-string");
    assert.equal(events.find((row) => row.recordId === "8")?.organizationId, "org-nested");
    assert.equal(events.find((row) => row.recordId === "8.5")?.organizationId, "org-from-header");
    assert.equal(events.find((row) => row.recordId === "8.6")?.organizationId, "org-from-als");
    assert.equal(events.find((row) => row.recordId === "9")?.organizationId, "org-from-id");
    assert.equal(events.find((row) => row.recordId === "10")?.organizationId, "org-id-field");
    assert.equal(events.find((row) => row.recordId === "11")?.organizationId, "42");
  });

  it("swallows persist failures from recordAuditEvent", async () => {
    const errorSpy = spyOn(logger, "error").mockImplementation(() => logger);
    installAuditRecorder({
      create: async () => {
        throw new Error("write failed");
      },
    } as unknown as AuditEventModel);
    await recordAuditEvent({
      modelName: "Note",
      operation: "create",
      source: "modelRouter",
      verb: "created",
    });
    assert.isTrue(
      errorSpy.mock.calls.some((call) => String(call[0]).includes("Failed to persist"))
    );
    errorSpy.mockRestore();
  });

  it("does not persist when recordAuditEvent targets AuditEvent", async () => {
    registerAuditApp();
    await recordAuditEvent({
      after: {modelName: "Todo"},
      modelName: "AuditEvent",
      operation: "create",
      source: "admin",
      verb: "created",
    });
    assert.equal(await mongoose.connection.collection("auditevents").countDocuments(), 0);
  });

  it("delegates persist to enqueue instead of Mongo", async () => {
    const queued: {modelName: string}[] = [];
    const model = createAuditEventModel(mongoose.connection);
    installAuditRecorder(model, {
      enqueue: async (write): Promise<void> => {
        queued.push({modelName: write.modelName});
      },
    });
    await recordAuditEvent({
      modelName: "Note",
      operation: "create",
      source: "modelRouter",
      verb: "created",
    });
    assert.equal(queued.length, 1);
    assert.equal(await mongoose.connection.collection("auditevents").countDocuments(), 0);
  });
});
