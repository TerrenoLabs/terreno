import {afterEach, beforeAll, beforeEach, describe, expect, it, spyOn} from "bun:test";
import mongoose from "mongoose";

import {createLocalObservabilityPlugin} from "../observability/local/localPlugin";
import {registerObsSpan} from "../observability/local/models/obsSpan";
import {registerObsTrace} from "../observability/local/models/obsTrace";
import type {HarnessTestHooks} from "../types/harness";
import type {ObsSpanModel, ObsTraceModel} from "../types/observability";
import {defineTask, Harness, HarnessCommitConflictError, InProcessRunner} from "./harness";
import {registerHarnessTask} from "./models/harnessTask";

interface IntakeInput {
  patientId: string;
}

interface IntakeState {
  chart?: string;
  summary?: string;
}

const intakeTask = defineTask<IntakeInput, IntakeState, {status: string; summary: string}>({
  initial: () => ({phase: "fetch", state: {}}),
  name: "test.intake",
  phases: {
    fetch: {
      replay: "safe",
      run: async (task, rt) => {
        await rt.commit({phase: "summarize", state: {chart: `chart-for-${task.input.patientId}`}});
      },
    },
    summarize: {
      run: async (task, rt) => {
        await rt.commit({
          terminal: {
            result: {status: "filed", summary: `summary of ${task.state.chart}`},
            status: "completed",
          },
        });
      },
    },
  },
  retry: {maxAttempts: 3},
  version: 1,
});

const TaskModel = registerHarnessTask();
let SpanModel: ObsSpanModel;
let TraceModel: ObsTraceModel;

const openHarnesses: Harness[] = [];

const openHarness = async (
  options: {
    registry?: Parameters<typeof Harness.open>[0]["registry"];
    testHooks?: HarnessTestHooks;
  } = {}
): Promise<Harness> => {
  const harness = await Harness.open({
    registry: options.registry ?? [intakeTask],
    runner: new InProcessRunner({pollInterval: {milliseconds: 20}}),
    testHooks: options.testHooks,
  });
  openHarnesses.push(harness);
  return harness;
};

const deferred = (): {promise: Promise<void>; resolve: () => void} => {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return {promise, resolve};
};

