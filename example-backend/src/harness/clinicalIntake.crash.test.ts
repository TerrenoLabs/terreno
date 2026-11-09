import {describe, expect, it, setDefaultTimeout} from "bun:test";
import {rm} from "node:fs/promises";
import {createServer} from "node:net";
import {tmpdir} from "node:os";
import path from "node:path";
import {createLocalObservabilityPlugin} from "@terreno/ai";
import {Harness} from "@terreno/ai/harness";
import {buildDatabaseUri, getMongoServerUri} from "@terreno/test";
import type {Subprocess} from "bun";
import {DateTime} from "luxon";
import mongoose from "mongoose";

import {FakeClinicalNote} from "../models/fakeClinicalNote";
import {FakePatientChart} from "../models/fakePatientChart";
import {FAKE_PATIENT_CHARTS} from "../scripts/seedFakeEhr";
import {pollUntil, traceSpanLines, useReplicaSetConnection} from "../tests/harnessTestHelpers";
import {CLINICIAN_SIGNOFF, createClinicalIntake} from "./clinicalIntake";
import {CLINIC_DEMO_MODEL} from "./clinicDemoModel";
import {resolveExampleModel} from "./clinicModels";

setDefaultTimeout(240_000);

const EXAMPLE_BACKEND_DIR = path.resolve(import.meta.dir, "../..");
const LEASE_SECONDS = 3;

const freePort = async (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });

/**
 * Start `bun run src/index.ts` (the real example API process, runner included) against the
 * test replica set. `CLINIC_DEMO_MODEL_DELAY_MS` holds every summarizer request open.
 */
interface Backend {
  child: Subprocess;
  /** stdout log; stderr goes to `<logFile>.err`. */
  logFile: string;
}

const readLogs = async ({logFile}: Backend): Promise<string> => {
  const [out, err] = await Promise.all([
    Bun.file(logFile)
      .text()
      .catch(() => ""),
    Bun.file(`${logFile}.err`)
      .text()
      .catch(() => ""),
  ]);
  return `${out}\n${err}`;
};

const startBackend = async ({
  delayMs,
  label,
  mongoUri,
  port,
}: {
  delayMs: number;
  label: string;
  mongoUri: string;
  port: number;
}): Promise<Backend> => {
  const logFile = path.join(
    process.env.TMPDIR ?? tmpdir(),
    `clinical-crash-${label}-${DateTime.now().toMillis()}.log`
  );
  const child = Bun.spawn([process.execPath, "run", "src/index.ts"], {
    cwd: EXAMPLE_BACKEND_DIR,
    env: {
      ...process.env,
      CLINIC_DEMO_MODEL: "true",
      CLINIC_DEMO_MODEL_DELAY_MS: String(delayMs),
      HARNESS_LEASE_SECONDS: String(LEASE_SECONDS),
      MONGO_URI: mongoUri,
      PORT: String(port),
    },
    stderr: Bun.file(`${logFile}.err`),
    stdout: Bun.file(logFile),
  });
  // The caller never receives a child that failed to come up, so kill it here
  try {
    await waitForHealth({child, label, logFile, port});
  } catch (error: unknown) {
    child.kill("SIGKILL");
    throw error;
  }
  return {child, logFile};
};

