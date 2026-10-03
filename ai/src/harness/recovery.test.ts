import {afterEach, beforeAll, beforeEach, describe, expect, it} from "bun:test";
import {DateTime} from "luxon";
import mongoose from "mongoose";

import {createLocalObservabilityPlugin} from "../observability/local/localPlugin";
import {registerObsSpan} from "../observability/local/models/obsSpan";
import {registerObsTrace} from "../observability/local/models/obsTrace";
import type {HarnessTaskDocument} from "../types/harness";
import type {ObsSpanModel, ObsTraceModel} from "../types/observability";
import {
  type AnyHarnessTaskDefinition,
  defineTask,
  Harness,
  HarnessCommitConflictError,
  InProcessRunner,
} from "./harness";
import {registerHarnessOwner} from "./models/harnessOwner";
import {registerHarnessTask} from "./models/harnessTask";

const LEASE_MS = 300;
const HEARTBEAT_MS = 50;
/** Lease for the test that holds a phase past it; roomy so a stalled machine cannot flake it. */
const SLOW_LEASE_MS = 1000;

const TaskModel = registerHarnessTask();
const OwnerModel = registerHarnessOwner();
let SpanModel: ObsSpanModel;
let TraceModel: ObsTraceModel;

interface Gate {
  promise: Promise<void>;
  release: () => void;
}

const gate = (): Gate => {
  let release: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {promise, release};
};

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const waitUntil = async (
  predicate: () => Promise<boolean> | boolean,
  label: string
): Promise<void> => {
  for (let i = 0; i < 300; i++) {
    if (await predicate()) {
      return;
    }
    await pause(10);
  }
  throw new Error(`waitUntil timed out: ${label}`);
};

interface ProcessHandle {
  /** Freeze every lease renewal, as if the process stopped running. */
  die: () => void;
  harness: Harness;
  runner: InProcessRunner;
}

const liveHandles: ProcessHandle[] = [];
/** Phases left hanging by a simulated crash; released after each test so stop() settles. */
const hungGates: Gate[] = [];

/** One simulated process: a Harness plus its runner, sharing the test database. */
const openProcess = async ({
  leaseMs = LEASE_MS,
  ownerId,
  registry,
}: {
  leaseMs?: number;
  ownerId: string;
  registry: ReadonlyArray<AnyHarnessTaskDefinition>;
}): Promise<ProcessHandle> => {
  let isDead = false;
  const runner = new InProcessRunner({
    heartbeatInterval: {milliseconds: HEARTBEAT_MS},
    leaseDuration: {milliseconds: leaseMs},
    ownerId,
    pollInterval: {milliseconds: 20},
  });
  const harness = await Harness.open({
    registry,
    runner,
    testHooks: {isHeartbeatSuspended: () => isDead},
  });
  const handle = {
    die: () => {
      isDead = true;
    },
    harness,
    runner,
  };
  liveHandles.push(handle);
  return handle;
};

const phaseSpans = async (
  task: HarnessTaskDocument
): Promise<Array<{error?: string; name: string; output?: unknown; status: string}>> => {
  const spans = await SpanModel.find({
    _id: {$ne: task.rootSpanId},
    traceId: task.traceId,
  }).sort({_id: 1, created: 1});
  return spans.map((span) => ({
    error: span.error,
    name: span.name,
    output: span.output,
    status: span.status,
  }));
};

const findTask = (id: mongoose.Types.ObjectId): Promise<HarnessTaskDocument> =>
  TaskModel.findExactlyOne({_id: id});

