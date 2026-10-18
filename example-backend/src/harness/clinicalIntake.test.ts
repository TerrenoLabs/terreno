import {describe, expect, it, setDefaultTimeout} from "bun:test";
import {createLocalObservabilityPlugin} from "@terreno/ai";
import {Harness, InProcessRunner} from "@terreno/ai/harness";
import type {User as ApiUser} from "@terreno/api";
import mongoose from "mongoose";

import {access} from "../access";
import {FakeClinicalNote} from "../models/fakeClinicalNote";
import {FakePatientChart} from "../models/fakePatientChart";
import {User} from "../models/user";
import {CLINICIAN_ROLE, DEFAULT_USER_ROLE} from "../rbacRoles";
import {FAKE_PATIENT_CHARTS} from "../scripts/seedFakeEhr";
import {pollUntil, traceSpanLines, useReplicaSetConnection} from "../tests/harnessTestHelpers";
import type {UserDocument} from "../types/models/userTypes";
import {CLINICIAN_SIGNOFF, createClinicalIntake} from "./clinicalIntake";
import {CLINIC_DEMO_MODEL, DEMO_SUMMARY_PREFIX} from "./clinicDemoModel";
import {resolveExampleModel} from "./clinicModels";

setDefaultTimeout(120_000);

const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

interface Fixture {
  admin: UserDocument;
  clinician: UserDocument;
  harness: Harness;
  intake: ReturnType<typeof createClinicalIntake>;
  member: UserDocument;
}

const makeUser = async (email: string, fields: Record<string, unknown>): Promise<UserDocument> =>
  (await User.create({email, name: email, ...fields})) as UserDocument;

/**
 * Open and start a harness with the example's clinical registry and the demo model, run
 * `body`, then stop the runner so the preload's per-test wipe never races a live runner.
 */
const withIntakeHarness = async (
  body: (fixture: Fixture) => Promise<void>,
  options: Partial<Parameters<typeof createClinicalIntake>[0]> = {}
): Promise<void> => {
  createLocalObservabilityPlugin();
  await access.roles.seedDefaults();
  await FakePatientChart.create(FAKE_PATIENT_CHARTS);
  await FakeClinicalNote.init();
  const intake = createClinicalIntake({model: CLINIC_DEMO_MODEL, ...options});
  const harness = await Harness.open({
    models: resolveExampleModel,
    registry: [intake.intakeSummary, intake.summarizer],
    runner: new InProcessRunner({
      heartbeatInterval: {milliseconds: 100},
      leaseDuration: {milliseconds: 500},
      pollInterval: {milliseconds: 25},
    }),
  });
  await harness.start();
  try {
    await body({
      admin: await makeUser("admin@clinic.test", {admin: true}),
      clinician: await makeUser("clinician@clinic.test", {roles: [CLINICIAN_ROLE]}),
      harness,
      intake,
      member: await makeUser("member@clinic.test", {roles: [DEFAULT_USER_ROLE]}),
    });
  } finally {
    await harness.stop();
  }
};

const pendingApprovalOf = async (taskId: unknown) =>
  pollUntil(
    async () =>
      (await mongoose.connection
        .collection("harnessapprovals")
        .findOne({status: "pending", taskId})) ?? undefined,
    {what: "the clinician-signoff approval"}
  );

