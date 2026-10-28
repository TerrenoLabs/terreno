import {afterEach, beforeAll, beforeEach, describe, expect, it} from "bun:test";

import {createLocalObservabilityPlugin} from "../observability/local/localPlugin";
import {registerObsSpan} from "../observability/local/models/obsSpan";
import {registerObsTrace} from "../observability/local/models/obsTrace";
import type {ObsSpanModel, ObsTraceModel} from "../types/observability";
import {type AnyHarnessTaskDefinition, defineTask, Harness, InProcessRunner} from "./harness";
import {registerHarnessOwner} from "./models/harnessOwner";
import {registerHarnessTask} from "./models/harnessTask";

const TaskModel = registerHarnessTask();
const OwnerModel = registerHarnessOwner();
let SpanModel: ObsSpanModel;
let TraceModel: ObsTraceModel;

const pause = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

const openHarnesses: Harness[] = [];
const releases: Array<() => void> = [];

const openHarness = async ({
  concurrency,
  registry,
}: {
  concurrency: number;
  registry: ReadonlyArray<AnyHarnessTaskDefinition>;
}): Promise<Harness> => {
  const harness = await Harness.open({
    registry,
    runner: new InProcessRunner({concurrency, pollInterval: {milliseconds: 20}}),
  });
  openHarnesses.push(harness);
  await harness.start();
  return harness;
};

describe("InProcessRunner concurrency against Mongo", () => {
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
    for (const release of releases.splice(0)) {
      release();
    }
    await Promise.all(openHarnesses.splice(0).map((harness) => harness.stop()));
  });

  it("completes a second task while the first is blocked on a gate", async () => {
    let releaseGate: () => void = () => {};
    const gated = new Promise<void>((done) => {
      releaseGate = done;
    });
    releases.push(releaseGate);
    const definition = defineTask<{blocked: boolean}, Record<string, never>, {status: string}>({
      initial: () => ({phase: "work", state: {}}),
      name: "test.concurrencyGate",
      phases: {
        work: {
          run: async (task, rt) => {
            if (task.input.blocked) {
              await gated;
            }
            await rt.commit({terminal: {result: {status: "done"}, status: "completed"}});
          },
        },
      },
      version: 1,
    }) as unknown as AnyHarnessTaskDefinition;
    const harness = await openHarness({concurrency: 2, registry: [definition]});

    const blocked = await harness.createTask(definition as never, {blocked: true});
    const free = await harness.createTask(definition as never, {blocked: false});
    const freeDone = await harness.waitForTask(free._id, {timeout: {seconds: 5}});

    expect(freeDone.status).toBe("completed");
    expect((await TaskModel.findExactlyOne({_id: blocked._id})).status).toBe("running");
    releaseGate();
    expect((await harness.waitForTask(blocked._id, {timeout: {seconds: 5}})).status).toBe(
      "completed"
    );
  });

  it("never runs one task twice at once and never exceeds the concurrency", async () => {
    const activeByTask = new Map<string, number>();
    let active = 0;
    let peak = 0;
    let peakPerTask = 0;
    const enter = (taskId: string): void => {
      active += 1;
      peak = Math.max(peak, active);
      const count = (activeByTask.get(taskId) ?? 0) + 1;
      activeByTask.set(taskId, count);
      peakPerTask = Math.max(peakPerTask, count);
    };
    const leave = (taskId: string): void => {
      active -= 1;
      activeByTask.set(taskId, (activeByTask.get(taskId) ?? 1) - 1);
    };
    // The first phase holds until three run at once (or 2 s pass), so the peak does not
    // depend on how fast CI Mongo claims.
    const fullHouse = async (): Promise<void> => {
      for (let i = 0; i < 200 && active < 3; i++) {
        await pause(10);
      }
    };
    const definition = defineTask<{n: number}, Record<string, never>, {status: string}>({
      initial: () => ({phase: "first", state: {}}),
      name: "test.concurrencyPeak",
      phases: {
        first: {
          run: async (task, rt) => {
            enter(task.id);
            await fullHouse();
            await pause(30);
            leave(task.id);
            await rt.commit({phase: "second"});
          },
        },
        second: {
          run: async (task, rt) => {
            enter(task.id);
            await pause(30);
            leave(task.id);
            await rt.commit({terminal: {result: {status: "done"}, status: "completed"}});
          },
        },
      },
      version: 1,
    }) as unknown as AnyHarnessTaskDefinition;
    const harness = await openHarness({concurrency: 3, registry: [definition]});

    const created = await Promise.all(
      [1, 2, 3, 4, 5, 6, 7].map((n) => harness.createTask(definition as never, {n}))
    );
    const done = await Promise.all(
      created.map((task) => harness.waitForTask(task._id, {timeout: {seconds: 10}}))
    );

    expect(done.map((task) => task.status)).toEqual(Array(7).fill("completed"));
    expect(peakPerTask).toBe(1);
    expect(peak).toBe(3);
  });
});
