import {describe, it} from "bun:test";
import {assert} from "chai";

import {APIError} from "../errors";
import {partialEnv} from "../tests/testEnv";
import {auditEnqueueFromEnv, createCloudTasksAuditEnqueue} from "./cloudTasksEnqueue";
import type {AuditEventWrite} from "./record";

const sampleWrite: AuditEventWrite = {
  modelName: "Note",
  operation: "create",
  source: "modelRouter",
  verb: "created",
};

describe("createCloudTasksAuditEnqueue", () => {
  it("POSTs the write to the queue URL with the shared secret", async () => {
    const created: unknown[] = [];
    const enqueue = createCloudTasksAuditEnqueue({
      loadModule: async () => ({
        CloudTasksClient: class {
          createTask = async (request: unknown): Promise<void> => {
            created.push(request);
          };
        },
      }),
      location: "us-central1",
      project: "proj",
      queue: "audit-queue",
      secret: "s3cret",
      url: "https://api.example.com/internal/audit-events",
    });
    await enqueue(sampleWrite);
    await enqueue(sampleWrite);
    assert.equal(created.length, 2);
    const request = created[0] as {
      parent: string;
      task: {httpRequest: {body: string; headers: Record<string, string>; url: string}};
    };
    assert.equal(request.parent, "projects/proj/locations/us-central1/queues/audit-queue");
    assert.equal(request.task.httpRequest.url, "https://api.example.com/internal/audit-events");
    assert.equal(request.task.httpRequest.headers["X-Terreno-Audit-Secret"], "s3cret");
    const payload = JSON.parse(
      Buffer.from(request.task.httpRequest.body, "base64").toString("utf8")
    ) as AuditEventWrite;
    assert.equal(payload.modelName, "Note");
  });

  it("throws when @google-cloud/tasks cannot be loaded", async () => {
    const enqueue = createCloudTasksAuditEnqueue({
      loadModule: async () => {
        throw new Error("not installed");
      },
      location: "us-central1",
      project: "proj",
      queue: "audit-queue",
      secret: "s3cret",
      url: "https://api.example.com/internal/audit-events",
    });
    try {
      await enqueue(sampleWrite);
      assert.fail("expected enqueue to throw");
    } catch (error: unknown) {
      assert.instanceOf(error, APIError);
      assert.include((error as APIError).title, "@google-cloud/tasks");
    }
  });

  it("throws when CloudTasksClient is missing from the module", async () => {
    const enqueue = createCloudTasksAuditEnqueue({
      loadModule: async () => ({}),
      location: "us-central1",
      project: "proj",
      queue: "audit-queue",
      secret: "s3cret",
      url: "https://api.example.com/internal/audit-events",
    });
    try {
      await enqueue(sampleWrite);
      assert.fail("expected enqueue to throw");
    } catch (error: unknown) {
      assert.instanceOf(error, APIError);
      assert.include((error as APIError).title, "CloudTasksClient not found");
    }
  });

  it("wraps a missing default @google-cloud/tasks install", async () => {
    const enqueue = createCloudTasksAuditEnqueue({
      location: "us-central1",
      project: "proj",
      queue: "audit-queue",
      secret: "s3cret",
      url: "https://api.example.com/internal/audit-events",
    });
    try {
      await enqueue(sampleWrite);
      assert.fail("expected enqueue to throw");
    } catch (error: unknown) {
      assert.instanceOf(error, APIError);
    }
  });
});

describe("auditEnqueueFromEnv", () => {
  it("returns undefined until project, location, queue, url, and secret are set", () => {
    assert.isUndefined(auditEnqueueFromEnv(partialEnv({})));
    assert.isUndefined(
      auditEnqueueFromEnv(
        partialEnv({
          AUDIT_TASKS_SECRET: "s",
          AUDIT_TASKS_URL: "https://example.com/internal/audit-events",
          GCP_LOCATION: "us-central1",
          GCP_PROJECT: "proj",
        })
      )
    );
    assert.isDefined(
      auditEnqueueFromEnv(
        partialEnv({
          AUDIT_TASKS_SECRET: "s",
          AUDIT_TASKS_URL: "https://example.com/internal/audit-events",
          GCP_LOCATION: "us-central1",
          GCP_PROJECT: "proj",
          GCP_TASKS_AUDIT_QUEUE: "audit-q",
        })
      )
    );
  });
});
