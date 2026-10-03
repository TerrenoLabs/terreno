import {afterEach, beforeAll, beforeEach, describe, expect, it, setDefaultTimeout} from "bun:test";
import mongoose from "mongoose";

import {createLocalObservabilityPlugin} from "../observability/local/localPlugin";
import {registerObsSpan} from "../observability/local/models/obsSpan";
import {registerObsTrace} from "../observability/local/models/obsTrace";
import type {HarnessChildOutcome, HarnessTaskDocument, HarnessTestHooks} from "../types/harness";
import type {ObsSpanModel, ObsTraceModel} from "../types/observability";
import type {HarnessModels} from "./commit";
import {
  type AnyHarnessTaskDefinition,
  defineTask,
  Harness,
  HarnessCommitConflictError,
  InProcessRunner,
} from "./harness";
import {registerHarnessEvent, registerHarnessEventStream} from "./models/harnessEvent";
import {registerHarnessOwner} from "./models/harnessOwner";
import {registerHarnessTask} from "./models/harnessTask";
import {type HarnessEngine, sweepWaitingTasks} from "./ownership";

// Multi-task trees under a loaded full run need more than Bun's 5s default.
setDefaultTimeout(30_000);

const TaskModel = registerHarnessTask();
const OwnerModel = registerHarnessOwner();
let SpanModel: ObsSpanModel;
let TraceModel: ObsTraceModel;
const openHarnesses: Harness[] = [];

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const waitUntil = async (predicate: () => Promise<boolean>, label: string): Promise<void> => {
  for (let i = 0; i < 300; i++) {
    if (await predicate()) {
      return;
    }
    await pause(10);
  }
  throw new Error(`waitUntil timed out: ${label}`);
};

const openHarness = async (
  registry: ReadonlyArray<AnyHarnessTaskDefinition>,
  testHooks?: HarnessTestHooks
): Promise<Harness> => {
  const harness = await Harness.open({
    registry,
    runner: new InProcessRunner({pollInterval: {milliseconds: 20}}),
    testHooks,
  });
  openHarnesses.push(harness);
  return harness;
};

const findTask = (id: mongoose.Types.ObjectId | string): Promise<HarnessTaskDocument> =>
  TaskModel.findExactlyOne({_id: id});

const childrenOf = (id: mongoose.Types.ObjectId): Promise<HarnessTaskDocument[]> =>
  TaskModel.find({"ownership.id": id, "ownership.kind": "task"}).sort({created: 1});

const asAny = (definition: unknown): AnyHarnessTaskDefinition =>
  definition as AnyHarnessTaskDefinition;

const completesWith = (name: string, result: unknown): AnyHarnessTaskDefinition =>
  asAny(
    defineTask<unknown, unknown, unknown>({
      initial: () => ({phase: "work"}),
      name,
      phases: {
        work: {run: async (_task, rt) => rt.commit({terminal: {result, status: "completed"}})},
      },
      version: 1,
    })
  );

const failsWith = (name: string, error: string): AnyHarnessTaskDefinition =>
  asAny(
    defineTask<unknown, unknown, unknown>({
      initial: () => ({phase: "work"}),
      name,
      phases: {
        work: {
          run: async () => {
            throw new Error(error);
          },
        },
      },
      retry: {maxAttempts: 1},
      version: 1,
    })
  );

/**
 * A parent that creates `children` (by definition) in one phase and waits on them with
 * `policy`, completing with the outcomes.
 */
const fanOut = ({
  children,
  name,
  policy,
  runs,
}: {
  children: AnyHarnessTaskDefinition[];
  name: string;
  policy?: "all" | "failFast";
  runs: {count: number};
}): AnyHarnessTaskDefinition =>
  asAny(
    defineTask<unknown, unknown, HarnessChildOutcome[]>({
      initial: () => ({phase: "fanOut"}),
      name,
      phases: {
        fanOut: {
          run: async (_task, rt) => {
            runs.count += 1;
            const ids: string[] = [];
            for (const child of children) {
              ids.push(await rt.createTask(child, {from: name}));
            }
            const outcomes = await rt.waitForTasks(ids, {policy});
            await rt.commit({terminal: {result: outcomes, status: "completed"}});
          },
        },
      },
      version: 1,
    })
  );

