import {afterEach, beforeAll, beforeEach, describe, expect, it} from "bun:test";
import {DateTime, Settings} from "luxon";

import {createLocalObservabilityPlugin} from "../observability/local/localPlugin";
import {registerObsSpan} from "../observability/local/models/obsSpan";
import {registerObsTrace} from "../observability/local/models/obsTrace";
import type {HarnessTaskDocument, HarnessTestHooks} from "../types/harness";
import type {ObsSpanModel, ObsTraceModel} from "../types/observability";
import {type AnyHarnessTaskDefinition, defineTask, Harness, InProcessRunner} from "./harness";
import {registerHarnessTask} from "./models/harnessTask";

const TaskModel = registerHarnessTask();
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

const phaseSpans = async (
  task: HarnessTaskDocument
): Promise<Array<{error?: string; input?: unknown; output?: unknown; status: string}>> => {
  const spans = await SpanModel.find({_id: {$ne: task.rootSpanId}, traceId: task.traceId}).sort({
    _id: 1,
  });
  return spans.map((span) => ({
    error: span.error,
    input: span.input,
    output: span.output,
    status: span.status,
  }));
};

/** A one-phase task whose phase throws until it has failed `failures` times. */
const flakyTask = ({
  failures,
  name,
  retry,
}: {
  failures: number;
  name: string;
  retry: {backoffMs?: number; maxAttempts?: number; maxBackoffMs?: number};
}): {attemptsSeen: number[]; definition: AnyHarnessTaskDefinition} => {
  const attemptsSeen: number[] = [];
  const definition = defineTask<unknown, unknown, {ok: boolean}>({
    initial: () => ({phase: "call"}),
    name,
    phases: {
      call: {
        run: async (task, rt) => {
          attemptsSeen.push(task.attempt);
          if (attemptsSeen.length <= failures) {
            throw new Error(`EHR 503 (run ${attemptsSeen.length})`);
          }
          await rt.commit({terminal: {result: {ok: true}, status: "completed"}});
        },
      },
    },
    retry,
    version: 1,
  });
  return {attemptsSeen, definition: definition as unknown as AnyHarnessTaskDefinition};
};

