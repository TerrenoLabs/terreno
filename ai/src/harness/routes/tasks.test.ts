import {afterEach, beforeAll, beforeEach, describe, expect, it, setDefaultTimeout} from "bun:test";
import {TerrenoApp} from "@terreno/api";
import type express from "express";
import {DateTime} from "luxon";
import supertest from "supertest";
import type TestAgent from "supertest/lib/agent";

import {createLocalObservabilityPlugin} from "../../observability/local/localPlugin";
import {registerObsSpan} from "../../observability/local/models/obsSpan";
import {registerObsTrace} from "../../observability/local/models/obsTrace";
import {ensureTestUsers, UserModel} from "../../tests/helpers";
import type {ObsSpanModel, ObsTraceModel} from "../../types/observability";
import {defineTask, Harness, HarnessApp, InProcessRunner} from "../harness";
import {registerHarnessEvent, registerHarnessEventStream} from "../models/harnessEvent";
import {registerHarnessOwner} from "../models/harnessOwner";
import {registerHarnessTask} from "../models/harnessTask";

setDefaultTimeout(30_000);

const TaskModel = registerHarnessTask();
const OwnerModel = registerHarnessOwner();
const EventModel = registerHarnessEvent();
const EventStreamModel = registerHarnessEventStream();
let SpanModel: ObsSpanModel;
let TraceModel: ObsTraceModel;

const OWNER = {admin: false, email: "owner@example.com", name: "Owner", password: "pw-owner"};
const OTHER = {admin: false, email: "other@example.com", name: "Other", password: "pw-other"};
const ADMIN = {admin: true, email: "admin@example.com", name: "Admin", password: "pw-admin"};

/** Waits for an event that never comes, so the task stays `waiting` until aborted. */
const parked = defineTask<Record<string, never>, unknown, string>({
  initial: () => ({phase: "wait"}),
  name: "test.parked",
  phases: {
    wait: {
      replay: "safe",
      run: async (_task, rt) => {
        await rt.waitFor("never");
        await rt.commit({terminal: {result: "woke", status: "completed"}});
      },
    },
  },
  version: 1,
});

const openHarnesses: Harness[] = [];

const setup = async ({start = false}: {start?: boolean} = {}) => {
  const harness = await Harness.open({
    registry: [parked],
    runner: new InProcessRunner({pollInterval: {milliseconds: 20}}),
  });
  openHarnesses.push(harness);
  if (start) {
    await harness.start();
  }
  const app: express.Application = new TerrenoApp({skipListen: true, userModel: UserModel})
    .register(new HarnessApp({harness}))
    .build();
  const login = async ({email, password}: {email: string; password: string}) => {
    const agent = supertest.agent(app);
    const res = await agent.post("/auth/login").send({email, password}).expect(200);
    agent.set("authorization", `Bearer ${res.body.data.token}`);
    return agent as unknown as TestAgent;
  };
  const ownerId = String((await UserModel.find({email: OWNER.email}).lean())[0]?._id);
  const adminId = String((await UserModel.find({email: ADMIN.email}).lean())[0]?._id);
  return {adminId, app, harness, login, ownerId};
};

