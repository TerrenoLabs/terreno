import {afterEach, beforeAll, beforeEach, describe, expect, it} from "bun:test";
import {DateTime} from "luxon";

import {createLocalObservabilityPlugin} from "../observability/local/localPlugin";
import {registerObsSpan} from "../observability/local/models/obsSpan";
import {registerObsTrace} from "../observability/local/models/obsTrace";
import type {ObsSpanModel, ObsTraceModel} from "../types/observability";
import {type AnyHarnessTaskDefinition, defineTask, Harness, InProcessRunner} from "./harness";
import {registerHarnessTask} from "./models/harnessTask";

interface IntakeInput {
  patientId: string;
}

/** Handler calls, tagged `name@version:phase`, so a test can tell which version ran. */
const calls: string[] = [];

/** `test.intake` at `version`: two phases on v1, one renamed phase on v2. */
const intakeAt = (version: number): AnyHarnessTaskDefinition => {
  const tag = (phase: string): string => `test.intake@${version}:${phase}`;
  const phases =
    version === 1
      ? {
          fetch: {
            run: async (_task: unknown, rt: {commit: (next: object) => Promise<void>}) => {
              calls.push(tag("fetch"));
              await rt.commit({phase: "summarize", state: {chart: "v1-chart"}});
            },
          },
          summarize: {
            run: async (_task: unknown, rt: {commit: (next: object) => Promise<void>}) => {
              calls.push(tag("summarize"));
              await rt.commit({terminal: {result: "v1", status: "completed"}});
            },
          },
        }
      : {
          gather: {
            run: async (_task: unknown, rt: {commit: (next: object) => Promise<void>}) => {
              calls.push(tag("gather"));
              await rt.commit({terminal: {result: `v${version}`, status: "completed"}});
            },
          },
        };
  return defineTask<IntakeInput, {chart?: string}, unknown>({
    abort: async (_task, rt) => {
      calls.push(`${tag("abort")}:${rt.reason}`);
    },
    initial: () => ({phase: version === 1 ? "fetch" : "gather", state: {}}),
    name: "test.intake",
    phases: phases as never,
    version,
  }) as unknown as AnyHarnessTaskDefinition;
};

const intakeV1 = intakeAt(1);
const intakeV2 = intakeAt(2);

const TaskModel = registerHarnessTask();
let SpanModel: ObsSpanModel;
let TraceModel: ObsTraceModel;

const openHarnesses: Harness[] = [];

const openHarness = async (registry: ReadonlyArray<AnyHarnessTaskDefinition>): Promise<Harness> => {
  const harness = await Harness.open({
    registry,
    runner: new InProcessRunner({pollInterval: {milliseconds: 20}}),
  });
  openHarnesses.push(harness);
  return harness;
};

