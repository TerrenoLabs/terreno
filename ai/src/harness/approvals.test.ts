import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  setDefaultTimeout,
} from "bun:test";
import {Permissions, type RESTMethod, TerrenoApp, type User, z} from "@terreno/api";
import type {LanguageModel} from "ai";
import type express from "express";
import {DateTime, Settings} from "luxon";
import mongoose from "mongoose";
import supertest from "supertest";
import type TestAgent from "supertest/lib/agent";

import {createLocalObservabilityPlugin} from "../observability/local/localPlugin";
import {registerObsSpan} from "../observability/local/models/obsSpan";
import {registerObsTrace} from "../observability/local/models/obsTrace";
import {withGenerateStreaming} from "../tests/generateStream";
import {authAsUser, ensureTestUsers, UserModel} from "../tests/helpers";
import type {
  HarnessApprovalDocument,
  HarnessApprovalResult,
  HarnessTaskDocument,
  HarnessTestHooks,
} from "../types/harness";
import type {ObsSpanModel, ObsTraceModel} from "../types/observability";
import type {HarnessModels} from "./commit";
import {
  AGENT_TOOL_TASK_NAME,
  type AnyHarnessTaskDefinition,
  approvalGate,
  approvalTaskInput,
  defineAgent,
  defineExtension,
  defineTask,
  defineTool,
  Harness,
  HarnessApp,
  HarnessApprovalConflictError,
  type HarnessModelRef,
  type HarnessRegistryEntry,
  InProcessRunner,
} from "./harness";
import {registerHarnessApproval} from "./models/harnessApproval";
import {registerHarnessConversation} from "./models/harnessConversation";
import {registerHarnessInboxEvent} from "./models/harnessInboxEvent";
import {registerHarnessMemo} from "./models/harnessMemo";
import {registerHarnessMessage} from "./models/harnessMessage";
import {registerHarnessOwner} from "./models/harnessOwner";
import {registerHarnessTask} from "./models/harnessTask";
import {HarnessWaitRaceError, sendEventRecords} from "./waits";

// Whole tasks and turns on a real replica set; the first test also pays for index creation.
setDefaultTimeout(30_000);

const TaskModel = registerHarnessTask();
const OwnerModel = registerHarnessOwner();
const InboxModel = registerHarnessInboxEvent();
const ApprovalModel = registerHarnessApproval();
const ConversationModel = registerHarnessConversation();
const MessageModel = registerHarnessMessage();
const MemoModel = registerHarnessMemo();
let SpanModel: ObsSpanModel;
let TraceModel: ObsTraceModel;
const openHarnesses: Harness[] = [];

const CLINICIAN = {admin: false, email: "clinician@example.com", name: "Clin", password: "pw-clin"};

/** Plain JSON copy; matchers must never walk mongoose documents (they recurse forever). */
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const waitUntil = async (predicate: () => Promise<boolean>, label: string): Promise<void> => {
  for (let i = 0; i < 500; i++) {
    if (await predicate()) {
      return;
    }
    await pause(10);
  }
  throw new Error(`waitUntil timed out: ${label}`);
};

/** Luxon time that runs on from `at` (a frozen clock would stop `waitForTask` timing out). */
const tickFrom = (at: DateTime): void => {
  const offset = at.toMillis() - Date.now();
  Settings.now = () => Date.now() + offset;
};

/** The one span named `name` in `traceId`'s trace (fails on zero or duplicates). */
const onlySpan = async (filter: Record<string, unknown>) => {
  const spans = await SpanModel.find(filter).lean();
  expect(spans).toHaveLength(1);
  return spans[0];
};

const findTask = (id: unknown): Promise<HarnessTaskDocument> => TaskModel.findExactlyOne({_id: id});

const statusIs = (id: unknown, status: string) => async (): Promise<boolean> =>
  (await findTask(id)).status === status;

const approvalOf = (taskId: unknown): Promise<HarnessApprovalDocument> =>
  ApprovalModel.findExactlyOne({taskId});

const asAny = (definition: unknown): AnyHarnessTaskDefinition =>
  definition as AnyHarnessTaskDefinition;

const openHarness = async (
  registry: ReadonlyArray<HarnessRegistryEntry>,
  {
    model,
    runner,
    start = true,
    testHooks,
  }: {
    model?: unknown;
    runner?: InProcessRunner;
    start?: boolean;
    testHooks?: HarnessTestHooks;
  } = {}
): Promise<Harness> => {
  const harness = await Harness.open({
    models: () => model as LanguageModel,
    registry,
    runner: runner ?? new InProcessRunner({pollInterval: {milliseconds: 20}}),
    testHooks: {random: () => 0, ...testHooks},
  });
  openHarnesses.push(harness);
  if (start) {
    await harness.start();
  }
  return harness;
};

const buildApp = (harness: Harness): express.Application =>
  new TerrenoApp({skipListen: true, userModel: UserModel})
    .register(new HarnessApp({harness}))
    .build();

const loginAs = async (app: express.Application, email: string, password: string) => {
  const agent = supertest.agent(app);
  const res = await agent.post("/auth/login").send({email, password}).expect(200);
  agent.set("authorization", `Bearer ${res.body.data.token}`);
  return agent as unknown as TestAgent;
};

const userIdOf = async (email: string): Promise<string> =>
  String((await UserModel.find({email}).lean())[0]?._id);

