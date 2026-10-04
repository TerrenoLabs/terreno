import {afterEach, beforeAll, beforeEach, describe, expect, it} from "bun:test";
import {existsSync, readFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {getJobsService, Job, JobsApp, unregisterJobsService} from "@terreno/jobs";
import express from "express";
import {Duration} from "luxon";
import type mongoose from "mongoose";

import {createLocalObservabilityPlugin} from "../../observability/local/localPlugin";
import {registerObsSpan} from "../../observability/local/models/obsSpan";
import {registerObsTrace} from "../../observability/local/models/obsTrace";
import {harnessErrorMatching} from "../../tests/harnessErrors";
import type {HarnessRunnerContext, HarnessTaskDocument} from "../../types/harness";
import type {ObsSpanModel, ObsTraceModel} from "../../types/observability";
import {
  type AnyHarnessTaskDefinition,
  defineTask,
  Harness,
  HarnessCommitConflictError,
} from "../harness";
import {registerHarnessTask} from "../models/harnessTask";
import {claimTaskById, listRunnableTasks} from "../runtime";
import {HARNESS_PHASE_JOB_NAME, JobsRunner} from "./jobsRunner";

/** Roomy default so a stalled machine cannot trigger recovery in tests that count claims. */
const LEASE_MS = 5000;
/** Short lease for the tests that let a lease lapse on purpose. */
const SHORT_LEASE_MS = 400;
const HEARTBEAT_MS = 50;

const TaskModel = registerHarnessTask();
let SpanModel: ObsSpanModel;
let TraceModel: ObsTraceModel;

interface Gate {
  promise: Promise<void>;
  release: () => void;
}

const gate = (): Gate => {
  let release: () => void = () => {};
  const promise = new Promise<void>((done) => {
    release = done;
  });
  return {promise, release};
};

const pause = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

const waitUntil = async (
  predicate: () => Promise<boolean> | boolean,
  label: string
): Promise<void> => {
  for (let i = 0; i < 500; i++) {
    if (await predicate()) {
      return;
    }
    await pause(10);
  }
  throw new Error(`waitUntil timed out: ${label}`);
};

interface Worker {
  /** Freeze every task lease renewal, as if the process stopped running. */
  die: () => void;
  harness: Harness;
  jobsApp: JobsApp;
  runner: JobsRunner;
}

const liveWorkers: Worker[] = [];
const hungGates: Gate[] = [];

/** One simulated instance: its own JobsApp worker, JobsRunner, and Harness on the shared DB. */
const openWorker = async ({
  leaseMs = LEASE_MS,
  ownerId,
  registry,
}: {
  leaseMs?: number;
  ownerId: string;
  registry: ReadonlyArray<AnyHarnessTaskDefinition>;
}): Promise<Worker> => {
  let isDead = false;
  const jobsApp = new JobsApp({pollIntervalMs: 10});
  const runner = new JobsRunner({
    heartbeatInterval: {milliseconds: HEARTBEAT_MS},
    jobs: jobsApp,
    leaseDuration: {milliseconds: leaseMs},
    ownerId,
    pollInterval: {milliseconds: 20},
  });
  jobsApp.register(express());
  const harness = await Harness.open({
    registry,
    runner,
    testHooks: {isHeartbeatSuspended: () => isDead},
  });
  const worker = {
    die: () => {
      isDead = true;
    },
    harness,
    jobsApp,
    runner,
  };
  liveWorkers.push(worker);
  await harness.start();
  await jobsApp.startWorker();
  return worker;
};

const phaseJobKeys = async (taskId: mongoose.Types.ObjectId): Promise<string[]> => {
  const jobs = await Job.find({
    name: HARNESS_PHASE_JOB_NAME,
    "payload.taskId": String(taskId),
  }).sort({created: 1});
  return jobs.map((job) => String(job.idempotencyKey));
};

const okPhaseSpans = async (task: HarnessTaskDocument): Promise<string[]> => {
  const spans = await SpanModel.find({
    _id: {$ne: task.rootSpanId},
    status: "ok",
    traceId: task.traceId,
  }).sort({_id: 1});
  return spans.map((span) => span.name);
};

const twoPhase = ({
  name,
  onFetch,
}: {
  name: string;
  onFetch: (rt: {owner: () => Promise<string>}) => Promise<void> | void;
}): AnyHarnessTaskDefinition =>
  defineTask<{patientId: string}, {chart?: string}, {status: string}>({
    initial: () => ({phase: "fetch", state: {}}),
    name,
    phases: {
      fetch: {
        replay: "safe",
        run: async (task, rt) => {
          await onFetch({
            owner: async () =>
              String((await TaskModel.findExactlyOne({_id: task.id})).lease?.owner),
          });
          await rt.commit({phase: "finish", state: {chart: `chart-${task.input.patientId}`}});
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
  }) as unknown as AnyHarnessTaskDefinition;

describe("JobsRunner", () => {
  beforeAll(() => {
    createLocalObservabilityPlugin();
    SpanModel = registerObsSpan();
    TraceModel = registerObsTrace();
  });

  beforeEach(async () => {
    await Promise.all([
      Job.deleteMany({}),
      TaskModel.deleteMany({}),
      SpanModel.deleteMany({}),
      TraceModel.deleteMany({}),
    ]);
  });

  afterEach(async () => {
    for (const hung of hungGates.splice(0)) {
      hung.release();
    }
    for (const worker of liveWorkers.splice(0)) {
      await worker.jobsApp.stopWorker();
      await worker.harness.stop();
    }
    unregisterJobsService();
  });

  it("runs each phase as its own terreno.harness.phase job to completion", async () => {
    const definition = twoPhase({name: "test.jobsTwoPhase", onFetch: () => {}});
    const worker = await openWorker({ownerId: "worker-1", registry: [definition]});

    const created = await worker.harness.createTask(definition as never, {patientId: "p1"});
    const done = await worker.harness.waitForTask(created._id, {timeout: {seconds: 5}});

    expect(done.status).toBe("completed");
    expect(done.outcome?.result).toEqual({status: "filed chart-p1"});
    expect(done.claims).toBe(2);
    // One job per runnable visit: `taskId:phase:attempt:claims`.
    expect(await phaseJobKeys(created._id)).toEqual([
      `${created._id}:fetch:0:0`,
      `${created._id}:finish:0:1`,
    ]);
    expect(await okPhaseSpans(done)).toEqual(["fetch", "finish"]);
  });

  it("lets a second job for a phase already running claim nothing, so the phase commits once", async () => {
    const hung = gate();
    hungGates.push(hung);
    const started = gate();
    let fetchRuns = 0;
    const definition = twoPhase({
      name: "test.jobsRace",
      onFetch: async () => {
        fetchRuns += 1;
        started.release();
        await hung.promise;
      },
    });
    const first = await openWorker({ownerId: "worker-1", registry: [definition]});
    const second = await openWorker({ownerId: "worker-2", registry: [definition]});

    const created = await first.harness.createTask(definition as never, {patientId: "p2"});
    await started.promise;
    // Both workers race the same phase: a second job for the visit, as a re-dispatch makes.
    await getJobsService().enqueue({
      idempotencyKey: `${created._id}:fetch:0:0:duplicate`,
      name: HARNESS_PHASE_JOB_NAME,
      payload: {taskId: String(created._id)},
    });
    await waitUntil(
      async () =>
        (await Job.countDocuments({
          idempotencyKey: `${created._id}:fetch:0:0:duplicate`,
          status: "completed",
        })) === 1,
      "duplicate job finished without claiming"
    );
    hung.release();

    const done = await second.harness.waitForTask(created._id, {timeout: {seconds: 5}});
    expect(done.status).toBe("completed");
    expect(fetchRuns).toBe(1);
    expect(await okPhaseSpans(done)).toEqual(["fetch", "finish"]);
  });

  it("rejects a stale lease holder's commit after another worker recovers the phase", async () => {
    const hung = gate();
    hungGates.push(hung);
    const owners: string[] = [];
    let zombieError: unknown;
    let fetchRuns = 0;
    const definition = defineTask<{patientId: string}, {chart?: string}, {status: string}>({
      initial: () => ({phase: "fetch", state: {}}),
      name: "test.jobsStale",
      phases: {
        fetch: {
          replay: "safe",
          run: async (task, rt) => {
            fetchRuns += 1;
            const run = fetchRuns;
            owners.push(String((await TaskModel.findExactlyOne({_id: task.id})).lease?.owner));
            if (run === 1) {
              await hung.promise;
              try {
                await rt.commit({phase: "finish", state: {chart: "from-the-dead-worker"}});
              } catch (error: unknown) {
                zombieError = error;
                throw error;
              }
              return;
            }
            await rt.commit({phase: "finish", state: {chart: `chart-${task.input.patientId}`}});
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
    }) as unknown as AnyHarnessTaskDefinition;
    const first = await openWorker({
      leaseMs: SHORT_LEASE_MS,
      ownerId: "worker-1",
      registry: [definition],
    });
    const created = await first.harness.createTask(definition as never, {patientId: "p3"});
    await waitUntil(() => fetchRuns === 1, "worker-1 started fetch");
    first.die();

    const second = await openWorker({
      leaseMs: SHORT_LEASE_MS,
      ownerId: "worker-2",
      registry: [definition],
    });
    const done = await second.harness.waitForTask(created._id, {timeout: {seconds: 5}});
    expect(done.status).toBe("completed");
    expect(done.state).toEqual({chart: "chart-p3"});

    hung.release();
    await waitUntil(() => zombieError !== undefined, "stale commit settled");
    expect(zombieError).toBeInstanceOf(HarnessCommitConflictError);
    expect(owners.slice(0, 2)).toEqual(["worker-1", expect.stringMatching(/^worker-[12]$/)]);
    const after = await TaskModel.findExactlyOne({_id: created._id});
    expect(after.state).toEqual({chart: "chart-p3"});
    expect(await okPhaseSpans(after)).toEqual(["fetch", "finish"]);
    // The recovered visit got its own job key, so it was not deduplicated away.
    expect(await phaseJobKeys(created._id)).toContain(`${created._id}:fetch:0:1`);
  });

  it("re-dispatches past a chain of jobs that all ended without claiming the task", async () => {
    const definition = twoPhase({name: "test.jobsRedispatch", onFetch: () => {}});
    const jobsApp = new JobsApp();
    jobsApp.define(HARNESS_PHASE_JOB_NAME, {handler: async () => {}});
    jobsApp.register(express());
    const created = await (
      await Harness.open({registry: [definition], runner: new JobsRunner({jobs: new JobsApp()})})
    ).createTask(definition as never, {patientId: "p4"});
    // Six jobs for the first visit already ended unclaimed, e.g. on old instances mid-deploy.
    const baseKey = `${created._id}:fetch:0:0`;
    const chain: string[] = [];
    let key = baseKey;
    for (let i = 0; i < 6; i++) {
      const ended = await getJobsService().enqueue({
        idempotencyKey: key,
        name: HARNESS_PHASE_JOB_NAME,
        payload: {taskId: String(created._id)},
      });
      await Job.updateOne({_id: ended._id}, {$set: {status: i % 2 === 0 ? "dead" : "completed"}});
      chain.push(key);
      key = `${baseKey}:${ended._id}`;
    }
    unregisterJobsService();

    const worker = await openWorker({ownerId: "worker-1", registry: [definition]});
    const done = await worker.harness.waitForTask(created._id, {timeout: {seconds: 5}});

    expect(done.status).toBe("completed");
    expect((await phaseJobKeys(created._id)).slice(0, 7)).toEqual([...chain, key]);
  });

  it("dispatches a fresh job when an event wakes a task back into the same phase", async () => {
    const waits: unknown[] = [];
    const definition = defineTask<unknown, Record<string, never>, {status: string}>({
      initial: () => ({phase: "review", state: {}}),
      name: "test.jobsEventWake",
      phases: {
        review: {
          run: async (_task, rt) => {
            waits.push(await rt.waitFor("signed"));
            await rt.commit({terminal: {result: {status: "signed"}, status: "completed"}});
          },
        },
      },
      version: 1,
    }) as unknown as AnyHarnessTaskDefinition;
    const worker = await openWorker({ownerId: "worker-1", registry: [definition]});
    const created = await worker.harness.createTask(definition as never, {});
    await waitUntil(
      async () => (await TaskModel.findExactlyOne({_id: created._id})).status === "waiting",
      "task waits for the event"
    );

    await worker.harness.sendEvent(created._id, "signed", {by: "clinician"});
    const done = await worker.harness.waitForTask(created._id, {timeout: {seconds: 5}});

    expect(done.status).toBe("completed");
    expect(waits).toEqual([{by: "clinician"}]);
    // Same phase and attempt both times; only `claims` tells the two visits apart.
    expect(await phaseJobKeys(created._id)).toEqual([
      `${created._id}:review:0:0`,
      `${created._id}:review:0:1`,
    ]);
  });

  it("ends a task aborted mid-phase as aborted instead of handing it back", async () => {
    const hung = gate();
    hungGates.push(hung);
    const started = gate();
    const definition = twoPhase({
      name: "test.jobsAbort",
      onFetch: async () => {
        started.release();
        await hung.promise;
      },
    });
    const worker = await openWorker({ownerId: "worker-1", registry: [definition]});
    const created = await worker.harness.createTask(definition as never, {patientId: "p6"});
    await started.promise;

    const abortion = worker.harness.abort(created._id, {reason: "patient withdrew"});
    hung.release();
    await abortion;
    const done = await worker.harness.waitForTask(created._id, {timeout: {seconds: 5}});

    expect(done.status).toBe("aborted");
    expect(done.lease?.token).toBeUndefined();
    // Whether fetch committed before the abort landed or not, the task never ran on.
    const spans = await okPhaseSpans(done);
    expect(spans).not.toContain("finish");
    expect(spans.at(-1)).toBe("abort");
  });

  it("leaves a task whose lease moved on during the phase instead of handing it back", async () => {
    const definition = twoPhase({name: "test.jobsLostHandoff", onFetch: () => {}});
    const stolen = defineTask<{patientId: string}, Record<string, never>, {status: string}>({
      initial: () => ({phase: "fetch", state: {}}),
      name: "test.jobsStolen",
      phases: {
        fetch: {
          run: async (task, rt) => {
            await rt.commit({phase: "finish"});
            // Another runner takes the lease after the commit, before the hand-off.
            await TaskModel.updateOne({_id: task.id}, {$set: {"lease.token": "stolen"}});
          },
        },
        finish: {run: async (_task, rt) => rt.commit({terminal: {status: "completed"}})},
      },
      version: 1,
    }) as unknown as AnyHarnessTaskDefinition;
    const worker = await openWorker({ownerId: "worker-1", registry: [definition, stolen]});

    const created = await worker.harness.createTask(stolen as never, {patientId: "p5"});
    await waitUntil(
      async () =>
        (await Job.countDocuments({
          idempotencyKey: `${created._id}:fetch:0:0`,
          status: "completed",
        })) === 1,
      "fetch job finished"
    );
    // Stop before asserting so recovery cannot park the stolen task meanwhile.
    await worker.jobsApp.stopWorker();
    await worker.harness.stop();

    const task = await TaskModel.findExactlyOne({_id: created._id});
    expect(task.status).toBe("running");
    expect(task.phase).toBe("finish");
    expect(task.lease?.token).toBe("stolen");
  });

  it("claims nothing for an unknown id and lists nothing without definitions", async () => {
    const definition = twoPhase({name: "test.jobsNoClaim", onFetch: () => {}});
    const definitions = new Map([["test.jobsNoClaim@1", definition as never]]);
    const lease = {
      duration: Duration.fromObject({seconds: 30}),
      heartbeat: Duration.fromObject({seconds: 10}),
      owner: "worker-1",
    };
    const models = {task: TaskModel} as never;

    expect(await claimTaskById({definitions, lease, models, taskId: "not-an-id"})).toBeNull();
    expect(await claimTaskById({definitions: new Map(), lease, models, taskId: "x"})).toBeNull();
    expect(await listRunnableTasks({definitions: new Map(), limit: 10, models})).toEqual([]);
  });

  describe("phase job handler", () => {
    const fakeContext = (overrides: Partial<HarnessRunnerContext>): HarnessRunnerContext => ({
      acquireOwnerLease: async () => true,
      claimNext: async () => null,
      claimTask: async () => null,
      listRunnable: async () => [],
      recoverExpired: async () => 0,
      releaseOwnerLease: async () => {},
      runTask: async () => {},
      ...overrides,
    });

    const phaseHandler = (jobsApp: JobsApp): ((payload: unknown) => Promise<void>) => {
      const definition = jobsApp.getDefinition(HARNESS_PHASE_JOB_NAME);
      if (!definition) {
        throw new Error("phase job not defined");
      }
      return (payload) =>
        definition.handler(payload, {
          jobId: "job",
          log: undefined as never,
          signal: new AbortController().signal,
        });
    };

    it("rejects a payload without a taskId", async () => {
      const jobsApp = new JobsApp();
      new JobsRunner({jobs: jobsApp});

      await expect(phaseHandler(jobsApp)({})).rejects.toThrow(
        harnessErrorMatching(
          "invalidRequest",
          "terreno.harness.phase payload needs a taskId string"
        )
      );
    });

    it("fails the job so it retries while the runner is stopped", async () => {
      const jobsApp = new JobsApp();
      new JobsRunner({jobs: jobsApp});

      await expect(phaseHandler(jobsApp)({taskId: "abc"})).rejects.toThrow(
        harnessErrorMatching("runnerStopped", "JobsRunner is not running; task abc stays runnable")
      );
    });

    it("runs one phase of a claimed task and skips a task another worker claimed", async () => {
      const jobsApp = new JobsApp();
      jobsApp.register(express());
      const runner = new JobsRunner({jobs: jobsApp, pollInterval: {minutes: 10}});
      const runs: Array<{maxPhases?: number; taskId: string}> = [];
      await runner.start(
        fakeContext({
          claimTask: async (taskId) =>
            taskId === "free" ? ({_id: taskId} as unknown as HarnessTaskDocument) : null,
          runTask: async (task, _lease, options) => {
            runs.push({maxPhases: options?.maxPhases, taskId: String(task._id)});
          },
        })
      );

      await phaseHandler(jobsApp)({taskId: "taken"});
      await phaseHandler(jobsApp)({taskId: "free"});
      await runner.stop();

      expect(runs).toEqual([{maxPhases: 1, taskId: "free"}]);
    });

    it("waits for a claim in flight before stop resolves", async () => {
      const jobsApp = new JobsApp();
      jobsApp.register(express());
      const runner = new JobsRunner({jobs: jobsApp, pollInterval: {minutes: 10}});
      const claimHeld = gate();
      let isClaimDone = false;
      await runner.start(
        fakeContext({
          claimTask: async () => {
            await claimHeld.promise;
            isClaimDone = true;
            return null;
          },
        })
      );
      const job = phaseHandler(jobsApp)({taskId: "claiming"});
      await pause(10);

      const stopped = runner.stop();
      await pause(20);
      expect(isClaimDone).toBe(false);
      claimHeld.release();
      await stopped;
      await job;

      expect(isClaimDone).toBe(true);
    });

    it("waits for a phase in flight before stop resolves", async () => {
      const jobsApp = new JobsApp();
      jobsApp.register(express());
      const runner = new JobsRunner({jobs: jobsApp, pollInterval: {minutes: 10}});
      const held = gate();
      let isPhaseDone = false;
      await runner.start(
        fakeContext({
          claimTask: async (taskId) => ({_id: taskId}) as unknown as HarnessTaskDocument,
          runTask: async () => {
            await held.promise;
            isPhaseDone = true;
          },
        })
      );
      const job = phaseHandler(jobsApp)({taskId: "slow"});
      await pause(10);

      const stopped = runner.stop();
      await pause(20);
      expect(isPhaseDone).toBe(false);
      held.release();
      await stopped;
      await job;

      expect(isPhaseDone).toBe(true);
    });
  });

  it("keeps dispatching after a scan error", async () => {
    const jobsApp = new JobsApp();
    jobsApp.register(express());
    const runner = new JobsRunner({jobs: jobsApp, pollInterval: {milliseconds: 5}});
    let scans = 0;
    await runner.start({
      acquireOwnerLease: async () => true,
      claimNext: async () => null,
      claimTask: async () => null,
      listRunnable: async () => {
        scans += 1;
        if (scans === 1) {
          throw new Error("primary stepped down");
        }
        return [];
      },
      recoverExpired: async () => 0,
      releaseOwnerLease: async () => {},
      runTask: async () => {},
    });
    await waitUntil(() => scans >= 3, "dispatcher scanned again");
    await runner.stop();
    expect(scans).toBeGreaterThanOrEqual(3);
  });

  it("rejects a heartbeat that is not shorter than the lease and a second start", async () => {
    expect(
      () =>
        new JobsRunner({
          heartbeatInterval: {seconds: 30},
          jobs: new JobsApp(),
          leaseDuration: {seconds: 30},
        })
    ).toThrow(
      harnessErrorMatching(
        "configInvalid",
        "JobsRunner heartbeatInterval must be positive and shorter than leaseDuration"
      )
    );

    const runner = new JobsRunner({jobs: new JobsApp(), ownerId: "worker-x"});
    expect(runner.ownerId).toBe("worker-x");
    const registered = new JobsApp();
    registered.register(express());
    const context = {
      acquireOwnerLease: async () => true,
      claimNext: async () => null,
      claimTask: async () => null,
      listRunnable: async () => [],
      recoverExpired: async () => 0,
      releaseOwnerLease: async () => {},
      runTask: async () => {},
    };
    await runner.start(context);
    await expect(runner.start(context)).rejects.toThrow(
      harnessErrorMatching("alreadyStarted", "JobsRunner is already started")
    );
    await runner.stop();
    await runner.stop();
  });

  it("refuses to start before a JobsApp is registered", async () => {
    const runner = new JobsRunner({jobs: new JobsApp()});

    await expect(
      runner.start({
        acquireOwnerLease: async () => true,
        claimNext: async () => null,
        claimTask: async () => null,
        listRunnable: async () => [],
        recoverExpired: async () => 0,
        releaseOwnerLease: async () => {},
        runTask: async () => {},
      })
    ).rejects.toThrow(
      harnessErrorMatching(
        "configInvalid",
        "JobsRunner needs a registered JobsApp: register it and build the app before harness.start()"
      )
    );
  });

  it("is not reachable from the root @terreno/ai or @terreno/ai/harness imports", () => {
    const srcRoot = resolve(import.meta.dir, "../..");
    const seen = new Set<string>();
    const importsJobs: string[] = [];
    const visit = (file: string): void => {
      if (seen.has(file)) {
        return;
      }
      seen.add(file);
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/(?:from|import)\s*\(?\s*"([^"]+)"/g)) {
        const specifier = match[1];
        if (specifier.startsWith("@terreno/jobs")) {
          importsJobs.push(file);
        }
        if (specifier.startsWith(".")) {
          const base = resolve(dirname(file), specifier.replace(/\.js$/, ""));
          const candidates = [`${base}.ts`, `${base}.tsx`, resolve(base, "index.ts")];
          const target = candidates.find((candidate) => existsSync(candidate));
          if (target) {
            visit(target);
          }
        }
      }
    };
    visit(resolve(srcRoot, "index.ts"));
    visit(resolve(srcRoot, "harness/harness.ts"));

    expect(seen.size).toBeGreaterThan(20);
    expect(importsJobs).toEqual([]);
  });
});