describe("Harness task routes", () => {
  beforeAll(async () => {
    createLocalObservabilityPlugin();
    SpanModel = registerObsSpan();
    TraceModel = registerObsTrace();
    await ensureTestUsers([OWNER, OTHER, ADMIN]);
  });

  beforeEach(async () => {
    await Promise.all(
      [TaskModel, OwnerModel, EventModel, EventStreamModel, SpanModel, TraceModel].map((model) =>
        (model as {deleteMany: (filter: object) => Promise<unknown>}).deleteMany({})
      )
    );
  });

  afterEach(async () => {
    await Promise.all(openHarnesses.splice(0).map((harness) => harness.stop()));
  });

  it("reads a task for its owner or an admin only, and never lists or edits", async () => {
    const {app, harness, login, ownerId} = await setup();
    const task = await harness.createTask(parked, {}, {userId: ownerId});
    const owner = await login(OWNER);
    const read = await owner.get(`/harness/tasks/${task._id}`).expect(200);
    expect(read.body.data.name).toBe("test.parked");
    await (await login(ADMIN)).get(`/harness/tasks/${task._id}`).expect(200);
    await (await login(OTHER)).get(`/harness/tasks/${task._id}`).expect(403);
    await supertest(app).get(`/harness/tasks/${task._id}`).expect(401);
    await owner.get("/harness/tasks").expect(405);
    await owner.patch(`/harness/tasks/${task._id}`).send({name: "x"}).expect(405);
  });

  it("abort: the owner or an admin aborts with a reason; others get 403; ended tasks 409", async () => {
    const {harness, login, ownerId} = await setup({start: true});
    const first = await harness.createTask(parked, {}, {userId: ownerId});
    const second = await harness.createTask(parked, {}, {userId: ownerId});
    const owner = await login(OWNER);
    const admin = await login(ADMIN);

    await (await login(OTHER))
      .post(`/harness/tasks/${first._id}/abort`)
      .send({reason: "nope"})
      .expect(403);
    await owner.post(`/harness/tasks/${first._id}/abort`).send({}).expect(400);
    await owner.post(`/harness/tasks/${first._id}/abort`).send({reason: " "}).expect(400);

    const aborted = await owner
      .post(`/harness/tasks/${first._id}/abort`)
      .send({reason: "Patient left"})
      .expect(200);
    expect(aborted.body.data.status).toBe("aborted");
    expect(aborted.body.data.abortRequested.reason).toBe("Patient left");
    expect(aborted.body.data.abortRequested.userId).toBe(ownerId);
    const again = await owner
      .post(`/harness/tasks/${first._id}/abort`)
      .send({reason: "Twice"})
      .expect(409);
    expect(again.body.title).toBe("Task already ended");

    const byAdmin = await admin
      .post(`/harness/tasks/${second._id}/abort`)
      .send({reason: "Ops cleanup"})
      .expect(200);
    expect(byAdmin.body.data.status).toBe("aborted");
    // The abort is on the task's event stream.
    const statuses = await EventModel.find({streamId: second._id, type: "task.status"})
      .sort({seq: 1})
      .lean();
    expect(statuses.map((event) => (event.payload as {status: string}).status).at(-1)).toBe(
      "aborted"
    );
  });

  it("resolveInterrupted: admins only; 409 unless the task is interrupted", async () => {
    const {harness, login, ownerId} = await setup();
    const task = await harness.createTask(parked, {}, {userId: ownerId});
    const owner = await login(OWNER);
    const admin = await login(ADMIN);
    const path = `/harness/tasks/${task._id}/resolveInterrupted`;

    const notInterrupted = await admin
      .post(path)
      .send({action: "complete", reason: "Done by hand"})
      .expect(409);
    expect(notInterrupted.body.title).toBe("Task is not interrupted");

    await TaskModel.updateOne({_id: task._id}, {$set: {status: "interrupted"}});
    await owner.post(path).send({action: "complete", reason: "Mine"}).expect(403);
    await admin.post(path).send({action: "skip", reason: "Bad action"}).expect(400);
    await admin.post(path).send({action: "complete"}).expect(400);

    const resolved = await admin
      .post(path)
      .send({action: "complete", reason: "Filed by hand", result: "woke"})
      .expect(200);
    expect(resolved.body.data.status).toBe("completed");
    expect(resolved.body.data.outcome.result).toBe("woke");
    const span = await SpanModel.find({name: "resolveInterrupted", traceId: task.traceId}).lean();
    expect(span[0]?.output).toMatchObject({action: "complete", reason: "Filed by hand"});
  });

  it("resolveInterrupted refuses retry for a task that is being aborted", async () => {
    const {harness, login, ownerId} = await setup();
    const task = await harness.createTask(parked, {}, {userId: ownerId});
    await TaskModel.updateOne(
      {_id: task._id},
      {
        $set: {
          abortRequested: {at: DateTime.now().toJSDate(), reason: "Stop"},
          status: "interrupted",
        },
      }
    );
    const admin = await login(ADMIN);
    const refused = await admin
      .post(`/harness/tasks/${task._id}/resolveInterrupted`)
      .send({action: "retry", reason: "Try again"})
      .expect(409);
    expect(refused.body.title).toBe("Task is being aborted");
    const aborted = await admin
      .post(`/harness/tasks/${task._id}/resolveInterrupted`)
      .send({action: "abort", reason: "Give up"})
      .expect(200);
    expect(aborted.body.data.status).toBe("aborted");
  });
});