/** Approver that only lets the clinician through, recording what it was called with. */
const approverCalls: Array<{method: RESTMethod; title?: string}> = [];
const isClinician = (method: RESTMethod, user?: User, approval?: unknown): boolean => {
  approverCalls.push({method, title: (approval as HarnessApprovalDocument | undefined)?.title});
  return (user as {email?: string} | undefined)?.email === CLINICIAN.email;
};

/** One phase that asks for approval `key` and completes with the decision. */
const asksApproval = ({
  approvals,
  key = "signoff",
  name,
  notify,
  retry,
  runs,
  timeout,
}: {
  approvals?: Parameters<typeof defineTask>[0]["approvals"];
  key?: string;
  name: string;
  notify?: (approval: HarnessApprovalDocument) => void;
  retry?: {maxAttempts: number};
  runs?: {count: number};
  timeout?: {hours: number};
}): AnyHarnessTaskDefinition =>
  asAny(
    defineTask<{patientId: string}, unknown, HarnessApprovalResult>({
      approvals,
      initial: () => ({phase: "review"}),
      name,
      phases: {
        review: {
          replay: "safe",
          run: async (task, rt) => {
            if (runs) {
              runs.count += 1;
            }
            const decision = await rt.approval(key, {
              notify,
              payload: {patientId: task.input.patientId, summary: "Stable"},
              summary: "Intake summary for sign-off",
              timeout,
              title: "Sign off intake summary",
            });
            await rt.commit({terminal: {result: decision, status: "completed"}});
          },
        },
      },
      retry,
      version: 1,
    })
  );