describe("clinic.intakeSummary", () => {
  useReplicaSetConnection("terreno-example-clinical-intake-test");

  it("summarizes the chart, waits for a clinician, and files exactly one note", async () => {
    await withIntakeHarness(async ({admin, clinician, harness, intake, member}) => {
      const task = await harness.createTask(
        intake.intakeSummary,
        {patientId: "p-1001"},
        {requestId: "intake-p-1001"}
      );
      const pending = await pendingApprovalOf(task._id);
      expect(pending.definitionKey).toBe(`clinic.intakeSummary@1:${CLINICIAN_SIGNOFF}`);
      expect(pending.title).toBe("Sign off intake summary for Avery Synthetic");
      expect(pending.summary).toContain("**Avery Synthetic** (p-1001), risk **high**");
      expect(plain(pending.payload)).toMatchObject({
        patientId: "p-1001",
        risk: "high",
        summary: expect.stringContaining(DEMO_SUMMARY_PREFIX),
      });

      // Approvers: admins or the RBAC clinician role; a plain member sees nothing.
      const visibleTo = async (user: UserDocument): Promise<string[]> =>
        (await harness.approvableApprovals({user: user as unknown as ApiUser})).map((approval) =>
          String(approval._id)
        );
      expect(await visibleTo(clinician)).toEqual([String(pending._id)]);
      expect(await visibleTo(admin)).toEqual([String(pending._id)]);
      expect(await visibleTo(member)).toEqual([]);

      await harness.decideApproval(pending._id, {approved: true, userId: clinician._id});
      const done = await harness.waitForTask(task._id, {timeout: {seconds: 30}});
      expect(done.status).toBe("completed");
      const result = plain(done.outcome?.result) as {noteId: string; status: string};
      expect(result.status).toBe("filed");

      const notes = await FakeClinicalNote.find({});
      expect(notes).toHaveLength(1);
      expect(String(notes[0]._id)).toBe(result.noteId);
      expect(notes[0].idempotencyKey).toBe(`note-${String(task._id)}`);
      expect(notes[0].signedOffBy).toBe(String(clinician._id));
      expect(notes[0].summary).toStartWith(DEMO_SUMMARY_PREFIX);
      expect(notes[0].sources).toContain("medications");

      const spans = await traceSpanLines(task.traceId);
      const named = (name: string) => spans.filter((span) => span.name === name);
      expect(spans[0]).toMatchObject({depth: 0, kind: "CHAIN", name: "clinic.intakeSummary@1"});
      expect(named("fetch")).toHaveLength(1);
      expect(named("write")).toHaveLength(1);
      for (const phase of ["fetch", "summarize", "review", "write"]) {
        expect(named(phase).every((span) => span.kind === "CHAIN")).toBe(true);
      }
      expect(named("clinic.summarizer")).toEqual([
        expect.objectContaining({depth: 1, kind: "AGENT", status: "ok"}),
      ]);
      expect(named("demo/clinic-summarizer-demo")).toEqual([
        expect.objectContaining({kind: "LLM", parent: "clinic.summarizer", status: "ok"}),
      ]);
      expect(named(`approval:${CLINICIAN_SIGNOFF}`)).toEqual([
        expect.objectContaining({
          kind: "CHAIN",
          output: expect.objectContaining({
            decidedBy: String(clinician._id),
            decision: "approved",
          }),
        }),
      ]);

      // The same requestId returns the same run instead of starting a second one.
      const again = await harness.createTask(
        intake.intakeSummary,
        {patientId: "p-1001"},
        {requestId: "intake-p-1001"}
      );
      expect(String(again._id)).toBe(String(task._id));
    });
  });

  it("completes as rejected with the clinician's reason and files nothing", async () => {
    await withIntakeHarness(async ({clinician, harness, intake}) => {
      const task = await harness.createTask(intake.intakeSummary, {patientId: "p-1002"});
      const pending = await pendingApprovalOf(task._id);
      expect(plain(pending.payload)).toMatchObject({risk: "low"});
      await harness.decideApproval(pending._id, {
        approved: false,
        reason: "Wrong medication list",
        userId: clinician._id,
      });
      const done = await harness.waitForTask(task._id, {timeout: {seconds: 30}});
      expect(done.status).toBe("completed");
      expect(plain(done.outcome?.result)).toEqual({
        reason: "Wrong medication list",
        status: "rejected",
      });
      expect(await FakeClinicalNote.countDocuments({})).toBe(0);
    });
  });

  it("returns the existing note when one already holds the task's idempotency key", async () => {
    await withIntakeHarness(async ({clinician, harness, intake}) => {
      const task = await harness.createTask(intake.intakeSummary, {patientId: "p-1002"});
      const pending = await pendingApprovalOf(task._id);
      // As if an interrupted write had already reached the EHR before an operator retried.
      const earlier = await FakeClinicalNote.create({
        idempotencyKey: `note-${String(task._id)}`,
        patientId: "p-1002",
        risk: "low",
        summary: "Filed by the interrupted attempt",
      });
      await harness.decideApproval(pending._id, {approved: true, userId: clinician._id});
      const done = await harness.waitForTask(task._id, {timeout: {seconds: 30}});
      expect(plain(done.outcome?.result)).toEqual({noteId: String(earlier._id), status: "filed"});
      expect(await FakeClinicalNote.countDocuments({})).toBe(1);
    });
  });

  it("completes as rejected when nobody signs off before the timeout", async () => {
    await withIntakeHarness(
      async ({harness, intake}) => {
        const task = await harness.createTask(intake.intakeSummary, {patientId: "p-1002"});
        const done = await harness.waitForTask(task._id, {timeout: {seconds: 30}});
        expect(done.status).toBe("completed");
        expect(plain(done.outcome?.result)).toEqual({
          reason: "Sign-off expired before anyone decided",
          status: "rejected",
        });
        const approval = await mongoose.connection
          .collection("harnessapprovals")
          .findOne({taskId: task._id});
        expect(approval?.status).toBe("expired");
        expect(await FakeClinicalNote.countDocuments({})).toBe(0);
      },
      {signoffTimeout: {milliseconds: 300}}
    );
  });

  it("fails the run without asking anyone when the summarizer's model cannot be resolved", async () => {
    await withIntakeHarness(
      async ({harness, intake}) => {
        const task = await harness.createTask(intake.intakeSummary, {patientId: "p-1001"});
        const done = await harness.waitForTask(task._id, {timeout: {seconds: 30}});
        expect(done.status).toBe("failed");
        expect(done.outcome?.error).toContain("could not be resolved");
        expect(
          await mongoose.connection
            .collection("harnessapprovals")
            .countDocuments({taskId: task._id})
        ).toBe(0);
      },
      {model: {modelId: "x", provider: "openai"}}
    );
  });

  it("fails at once when the patient has no chart", async () => {
    await withIntakeHarness(async ({harness, intake}) => {
      const task = await harness.createTask(intake.intakeSummary, {patientId: "p-404"});
      const done = await harness.waitForTask(task._id, {timeout: {seconds: 30}});
      expect(done.status).toBe("failed");
      expect(done.outcome?.error).toBe("No chart for patient p-404");
      expect(done.attempt).toBe(0);
    });
  });
});