describe("Harness ownership tree", () => {
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
      OwnerModel.deleteMany({}),
    ]);
  });

  afterEach(async () => {
    await Promise.all(openHarnesses.splice(0).map((harness) => harness.stop()));
  });

  describe("rt.createTask + rt.waitForTasks", () => {
    it("runs a child in the parent's trace, nests its spans, and hands back its outcome", async () => {
      const child = completesWith("test.child", {summary: "ok"});
      const runs = {count: 0};
      const parent = fanOut({children: [child], name: "test.parent", runs});
      const harness = await openHarness([parent, child]);
      await harness.start();

      const created = await harness.createTask(parent, {}, {userId: new mongoose.Types.ObjectId()});
      const done = await harness.waitForTask(created._id);
      expect(done.status).toBe("completed");

      const [childTask] = await childrenOf(done._id);
      expect(done.outcome?.result).toEqual([
        {
          id: String(childTask._id),
          name: "test.child",
          result: {summary: "ok"},
          status: "completed",
        },
      ]);
      // The phase ran, waited, and re-ran once woken; the second run reused the child.
      expect(runs.count).toBe(2);
      expect(await childrenOf(done._id)).toHaveLength(1);

      expect(childTask.toObject().ownership).toEqual({id: done._id, kind: "task"});
      expect(String(childTask.rootTaskId)).toBe(String(done._id));
      expect(String(childTask.traceId)).toBe(String(done.traceId));
      expect(String(childTask.userId)).toBe(String(done.userId));
      expect(childTask.background).toBe(false);

      const childSpan = await SpanModel.findExactlyOne({_id: childTask.rootSpanId});
      expect(childSpan.name).toBe("test.child@1");
      expect(String(childSpan.parentSpanId)).toBe(String(done.rootSpanId));
      expect(childSpan.status).toBe("ok");
      expect(childSpan.endedAt).toBeInstanceOf(Date);
      const childPhase = await SpanModel.findExactlyOne({name: "work", traceId: done.traceId});
      expect(String(childPhase.parentSpanId)).toBe(String(childTask.rootSpanId));

      // One wait span plus the completing span for the parent's phase.
      const parentPhases = await SpanModel.find({
        name: "fanOut",
        parentSpanId: done.rootSpanId,
      }).sort({_id: 1});
      expect(parentPhases.map((span) => span.output)).toEqual([
        {waiting: {kind: "tasks", policy: "all", taskIds: [String(childTask._id)]}},
        {terminal: {result: done.outcome?.result, status: "completed"}},
      ]);

      // Only the root task closed the shared trace.
      expect(await TraceModel.countDocuments({})).toBe(1);
      const trace = await TraceModel.findExactlyOne({_id: done.traceId});
      expect(trace.output).toEqual(done.outcome?.result);
    });

    it("waits for every child under the default policy, in the order passed", async () => {
      const ok = completesWith("test.okChild", 1);
      const bad = failsWith("test.badChild", "lab system down");
      const runs = {count: 0};
      const parent = fanOut({children: [bad, ok], name: "test.waitAll", runs});
      const harness = await openHarness([parent, ok, bad]);
      await harness.start();

      const done = await harness.waitForTask((await harness.createTask(parent, {}))._id);
      expect(done.status).toBe("completed");
      const outcomes = done.outcome?.result as HarnessChildOutcome[];
      expect(
        outcomes.map(({error, name, result, status}) => ({error, name, result, status}))
      ).toEqual([
        {error: "lab system down", name: "test.badChild", result: undefined, status: "failed"},
        {error: undefined, name: "test.okChild", result: 1, status: "completed"},
      ]);
    });

    it("stores background on the child", async () => {
      const child = completesWith("test.bgChild", null);
      const parent = defineTask<unknown, unknown, unknown>({
        initial: () => ({phase: "spawn"}),
        name: "test.bgParent",
        phases: {
          spawn: {
            run: async (_task, rt) => {
              await rt.createTask(child, {}, {background: true});
              await rt.commit({terminal: {status: "completed"}});
            },
          },
        },
        version: 1,
      });
      const harness = await openHarness([asAny(parent), child]);
      await harness.start();

      const done = await harness.waitForTask((await harness.createTask(parent, {}))._id);
      const [childTask] = await childrenOf(done._id);
      expect(childTask.background).toBe(true);
      expect((await harness.waitForTask(childTask._id)).status).toBe("completed");
    });

    it("rejects children of unregistered definitions and waits on tasks it does not own", async () => {
      const stranger = completesWith("test.stranger", null);
      const unregistered = completesWith("test.unregistered", null);
      const spawnsUnregistered = defineTask<unknown, unknown, unknown>({
        initial: () => ({phase: "spawn"}),
        name: "test.spawnsUnregistered",
        phases: {
          spawn: {
            run: async (_task, rt) => {
              await rt.createTask(unregistered, {});
            },
          },
        },
        retry: {backoffMs: 0, maxAttempts: 3},
        version: 1,
      });
      let strangerId = "";
      const waitsOnStranger = defineTask<unknown, unknown, unknown>({
        initial: () => ({phase: "wait"}),
        name: "test.waitsOnStranger",
        phases: {
          wait: {
            run: async (_task, rt) => {
              await rt.waitForTasks([strangerId]);
            },
          },
        },
        retry: {backoffMs: 0, maxAttempts: 3},
        version: 1,
      });
      const harness = await openHarness([
        asAny(spawnsUnregistered),
        asAny(waitsOnStranger),
        stranger,
      ]);
      strangerId = String((await harness.createTask(stranger, {}))._id);
      await harness.start();

      const spawned = await harness.waitForTask(
        (await harness.createTask(spawnsUnregistered, {}))._id
      );
      expect(spawned.status).toBe("failed");
      expect(spawned.attempt).toBe(0);
      expect(spawned.outcome?.error).toBe("test.unregistered@1 is not in this harness registry");

      const waited = await harness.waitForTask((await harness.createTask(waitsOnStranger, {}))._id);
      expect(waited.status).toBe("failed");
      expect(waited.outcome?.error).toBe(
        "test.waitsOnStranger@1: rt.waitForTasks only waits on tasks this task created with rt.createTask"
      );
    });

    it("refuses to create a child once the parent's lease is gone", async () => {
      const child = completesWith("test.fencedChild", null);
      let createError: unknown;
      const settled = Promise.withResolvers<void>();
      const parent = defineTask<unknown, unknown, unknown>({
        initial: () => ({phase: "spawn"}),
        name: "test.fencedParent",
        phases: {
          spawn: {
            run: async (task, rt) => {
              await TaskModel.updateOne({_id: task.id}, {$set: {"lease.token": "other-runner"}});
              try {
                await rt.createTask(child, {});
              } catch (error: unknown) {
                createError = error;
              }
              settled.resolve();
              throw createError;
            },
          },
        },
        version: 1,
      });
      const harness = await openHarness([asAny(parent), child]);
      await harness.start();
      const created = await harness.createTask(parent, {});
      await settled.promise;
      await harness.stop();

      expect(createError).toBeInstanceOf(HarnessCommitConflictError);
      expect(await childrenOf(created._id)).toHaveLength(0);
      expect(await SpanModel.countDocuments({name: "test.fencedChild@1"})).toBe(0);
    });

    it("writes no waiting state when the parent's lease is gone", async () => {
      const child = completesWith("test.waitFencedChild", null);
      let waitError: unknown;
      const settled = Promise.withResolvers<void>();
      const parent = defineTask<unknown, unknown, unknown>({
        initial: () => ({phase: "spawn"}),
        name: "test.waitFenced",
        phases: {
          spawn: {
            run: async (task, rt) => {
              const id = await rt.createTask(child, {});
              await TaskModel.updateOne({_id: task.id}, {$set: {"lease.token": "other-runner"}});
              try {
                await rt.waitForTasks([id]);
              } catch (error: unknown) {
                waitError = error;
              }
              settled.resolve();
              throw waitError;
            },
          },
        },
        version: 1,
      });
      const harness = await openHarness([asAny(parent), child]);
      await harness.start();
      const created = await harness.createTask(parent, {});
      await settled.promise;
      await harness.stop();

      expect(waitError).toBeInstanceOf(HarnessCommitConflictError);
      const task = await findTask(created._id);
      expect(task.status).toBe("running");
      expect(task.waiting?.kind).toBeUndefined();
      expect(await SpanModel.countDocuments({name: "spawn"})).toBe(0);
    });

    it("wakes itself when a child settles between the check and the waiting commit", async () => {
      const child = completesWith("test.racingChild", null);
      const runs = {count: 0};
      const parent = fanOut({children: [child], name: "test.racingParent", runs});
      let hasRaced = false;
      const harness = await openHarness([parent, child], {
        beforeCommitEnd: async ({phase, taskId}) => {
          if (phase !== "fanOut" || hasRaced) {
            return;
          }
          hasRaced = true;
          // Another process finishes the child while this parent's waiting commit is open.
          await TaskModel.updateOne(
            {"ownership.id": new mongoose.Types.ObjectId(taskId)},
            {$set: {outcome: {result: "raced", status: "completed"}, status: "completed"}}
          );
        },
      });
      await harness.start();

      // Shorter than the owner heartbeat, so only the post-commit re-check can wake it.
      const done = await harness.waitForTask((await harness.createTask(parent, {}))._id, {
        timeout: {seconds: 3},
      });
      expect(hasRaced).toBe(true);
      expect(done.status).toBe("completed");
      expect(runs.count).toBe(2);
    });

    // Retry backoff plus two child runs on a replica set can pass the 5 s default.
    it("creates fresh children on a retry, and reuses them on a wake", async () => {
      let childRuns = 0;
      const flakyChild = defineTask<unknown, unknown, unknown>({
        initial: () => ({phase: "work"}),
        name: "test.flakyChild",
        phases: {
          work: {
            run: async (_task, rt) => {
              childRuns += 1;
              if (childRuns === 1) {
                throw new Error("first child failed");
              }
              await rt.commit({terminal: {result: "second child ok", status: "completed"}});
            },
          },
        },
        retry: {maxAttempts: 1},
        version: 1,
      });
      const parent = defineTask<unknown, unknown, unknown>({
        initial: () => ({phase: "fanOut"}),
        name: "test.retryingParent",
        phases: {
          fanOut: {
            run: async (_task, rt) => {
              const [outcome] = await rt.waitForTasks([await rt.createTask(flakyChild, {})]);
              if (outcome.status !== "completed") {
                throw new Error(`child ${outcome.status}`);
              }
              await rt.commit({terminal: {result: outcome.result, status: "completed"}});
            },
          },
        },
        retry: {backoffMs: 0, maxAttempts: 2},
        version: 1,
      });
      const harness = await openHarness([asAny(parent), asAny(flakyChild)]);
      await harness.start();

      const done = await harness.waitForTask((await harness.createTask(parent, {}))._id);
      expect(done.status).toBe("completed");
      expect(done.outcome?.result).toBe("second child ok");
      const children = await childrenOf(done._id);
      expect(children.map((task) => task.status)).toEqual(["failed", "completed"]);
    }, 20_000);

    it("failFast: the first failed child aborts its in-flight siblings (with their subtrees)", async () => {
      const handlerOrder: string[] = [];
      const grandchildRuns = {count: 0};
      const grandchild = defineTask<unknown, unknown, unknown>({
        abort: async () => {
          handlerOrder.push("grandchild");
        },
        initial: () => ({phase: "work"}),
        name: "test.ffGrandchild",
        phases: {
          work: {
            run: async (_task, rt) => {
              grandchildRuns.count += 1;
              await rt.commit({terminal: {status: "completed"}});
            },
          },
        },
        version: 1,
      });
      // Waits on its own child, so it is in flight (waiting) when its sibling fails.
      const waitingSibling = defineTask<unknown, unknown, unknown>({
        abort: async (task) => {
          const [owned] = await childrenOf(new mongoose.Types.ObjectId(task.id));
          handlerOrder.push(`waitingSibling(grandchild ${owned.status})`);
        },
        initial: () => ({phase: "delegate"}),
        name: "test.ffWaitingSibling",
        phases: {
          delegate: {
            run: async (_task, rt) => {
              const id = await rt.createTask(grandchild, {});
              await rt.waitForTasks([id]);
              await rt.commit({terminal: {status: "completed"}});
            },
          },
        },
        version: 1,
      });
      const pendingSibling = defineTask<unknown, unknown, unknown>({
        abort: async () => {
          handlerOrder.push("pendingSibling");
        },
        initial: () => ({phase: "work"}),
        name: "test.ffPendingSibling",
        phases: {work: {run: async (_task, rt) => rt.commit({terminal: {status: "completed"}})}},
        version: 1,
      });
      const failing = failsWith("test.ffFailing", "allergy check failed");
      const runs = {count: 0};
      const parent = fanOut({
        children: [asAny(waitingSibling), failing, asAny(pendingSibling)],
        name: "test.failFast",
        policy: "failFast",
        runs,
      });
      const harness = await openHarness([
        parent,
        failing,
        asAny(waitingSibling),
        asAny(pendingSibling),
        asAny(grandchild),
      ]);
      await harness.start();

      const done = await harness.waitForTask((await harness.createTask(parent, {}))._id);
      expect(done.status).toBe("completed");
      const outcomes = done.outcome?.result as HarnessChildOutcome[];
      expect(outcomes.map(({name, status}) => ({name, status}))).toEqual([
        {name: "test.ffWaitingSibling", status: "aborted"},
        {name: "test.ffFailing", status: "failed"},
        {name: "test.ffPendingSibling", status: "aborted"},
      ]);
      expect(outcomes[0].error).toMatch(/^Aborted: Sibling task \S+ failed \(failFast wait of /);
      expect(handlerOrder).toEqual([
        "grandchild",
        "waitingSibling(grandchild aborted)",
        "pendingSibling",
      ]);
      expect(grandchildRuns.count).toBe(0);
      const [waitingTask] = await childrenOf(done._id);
      const [grandchildTask] = await childrenOf(waitingTask._id);
      expect(grandchildTask.status).toBe("aborted");
    });

    it("wakes a waiting parent when an operator aborts its child directly", async () => {
      const released = Promise.withResolvers<void>();
      const parked = defineTask<unknown, unknown, unknown>({
        initial: () => ({phase: "work"}),
        name: "test.parkedChild",
        phases: {
          work: {
            run: async (_task, rt) => {
              await new Promise<void>((resolve) => {
                rt.signal.addEventListener("abort", () => resolve());
                released.promise.then(resolve);
              });
              throw new Error("stopped");
            },
          },
        },
        version: 1,
      });
      const runs = {count: 0};
      const parent = fanOut({children: [asAny(parked)], name: "test.waitsOnParked", runs});
      const harness = await openHarness([parent, asAny(parked)]);
      await harness.start();

      const created = await harness.createTask(parent, {});
      await waitUntil(
        async () => (await findTask(created._id)).status === "waiting",
        "parent waiting"
      );
      const [child] = await childrenOf(created._id);
      await waitUntil(
        async () => (await findTask(child._id)).status === "running",
        "child running"
      );

      const aborted = await harness.abort(child._id, {reason: "Patient left"});
      expect(aborted.status).toBe("aborted");
      released.resolve();

      const done = await harness.waitForTask(created._id);
      expect(done.status).toBe("completed");
      const [outcome] = (done.outcome?.result ?? []) as HarnessChildOutcome[];
      expect(outcome).toMatchObject({error: "Aborted: Patient left", status: "aborted"});
      // The aborted run's late throw recorded nothing.
      expect((await findTask(child._id)).status).toBe("aborted");
      expect(await SpanModel.countDocuments({name: "work", traceId: done.traceId})).toBe(0);
    });
  });

  describe("harness.abort", () => {
    it("aborts three levels bottom-up, running each abort handler after its children are aborted", async () => {
      const events: string[] = [];
      const signals: AbortSignal[] = [];
      const userId = new mongoose.Types.ObjectId();
      const statusOf = async (id: mongoose.Types.ObjectId): Promise<string> => {
        const owned = await childrenOf(id);
        return owned.map((task) => task.status).join(",") || "none";
      };

      const grandchild = defineTask<unknown, unknown, unknown>({
        abort: async (task, rt) => {
          events.push(
            `abort grandchild (phase signal ${signals[0]?.aborted}, by ${rt.userId}, ${rt.reason}, children ${await statusOf(new mongoose.Types.ObjectId(task.id))})`
          );
        },
        initial: () => ({phase: "work"}),
        name: "test.grandchild",
        phases: {
          work: {
            run: async (_task, rt) => {
              signals.push(rt.signal);
              events.push("grandchild running");
              await new Promise<void>((resolve) =>
                rt.signal.addEventListener("abort", () => resolve())
              );
              events.push("grandchild saw abort signal");
              // A late commit from an aborted run is fenced out.
              await rt.commit({terminal: {result: "too late", status: "completed"}});
            },
          },
        },
        version: 1,
      });
      const child = defineTask<unknown, unknown, unknown>({
        abort: async (task) => {
          events.push(
            `abort child (children ${await statusOf(new mongoose.Types.ObjectId(task.id))})`
          );
        },
        initial: () => ({phase: "delegate"}),
        name: "test.middle",
        phases: {
          delegate: {
            run: async (_task, rt) => {
              await rt.waitForTasks([await rt.createTask(grandchild, {})]);
              await rt.commit({terminal: {status: "completed"}});
            },
          },
        },
        version: 1,
      });
      const root = defineTask<unknown, unknown, unknown>({
        abort: async (task) => {
          events.push(
            `abort root (children ${await statusOf(new mongoose.Types.ObjectId(task.id))})`
          );
        },
        initial: () => ({phase: "delegate"}),
        name: "test.root",
        phases: {
          delegate: {
            run: async (_task, rt) => {
              await rt.waitForTasks([await rt.createTask(child, {})]);
              await rt.commit({terminal: {status: "completed"}});
            },
          },
        },
        version: 1,
      });
      const harness = await openHarness([asAny(root), asAny(child), asAny(grandchild)]);
      await harness.start();

      const created = await harness.createTask(root, {});
      await waitUntil(async () => events.includes("grandchild running"), "grandchild running");

      const aborted = await harness.abort(created._id, {reason: "Duplicate intake", userId});
      expect(aborted.status).toBe("aborted");
      expect(aborted.toObject().outcome).toEqual({
        error: "Aborted: Duplicate intake",
        status: "aborted",
      });

      expect(events.filter((event) => event.startsWith("abort"))).toEqual([
        `abort grandchild (phase signal true, by ${userId}, Duplicate intake, children none)`,
        "abort child (children aborted)",
        "abort root (children aborted)",
      ]);
      expect(signals[0]?.aborted).toBe(true);

      const [middle] = await childrenOf(created._id);
      const [leaf] = await childrenOf(middle._id);
      for (const task of [middle, leaf]) {
        const fresh = await findTask(task._id);
        expect(fresh.status).toBe("aborted");
        expect(fresh.lease?.token).toBeUndefined();
        expect(fresh.waiting?.kind).toBeUndefined();
      }

      const abortSpans = await SpanModel.find({name: "abort", traceId: created.traceId}).sort({
        _id: 1,
      });
      expect(abortSpans.map((span) => String(span.parentSpanId))).toEqual([
        String(leaf.rootSpanId),
        String(middle.rootSpanId),
        String(created.rootSpanId),
      ]);
      for (const span of abortSpans) {
        expect(span.status).toBe("ok");
        expect(span.output).toEqual({
          abortedBy: String(userId),
          abortHandler: {status: "ok"},
          reason: "Duplicate intake",
          requestedOn: String(created._id),
        });
      }
      const trace = await TraceModel.findExactlyOne({_id: created.traceId});
      expect(trace.status).toBe("error");
      expect(trace.errorSummary).toBe("Aborted: Duplicate intake");

      // The runner is free again and the aborted grandchild's late commit wrote nothing.
      await waitUntil(async () => events.includes("grandchild saw abort signal"), "signal seen");
      const next = completesWith("test.afterAbort", "fine");
      const nextHarness = await openHarness([next]);
      await harness.stop();
      await nextHarness.start();
      expect(
        (await nextHarness.waitForTask((await nextHarness.createTask(next, {}))._id)).status
      ).toBe("completed");
      expect((await findTask(leaf._id)).status).toBe("aborted");
      expect(await SpanModel.countDocuments({name: "work", traceId: created.traceId})).toBe(0);
    });

    it("aborts a waiting parent without waking it", async () => {
      const blocker = defineTask<unknown, unknown, unknown>({
        initial: () => ({phase: "work"}),
        name: "test.blocker",
        phases: {
          work: {
            run: async (_task, rt) => {
              await new Promise<void>((resolve) =>
                rt.signal.addEventListener("abort", () => resolve())
              );
              throw new Error("stopped");
            },
          },
        },
        version: 1,
      });
      const runs = {count: 0};
      const parent = fanOut({children: [asAny(blocker)], name: "test.waitingParent", runs});
      const harness = await openHarness([parent, asAny(blocker)]);
      await harness.start();

      const created = await harness.createTask(parent, {});
      await waitUntil(async () => (await findTask(created._id)).status === "waiting", "waiting");
      const aborted = await harness.abort(created._id, {reason: "Cancelled by clinician"});
      await pause(100);

      expect(aborted.status).toBe("aborted");
      expect(runs.count).toBe(1);
      const [child] = await childrenOf(created._id);
      expect((await findTask(child._id)).status).toBe("aborted");
      expect((await findTask(created._id)).status).toBe("aborted");
    });

    it("records a failing abort handler on the span and aborts anyway", async () => {
      const brittle = defineTask<unknown, unknown, unknown>({
        abort: async () => {
          throw new Error("EHR delete failed");
        },
        initial: () => ({phase: "work"}),
        name: "test.brittleAbort",
        phases: {work: {run: async (_task, rt) => rt.commit({terminal: {status: "completed"}})}},
        version: 1,
      });
      const harness = await openHarness([asAny(brittle)]);
      const created = await harness.createTask(brittle, {});

      const aborted = await harness.abort(created._id, {reason: "Wrong patient"});
      expect(aborted.status).toBe("aborted");
      const span = await SpanModel.findExactlyOne({name: "abort", traceId: created.traceId});
      expect(span.status).toBe("error");
      expect(span.error).toBe("Abort handler failed: EHR delete failed");
      expect(span.output).toMatchObject({
        abortHandler: {error: "EHR delete failed", status: "error"},
      });
    });

    it("runs each handler once when two aborts of the same tree overlap", async () => {
      let handlerRuns = 0;
      const slowHandler = defineTask<unknown, unknown, unknown>({
        abort: async () => {
          handlerRuns += 1;
          await pause(100);
        },
        initial: () => ({phase: "work"}),
        name: "test.slowHandler",
        phases: {work: {run: async (_task, rt) => rt.commit({terminal: {status: "completed"}})}},
        version: 1,
      });
      const harness = await openHarness([asAny(slowHandler)]);
      const created = await harness.createTask(slowHandler, {});

      const [first, second] = await Promise.all([
        harness.abort(created._id, {reason: "first"}),
        harness.abort(created._id, {reason: "second"}),
      ]);
      expect(handlerRuns).toBe(1);
      expect(first.status).toBe("aborted");
      expect(second.status).toBe("aborted");
      expect(await SpanModel.countDocuments({name: "abort", traceId: created.traceId})).toBe(1);
      // The first request recorded wins; the other waited for its handler to finish.
      expect(["first", "second"]).toContain((await findTask(created._id)).abortRequested?.reason);
    });

    it("keeps aborting the tree when a child's handler throws", async () => {
      const handled: string[] = [];
      const brittleChild = defineTask<unknown, unknown, unknown>({
        abort: async () => {
          handled.push("child");
          throw new Error("could not cancel lab order");
        },
        initial: () => ({phase: "work"}),
        name: "test.brittleChild",
        phases: {
          work: {
            run: async (_task, rt) => {
              await new Promise<void>((resolve) =>
                rt.signal.addEventListener("abort", () => resolve())
              );
              throw new Error("stopped");
            },
          },
        },
        version: 1,
      });
      const parent = defineTask<unknown, unknown, unknown>({
        abort: async () => {
          handled.push("parent");
        },
        initial: () => ({phase: "fanOut"}),
        name: "test.brittleParent",
        phases: {
          fanOut: {
            run: async (_task, rt) => {
              await rt.waitForTasks([await rt.createTask(brittleChild, {})]);
            },
          },
        },
        version: 1,
      });
      const harness = await openHarness([asAny(parent), asAny(brittleChild)]);
      await harness.start();
      const created = await harness.createTask(parent, {});
      await waitUntil(async () => (await findTask(created._id)).status === "waiting", "waiting");

      const aborted = await harness.abort(created._id, {reason: "Visit cancelled"});
      expect(aborted.status).toBe("aborted");
      expect(handled).toEqual(["child", "parent"]);
      const [child] = await childrenOf(created._id);
      expect((await findTask(child._id)).status).toBe("aborted");
      const spans = await SpanModel.find({name: "abort", traceId: created.traceId}).sort({_id: 1});
      expect(spans.map((span) => span.status)).toEqual(["error", "ok"]);
    });

    it("rejects a blank reason and an already-terminal task", async () => {
      const quick = completesWith("test.quick", 1);
      const harness = await openHarness([quick]);
      await harness.start();
      const done = await harness.waitForTask((await harness.createTask(quick, {}))._id);

      await expect(harness.abort(done._id, {reason: " "})).rejects.toThrow(
        "abort requires a reason"
      );
      await expect(harness.abort(done._id, {reason: "late"})).rejects.toThrow(
        `Task ${done._id} is already completed`
      );
      expect(await SpanModel.countDocuments({name: "abort"})).toBe(0);
    });

    it("records an unregistered version's abort as handler-less", async () => {
      const v1 = completesWith("test.versioned", 1);
      const writer = await openHarness([v1]);
      const created = await writer.createTask(v1, {});
      const other = await openHarness([completesWith("test.other", 1)]);

      const aborted = await other.abort(created._id, {reason: "Retired workflow"});
      expect(aborted.status).toBe("aborted");
      const span = await SpanModel.findExactlyOne({name: "abort", traceId: created.traceId});
      expect(span.output).toMatchObject({
        abortHandler: {
          error: "test.versioned@1 is not in this harness registry; no abort handler ran",
          status: "unregistered",
        },
      });
      expect(span.status).toBe("ok");
    });

    it("runs the abort handler when resolveInterrupted chooses abort", async () => {
      const handled: string[] = [];
      const write = defineTask<unknown, unknown, unknown>({
        abort: async (_task, rt) => {
          handled.push(rt.reason);
        },
        initial: () => ({phase: "write"}),
        name: "test.interruptedWrite",
        phases: {write: {run: async (_task, rt) => rt.commit({terminal: {status: "completed"}})}},
        version: 1,
      });
      const harness = await openHarness([asAny(write)]);
      const created = await harness.createTask(write, {});
      await TaskModel.updateOne({_id: created._id}, {$set: {status: "interrupted"}});

      const resolved = await harness.resolveInterrupted(created._id, {
        action: "abort",
        reason: "Note already filed by hand",
      });
      expect(resolved.status).toBe("aborted");
      expect(handled).toEqual(["Note already filed by hand"]);
      const span = await SpanModel.findExactlyOne({
        name: "resolveInterrupted",
        traceId: created.traceId,
      });
      expect(span.output).toEqual({
        abortHandler: {status: "ok"},
        action: "abort",
        phase: "write",
        reason: "Note already filed by hand",
      });
    });
  });

  describe("resolveInterrupted on an aborting task", () => {
    it("refuses retry once an abort has started", async () => {
      const write = completesWith("test.abortingWrite", null);
      const harness = await openHarness([write]);
      const created = await harness.createTask(write, {});
      await TaskModel.updateOne(
        {_id: created._id},
        {
          $set: {
            abortRequested: {at: new Date(), reason: "crashed mid-abort"},
            status: "interrupted",
          },
        }
      );

      await expect(
        harness.resolveInterrupted(created._id, {action: "retry", reason: "try again"})
      ).rejects.toThrow("is being aborted; resolve it with abort, not retry");
      const resolved = await harness.resolveInterrupted(created._id, {
        action: "abort",
        reason: "finish the abort",
      });
      expect(resolved.status).toBe("aborted");
    });
  });

  describe("waiting sweep", () => {
    const buildEngine = (
      definitions: ReadonlyArray<AnyHarnessTaskDefinition> = []
    ): {engine: HarnessEngine; wakes: {count: number}} => {
      const wakes = {count: 0};
      const models = {
        event: registerHarnessEvent(),
        eventStream: registerHarnessEventStream(),
        owner: OwnerModel,
        span: SpanModel,
        task: TaskModel,
        trace: TraceModel,
      } as unknown as HarnessModels;
      return {
        engine: {
          controllers: new Map(),
          definitions: new Map(definitions.map((definition) => [definition.key, definition])),
          models,
          wake: () => {
            wakes.count += 1;
          },
        },
        wakes,
      };
    };

    type SeedStatus = "completed" | "failed" | "pending" | "running";

    /**
     * A parent `waiting` on children in `childStatuses`, written straight to Mongo with
     * the trace and spans the commit paths expect.
     */
    const seedWait = async ({
      childStatuses,
      name = "test.seeded",
      policy,
    }: {
      childStatuses: SeedStatus[];
      name?: string;
      policy: "all" | "failFast";
    }): Promise<{childIds: mongoose.Types.ObjectId[]; parentId: mongoose.Types.ObjectId}> => {
      const parentId = new mongoose.Types.ObjectId();
      const traceId = new mongoose.Types.ObjectId();
      const startedAt = new Date();
      await TraceModel.create({_id: traceId, name, startedAt, status: "ok"});
      const seedSpan = async (): Promise<mongoose.Types.ObjectId> => {
        const [span] = await SpanModel.create([
          {kind: "CHAIN", name, startedAt, startOffsetMs: 0, status: "ok", traceId},
        ]);
        return span._id;
      };
      const childIds = childStatuses.map(() => new mongoose.Types.ObjectId());
      const common = {name, phase: "fanOut", rootTaskId: parentId, traceId, version: 1};
      await TaskModel.create({
        ...common,
        _id: parentId,
        rootSpanId: await seedSpan(),
        status: "waiting",
        waiting: {kind: "tasks", policy, taskIds: childIds},
      });
      for (const [index, status] of childStatuses.entries()) {
        await TaskModel.create({
          ...common,
          _id: childIds[index],
          name: "test.seededChild",
          outcome:
            status === "completed" || status === "failed"
              ? {...(status === "failed" ? {error: "seeded failure"} : {result: index}), status}
              : undefined,
          ownership: {id: parentId, kind: "task"},
          phase: "work",
          // Matches what rt.createTask would name child `index` of the parent's first visit.
          requestId: `harness-child:${parentId}:0:0:${index}`,
          rootSpanId: await seedSpan(),
          status,
        });
      }
      return {childIds, parentId};
    };

    it("wakes a parent whose children settled without waking it (a lost wake)", async () => {
      const {engine, wakes} = buildEngine();
      const {parentId} = await seedWait({childStatuses: ["completed"], policy: "all"});
      const stillWaiting = await seedWait({childStatuses: ["completed", "pending"], policy: "all"});

      expect(await sweepWaitingTasks(engine)).toBe(1);
      expect(wakes.count).toBe(1);
      const woken = await findTask(parentId);
      expect(woken.status).toBe("pending");
      expect(woken.waiting?.kind).toBeUndefined();
      expect((await findTask(stillWaiting.parentId)).status).toBe("waiting");
      expect(await sweepWaitingTasks(engine)).toBe(0);
    });

    it("failFast: a failed child wakes the parent and aborts the siblings still in flight", async () => {
      const {engine} = buildEngine();
      const failFast = await seedWait({
        childStatuses: ["failed", "pending", "running"],
        policy: "failFast",
      });
      const all = await seedWait({childStatuses: ["failed", "pending"], policy: "all"});

      expect(await sweepWaitingTasks(engine)).toBe(1);
      expect((await findTask(failFast.parentId)).status).toBe("pending");
      const [, pending, running] = await Promise.all(failFast.childIds.map(findTask));
      expect(pending.status).toBe("aborted");
      expect(running.status).toBe("aborted");
      expect(pending.outcome?.error).toMatch(/^Aborted: Sibling task \S+ failed \(failFast/);
      expect((await findTask(all.parentId)).status).toBe("waiting");
      expect((await findTask(all.childIds[1])).status).toBe("pending");
    });

    it("tolerates two failed failFast siblings and repeated sweeps", async () => {
      const {engine} = buildEngine();
      const {childIds, parentId} = await seedWait({
        childStatuses: ["failed", "failed", "running"],
        policy: "failFast",
      });

      const results = await Promise.all([sweepWaitingTasks(engine), sweepWaitingTasks(engine)]);
      expect(results.reduce((sum, woken) => sum + woken, 0)).toBe(1);
      expect((await findTask(parentId)).status).toBe("pending");
      expect((await findTask(childIds[2])).status).toBe("aborted");
      expect(await SpanModel.countDocuments({name: "abort"})).toBe(1);
    });

    it("the running harness sweeps lost wakes and finishes the parent", async () => {
      const child = completesWith("test.seededChild", null);
      const runs = {count: 0};
      const parent = fanOut({children: [child], name: "test.seededParent", runs});
      const {parentId} = await seedWait({
        childStatuses: ["completed"],
        name: "test.seededParent",
        policy: "all",
      });
      const harness = await openHarness([parent, child]);
      await harness.start();

      const done = await harness.waitForTask(parentId, {timeout: {seconds: 5}});
      expect(done.status).toBe("completed");
      expect(runs.count).toBe(1);
      expect(done.outcome?.result).toEqual([
        {id: expect.any(String), name: "test.seededChild", result: 0, status: "completed"},
      ]);
    });
  });
});