describe("Harness phase retries", () => {
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
    Settings.now = () => Date.now();
    await Promise.all(openHarnesses.splice(0).map((harness) => harness.stop()));
  });

  it("retries a phase that throws twice, then completes with one error span per failure", async () => {
    const {attemptsSeen, definition} = flakyTask({
      failures: 2,
      name: "test.flaky",
      retry: {backoffMs: 0, maxAttempts: 3},
    });
    const harness = await openHarness([definition]);
    await harness.start();

    const done = await harness.waitForTask((await harness.createTask(definition, {}))._id);
    expect(done.status).toBe("completed");
    expect(done.outcome?.result).toEqual({ok: true});
    expect(attemptsSeen).toEqual([0, 1, 2]);

    const spans = await phaseSpans(done);
    expect(spans.map((span) => span.status)).toEqual(["error", "error", "ok"]);
    expect(spans[0]).toMatchObject({
      error: "EHR 503 (run 1)",
      input: {attempt: 0},
      output: {retry: {attempt: 1, maxAttempts: 3}},
    });
    expect(spans[1]).toMatchObject({
      error: "EHR 503 (run 2)",
      input: {attempt: 1},
      output: {retry: {attempt: 2, maxAttempts: 3}},
    });
    const trace = await TraceModel.findExactlyOne({_id: done.traceId});
    expect(trace.status).toBe("ok");
  });

  it("fails the task with outcome.error once maxAttempts runs are used up", async () => {
    const {attemptsSeen, definition} = flakyTask({
      failures: 5,
      name: "test.exhausted",
      retry: {backoffMs: 0, maxAttempts: 2},
    });
    const harness = await openHarness([definition]);
    await harness.start();

    const done = await harness.waitForTask((await harness.createTask(definition, {}))._id);
    expect(done.status).toBe("failed");
    expect(done.toObject().outcome).toEqual({error: "EHR 503 (run 2)", status: "failed"});
    expect(done.attempt).toBe(2);
    expect(done.runAt).toBeUndefined();
    expect(attemptsSeen).toEqual([0, 1]);

    const spans = await phaseSpans(done);
    expect(spans.map((span) => span.status)).toEqual(["error", "error"]);
    expect(spans[1].output).toEqual({terminal: {error: "EHR 503 (run 2)", status: "failed"}});
    const trace = await TraceModel.findExactlyOne({_id: done.traceId});
    expect(trace.status).toBe("error");
    expect(trace.errorSummary).toBe("EHR 503 (run 2)");
  });

  it("uses the default policy (3 attempts) when the definition sets none", async () => {
    const attemptsSeen: number[] = [];
    const noPolicy = defineTask<unknown, unknown, unknown>({
      initial: () => ({phase: "call"}),
      name: "test.defaultPolicy",
      phases: {
        call: {
          run: async (task) => {
            attemptsSeen.push(task.attempt);
            throw new Error("always down");
          },
        },
      },
      version: 1,
    });
    // Zero jitter keeps the default 1 s base backoff at its 0.5 s floor.
    const harness = await openHarness([noPolicy], {random: () => 0});
    await harness.start();

    const done = await harness.waitForTask((await harness.createTask(noPolicy, {}))._id, {
      timeout: {seconds: 10},
    });
    expect(done.status).toBe("failed");
    expect(attemptsSeen).toEqual([0, 1, 2]);
  });

  it("schedules each retry with exponential backoff and does not run it before runAt", async () => {
    const start = DateTime.now();
    let clock = start;
    Settings.now = () => clock.toMillis();

    const {attemptsSeen, definition} = flakyTask({
      failures: 2,
      name: "test.backoff",
      retry: {backoffMs: 1000, maxAttempts: 3, maxBackoffMs: 60_000},
    });
    // random 0.5 puts each delay at 75% of its capped value: 750 ms, then 1500 ms.
    const harness = await openHarness([definition], {random: () => 0.5});
    await harness.start();
    const created = await harness.createTask(definition, {});

    await waitUntil(
      async () => (await TaskModel.findExactlyOne({_id: created._id})).attempt === 1,
      "first retry"
    );
    const firstRetry = await TaskModel.findExactlyOne({_id: created._id});
    expect(firstRetry.status).toBe("pending");
    expect(firstRetry.lease?.token).toBeUndefined();
    expect(firstRetry.runAt?.getTime()).toBe(start.plus({milliseconds: 750}).toMillis());

    // Real time passes, Luxon's clock does not: the runner must leave the task alone.
    await pause(200);
    expect(attemptsSeen).toEqual([0]);

    clock = start.plus({milliseconds: 749});
    await pause(100);
    expect(attemptsSeen).toEqual([0]);

    clock = start.plus({milliseconds: 750});
    await waitUntil(
      async () => (await TaskModel.findExactlyOne({_id: created._id})).attempt === 2,
      "second retry"
    );
    const secondRetry = await TaskModel.findExactlyOne({_id: created._id});
    expect(secondRetry.runAt?.getTime()).toBe(start.plus({milliseconds: 750 + 1500}).toMillis());
    await pause(150);
    expect(attemptsSeen).toEqual([0, 1]);

    clock = start.plus({milliseconds: 750 + 1500});
    const done = await harness.waitForTask(created._id);
    expect(done.status).toBe("completed");
    expect(attemptsSeen).toEqual([0, 1, 2]);
    // A terminal commit keeps the count of failures its final phase absorbed.
    expect(done.attempt).toBe(2);
    expect(done.runAt).toBeUndefined();
  });

  it("fails at once, without retrying, when the phase misuses the task API", async () => {
    let runs = 0;
    const misuse = defineTask<unknown, unknown, unknown>({
      initial: () => ({phase: "start"}),
      name: "test.misuse",
      phases: {
        start: {
          run: async (_task, rt) => {
            runs += 1;
            await rt.commit({phase: "nowhere"});
          },
        },
      },
      retry: {backoffMs: 0, maxAttempts: 5},
      version: 1,
    });
    const harness = await openHarness([misuse]);
    await harness.start();

    const done = await harness.waitForTask((await harness.createTask(misuse, {}))._id);
    expect(done.status).toBe("failed");
    expect(done.attempt).toBe(0);
    expect(runs).toBe(1);
  });

  it("writes no retry when the run lost its lease before the phase threw", async () => {
    const thrown = Promise.withResolvers<void>();
    const stolen = defineTask<unknown, unknown, unknown>({
      initial: () => ({phase: "call"}),
      name: "test.stolenRetry",
      phases: {
        call: {
          run: async (task) => {
            await TaskModel.updateOne({_id: task.id}, {$set: {"lease.token": "other-runner"}});
            thrown.resolve();
            throw new Error("boom");
          },
        },
      },
      retry: {backoffMs: 0, maxAttempts: 3},
      version: 1,
    });
    const harness = await openHarness([stolen]);
    await harness.start();
    const created = await harness.createTask(stolen, {});
    await thrown.promise;
    await harness.stop();

    const task = await TaskModel.findExactlyOne({_id: created._id});
    expect(task.status).toBe("running");
    expect(task.attempt).toBe(0);
    expect(task.lease?.token).toBe("other-runner");
    expect(await SpanModel.countDocuments({name: "call"})).toBe(0);
  });
});