describe("Harness version pinning", () => {
  beforeAll(() => {
    createLocalObservabilityPlugin();
    SpanModel = registerObsSpan();
    TraceModel = registerObsTrace();
  });

  beforeEach(async () => {
    calls.length = 0;
    await Promise.all([
      TaskModel.deleteMany({}),
      SpanModel.deleteMany({}),
      TraceModel.deleteMany({}),
    ]);
  });

  afterEach(async () => {
    await Promise.all(openHarnesses.splice(0).map((harness) => harness.stop()));
  });

  it("registers several versions of one name side by side and pins createTask to each", async () => {
    const harness = await openHarness([intakeV1, intakeV2]);

    const v1 = await harness.createTask(intakeV1, {patientId: "p1"} as never);
    const v2 = await harness.createTask(intakeV2, {patientId: "p2"} as never);
    expect({name: v1.name, phase: v1.phase, version: v1.version}).toEqual({
      name: "test.intake",
      phase: "fetch",
      version: 1,
    });
    expect({name: v2.name, phase: v2.phase, version: v2.version}).toEqual({
      name: "test.intake",
      phase: "gather",
      version: 2,
    });
  });

  it("throws when the same name@version is registered twice, even beside other versions", async () => {
    await expect(openHarness([intakeV1, intakeV2, intakeAt(2)])).rejects.toThrow(
      "Harness registry lists test.intake@2 more than once"
    );
  });

  it("finishes an in-flight v1 task on v1 handlers while new v2 tasks run on v2 (AC10)", async () => {
    // The old deploy: v1 starts a task and checkpoints after its first phase.
    const oldDeploy = await openHarness([intakeV1]);
    const inFlight = await oldDeploy.createTask(intakeV1, {patientId: "p1"} as never);
    await TaskModel.updateOne(
      {_id: inFlight._id},
      {$set: {phase: "summarize", state: {chart: "v1-chart"}}}
    );
    await oldDeploy.stop();

    // The new deploy keeps v1 registered beside v2.
    const newDeploy = await openHarness([intakeV1, intakeV2]);
    await newDeploy.start();
    const fresh = await newDeploy.createTask(intakeV2, {patientId: "p2"} as never);

    const [oldDone, newDone] = await Promise.all([
      newDeploy.waitForTask(inFlight._id),
      newDeploy.waitForTask(fresh._id),
    ]);
    expect(oldDone.outcome?.result).toBe("v1");
    expect(newDone.outcome?.result).toBe("v2");
    expect([...calls].sort()).toEqual(["test.intake@1:summarize", "test.intake@2:gather"]);
  });

  it("refuses to start when non-terminal tasks use unregistered versions, listing each with its count (AC10)", async () => {
    const old = await openHarness([intakeV1, intakeAt(3)]);
    const pending = await old.createTask(intakeV1, {patientId: "a"} as never);
    const running = await old.createTask(intakeV1, {patientId: "b"} as never);
    const waiting = await old.createTask(intakeV1, {patientId: "c"} as never);
    const aborting = await old.createTask(intakeAt(3), {patientId: "d"} as never);
    const interrupted = await old.createTask(intakeAt(3), {patientId: "e"} as never);
    const done = await old.createTask(intakeAt(3), {patientId: "f"} as never);
    await TaskModel.updateOne({_id: running._id}, {$set: {status: "running"}});
    await TaskModel.updateOne({_id: waiting._id}, {$set: {status: "waiting"}});
    await TaskModel.updateOne(
      {_id: aborting._id},
      {$set: {abortRequested: {at: DateTime.now().toJSDate(), reason: "retire"}}}
    );
    await TaskModel.updateOne({_id: interrupted._id}, {$set: {status: "interrupted"}});
    // Terminal tasks never run again, so their version need not be registered.
    await TaskModel.updateOne({_id: done._id}, {$set: {status: "completed"}});
    await old.stop();

    const harness = await openHarness([intakeV2]);
    // A task this registry does run, to prove the check happens before any claim.
    const runnable = await harness.createTask(intakeV2, {patientId: "g"} as never);
    await expect(harness.start()).rejects.toThrow(
      "Harness.start: in-flight tasks use task versions this registry does not register: test.intake@1 (3 tasks), test.intake@3 (2 tasks)."
    );

    // Nothing was claimed: the pending task kept no lease and never ran.
    const untouched = await TaskModel.findExactlyOne({_id: pending._id});
    expect(untouched.status).toBe("pending");
    expect(untouched.lease?.owner).toBeUndefined();
    const notClaimed = await TaskModel.findExactlyOne({_id: runnable._id});
    expect(notClaimed.status).toBe("pending");
    expect(notClaimed.lease?.owner).toBeUndefined();
    expect(calls).toEqual([]);

    // Registering the missing versions lets a redeployed process start.
    const fixed = await openHarness([intakeV1, intakeV2, intakeAt(3)]);
    await fixed.start();
    expect((await fixed.waitForTask(pending._id)).outcome?.result).toBe("v1");
  });

  it("starts when every in-flight version is registered and only terminal rows are unknown", async () => {
    const old = await openHarness([intakeV1]);
    const finished = await old.createTask(intakeV1, {patientId: "a"} as never);
    await TaskModel.updateOne({_id: finished._id}, {$set: {status: "failed"}});

    const harness = await openHarness([intakeV2]);
    await harness.start();
    const fresh = await harness.createTask(intakeV2, {patientId: "b"} as never);
    expect((await harness.waitForTask(fresh._id)).outcome?.result).toBe("v2");
  });

  it("never claims a pending task of a version created after start that it does not register", async () => {
    const harness = await openHarness([intakeV2]);
    await harness.start();
    const other = await openHarness([intakeV1]);
    const stranded = await other.createTask(intakeV1, {patientId: "a"} as never);

    const done = await harness.waitForTask(
      (await harness.createTask(intakeV2, {patientId: "b"} as never))._id
    );
    expect(done.outcome?.result).toBe("v2");
    // Several poll intervals pass while the v1 row is runnable.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect((await TaskModel.findExactlyOne({_id: stranded._id})).status).toBe("pending");
    expect(calls).toEqual(["test.intake@2:gather"]);
  });

  it("runs the abort handler of the version each task is pinned to", async () => {
    const harness = await openHarness([intakeV1, intakeV2]);
    const v1 = await harness.createTask(intakeV1, {patientId: "a"} as never);
    const v2 = await harness.createTask(intakeV2, {patientId: "b"} as never);

    await harness.abort(v1._id, {reason: "stop-v1"});
    await harness.abort(v2._id, {reason: "stop-v2"});

    expect(calls).toEqual(["test.intake@1:abort:stop-v1", "test.intake@2:abort:stop-v2"]);
    const spans = await SpanModel.find({name: "abort"}).sort({created: 1});
    expect(spans.map((span) => (span.output as {abortHandler: unknown}).abortHandler)).toEqual([
      {status: "ok"},
      {status: "ok"},
    ]);
  });

  it("pins a child task to the version its parent passed to rt.createTask", async () => {
    const parent = defineTask<unknown, unknown, unknown>({
      initial: () => ({phase: "spawn"}),
      name: "test.parent",
      phases: {
        spawn: {
          run: async (_task, rt) => {
            const childId = await rt.createTask(intakeV1 as never, {patientId: "kid"});
            await rt.waitForTasks([childId]);
            await rt.commit({terminal: {result: "done", status: "completed"}});
          },
        },
      },
      version: 1,
    }) as unknown as AnyHarnessTaskDefinition;
    const harness = await openHarness([parent, intakeV1, intakeV2]);
    await harness.start();

    const created = await harness.createTask(parent, {} as never);
    expect((await harness.waitForTask(created._id)).status).toBe("completed");
    const child = await TaskModel.findExactlyOne({"ownership.id": created._id});
    expect(child.version).toBe(1);
    expect(calls).toEqual(["test.intake@1:fetch", "test.intake@1:summarize"]);
  });

  it("lets only one of two overlapping start() calls run, and allows a retry after a failed check", async () => {
    const old = await openHarness([intakeV1]);
    const stranded = await old.createTask(intakeV1, {patientId: "a"} as never);
    const harness = await openHarness([intakeV2]);

    await expect(harness.start()).rejects.toThrow("test.intake@1 (1 task)");
    await TaskModel.updateOne({_id: stranded._id}, {$set: {status: "aborted"}});

    const results = await Promise.allSettled([harness.start(), harness.start()]);
    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    const rejected = results.find((result) => result.status === "rejected");
    expect(String((rejected as PromiseRejectedResult).reason)).toContain(
      "Harness is already started"
    );
  });

  it("refuses to retry an interrupted task whose version this harness does not register", async () => {
    const old = await openHarness([intakeV1]);
    const created = await old.createTask(intakeV1, {patientId: "a"} as never);
    await TaskModel.updateOne({_id: created._id}, {$set: {status: "interrupted"}});

    const harness = await openHarness([intakeV2]);
    await expect(
      harness.resolveInterrupted(created._id, {action: "retry", reason: "try again"})
    ).rejects.toThrow("test.intake@1 is not in this harness registry; register it before retrying");
    expect((await TaskModel.findExactlyOne({_id: created._id})).status).toBe("interrupted");
  });
});