/** A `fetch` phase whose first run hangs on `hung` until the test lets it go. */
const buildCrashingTask = ({
  hung,
  name,
  onRun,
  replay,
}: {
  hung: Gate;
  name: string;
  onRun: (run: number) => Promise<void> | void;
  replay?: "never" | "safe";
}): {definition: AnyHarnessTaskDefinition; started: Gate; zombieError: () => unknown} => {
  const started = gate();
  let runs = 0;
  let zombieError: unknown;
  const definition = defineTask<{patientId: string}, {chart?: string}, {status: string}>({
    initial: () => ({phase: "fetch", state: {}}),
    name,
    phases: {
      fetch: {
        replay,
        run: async (task, rt) => {
          runs += 1;
          const run = runs;
          await onRun(run);
          if (run === 1) {
            started.release();
            await hung.promise;
            try {
              await rt.commit({phase: "finish", state: {chart: "from-the-dead-runner"}});
            } catch (error: unknown) {
              zombieError = error;
              throw error;
            }
            return;
          }
          await rt.commit({
            phase: "finish",
            state: {chart: `chart-${task.input.patientId}-${run}`},
          });
        },
      },
      finish: {
        run: async (task, rt) =>
          rt.commit({
            terminal: {result: {status: `filed ${task.state.chart}`}, status: "completed"},
          }),
      },
    },
    version: 1,
  });
  return {
    definition: definition as unknown as AnyHarnessTaskDefinition,
    started,
    zombieError: () => zombieError,
  };
};

/** When the crashed owner started the phase it never finished. */
const ABANDONED_ACQUIRED_AT = DateTime.now().minus({minutes: 2}).startOf("second");

/** Put a task in `running` with a lease that already lapsed, as a crashed owner leaves it. */
const abandonRunning = async (id: mongoose.Types.ObjectId, phase?: string): Promise<void> => {
  await TaskModel.updateOne(
    {_id: id},
    {
      $set: {
        lease: {
          acquiredAt: ABANDONED_ACQUIRED_AT.toJSDate(),
          expiresAt: DateTime.now().minus({minutes: 1}).toJSDate(),
          owner: "crashed-process",
          token: "stale-token",
        },
        status: "running",
        ...(phase ? {phase} : {}),
      },
    }
  );
};

const writeOnce = (onWrite: () => void): AnyHarnessTaskDefinition =>
  defineTask<unknown, {draft: string}, {status: string}>({
    initial: () => ({phase: "write", state: {draft: "note"}}),
    name: "test.ehrWrite",
    phases: {
      write: {
        run: async (_task, rt) => {
          onWrite();
          await rt.commit({terminal: {result: {status: "filed"}, status: "completed"}});
        },
      },
    },
    version: 1,
  }) as unknown as AnyHarnessTaskDefinition;