describe("Harness approvals", () => {
  let adminId: string;
  let clinicianId: string;
  let notAdminId: string;

  beforeAll(async () => {
    createLocalObservabilityPlugin();
    SpanModel = registerObsSpan();
    TraceModel = registerObsTrace();
    await ensureTestUsers([
      {admin: true, email: "admin@example.com", name: "Admin", password: "securePassword"},
      {admin: false, email: "notAdmin@example.com", name: "User", password: "password"},
      CLINICIAN,
    ]);
    adminId = await userIdOf("admin@example.com");
    clinicianId = await userIdOf(CLINICIAN.email);
    notAdminId = await userIdOf("notAdmin@example.com");
  });

  beforeEach(async () => {
    approverCalls.length = 0;
    await Promise.all([
      TaskModel.deleteMany({}),
      OwnerModel.deleteMany({}),
      InboxModel.deleteMany({}),
      ApprovalModel.deleteMany({}),
      ConversationModel.deleteMany({}),
      MessageModel.deleteMany({}),
      MemoModel.deleteMany({}),
      SpanModel.deleteMany({}),
      TraceModel.deleteMany({}),
    ]);
  });

  afterEach(async () => {
    await Promise.all(openHarnesses.splice(0).map((harness) => harness.stop()));
    Settings.now = () => Date.now();
  });

  describe("rt.approval over HTTP (AC7)", () => {
    it("hides the approval from unpermitted users and lets a permitted non-admin approve", async () => {
      const notify = mock((_approval: HarnessApprovalDocument) => undefined);
      const runs = {count: 0};
      const definition = asksApproval({
        approvals: {signoff: {approvers: [Permissions.IsAuthenticated, isClinician]}},
        name: "test.signoff",
        notify,
        runs,
      });
      const harness = await openHarness([definition]);
      const app = buildApp(harness);
      const created = await harness.createTask(definition, {patientId: "p1"});
      await waitUntil(statusIs(created._id, "waiting"), "waiting on approval");

      const approval = await approvalOf(created._id);
      expect(
        plain({
          definitionKey: approval.definitionKey,
          expiresAt: approval.expiresAt,
          key: approval.key,
          payload: approval.payload,
          rootTaskId: approval.rootTaskId,
          status: approval.status,
          summary: approval.summary,
          title: approval.title,
          traceId: approval.traceId,
        })
      ).toEqual({
        definitionKey: "test.signoff@1:signoff",
        key: "signoff",
        payload: {patientId: "p1", summary: "Stable"},
        rootTaskId: String(created._id),
        status: "pending",
        summary: "Intake summary for sign-off",
        title: "Sign off intake summary",
        traceId: String(created.traceId),
      });
      expect(notify).toHaveBeenCalledTimes(1);
      expect(String(notify.mock.calls[0]?.[0]._id)).toBe(String(approval._id));

      // Unpermitted users: an empty inbox, and 403 on read and decide.
      for (const agent of [await authAsUser(app, "notAdmin"), await authAsUser(app, "admin")]) {
        const list = await agent.get("/harness/approvals").expect(200);
        expect(list.body.data).toEqual([]);
        await agent.get(`/harness/approvals/${approval._id}`).expect(403);
        await agent
          .post(`/harness/approvals/${approval._id}/approve`)
          .send({reason: "sure"})
          .expect(403);
      }
      expect((await findTask(created._id)).status).toBe("waiting");

      const clinician = await loginAs(app, CLINICIAN.email, CLINICIAN.password);
      const list = await clinician.get("/harness/approvals").expect(200);
      expect(list.body.data.map((row: {_id: string}) => row._id)).toEqual([String(approval._id)]);
      expect(list.body.total).toBe(1);
      // The inbox asks with the same method approve / reject use.
      expect(approverCalls.map(({method}) => method)).not.toContain("list");
      expect(approverCalls).toContainEqual({method: "update", title: "Sign off intake summary"});
      const read = await clinician.get(`/harness/approvals/${approval._id}`).expect(200);
      expect(read.body.data.title).toBe("Sign off intake summary");

      const approved = await clinician
        .post(`/harness/approvals/${approval._id}/approve`)
        .send({reason: "Looks right"})
        .expect(200);
      expect(approved.body.data.status).toBe("approved");
      expect(approved.body.data.decidedBy).toBe(clinicianId);
      expect(approved.body.data.updated).toBe(approved.body.data.decidedAt);
      expect(typeof read.body.data.updated).toBe("string");
      expect(approverCalls).toContainEqual({method: "update", title: "Sign off intake summary"});

      const done = await harness.waitForTask(created._id, {timeout: {seconds: 10}});
      expect(done.status).toBe("completed");
      const result = plain(done.outcome?.result) as HarnessApprovalResult;
      expect(result).toEqual({
        approvalId: String(approval._id),
        approved: true,
        decidedAt: result.decidedAt,
        decidedBy: clinicianId,
        reason: "Looks right",
      });
      expect(DateTime.fromISO(result.decidedAt ?? "").isValid).toBe(true);
      // The phase re-ran after the decision; notify still ran once.
      expect(runs.count).toBe(2);
      expect(notify).toHaveBeenCalledTimes(1);

      const span = await onlySpan({name: "approval:signoff", traceId: done.traceId});
      expect(plain(span?.output)).toEqual({
        decidedBy: clinicianId,
        decision: "approved",
        reason: "Looks right",
      });
      expect(plain(span?.input)).toEqual({
        approvalId: String(approval._id),
        definitionKey: "test.signoff@1:signoff",
        title: "Sign off intake summary",
      });
      expect(String(span?.parentSpanId)).toBe(String(done.rootSpanId));

      // Decided: still readable by its approver, gone from the inbox, and final.
      const decidedRead = await clinician.get(`/harness/approvals/${approval._id}`).expect(200);
      expect(decidedRead.body.data.status).toBe("approved");
      expect((await clinician.get("/harness/approvals").expect(200)).body.data).toEqual([]);
      const again = await clinician
        .post(`/harness/approvals/${approval._id}/approve`)
        .send({})
        .expect(409);
      expect(again.body.detail).toBe(`Approval ${approval._id} is already approved`);
      await clinician
        .post(`/harness/approvals/${approval._id}/reject`)
        .send({reason: "changed my mind"})
        .expect(409);
      expect(await SpanModel.countDocuments({name: "approval:signoff"})).toBe(1);
    });

    it("defaults approvers to IsAdmin and requires a reason to reject", async () => {
      const definition = asksApproval({name: "test.defaultApprovers"});
      const harness = await openHarness([definition]);
      const app = buildApp(harness);
      const created = await harness.createTask(definition, {patientId: "p2"});
      await waitUntil(statusIs(created._id, "waiting"), "waiting on approval");
      const approval = await approvalOf(created._id);

      const notAdmin = await authAsUser(app, "notAdmin");
      expect((await notAdmin.get("/harness/approvals").expect(200)).body.data).toEqual([]);
      await notAdmin
        .post(`/harness/approvals/${approval._id}/reject`)
        .send({reason: "no"})
        .expect(403);

      const admin = await authAsUser(app, "admin");
      const listed = await admin.get("/harness/approvals").expect(200);
      expect(listed.body.data).toHaveLength(1);
      await admin.post(`/harness/approvals/${approval._id}/reject`).send({}).expect(400);
      await admin.post(`/harness/approvals/${approval._id}/reject`).send({reason: " "}).expect(400);
      await admin
        .post(`/harness/approvals/${approval._id}/approve`)
        .send({extra: 1, reason: "ok"})
        .expect(400);
      expect((await approvalOf(created._id)).status).toBe("pending");

      await admin
        .post(`/harness/approvals/${approval._id}/reject`)
        .send({reason: "Wrong patient"})
        .expect(200);
      const done = await harness.waitForTask(created._id, {timeout: {seconds: 10}});
      expect(plain(done.outcome?.result)).toMatchObject({
        approved: false,
        decidedBy: adminId,
        reason: "Wrong patient",
      });
      const span = await onlySpan({name: "approval:signoff", traceId: done.traceId});
      expect(plain(span?.output)).toEqual({
        decidedBy: adminId,
        decision: "rejected",
        reason: "Wrong patient",
      });
    });

    it("refuses create, update, and delete, and 404s an unknown approval", async () => {
      const definition = asksApproval({name: "test.crudOff"});
      const harness = await openHarness([definition]);
      const app = buildApp(harness);
      const created = await harness.createTask(definition, {patientId: "p3"});
      await waitUntil(statusIs(created._id, "waiting"), "waiting on approval");
      const approval = await approvalOf(created._id);
      const admin = await authAsUser(app, "admin");
      await admin.post("/harness/approvals").send({title: "forged"}).expect(405);
      await admin
        .patch(`/harness/approvals/${approval._id}`)
        .send({status: "approved"})
        .expect(405);
      await admin.delete(`/harness/approvals/${approval._id}`).expect(405);
      await admin
        .post(`/harness/approvals/${new mongoose.Types.ObjectId()}/approve`)
        .send({})
        .expect(404);
      expect((await approvalOf(created._id)).status).toBe("pending");
    });

    it("pages the inbox after filtering by approvers", async () => {
      const mine = asksApproval({
        approvals: {signoff: {approvers: [isClinician]}},
        name: "test.mine",
      });
      const others = asksApproval({name: "test.others"});
      const harness = await openHarness([mine, others]);
      const app = buildApp(harness);
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        // Interleave approvals the clinician may not see with ones they may.
        const hidden = await harness.createTask(others, {patientId: `h${i}`});
        const shown = await harness.createTask(mine, {patientId: `s${i}`});
        await waitUntil(statusIs(hidden._id, "waiting"), "hidden waiting");
        await waitUntil(statusIs(shown._id, "waiting"), "shown waiting");
        ids.push(String((await approvalOf(shown._id))._id));
      }
      const clinician = await loginAs(app, CLINICIAN.email, CLINICIAN.password);
      const page1 = await clinician.get("/harness/approvals?limit=2&page=1").expect(200);
      expect(page1.body.data.map((row: {_id: string}) => row._id)).toEqual(ids.slice(0, 2));
      expect(page1.body.total).toBe(3);
      expect(page1.body.more).toBe(true);
      const page2 = await clinician.get("/harness/approvals?limit=2&page=2").expect(200);
      expect(page2.body.data.map((row: {_id: string}) => row._id)).toEqual(ids.slice(2));
      expect(page2.body.more).toBe(false);
    });

    it("lets nobody decide an approval whose definition this process does not register", async () => {
      const definition = asksApproval({name: "test.unregistered"});
      const runner = await openHarness([definition]);
      const created = await runner.createTask(definition, {patientId: "p4"});
      await waitUntil(statusIs(created._id, "waiting"), "waiting on approval");
      const approval = await approvalOf(created._id);

      const app = buildApp(await openHarness([], {start: false}));
      const admin = await authAsUser(app, "admin");
      expect((await admin.get("/harness/approvals").expect(200)).body.data).toEqual([]);
      await admin.post(`/harness/approvals/${approval._id}/approve`).send({}).expect(403);
    });
  });

  describe("expiry, abort, and restart", () => {
    it("expires an undecided approval at its timeout and refuses later decisions", async () => {
      const start = DateTime.fromISO("2026-10-03T12:00:00.000Z");
      let clock = start;
      Settings.now = () => clock.toMillis();
      const definition = asksApproval({name: "test.expires", timeout: {hours: 1}});
      const first = await openHarness([definition]);
      const app = buildApp(first);
      const created = await first.createTask(definition, {patientId: "p5"});
      await waitUntil(statusIs(created._id, "waiting"), "waiting on approval");
      const approval = await approvalOf(created._id);
      expect(approval.expiresAt?.getTime()).toBe(start.plus({hours: 1}).toMillis());
      // Stop the runner so the expiry is observed over HTTP before the task resumes.
      await first.stop();

      clock = start.plus({hours: 1});
      const admin = await authAsUser(app, "admin");
      expect((await admin.get("/harness/approvals").expect(200)).body.data).toEqual([]);
      const late = await admin
        .post(`/harness/approvals/${approval._id}/approve`)
        .send({})
        .expect(409);
      expect(late.body.detail).toBe(`Approval ${approval._id} has expired`);

      tickFrom(start.plus({hours: 1}));
      await openHarness([definition]);
      const done = await first.waitForTask(created._id, {timeout: {seconds: 10}});
      expect(plain(done.outcome?.result)).toEqual({
        approvalId: String(approval._id),
        approved: false,
        expired: true,
      });
      expect((await approvalOf(created._id)).status).toBe("expired");
      const span = await onlySpan({name: "approval:signoff", traceId: done.traceId});
      expect(plain(span?.output)).toEqual({decision: "expired"});
    });

    it("refuses to decide an approval whose task was aborted, and drops it from the inbox", async () => {
      const definition = asksApproval({name: "test.aborted"});
      const harness = await openHarness([definition]);
      const app = buildApp(harness);
      const created = await harness.createTask(definition, {patientId: "p6"});
      await waitUntil(statusIs(created._id, "waiting"), "waiting on approval");
      const approval = await approvalOf(created._id);
      await harness.abort(created._id, {reason: "patient left"});

      const admin = await authAsUser(app, "admin");
      expect((await admin.get("/harness/approvals").expect(200)).body.data).toEqual([]);
      const res = await admin
        .post(`/harness/approvals/${approval._id}/approve`)
        .send({})
        .expect(409);
      expect(res.body.detail).toBe(
        `Approval ${approval._id} belongs to a task that is already aborted`
      );
    });

    it("delivers a decision made while the owner is down once a new owner starts", async () => {
      const runs = {count: 0};
      const definition = asksApproval({
        approvals: {signoff: {approvers: [isClinician]}},
        name: "test.restart",
        runs,
      });
      const owner = await openHarness([definition]);
      const created = await owner.createTask(definition, {patientId: "p7"});
      await waitUntil(statusIs(created._id, "waiting"), "waiting on approval");
      await owner.stop();

      // The API process opens its own harness and never runs tasks.
      const app = buildApp(await openHarness([definition], {start: false}));
      const clinician = await loginAs(app, CLINICIAN.email, CLINICIAN.password);
      const approval = await approvalOf(created._id);
      await clinician
        .post(`/harness/approvals/${approval._id}/approve`)
        .send({reason: "fine"})
        .expect(200);
      await pause(100);
      expect((await findTask(created._id)).status).toBe("pending");
      expect(runs.count).toBe(1);

      const restarted = await openHarness([definition]);
      const done = await restarted.waitForTask(created._id, {timeout: {seconds: 10}});
      expect(plain(done.outcome?.result)).toMatchObject({
        approved: true,
        decidedBy: clinicianId,
        reason: "fine",
      });
      expect(await ApprovalModel.countDocuments({taskId: created._id})).toBe(1);
    });
  });

  describe("races and forged events", () => {
    /** Past the approval's timeout with the runner stopped, so the next owner resolves it. */
    const parkThenPassTimeout = async (definition: AnyHarnessTaskDefinition) => {
      const start = DateTime.fromISO("2026-10-03T12:00:00.000Z");
      Settings.now = () => start.toMillis();
      const first = await openHarness([definition]);
      const created = await first.createTask(definition, {patientId: "r1"});
      await waitUntil(statusIs(created._id, "waiting"), "waiting on approval");
      await first.stop();
      tickFrom(start.plus({hours: 2}));
      return created;
    };

    /** Throws a timeout race inside the expiry transaction, after the approval was expired. */
    const raceTimeouts = (times: number): HarnessTestHooks => {
      let raced = 0;
      return {
        beforeCommitEnd: async ({session, taskId}) => {
          const [row] = await ApprovalModel.find({taskId}).session(session);
          if (row?.status === "expired" && raced < times) {
            raced += 1;
            throw new HarnessWaitRaceError();
          }
        },
      };
    };

    it("resolves a wait again when its timeout loses a race, then expires it", async () => {
      const definition = asksApproval({name: "test.raceOnce", timeout: {hours: 1}});
      const created = await parkThenPassTimeout(definition);
      const harness = await openHarness([definition], {testHooks: raceTimeouts(1)});
      const done = await harness.waitForTask(created._id, {timeout: {seconds: 10}});
      expect(plain(done.outcome?.result)).toMatchObject({approved: false, expired: true});
      expect(await SpanModel.countDocuments({name: "approval:signoff"})).toBe(1);
    });

    it("fails the phase when the timeout keeps losing races", async () => {
      const definition = asksApproval({
        name: "test.raceForever",
        retry: {maxAttempts: 1},
        timeout: {hours: 1},
      });
      const created = await parkThenPassTimeout(definition);
      const harness = await openHarness([definition], {testHooks: raceTimeouts(100)});
      const done = await harness.waitForTask(created._id, {timeout: {seconds: 10}});
      expect(done.status).toBe("failed");
      expect(done.outcome?.error).toBe("A matching event raced the wait's timeout");
      expect((await approvalOf(created._id)).status).toBe("pending");
    });

    it("treats a decision that beat the timeout as the answer", async () => {
      const start = DateTime.fromISO("2026-10-03T12:00:00.000Z");
      Settings.now = () => start.toMillis();
      const definition = asksApproval({name: "test.decisionWins", timeout: {hours: 1}});
      const first = await openHarness([definition]);
      const created = await first.createTask(definition, {patientId: "r2"});
      await waitUntil(statusIs(created._id, "waiting"), "waiting on approval");
      await first.stop();
      const approval = await approvalOf(created._id);
      await first.decideApproval(approval._id, {approved: true, userId: adminId});

      // The owner returns after the timeout passed; the stored decision still wins.
      tickFrom(start.plus({hours: 2}));
      const harness = await openHarness([definition]);
      const done = await harness.waitForTask(created._id, {timeout: {seconds: 10}});
      const result = plain(done.outcome?.result) as HarnessApprovalResult;
      expect(result.approved).toBe(true);
      expect(result.expired).toBeUndefined();
      expect((await approvalOf(created._id)).status).toBe("approved");
      const span = await onlySpan({name: "approval:signoff"});
      expect(plain(span?.output)).toEqual({decidedBy: adminId, decision: "approved"});
    });

    it("lets exactly one of two concurrent decisions win", async () => {
      const definition = asksApproval({name: "test.concurrent"});
      const harness = await openHarness([definition]);
      const created = await harness.createTask(definition, {patientId: "r3"});
      await waitUntil(statusIs(created._id, "waiting"), "waiting on approval");
      const approval = await approvalOf(created._id);
      const results = await Promise.allSettled([
        harness.decideApproval(approval._id, {approved: true, userId: adminId}),
        harness.decideApproval(approval._id, {approved: false, reason: "no", userId: adminId}),
      ]);
      expect(results.filter(({status}) => status === "fulfilled")).toHaveLength(1);
      const [rejected] = results.filter(
        (result): result is PromiseRejectedResult => result.status === "rejected"
      );
      expect(rejected?.reason).toBeInstanceOf(HarnessApprovalConflictError);
      const done = await harness.waitForTask(created._id, {timeout: {seconds: 10}});
      expect((plain(done.outcome?.result) as HarnessApprovalResult).approved).toBe(
        results[0]?.status === "fulfilled"
      );
      expect(await InboxModel.countDocuments({taskId: created._id})).toBe(1);
      expect(await SpanModel.countDocuments({name: "approval:signoff"})).toBe(1);
    });

    it("fails the task when its approval event arrives without a decision", async () => {
      const definition = asksApproval({name: "test.forged", retry: {maxAttempts: 1}});
      const harness = await openHarness([definition]);
      const created = await harness.createTask(definition, {patientId: "r4"});
      await waitUntil(statusIs(created._id, "waiting"), "waiting on approval");
      const approval = await approvalOf(created._id);
      await expect(
        harness.sendEvent(created._id, approval.event, {approved: true})
      ).rejects.toThrow(
        'sendEvent: event names starting with "terreno." are reserved for the harness'
      );
      // Below the public API (a raw inbox write), the decision row still decides.
      await sendEventRecords({
        event: approval.event,
        models: {inbox: InboxModel, task: TaskModel} as unknown as HarnessModels,
        payload: {approved: true},
        taskId: created._id,
      });
      const done = await harness.waitForTask(created._id, {timeout: {seconds: 10}});
      expect(done.status).toBe("failed");
      expect(done.outcome?.error).toBe(
        `Approval ${approval._id} received its event without a recorded decision`
      );
    });
  });

  describe("harness API", () => {
    it("validates decideApproval and exposes the task input to approvers", async () => {
      const seenInputs: unknown[] = [];
      const definition = asksApproval({
        approvals: {
          signoff: {
            approvers: [
              async (_method, _user, approval) => {
                seenInputs.push(await approvalTaskInput(approval as HarnessApprovalDocument));
                return true;
              },
            ],
          },
        },
        name: "test.api",
      });
      const harness = await openHarness([definition]);
      const created = await harness.createTask(definition, {patientId: "p8"});
      await waitUntil(statusIs(created._id, "waiting"), "waiting on approval");
      const approval = await approvalOf(created._id);

      expect(await harness.mayApprove({approval, user: {id: notAdminId} as User})).toBe(true);
      expect(seenInputs).toEqual([{patientId: "p8"}]);
      await expect(harness.decideApproval(approval._id, {approved: false})).rejects.toThrow(
        "decideApproval: a rejection requires a reason"
      );
      await expect(
        harness.decideApproval(approval._id, {approved: "yes" as unknown as boolean})
      ).rejects.toThrow("decideApproval requires approved: true or false");

      const decided = await harness.decideApproval(approval._id, {approved: true});
      expect(decided.decidedBy).toBeUndefined();
      await expect(harness.decideApproval(approval._id, {approved: true})).rejects.toBeInstanceOf(
        HarnessApprovalConflictError
      );
      const done = await harness.waitForTask(created._id, {timeout: {seconds: 10}});
      const result = plain(done.outcome?.result) as HarnessApprovalResult;
      expect(result).toEqual({
        approvalId: String(approval._id),
        approved: true,
        decidedAt: result.decidedAt,
      });
    });

    it("denies when an approver throws or the policy is empty", async () => {
      const definition = asksApproval({
        approvals: {
          nobody: {approvers: []},
          signoff: {
            approvers: [
              () => {
                throw new Error("directory down");
              },
            ],
          },
        },
        name: "test.failClosed",
      });
      const harness = await openHarness([definition]);
      const created = await harness.createTask(definition, {patientId: "p9"});
      await waitUntil(statusIs(created._id, "waiting"), "waiting on approval");
      const approval = await approvalOf(created._id);
      const admin = {admin: true, id: adminId} as User;
      expect(await harness.mayApprove({approval, user: admin})).toBe(false);
      approval.key = "nobody";
      approval.definitionKey = "test.failClosed@1:nobody";
      expect(await harness.mayApprove({approval, user: admin})).toBe(false);
      approval.definitionKey = "mismatched";
      expect(await harness.mayApprove({approval, user: admin})).toBe(false);
    });

    it("fails the task on rt.approval misuse and rejects invalid approval policies", async () => {
      const misuse = (options: unknown, key = "k"): AnyHarnessTaskDefinition =>
        asAny(
          defineTask<unknown, unknown, unknown>({
            initial: () => ({phase: "ask"}),
            name: `test.misuse.${key}.${Object.keys(options as object).join("-") || "none"}`,
            phases: {
              ask: {
                run: async (_task, rt) => {
                  await rt.approval(key, options as never);
                  await rt.commit({terminal: {status: "completed"}});
                },
              },
            },
            version: 1,
          })
        );
      const cases: Array<[AnyHarnessTaskDefinition, string]> = [
        [misuse({title: "t"}, " "), "rt.approval requires a key"],
        [misuse({}), 'rt.approval("k") requires a title'],
        [misuse({summary: 3, title: "t"}), 'rt.approval("k") summary must be a string'],
        [misuse({notify: "x", title: "t"}), 'rt.approval("k") notify must be a function'],
        [
          misuse({approvers: [], title: "t"}),
          'rt.approval("k") does not take approvers; declare them in defineTask',
        ],
        [misuse({timeout: {seconds: 0}, title: "t"}), 'rt.approval("k") timeout must be positive'],
      ];
      const harness = await openHarness(cases.map(([definition]) => definition));
      for (const [definition, message] of cases) {
        const created = await harness.createTask(definition, {});
        const done = await harness.waitForTask(created._id, {timeout: {seconds: 10}});
        expect(done.status).toBe("failed");
        expect(done.outcome?.error).toContain(message);
        expect(done.attempt).toBe(0);
      }
      expect(await ApprovalModel.countDocuments({})).toBe(0);

      expect(() => asksApproval({approvals: [] as never, name: "test.bad1"})).toThrow(
        "approvals must be an object keyed by approval key"
      );
      expect(() => asksApproval({approvals: {" ": {approvers: []}}, name: "test.bad2"})).toThrow(
        "approval keys must be non-empty"
      );
      expect(() =>
        asksApproval({approvals: {k: {approvers: ["x" as never]}}, name: "test.bad3"})
      ).toThrow("approvals.k.approvers must be an array of permission functions");
      expect(() => defineExtension({approvals: {k: {} as never}, name: "badExtension"})).toThrow(
        "defineExtension(badExtension): approvals.k.approvers must be an array"
      );
    });

    it("logs and ignores a notify callback that throws", async () => {
      const definition = asksApproval({
        name: "test.notifyThrows",
        notify: () => {
          throw new Error("smtp down");
        },
      });
      const harness = await openHarness([definition]);
      const created = await harness.createTask(definition, {patientId: "p10"});
      await waitUntil(statusIs(created._id, "waiting"), "waiting on approval");
      const approval = await approvalOf(created._id);
      await harness.decideApproval(approval._id, {approved: true, userId: adminId});
      const done = await harness.waitForTask(created._id, {timeout: {seconds: 10}});
      expect(done.status).toBe("completed");
    });

    it("validates HarnessApp and approvalGate options", async () => {
      const harness = await openHarness([], {start: false});
      expect(() => new HarnessApp({basePath: "harness", harness})).toThrow(
        'HarnessApp basePath must start with "/" and not end with "/": "harness"'
      );
      expect(() => new HarnessApp({harness: undefined as unknown as Harness})).toThrow(
        "HarnessApp requires an opened Harness"
      );
      expect(() => approvalGate({tools: []})).toThrow(
        "approvalGate: tools must list at least one tool"
      );
      expect(() => approvalGate({tools: [" "]})).toThrow(
        "approvalGate: every tool must be a defineTool tool or a tool name"
      );
      expect(() => approvalGate({title: 3 as never, tools: ["x"]})).toThrow(
        "approvalGate(approvalGate:x): title must be a string or a function"
      );
      expect(() => approvalGate({timeout: {seconds: -1}, tools: ["x"]})).toThrow(
        "approvalGate(approvalGate:x): timeout must be a valid, non-negative duration"
      );
    });
  });

  describe("approvalGate", () => {
    const MODEL: HarnessModelRef = {modelId: "mock-model", provider: "mock"};

    /** A model that calls `writeNote` once, then answers with the text it received. */
    const scriptedModel = () => {
      const prompts: unknown[] = [];
      let calls = 0;
      return {
        model: withGenerateStreaming({
          doGenerate: async (options: {prompt: unknown}) => {
            prompts.push(JSON.parse(JSON.stringify(options.prompt)));
            calls += 1;
            const content =
              calls === 1
                ? [
                    {
                      input: JSON.stringify({text: "Discharge"}),
                      toolCallId: "call-1",
                      toolName: "writeNote",
                      type: "tool-call" as const,
                    },
                  ]
                : [{text: "done", type: "text" as const}];
            return {
              content,
              finishReason: calls === 1 ? ("tool-calls" as const) : ("stop" as const),
              usage: {inputTokens: 1, outputTokens: 1, totalTokens: 2},
              warnings: [],
            };
          },
          modelId: "mock-model",
          provider: "mock",
          specificationVersion: "v2" as const,
          supportedUrls: {},
        }),
        prompts,
      };
    };

    const setup = async ({
      execute,
      runner,
      testHooks,
      timeout,
    }: {
      execute?: (call: number) => Promise<void>;
      runner?: InProcessRunner;
      testHooks?: HarnessTestHooks;
      timeout?: {hours: number};
    } = {}) => {
      const executed: unknown[] = [];
      const writeNote = defineTool({
        description: "Write a note to the chart",
        execute: async (args: {text: string}) => {
          executed.push(args);
          await execute?.(executed.length);
          return {filed: true};
        },
        name: "writeNote",
        parameters: z.object({text: z.string()}),
        replay: "safe",
      });
      const notify = mock((_approval: HarnessApprovalDocument) => undefined);
      const gate = approvalGate({approvers: [isClinician], notify, timeout, tools: [writeNote]});
      const agent = defineAgent({
        extensions: [gate],
        instructions: "Chart for the clinician.",
        model: MODEL,
        name: "test.charter",
        tools: [writeNote],
      });
      const scripted = scriptedModel();
      const harness = await openHarness([agent, gate], {model: scripted.model, runner, testHooks});
      const app = buildApp(harness);
      const conversation = await harness.createConversation({agent});
      const turn = await conversation.submit({content: "File it", requestId: "r1"});
      await waitUntil(async () => (await ApprovalModel.countDocuments({})) === 1, "approval");
      const toolTask = await TaskModel.findExactlyOne({name: AGENT_TOOL_TASK_NAME});
      await waitUntil(statusIs(toolTask._id, "waiting"), "tool waiting");
      return {
        agent,
        app,
        executed,
        gate,
        harness,
        model: scripted.model,
        notify,
        prompts: scripted.prompts,
        toolTask,
        turn,
      };
    };

    it("holds the tool until a permitted user approves, then runs it once", async () => {
      const {app, executed, gate, harness, notify, toolTask, turn} = await setup();
      expect(gate.name).toBe("approvalGate:writeNote");
      const approval = await approvalOf(toolTask._id);
      expect(
        plain({
          definitionKey: approval.definitionKey,
          extension: approval.extension,
          key: approval.key,
          payload: approval.payload,
          title: approval.title,
        })
      ).toEqual({
        definitionKey: `${AGENT_TOOL_TASK_NAME}@1:writeNote`,
        extension: "approvalGate:writeNote",
        key: "writeNote",
        payload: {args: {text: "Discharge"}, toolCallId: "call-1", toolName: "writeNote"},
        title: 'Run tool "writeNote"',
      });
      expect(executed).toEqual([]);
      expect(notify).toHaveBeenCalledTimes(1);

      const admin = await authAsUser(app, "admin");
      expect((await admin.get("/harness/approvals").expect(200)).body.data).toEqual([]);
      const clinician = await loginAs(app, CLINICIAN.email, CLINICIAN.password);
      await clinician
        .post(`/harness/approvals/${approval._id}/approve`)
        .send({reason: "ok"})
        .expect(200);

      const done = await harness.waitForTask(turn._id, {timeout: {seconds: 10}});
      expect(done.status).toBe("completed");
      expect(executed).toEqual([{text: "Discharge"}]);
      const memo = await MemoModel.findExactlyOne({
        key: "approvalGate:approvalGate:writeNote:call-1",
      });
      expect(String(memo.taskId)).toBe(String(turn._id));
      expect(plain(memo.value)).toEqual({approved: true, decidedBy: clinicianId, reason: "ok"});
      const toolSpan = await onlySpan({kind: "TOOL", traceId: done.traceId});
      expect(toolSpan?.status).toBe("ok");
      expect(
        await SpanModel.countDocuments({name: "approval:writeNote", traceId: done.traceId})
      ).toBe(1);
    });

    it("blocks the tool on rejection and sends the reason to the model", async () => {
      const {app, executed, harness, prompts, toolTask, turn} = await setup();
      const approval = await approvalOf(toolTask._id);
      const clinician = await loginAs(app, CLINICIAN.email, CLINICIAN.password);
      await clinician
        .post(`/harness/approvals/${approval._id}/reject`)
        .send({reason: "Note is wrong"})
        .expect(200);

      const done = await harness.waitForTask(turn._id, {timeout: {seconds: 10}});
      expect(done.status).toBe("completed");
      expect(executed).toEqual([]);
      const toolMessage = (prompts[1] as Array<{content: unknown; role: string}>).find(
        ({role}) => role === "tool"
      );
      expect(JSON.stringify(toolMessage?.content)).toContain(
        'Approval to run \\"writeNote\\" was rejected: Note is wrong'
      );
    });

    it("blocks the tool when nobody approves before the timeout", async () => {
      const start = DateTime.fromISO("2026-10-03T12:00:00.000Z");
      Settings.now = () => start.toMillis();
      const {executed, harness, prompts, toolTask, turn} = await setup({timeout: {hours: 1}});
      expect((await approvalOf(toolTask._id)).expiresAt?.getTime()).toBe(
        start.plus({hours: 1}).toMillis()
      );
      tickFrom(start.plus({hours: 2}));
      const done = await harness.waitForTask(turn._id, {timeout: {seconds: 10}});
      expect(done.status).toBe("completed");
      expect(executed).toEqual([]);
      const toolMessage = (prompts[1] as Array<{content: unknown; role: string}>).find(
        ({role}) => role === "tool"
      );
      expect(JSON.stringify(toolMessage?.content)).toContain(
        'Approval to run \\"writeNote\\" expired before anyone decided'
      );
    });

    it("reuses the memoized decision when a crashed call replays, without asking again", async () => {
      let isDead = false;
      let release: () => void = () => undefined;
      const hung = new Promise<void>((resolve) => {
        release = resolve;
      });
      const shortLeases = (): InProcessRunner =>
        new InProcessRunner({
          heartbeatInterval: {milliseconds: 50},
          leaseDuration: {milliseconds: 300},
          pollInterval: {milliseconds: 20},
        });
      const {agent, executed, gate, harness, model, notify, toolTask, turn} = await setup({
        // The first execution freezes its process mid-call, as if it crashed.
        execute: async (call) => {
          if (call === 1) {
            isDead = true;
            await hung;
          }
        },
        runner: shortLeases(),
        testHooks: {isHeartbeatSuspended: () => isDead},
      });
      const approval = await approvalOf(toolTask._id);
      await harness.decideApproval(approval._id, {approved: true, userId: clinicianId});
      await waitUntil(async () => executed.length === 1, "first execution");

      const second = await openHarness([agent, gate], {model, runner: shortLeases()});
      const done = await second.waitForTask(turn._id, {timeout: {seconds: 10}});
      release();
      expect(done.status).toBe("completed");
      expect(executed).toHaveLength(2);
      expect(await ApprovalModel.countDocuments({})).toBe(1);
      expect(notify).toHaveBeenCalledTimes(1);
      const toolDone = await findTask(toolTask._id);
      expect(toolDone.status).toBe("completed");
    });
  });
});