const waitForHealth = async ({
  child,
  label,
  logFile,
  port,
}: {
  child: Backend["child"];
  label: string;
  logFile: string;
  port: number;
}): Promise<void> => {
  await pollUntil(
    async () => {
      if (child.exitCode !== null) {
        throw new Error(
          `Backend ${label} exited with ${child.exitCode}; see ${logFile} and ${logFile}.err`
        );
      }
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health`);
        return response.ok ? true : undefined;
      } catch {
        return undefined;
      }
    },
    {intervalMs: 250, timeoutMs: 90_000, what: `backend ${label} /health`}
  );
};

const stopBackend = async (
  backend: Backend | undefined,
  signal: "SIGKILL" | "SIGTERM"
): Promise<void> => {
  const child = backend?.child;
  if (!child || child.exitCode !== null || child.signalCode) {
    return;
  }
  child.kill(signal);
  const exited = await Promise.race([child.exited, Bun.sleep(15_000).then(() => "timeout")]);
  if (exited === "timeout") {
    child.kill("SIGKILL");
    await child.exited;
  }
};

describe("clinic.intakeSummary crash and resume", () => {
  useReplicaSetConnection("terreno-example-clinical-crash-test");

  it("survives a SIGKILL of the API process mid-summarize and files exactly one note", async () => {
    createLocalObservabilityPlugin();
    await FakePatientChart.create(FAKE_PATIENT_CHARTS);
    const replicaSetUri = getMongoServerUri();
    if (!replicaSetUri) {
      throw new Error("replica set not started");
    }
    const mongoUri = buildDatabaseUri({databaseName: mongoose.connection.name, uri: replicaSetUri});
    // This process only creates the task and decides the approval, as an admin script and
    // the inbox would; it never starts a runner. The spawned API process runs every phase.
    const intake = createClinicalIntake({model: CLINIC_DEMO_MODEL});
    const harness = await Harness.open({
      models: resolveExampleModel,
      registry: [intake.intakeSummary, intake.summarizer],
    });
    const tasks = mongoose.connection.collection("harnesstasks");
    const port = await freePort();
    let first: Backend | undefined;
    let second: Backend | undefined;
    let passed = false;
    try {
      first = await startBackend({delayMs: 600_000, label: "first", mongoUri, port});
      const task = await harness.createTask(intake.intakeSummary, {patientId: "p-1001"});

      // The summarizer's model request is in flight (the demo model is holding it open).
      const turn = await pollUntil(
        async () =>
          (await tasks.findOne({
            name: "terreno.agent.turn",
            phase: "request",
            rootTaskId: task._id,
            status: "running",
          })) ?? undefined,
        {what: "the summarizer turn to start its model request"}
      );
      expect((await tasks.findOne({_id: task._id}))?.phase).toBe("summarize");
      // ...and the demo model is inside that request, holding it open.
      await pollUntil(
        async () =>
          first && (await readLogs(first)).includes("[clinic-demo] holding request")
            ? true
            : undefined,
        {what: "the demo model to hold the summarizer request"}
      );
      const firstOwner = turn.lease?.owner as string;

      await stopBackend(first, "SIGKILL");
      expect(first.child.signalCode).toBe("SIGKILL");
      // Killed mid-request: the turn still holds the dead process's lease and nothing is filed.
      const orphan = await tasks.findOne({_id: turn._id});
      expect(orphan?.status).toBe("running");
      expect(orphan?.lease?.owner).toBe(firstOwner);
      expect(await FakeClinicalNote.countDocuments({})).toBe(0);

      second = await startBackend({delayMs: 0, label: "second", mongoUri, port});
      const approval = await pollUntil(
        async () =>
          (await mongoose.connection
            .collection("harnessapprovals")
            .findOne({status: "pending", taskId: task._id})) ?? undefined,
        {timeoutMs: 90_000, what: "the clinician-signoff approval after recovery"}
      );
      await harness.decideApproval(approval._id, {
        approved: true,
        userId: new mongoose.Types.ObjectId(),
      });
      const done = await harness.waitForTask(task._id, {timeout: {seconds: 90}});
      expect(done.status).toBe("completed");
      expect(JSON.parse(JSON.stringify(done.outcome?.result))).toMatchObject({status: "filed"});

      const notes = await FakeClinicalNote.find({});
      expect(notes).toHaveLength(1);
      expect(notes[0].idempotencyKey).toBe(`note-${String(task._id)}`);

      const spans = await traceSpanLines(task.traceId);
      const named = (name: string) => spans.filter((span) => span.name === name);
      expect(spans[0]).toMatchObject({depth: 0, kind: "CHAIN", name: "clinic.intakeSummary@1"});
      expect(named("clinic.summarizer")).toEqual([
        expect.objectContaining({kind: "AGENT", status: "ok"}),
      ]);
      // The cut-off request wrote no LLM span; the re-requested one did.
      expect(named("demo/clinic-summarizer-demo")).toEqual([
        expect.objectContaining({kind: "LLM", parent: "clinic.summarizer", status: "ok"}),
      ]);
      expect(
        named("request").filter(
          (span) => span.status === "error" && span.parent === "clinic.summarizer"
        )
      ).toEqual([
        expect.objectContaining({
          output: expect.objectContaining({
            interrupted: true,
            leaseOwner: firstOwner,
            replay: "safe",
            status: "pending",
          }),
        }),
      ]);
      expect(named(`approval:${CLINICIAN_SIGNOFF}`)).toHaveLength(1);
      expect(named("write")).toEqual([expect.objectContaining({kind: "CHAIN", status: "ok"})]);
      passed = true;
    } finally {
      await stopBackend(first, "SIGKILL");
      await stopBackend(second, "SIGTERM");
      await harness.stop();
      // Keep the child logs only when the drill failed.
      for (const backend of passed ? [first, second] : []) {
        if (backend) {
          await rm(backend.logFile, {force: true});
          await rm(`${backend.logFile}.err`, {force: true});
        }
      }
    }
  });
});