describe("Harness leases and crash recovery", () => {
  beforeAll(() => {
    createLocalObservabilityPlugin();
    SpanModel = registerObsSpan();
    TraceModel = registerObsTrace();
  });

  beforeEach(async () => {
    await Promise.all([
      TaskModel.deleteMany({}),
      OwnerModel.deleteMany({}),
      SpanModel.deleteMany({}),
      TraceModel.deleteMany({}),
    ]);
  });

  afterEach(async () => {
    for (const hung of hungGates.splice(0)) {
      hung.release();
    }
    await Promise.all(liveHandles.splice(0).map(({harness}) => harness.stop()));
  });

  describe("process death mid-phase", () => {
    it("re-runs a replay-safe phase from its checkpoint on a fresh harness after the lease expires", async () => {
      const hung = gate();
      hungGates.push(hung);
      const leaseOwners: string[] = [];
      const crashing = buildCrashingTask({
        hung,
        name: "test.safeCrash",
        onRun: async () => {
          const row = await TaskModel.findExactlyOne({name: "test.safeCrash"});
          leaseOwners.push(String(row.lease?.owner));
        },
        replay: "safe",
      });
      // A lease long enough that the standby check below cannot race its expiry.
      const first = await openProcess({
        leaseMs: 1500,
        ownerId: "process-1",
        registry: [crashing.definition],
      });
      await first.harness.start();
      const created = await first.harness.createTask(crashing.definition as never, {
        patientId: "p1",
      });
      await crashing.started.promise;
      first.die();

      const second = await openProcess({ownerId: "process-2", registry: [crashing.definition]});
      await second.harness.start();
      // The dead owner's lease has not lapsed yet, so the fresh process waits on standby.
      await pause(HEARTBEAT_MS * 2);
      expect(second.runner.role).toBe("standby");
      expect((await findTask(created._id)).lease?.owner).toBe("process-1");

      const done = await second.harness.waitForTask(created._id, {timeout: {seconds: 5}});
      expect(second.runner.role).toBe("owner");
      expect(first.runner.role).toBe("standby");
      expect(done.status).toBe("completed");
      expect(done.phase).toBe("finish");
      expect(done.state).toEqual({chart: "chart-p1-2"});
      expect(done.outcome?.result).toEqual({status: "filed chart-p1-2"});
      expect(done.lease?.token).toBeUndefined();
      expect(leaseOwners).toEqual(["process-1", "process-2"]);

      const spans = await phaseSpans(done);
      expect(spans.map(({name, status}) => `${name}:${status}`)).toEqual([
        "fetch:error",
        "fetch:ok",
        "finish:ok",
      ]);
      expect(spans[0].error).toBe(
        "Interrupted: lease of process-1 expired mid-phase; re-running (replay: safe)"
      );
      expect(spans[0].output).toEqual({
        interrupted: true,
        leaseOwner: "process-1",
        replay: "safe",
        status: "pending",
      });
      const trace = await TraceModel.findExactlyOne({_id: done.traceId});
      expect(trace.status).toBe("ok");
    });

    it("parks a default-replay phase as interrupted and never re-runs it", async () => {
      const hung = gate();
      hungGates.push(hung);
      let runs = 0;
      const crashing = buildCrashingTask({
        hung,
        name: "test.neverCrash",
        onRun: () => {
          runs += 1;
        },
      });
      const first = await openProcess({ownerId: "process-1", registry: [crashing.definition]});
      await first.harness.start();
      const created = await first.harness.createTask(crashing.definition as never, {
        patientId: "p2",
      });
      await crashing.started.promise;
      first.die();

      const second = await openProcess({ownerId: "process-2", registry: [crashing.definition]});
      await second.harness.start();
      await waitUntil(
        async () => (await findTask(created._id)).status === "interrupted",
        "task parked as interrupted"
      );
      // Several more heartbeats and polls must not pick the parked task back up.
      await pause(LEASE_MS * 2);

      const parked = await findTask(created._id);
      expect(parked.status).toBe("interrupted");
      expect(parked.phase).toBe("fetch");
      // The untouched checkpoint: initial state `{}` (the task schema keeps empty objects).
      expect(parked.state).toEqual({});
      expect(parked.lease?.token).toBeUndefined();
      expect(runs).toBe(1);

      const spans = await phaseSpans(parked);
      expect(spans).toHaveLength(1);
      expect(spans[0]).toEqual({
        error:
          "Interrupted: lease of process-1 expired mid-phase; awaiting resolveInterrupted (replay: never)",
        name: "fetch",
        output: {
          interrupted: true,
          leaseOwner: "process-1",
          replay: "never",
          status: "interrupted",
        },
        status: "error",
      });
      // Interruption is not terminal: the root span and trace stay open.
      const root = await SpanModel.findExactlyOne({_id: parked.rootSpanId});
      expect(root.endedAt).toBeUndefined();
      const trace = await TraceModel.findExactlyOne({_id: parked.traceId});
      expect(trace.endedAt).toBeUndefined();
    });

    it("rejects the dead runner's late commit by its stale lease token and writes nothing", async () => {
      const hung = gate();
      hungGates.push(hung);
      const rerunHeld = gate();
      hungGates.push(rerunHeld);
      const crashing = buildCrashingTask({
        hung,
        name: "test.staleToken",
        onRun: async (run) => {
          // Hold the replay so the zombie commits while the task is running at the
          // same phase: only the lease token differs.
          if (run === 2) {
            await rerunHeld.promise;
          }
        },
        replay: "safe",
      });
      const first = await openProcess({ownerId: "process-1", registry: [crashing.definition]});
      await first.harness.start();
      const created = await first.harness.createTask(crashing.definition as never, {
        patientId: "p3",
      });
      await crashing.started.promise;
      const deadToken = (await findTask(created._id)).lease?.token;
      first.die();

      const second = await openProcess({ownerId: "process-2", registry: [crashing.definition]});
      await second.harness.start();
      await waitUntil(
        async () => (await findTask(created._id)).lease?.owner === "process-2",
        "replay claimed by process-2"
      );
      const beforeZombie = await findTask(created._id);
      const spansBeforeZombie = await SpanModel.countDocuments({});
      expect(beforeZombie.status).toBe("running");
      expect(beforeZombie.phase).toBe("fetch");
      expect(beforeZombie.lease?.token).not.toBe(deadToken);

      hung.release();
      await waitUntil(() => crashing.zombieError() !== undefined, "zombie commit settled");
      expect(crashing.zombieError()).toBeInstanceOf(HarnessCommitConflictError);

      const afterZombie = await findTask(created._id);
      expect(afterZombie.status).toBe("running");
      expect(afterZombie.phase).toBe("fetch");
      expect(afterZombie.state).toEqual({});
      expect(afterZombie.lease?.token).toBe(beforeZombie.lease?.token);
      expect(await SpanModel.countDocuments({})).toBe(spansBeforeZombie);

      rerunHeld.release();
      const done = await second.harness.waitForTask(created._id, {timeout: {seconds: 5}});
      expect(done.state).toEqual({chart: "chart-p3-2"});
      expect(await SpanModel.countDocuments({error: {$exists: false}, name: "fetch"})).toBe(1);
    });

    it("stops renewing and cannot commit once another runner holds the task lease", async () => {
      const finished = gate();
      let commitError: unknown;
      let expiresAfterTakeover: number | undefined;
      const takenOver = defineTask<unknown, unknown, unknown>({
        initial: () => ({phase: "work"}),
        name: "test.takenOver",
        phases: {
          work: {
            replay: "safe",
            run: async (task, rt) => {
              // Another runner re-claimed the task under its own token while this one ran.
              const foreignExpiry = DateTime.now().plus({minutes: 5}).toJSDate();
              await TaskModel.updateOne(
                {_id: task.id},
                {
                  $set: {
                    "lease.expiresAt": foreignExpiry,
                    "lease.owner": "other",
                    "lease.token": "foreign",
                  },
                }
              );
              expiresAfterTakeover = foreignExpiry.getTime();
              await pause(HEARTBEAT_MS * 3);
              try {
                await rt.commit({terminal: {status: "completed"}});
              } catch (error: unknown) {
                commitError = error;
                throw error;
              } finally {
                finished.release();
              }
            },
          },
        },
        version: 1,
      });
      const handle = await openProcess({ownerId: "process-1", registry: [takenOver as never]});
      await handle.harness.start();
      const created = await handle.harness.createTask(takenOver, {});
      await finished.promise;

      expect(commitError).toBeInstanceOf(HarnessCommitConflictError);
      const task = await findTask(created._id);
      expect(task.status).toBe("running");
      expect(task.lease?.token).toBe("foreign");
      // The original runner's heartbeat never overwrote the new holder's expiry.
      expect(task.lease?.expiresAt?.getTime()).toBe(expiresAfterTakeover);
      expect(await SpanModel.countDocuments({name: "work"})).toBe(0);
    });

    it("keeps a phase that outlives the lease alive through task heartbeats", async () => {
      const tokens: Array<string | undefined> = [];
      let fetchRuns = 0;
      const slow = defineTask<unknown, unknown, unknown>({
        initial: () => ({phase: "fetch"}),
        name: "test.slow",
        phases: {
          fetch: {
            replay: "safe",
            run: async (task, rt) => {
              fetchRuns += 1;
              tokens.push((await TaskModel.findExactlyOne({_id: task.id})).lease?.token);
              await pause(SLOW_LEASE_MS * 3);
              await rt.commit({phase: "finish"});
            },
          },
          finish: {
            run: async (task, rt) => {
              tokens.push((await TaskModel.findExactlyOne({_id: task.id})).lease?.token);
              await rt.commit({terminal: {status: "completed"}});
            },
          },
        },
        version: 1,
      });
      const only = await openProcess({
        leaseMs: SLOW_LEASE_MS,
        ownerId: "process-1",
        registry: [slow as never],
      });
      // The owner's heartbeat sweep would interrupt the task if its lease ever lapsed, and
      // the standby would take over if the owner lease lapsed while the phase ran.
      const standby = await openProcess({
        leaseMs: SLOW_LEASE_MS,
        ownerId: "process-2",
        registry: [slow as never],
      });
      await only.harness.start();
      await waitUntil(() => only.runner.role === "owner", "process-1 owns");
      await standby.harness.start();

      const created = await only.harness.createTask(slow, {});
      const done = await only.harness.waitForTask(created._id, {timeout: {seconds: 10}});

      expect(done.status).toBe("completed");
      expect(fetchRuns).toBe(1);
      expect(await SpanModel.countDocuments({status: "error"})).toBe(0);
      // Each phase starts under its own fencing token.
      expect(tokens).toHaveLength(2);
      expect(tokens[0]).toBeString();
      expect(tokens[1]).toBeString();
      expect(tokens[0]).not.toBe(tokens[1]);
      expect(only.runner.role).toBe("owner");
      expect(standby.runner.role).toBe("standby");
    }, 15000);
  });

  describe("recovery on start()", () => {
    it("parks a never phase and re-runs a safe phase found with an expired lease", async () => {
      let writes = 0;
      const ehrWrite = writeOnce(() => {
        writes += 1;
      });
      const safeTask = defineTask<unknown, unknown, unknown>({
        initial: () => ({phase: "fetch"}),
        name: "test.safeResume",
        phases: {
          fetch: {
            replay: "safe",
            run: async (_task, rt) => rt.commit({terminal: {status: "completed"}}),
          },
        },
        version: 1,
      });
      const handle = await openProcess({ownerId: "fresh", registry: [ehrWrite, safeTask as never]});
      const parkedTask = await handle.harness.createTask(ehrWrite as never, {});
      const resumedTask = await handle.harness.createTask(safeTask, {});
      await abandonRunning(parkedTask._id);
      await abandonRunning(resumedTask._id);

      await handle.harness.start();
      const resumed = await handle.harness.waitForTask(resumedTask._id, {timeout: {seconds: 5}});
      await waitUntil(
        async () => (await findTask(parkedTask._id)).status === "interrupted",
        "write parked"
      );

      expect(resumed.status).toBe("completed");
      expect(writes).toBe(0);
      const spans = await phaseSpans(resumed);
      expect(spans.map(({name, status}) => `${name}:${status}`)).toEqual([
        "fetch:error",
        "fetch:ok",
      ]);
      expect(spans[0].error).toContain("lease of crashed-process expired");
      // The interruption span covers the cut-off phase from when its lease was taken.
      const interruption = await SpanModel.findExactlyOne({
        status: "error",
        traceId: resumed.traceId,
      });
      expect(interruption.startedAt.getTime()).toBe(ABANDONED_ACQUIRED_AT.toMillis());
    });

    it("leaves the task running under its old lease when the interruption commit aborts", async () => {
      const attempted = gate();
      const ehrWrite = writeOnce(() => {});
      const handle = await openProcess({ownerId: "fresh", registry: [ehrWrite]});
      const ownTestHooks = {
        // Every recovery attempt fails inside its transaction.
        beforeCommitEnd: () => {
          attempted.release();
          throw new Error("audit store down");
        },
      };
      // Rebuild the harness with a failing commit hook; recovery must roll back atomically.
      const failing = await Harness.open({
        registry: [ehrWrite],
        runner: new InProcessRunner({
          heartbeatInterval: {milliseconds: HEARTBEAT_MS},
          leaseDuration: {milliseconds: LEASE_MS},
          ownerId: "failing",
          pollInterval: {milliseconds: 20},
        }),
        testHooks: ownTestHooks,
      });
      const created = await handle.harness.createTask(ehrWrite as never, {});
      await abandonRunning(created._id);

      await failing.start();
      await attempted.promise;
      await failing.stop();

      const task = await findTask(created._id);
      expect(task.status).toBe("running");
      expect(task.lease?.token).toBe("stale-token");
      expect(task.lease?.owner).toBe("crashed-process");
      expect(await SpanModel.countDocuments({name: "write"})).toBe(0);
    });

    it("leaves expired tasks of versions created after start that it does not register", async () => {
      const other = defineTask<unknown, unknown, unknown>({
        initial: () => ({phase: "only"}),
        name: "test.unrelated",
        phases: {only: {run: async (_task, rt) => rt.commit({terminal: {status: "completed"}})}},
        version: 1,
      });
      const handle = await openProcess({ownerId: "fresh", registry: [other as never]});
      await handle.harness.start();
      await waitUntil(() => handle.runner.role === "owner", "fresh owns");
      // Another deploy creates a task of a version this process does not run.
      const writer = await openProcess({ownerId: "writer", registry: [writeOnce(() => {})]});
      const foreign = await writer.harness.createTask(writeOnce(() => {}) as never, {});
      await abandonRunning(foreign._id);
      // Several heartbeat sweeps run while owner.
      await pause(HEARTBEAT_MS * 4);

      const untouched = await findTask(foreign._id);
      expect(untouched.status).toBe("running");
      expect(untouched.lease?.owner).toBe("crashed-process");
    });

    it("parks a task whose stored phase no longer exists", async () => {
      const ehrWrite = writeOnce(() => {});
      const handle = await openProcess({ownerId: "fresh", registry: [ehrWrite]});
      const created = await handle.harness.createTask(ehrWrite as never, {});
      await abandonRunning(created._id, "removedPhase");

      await handle.harness.start();
      await waitUntil(async () => (await findTask(created._id)).status === "interrupted", "parked");
      const [span] = await phaseSpans(await findTask(created._id));
      expect(span).toEqual({
        error:
          "Interrupted: lease of crashed-process expired mid-phase; awaiting resolveInterrupted (replay: never)",
        name: "removedPhase",
        output: {
          interrupted: true,
          leaseOwner: "crashed-process",
          replay: "never",
          status: "interrupted",
        },
        status: "error",
      });
    });
  });

  describe("resolveInterrupted", () => {
    const parkWrite = async (
      onWrite: () => void = () => {}
    ): Promise<{created: HarnessTaskDocument; handle: ProcessHandle}> => {
      const ehrWrite = writeOnce(onWrite);
      const handle = await openProcess({ownerId: "operator-process", registry: [ehrWrite]});
      const created = await handle.harness.createTask(ehrWrite as never, {});
      await abandonRunning(created._id);
      await handle.harness.start();
      await waitUntil(async () => (await findTask(created._id)).status === "interrupted", "parked");
      return {created, handle};
    };

    const resolutionSpan = async (
      task: HarnessTaskDocument
    ): Promise<{output?: unknown; status: string}> => {
      const span = await SpanModel.findExactlyOne({
        name: "resolveInterrupted",
        traceId: task.traceId,
      });
      return {output: span.output, status: span.status};
    };

    it("retry re-runs the same phase to completion and audits the decision", async () => {
      let writes = 0;
      const {created, handle} = await parkWrite(() => {
        writes += 1;
      });
      const operator = new mongoose.Types.ObjectId();

      const resolved = await handle.harness.resolveInterrupted(created._id, {
        action: "retry",
        reason: "Confirmed in the EHR that no note was filed",
        userId: operator,
      });
      expect(resolved.status).toBe("pending");
      expect(resolved.phase).toBe("write");

      const done = await handle.harness.waitForTask(created._id, {timeout: {seconds: 5}});
      expect(done.status).toBe("completed");
      expect(writes).toBe(1);
      expect(await resolutionSpan(done)).toEqual({
        output: {
          action: "retry",
          decidedBy: String(operator),
          phase: "write",
          reason: "Confirmed in the EHR that no note was filed",
        },
        status: "ok",
      });
    });

    it("abort ends the task aborted and closes the trace as an error", async () => {
      let writes = 0;
      const {created, handle} = await parkWrite(() => {
        writes += 1;
      });

      const done = await handle.harness.resolveInterrupted(String(created._id), {
        action: "abort",
        reason: "Duplicate intake",
      });
      await pause(LEASE_MS);

      expect(done.status).toBe("aborted");
      expect(done.toObject().outcome).toEqual({
        error: "Aborted after interruption: Duplicate intake",
        status: "aborted",
      });
      expect((await findTask(created._id)).status).toBe("aborted");
      expect(writes).toBe(0);
      expect(await resolutionSpan(done)).toEqual({
        output: {
          abortHandler: {status: "none"},
          action: "abort",
          phase: "write",
          reason: "Duplicate intake",
        },
        status: "ok",
      });
      const trace = await TraceModel.findExactlyOne({_id: done.traceId});
      expect(trace.status).toBe("error");
      expect(trace.errorSummary).toBe("Aborted after interruption: Duplicate intake");
      expect(trace.endedAt).toBeInstanceOf(Date);
      const root = await SpanModel.findExactlyOne({_id: done.rootSpanId});
      expect(root.status).toBe("error");
    });

    it("complete ends the task completed with the operator's result", async () => {
      const {created, handle} = await parkWrite();
      const operator = new mongoose.Types.ObjectId();

      const done = await handle.harness.resolveInterrupted(created._id, {
        action: "complete",
        reason: "Note was filed before the crash",
        result: {status: "filed"},
        userId: String(operator),
      });

      expect(done.status).toBe("completed");
      expect(done.outcome?.result).toEqual({status: "filed"});
      expect(await resolutionSpan(done)).toEqual({
        output: {
          action: "complete",
          decidedBy: String(operator),
          phase: "write",
          reason: "Note was filed before the crash",
          result: {status: "filed"},
        },
        status: "ok",
      });
      const trace = await TraceModel.findExactlyOne({_id: done.traceId});
      expect(trace.status).toBe("ok");
      expect(trace.output).toEqual({status: "filed"});
    });

    it("complete without a result closes the trace ok with no output", async () => {
      const {created, handle} = await parkWrite();

      const done = await handle.harness.resolveInterrupted(created._id, {
        action: "complete",
        reason: "Handled outside the harness",
      });

      expect(done.status).toBe("completed");
      expect(done.outcome?.result).toBeUndefined();
      const trace = await TraceModel.findExactlyOne({_id: done.traceId});
      expect(trace.status).toBe("ok");
      expect(trace.endedAt).toBeInstanceOf(Date);
    });

    it("lets only one of two concurrent resolutions win", async () => {
      const {created, handle} = await parkWrite();

      const results = await Promise.allSettled([
        handle.harness.resolveInterrupted(created._id, {action: "abort", reason: "first"}),
        handle.harness.resolveInterrupted(created._id, {action: "complete", reason: "second"}),
      ]);

      const winners = results.filter((result) => result.status === "fulfilled");
      const losers = results.filter((result) => result.status === "rejected");
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
      // The loser either saw the winner's status or lost the fenced commit.
      const loserError = (losers[0] as PromiseRejectedResult).reason as Error;
      expect(
        loserError instanceof HarnessCommitConflictError ||
          loserError.message.endsWith("not interrupted")
      ).toBe(true);
      const winner = (winners[0] as PromiseFulfilledResult<HarnessTaskDocument>).value;
      expect((await findTask(created._id)).status).toBe(winner.status);
      expect(["aborted", "completed"]).toContain(winner.status);
      expect(await SpanModel.countDocuments({name: "resolveInterrupted"})).toBe(1);
    });

    it("rejects a task that is not interrupted, a blank reason, and an unknown action", async () => {
      const {created, handle} = await parkWrite();
      const running = await handle.harness.createTask(writeOnce(() => {}) as never, {});
      await handle.harness.waitForTask(running._id, {timeout: {seconds: 5}});

      await expect(
        handle.harness.resolveInterrupted(running._id, {action: "retry", reason: "nope"})
      ).rejects.toThrow(`Task ${running._id} is completed, not interrupted`);
      await expect(
        handle.harness.resolveInterrupted(created._id, {action: "retry", reason: "  "})
      ).rejects.toThrow("resolveInterrupted requires a reason");
      await expect(
        handle.harness.resolveInterrupted(created._id, {
          action: "replay" as never,
          reason: "typo",
        })
      ).rejects.toThrow("resolveInterrupted action must be one of abort, complete, retry");
      expect((await findTask(created._id)).status).toBe("interrupted");
      expect(await SpanModel.countDocuments({name: "resolveInterrupted"})).toBe(0);
    });
  });

  describe("owner lease", () => {
    it("never lets two live harnesses run tasks at the same time", async () => {
      const activeByTask = new Map<string, number>();
      let maxConcurrent = 0;
      let active = 0;
      const ranBy: string[] = [];
      const counted = defineTask<unknown, unknown, unknown>({
        initial: () => ({phase: "work"}),
        name: "test.counted",
        phases: {
          work: {
            replay: "safe",
            run: async (task, rt) => {
              active += 1;
              activeByTask.set(task.id, (activeByTask.get(task.id) ?? 0) + 1);
              maxConcurrent = Math.max(maxConcurrent, active);
              ranBy.push(String((await TaskModel.findExactlyOne({_id: task.id})).lease?.owner));
              await pause(15);
              active -= 1;
              await rt.commit({terminal: {status: "completed"}});
            },
          },
        },
        version: 1,
      });
      // A long lease keeps ownership stable even when the test machine stalls.
      const a = await openProcess({
        leaseMs: 5000,
        ownerId: "process-a",
        registry: [counted as never],
      });
      const b = await openProcess({
        leaseMs: 5000,
        ownerId: "process-b",
        registry: [counted as never],
      });
      await Promise.all([a.harness.start(), b.harness.start()]);

      const created = await Promise.all(
        [1, 2, 3, 4, 5, 6].map((n) => (n % 2 === 0 ? a : b).harness.createTask(counted, {n}))
      );
      await Promise.all(
        created.map((task) => a.harness.waitForTask(task._id, {timeout: {seconds: 5}}))
      );

      expect(maxConcurrent).toBe(1);
      expect([...activeByTask.values()]).toEqual([1, 1, 1, 1, 1, 1]);
      expect(new Set(ranBy).size).toBe(1);
      expect([a.runner.role, b.runner.role].sort()).toEqual(["owner", "standby"]);
    });

    it("hands ownership to the standby immediately when the owner stops", async () => {
      const ehrWrite = writeOnce(() => {});
      // A lease far longer than the test: only the release on stop() lets b take over.
      const a = await openProcess({leaseMs: 60_000, ownerId: "process-a", registry: [ehrWrite]});
      const b = await openProcess({leaseMs: 60_000, ownerId: "process-b", registry: [ehrWrite]});
      await a.harness.start();
      await waitUntil(() => a.runner.role === "owner", "a owns");
      await b.harness.start();
      await pause(HEARTBEAT_MS * 2);
      expect(b.runner.role).toBe("standby");

      await a.harness.stop();
      const created = await b.harness.createTask(ehrWrite as never, {});
      const done = await b.harness.waitForTask(created._id, {timeout: {seconds: 5}});

      expect(done.status).toBe("completed");
      expect(b.runner.role).toBe("owner");
      const owner = await OwnerModel.findExactlyOne({key: "default"});
      expect(owner.owner).toBe("process-b");
    });
  });
});