describe("Harness", () => {
  beforeAll(() => {
    createLocalObservabilityPlugin();
    SpanModel = registerObsSpan();
    TraceModel = registerObsTrace();
  });

  beforeEach(async () => {
    await Promise.all([
      TaskModel.deleteMany({}),
      SpanModel.deleteMany({}),
      TraceModel.deleteMany({}),
    ]);
  });

  afterEach(async () => {
    await Promise.all(openHarnesses.splice(0).map((harness) => harness.stop()));
  });

  describe("two-phase task", () => {
    it("runs every phase to completed and stores the outcome", async () => {
      const harness = await openHarness();
      await harness.start();

      const created = await harness.createTask(intakeTask, {patientId: "p1"});
      expect(created.status).toBe("pending");
      expect(created.phase).toBe("fetch");
      expect(created.retry?.maxAttempts).toBe(3);
      expect(String(created.rootTaskId)).toBe(String(created._id));

      const done = await harness.waitForTask(created._id);
      expect(done.status).toBe("completed");
      expect(done.phase).toBe("summarize");
      expect(done.state).toEqual({chart: "chart-for-p1"});
      expect(done.outcome?.status).toBe("completed");
      expect(done.outcome?.result).toEqual({status: "filed", summary: "summary of chart-for-p1"});
    });

    it("writes one root trace, one root CHAIN span, and exactly one CHAIN span per phase", async () => {
      const harness = await openHarness();
      await harness.start();
      const userId = new mongoose.Types.ObjectId();

      const created = await harness.createTask(
        intakeTask,
        {patientId: "p2"},
        {userId: String(userId)}
      );
      const done = await harness.waitForTask(created._id);

      const traces = await TraceModel.find({});
      expect(traces).toHaveLength(1);
      const [trace] = traces;
      expect(String(trace._id)).toBe(String(done.traceId));
      expect(trace.name).toBe("test.intake@1");
      expect(trace.status).toBe("ok");
      expect(trace.endedAt).toBeInstanceOf(Date);
      expect(trace.input).toEqual({patientId: "p2"});
      expect(trace.output).toEqual({status: "filed", summary: "summary of chart-for-p2"});
      expect(String(trace.userId)).toBe(String(userId));
      expect(String(done.userId)).toBe(String(userId));

      const spans = await SpanModel.find({traceId: trace._id});
      expect(spans).toHaveLength(3);
      const root = spans.find((span) => String(span._id) === String(done.rootSpanId));
      expect(root?.kind).toBe("CHAIN");
      expect(root?.name).toBe("test.intake@1");
      expect(root?.parentSpanId).toBeUndefined();
      expect(root?.status).toBe("ok");
      expect(root?.endedAt).toBeInstanceOf(Date);

      // Spans of fast phases can share a millisecond, so order by name, not time.
      const phaseSpans = spans
        .filter((span) => String(span._id) !== String(done.rootSpanId))
        .sort((a, b) => a.name.localeCompare(b.name));
      expect(phaseSpans.map((span) => span.name)).toEqual(["fetch", "summarize"]);
      for (const span of phaseSpans) {
        expect(span.kind).toBe("CHAIN");
        expect(span.status).toBe("ok");
        expect(String(span.parentSpanId)).toBe(String(done.rootSpanId));
        expect(span.endedAt).toBeInstanceOf(Date);
        expect(span.durationMs).toBeGreaterThanOrEqual(0);
      }
      expect(phaseSpans[0].output).toEqual({phase: "summarize", state: {chart: "chart-for-p2"}});
      expect(phaseSpans[1].input).toEqual({attempt: 0, state: {chart: "chart-for-p2"}});
    });

    it("keeps the current state when a phase commit omits state", async () => {
      const keepState = defineTask<unknown, {count: number}, number>({
        initial: () => ({phase: "first", state: {count: 7}}),
        name: "test.keepState",
        phases: {
          first: {run: async (_task, rt) => rt.commit({phase: "second"})},
          second: {
            run: async (task, rt) =>
              rt.commit({terminal: {result: task.state.count, status: "completed"}}),
          },
        },
        version: 1,
      });
      const harness = await openHarness({registry: [keepState]});
      await harness.start();

      const done = await harness.waitForTask((await harness.createTask(keepState, {}))._id);
      expect(done.state).toEqual({count: 7});
      expect(done.outcome?.result).toBe(7);
    });
  });

  describe("transactional commit", () => {
    it("leaves neither the task update nor the span when the commit transaction aborts", async () => {
      const aborted = deferred();
      const seenInsideTransaction: {phaseSpan?: boolean; rootEnded?: boolean; status?: string} = {};
      const harness = await openHarness({
        testHooks: {
          beforeCommitEnd: async ({phase, session, taskId}) => {
            if (phase !== "summarize") {
              return;
            }
            // Prove the writes happened inside this transaction before it is aborted.
            const inFlight = await TaskModel.findById(taskId).session(session);
            const phaseSpan = await SpanModel.find({name: "summarize"}).session(session);
            const root = await SpanModel.findById(inFlight?.rootSpanId).session(session);
            seenInsideTransaction.status = inFlight?.status;
            seenInsideTransaction.phaseSpan = phaseSpan.length === 1;
            seenInsideTransaction.rootEnded = root?.endedAt instanceof Date;
            aborted.resolve();
            throw new Error("injected failure inside the commit transaction");
          },
        },
      });
      await harness.start();

      const created = await harness.createTask(intakeTask, {patientId: "p3"});
      await aborted.promise;
      await harness.stop();

      expect(seenInsideTransaction).toEqual({
        phaseSpan: true,
        rootEnded: true,
        status: "completed",
      });

      const task = await TaskModel.findExactlyOne({_id: created._id});
      expect(task.status).toBe("running");
      expect(task.phase).toBe("summarize");
      expect(task.state).toEqual({chart: "chart-for-p3"});
      expect(task.outcome?.status).toBeUndefined();

      const spans = await SpanModel.find({traceId: task.traceId});
      expect(spans.map((span) => span.name).sort()).toEqual(["fetch", "test.intake@1"]);
      const root = await SpanModel.findExactlyOne({_id: task.rootSpanId});
      expect(root.endedAt).toBeUndefined();
      expect(root.output).toBeUndefined();
      expect(root.status).toBe("ok");
      const trace = await TraceModel.findExactlyOne({_id: task.traceId});
      expect(trace.endedAt).toBeUndefined();
      expect(trace.output).toBeUndefined();
    });

    it("leaves the task at its checkpoint when a phase swallows a failed commit", async () => {
      const finished = deferred();
      const swallowing = defineTask<unknown, unknown, unknown>({
        initial: () => ({phase: "only"}),
        name: "test.swallowing",
        phases: {
          only: {
            run: async (_task, rt) => {
              try {
                await rt.commit({terminal: {status: "completed"}});
              } catch {
                // The phase ignores the failure; the engine must not treat it as committed.
              }
              finished.resolve();
            },
          },
        },
        version: 1,
      });
      const harness = await openHarness({
        registry: [swallowing],
        testHooks: {
          beforeCommitEnd: () => {
            throw new Error("injected failure inside the commit transaction");
          },
        },
      });
      await harness.start();

      const created = await harness.createTask(swallowing, {});
      await finished.promise;
      await harness.stop();

      const task = await TaskModel.findExactlyOne({_id: created._id});
      expect(task.status).toBe("running");
      expect(await SpanModel.countDocuments({name: "only"})).toBe(0);
    });

    it("rejects a commit whose checkpoint moved underneath it", async () => {
      const finished = deferred();
      let commitError: unknown;
      const raced = defineTask<unknown, unknown, unknown>({
        initial: () => ({phase: "first"}),
        name: "test.raced",
        phases: {
          first: {
            run: async (task, rt) => {
              // Another owner advanced the checkpoint while this phase was working.
              await TaskModel.updateOne({_id: task.id}, {$set: {phase: "second"}});
              try {
                await rt.commit({phase: "second", state: {stale: true}});
              } catch (error: unknown) {
                commitError = error;
                throw error;
              } finally {
                finished.resolve();
              }
            },
          },
          second: {run: async () => {}},
        },
        version: 1,
      });
      const harness = await openHarness({registry: [raced]});
      await harness.start();

      const created = await harness.createTask(raced, {});
      await finished.promise;
      await harness.stop();

      expect(commitError).toBeInstanceOf(HarnessCommitConflictError);
      const task = await TaskModel.findExactlyOne({_id: created._id});
      expect(task.phase).toBe("second");
      expect(task.state).toBeUndefined();
      expect(await SpanModel.countDocuments({name: "first"})).toBe(0);
    });
  });

  describe("phase failures", () => {
    it("fails the task with an error span when a phase throws with no retries left", async () => {
      const throwing = defineTask<unknown, unknown, unknown>({
        initial: () => ({phase: "explode"}),
        name: "test.throwing",
        phases: {
          explode: {
            run: async () => {
              throw new Error("EHR unavailable");
            },
          },
        },
        retry: {maxAttempts: 1},
        version: 1,
      });
      const harness = await openHarness({registry: [throwing]});
      await harness.start();

      const done = await harness.waitForTask((await harness.createTask(throwing, {}))._id);
      expect(done.status).toBe("failed");
      expect(done.toObject().outcome).toEqual({error: "EHR unavailable", status: "failed"});

      const phaseSpan = await SpanModel.findExactlyOne({name: "explode"});
      expect(phaseSpan.status).toBe("error");
      expect(phaseSpan.error).toBe("EHR unavailable");
      const trace = await TraceModel.findExactlyOne({_id: done.traceId});
      expect(trace.status).toBe("error");
      expect(trace.errorSummary).toBe("EHR unavailable");
      const root = await SpanModel.findExactlyOne({_id: done.rootSpanId});
      expect(root.status).toBe("error");
    });

    it("fails the task when a phase returns without committing", async () => {
      const silent = defineTask<unknown, unknown, unknown>({
        initial: () => ({phase: "noop"}),
        name: "test.silent",
        phases: {noop: {run: async () => {}}},
        version: 1,
      });
      const harness = await openHarness({registry: [silent]});
      await harness.start();

      const done = await harness.waitForTask((await harness.createTask(silent, {}))._id);
      expect(done.status).toBe("failed");
      expect(done.outcome?.error).toBe(
        'test.silent@1: phase "noop" returned without calling rt.commit'
      );
    });

    it("fails the task when a phase commits to an unknown phase", async () => {
      const lost = defineTask<unknown, unknown, unknown>({
        initial: () => ({phase: "start"}),
        name: "test.lost",
        phases: {start: {run: async (_task, rt) => rt.commit({phase: "nowhere"})}},
        version: 1,
      });
      const harness = await openHarness({registry: [lost]});
      await harness.start();

      const done = await harness.waitForTask((await harness.createTask(lost, {}))._id);
      expect(done.status).toBe("failed");
      expect(done.outcome?.error).toBe('test.lost@1: rt.commit to unknown phase "nowhere"');
    });

    it("rejects an invalid terminal status", async () => {
      const badTerminal = defineTask<unknown, unknown, unknown>({
        initial: () => ({phase: "start"}),
        name: "test.badTerminal",
        phases: {
          start: {
            run: async (_task, rt) =>
              rt.commit({terminal: {status: "aborted"}} as unknown as Parameters<
                typeof rt.commit
              >[0]),
          },
        },
        version: 1,
      });
      const harness = await openHarness({registry: [badTerminal]});
      await harness.start();

      const done = await harness.waitForTask((await harness.createTask(badTerminal, {}))._id);
      expect(done.status).toBe("failed");
      expect(done.outcome?.error).toBe(
        'test.badTerminal@1: terminal status must be "completed" or "failed"'
      );
    });

    it("keeps the first checkpoint when a phase commits twice", async () => {
      const twice = defineTask<unknown, {step: number}, unknown>({
        initial: () => ({phase: "first", state: {step: 0}}),
        name: "test.twice",
        phases: {
          first: {
            run: async (_task, rt) => {
              await rt.commit({phase: "second", state: {step: 1}});
              await rt.commit({phase: "second", state: {step: 2}});
            },
          },
          second: {
            run: async (task, rt) =>
              rt.commit({terminal: {result: task.state.step, status: "completed"}}),
          },
        },
        version: 1,
      });
      const harness = await openHarness({registry: [twice]});
      await harness.start();

      const done = await harness.waitForTask((await harness.createTask(twice, {}))._id);
      expect(done.status).toBe("completed");
      expect(done.outcome?.result).toBe(1);
      expect(await SpanModel.countDocuments({name: "first"})).toBe(1);
    });

    it("fails a task whose stored phase is no longer defined", async () => {
      const harness = await openHarness();
      const created = await harness.createTask(intakeTask, {patientId: "p4"});
      await TaskModel.updateOne({_id: created._id}, {$set: {phase: "removedPhase"}});
      await harness.start();

      const done = await harness.waitForTask(created._id);
      expect(done.status).toBe("failed");
      expect(done.outcome?.error).toBe('test.intake@1: unknown phase "removedPhase"');
    });

    it("leaves the task at its checkpoint when recording a failure also fails", async () => {
      const attempted = deferred();
      const throwing = defineTask<unknown, unknown, unknown>({
        initial: () => ({phase: "explode"}),
        name: "test.unrecordable",
        phases: {
          explode: {
            run: async () => {
              throw new Error("boom");
            },
          },
        },
        version: 1,
      });
      const harness = await openHarness({
        registry: [throwing],
        testHooks: {
          beforeCommitEnd: () => {
            attempted.resolve();
            throw new Error("audit store down");
          },
        },
      });
      await harness.start();

      const created = await harness.createTask(throwing, {});
      await attempted.promise;
      await harness.stop();

      const task = await TaskModel.findExactlyOne({_id: created._id});
      expect(task.status).toBe("running");
      expect(task.phase).toBe("explode");
      expect(await SpanModel.countDocuments({name: "explode"})).toBe(0);
    });
  });

  describe("createTask", () => {
    it("returns the existing task for a repeated requestId", async () => {
      const harness = await openHarness();

      const first = await harness.createTask(
        intakeTask,
        {patientId: "p5"},
        {requestId: "intake-p5"}
      );
      const second = await harness.createTask(
        intakeTask,
        {patientId: "p5"},
        {requestId: "intake-p5"}
      );

      expect(String(second._id)).toBe(String(first._id));
      expect(await TaskModel.countDocuments({})).toBe(1);
      expect(await TraceModel.countDocuments({})).toBe(1);
      expect(await SpanModel.countDocuments({})).toBe(1);
    });

    it("creates exactly one task when the same requestId races", async () => {
      const harness = await openHarness();

      const results = await Promise.all(
        [1, 2, 3].map(() =>
          harness.createTask(intakeTask, {patientId: "p6"}, {requestId: "intake-p6"})
        )
      );

      expect(new Set(results.map((task) => String(task._id))).size).toBe(1);
      expect(await TaskModel.countDocuments({requestId: "intake-p6"})).toBe(1);
      expect(await TraceModel.countDocuments({})).toBe(1);
    });

    it("rejects a requestId that belongs to a different task definition", async () => {
      const other = defineTask<unknown, unknown, unknown>({
        initial: () => ({phase: "only"}),
        name: "test.other",
        phases: {only: {run: async (_task, rt) => rt.commit({terminal: {status: "completed"}})}},
        version: 1,
      });
      const harness = await openHarness({registry: [intakeTask, other]});
      await harness.createTask(intakeTask, {patientId: "p7"}, {requestId: "shared-key"});

      await expect(harness.createTask(other, {}, {requestId: "shared-key"})).rejects.toThrow(
        'requestId "shared-key" already belongs to task'
      );
    });

    it("rejects a requestId reused by a different user", async () => {
      const harness = await openHarness();
      const owner = new mongoose.Types.ObjectId();
      await harness.createTask(
        intakeTask,
        {patientId: "p12"},
        {requestId: "user-key", userId: owner}
      );

      await expect(
        harness.createTask(
          intakeTask,
          {patientId: "p12"},
          {requestId: "user-key", userId: new mongoose.Types.ObjectId()}
        )
      ).rejects.toThrow('requestId "user-key" already belongs to a task for a different user');
      await expect(
        harness.createTask(intakeTask, {patientId: "p12"}, {requestId: "user-key"})
      ).rejects.toThrow("different user");
      const same = await harness.createTask(
        intakeTask,
        {patientId: "p12"},
        {requestId: "user-key", userId: String(owner)}
      );
      expect(String(same.userId)).toBe(String(owner));
    });

    it("lets tasks without a requestId coexist", async () => {
      const harness = await openHarness();
      await harness.createTask(intakeTask, {patientId: "a"});
      await harness.createTask(intakeTask, {patientId: "b"});
      expect(await TaskModel.countDocuments({})).toBe(2);
    });

    it("rejects a definition that is not registered", async () => {
      const unregistered = defineTask<unknown, unknown, unknown>({
        initial: () => ({phase: "only"}),
        name: "test.unregistered",
        phases: {only: {run: async () => {}}},
        version: 1,
      });
      const harness = await openHarness();
      await expect(harness.createTask(unregistered, {})).rejects.toThrow(
        "test.unregistered@1 is not in this harness registry"
      );
    });

    it("rejects an initial phase that is not defined and writes nothing", async () => {
      const badInitial = defineTask<unknown, unknown, unknown>({
        initial: () => ({phase: "missing"}),
        name: "test.badInitial",
        phases: {only: {run: async () => {}}},
        version: 1,
      });
      const harness = await openHarness({registry: [badInitial]});
      await expect(harness.createTask(badInitial, {})).rejects.toThrow(
        'test.badInitial@1: initial phase "missing" is not one of only'
      );
      expect(await TaskModel.countDocuments({})).toBe(0);
      expect(await TraceModel.countDocuments({})).toBe(0);
    });
  });

  describe("open / start / stop", () => {
    it("throws when the local observability models are not registered", async () => {
      mongoose.deleteModel("ObsSpan");
      try {
        await expect(Harness.open({registry: [intakeTask]})).rejects.toThrow(
          "Harness.open requires the local observability plugin"
        );
      } finally {
        SpanModel = registerObsSpan();
      }
    });

    it("throws when the connection is not a replica set", async () => {
      const db = mongoose.connection.db;
      if (!db) {
        throw new Error("expected a connected database");
      }
      // A standalone mongod answers `hello` without a replica set name.
      const commandSpy = spyOn(db, "command").mockResolvedValueOnce({
        isWritablePrimary: true,
        ok: 1,
      });
      await expect(Harness.open({registry: [intakeTask]})).rejects.toThrow(
        "Harness.open requires a MongoDB replica set"
      );
      commandSpy.mockRestore();
    });

    it("accepts a mongos router, which supports transactions", async () => {
      const db = mongoose.connection.db;
      if (!db) {
        throw new Error("expected a connected database");
      }
      spyOn(db, "command").mockResolvedValueOnce({isWritablePrimary: true, msg: "isdbgrid", ok: 1});
      const harness = await Harness.open({registry: [intakeTask]});
      openHarnesses.push(harness);
      expect(harness).toBeInstanceOf(Harness);
    });

    it("throws when a name@version is registered twice", async () => {
      await expect(Harness.open({registry: [intakeTask, intakeTask]})).rejects.toThrow(
        "Harness registry lists test.intake@1 more than once"
      );
    });

    it("throws when started twice and allows stop before start", async () => {
      const harness = await openHarness();
      await harness.stop();
      await harness.start();
      await expect(harness.start()).rejects.toThrow("Harness is already started");
    });

    it("defaults to an InProcessRunner", async () => {
      const harness = await Harness.open({registry: [intakeTask]});
      openHarnesses.push(harness);
      await harness.start();
      const done = await harness.waitForTask(
        (await harness.createTask(intakeTask, {patientId: "p9"}))._id
      );
      expect(done.status).toBe("completed");
    });

    it("never claims tasks when the registry is empty", async () => {
      const idle = await openHarness({registry: []});
      await idle.start();
      // Created after start, so the start-time version check does not reject it.
      const writer = await openHarness();
      const created = await writer.createTask(intakeTask, {patientId: "p11"});
      await new Promise((resolve) => setTimeout(resolve, 60));
      await idle.stop();

      const task = await TaskModel.findExactlyOne({_id: created._id});
      expect(task.status).toBe("pending");
    });

    it("times out waiting for a task that never finishes", async () => {
      const harness = await openHarness();
      const created = await harness.createTask(intakeTask, {patientId: "p10"});
      await expect(
        harness.waitForTask(created._id, {
          pollInterval: {milliseconds: 5},
          timeout: {milliseconds: 30},
        })
      ).rejects.toThrow(
        `Timed out waiting for task ${created._id} (test.intake@1) in status pending`
      );
    });
  });
});
