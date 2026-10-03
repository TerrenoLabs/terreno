import {afterEach, beforeAll, beforeEach, describe, expect, it} from "bun:test";
import {DateTime, Settings} from "luxon";
import mongoose from "mongoose";

import {createLocalObservabilityPlugin} from "../observability/local/localPlugin";
import {registerObsSpan} from "../observability/local/models/obsSpan";
import {registerObsTrace} from "../observability/local/models/obsTrace";
import type {HarnessTaskDocument, HarnessTestHooks} from "../types/harness";
import type {ObsSpanModel, ObsTraceModel} from "../types/observability";
import {commitWaiting, type HarnessModels} from "./commit";
import {type AnyHarnessTaskDefinition, defineTask, Harness, InProcessRunner} from "./harness";
import {registerHarnessEvent, registerHarnessEventStream} from "./models/harnessEvent";
import {registerHarnessInboxEvent} from "./models/harnessInboxEvent";
import {registerHarnessOwner} from "./models/harnessOwner";
import {registerHarnessTask} from "./models/harnessTask";

const TaskModel = registerHarnessTask();
const OwnerModel = registerHarnessOwner();
const InboxModel = registerHarnessInboxEvent();
let SpanModel: ObsSpanModel;
let TraceModel: ObsTraceModel;
const openHarnesses: Harness[] = [];

const START = DateTime.fromISO("2026-10-03T12:00:00.000Z");
let clock = START;

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

const findTask = (id: unknown): Promise<HarnessTaskDocument> => TaskModel.findExactlyOne({_id: id});

const statusIs = (id: unknown, status: string) => async (): Promise<boolean> =>
  (await findTask(id)).status === status;

const asAny = (definition: unknown): AnyHarnessTaskDefinition =>
  definition as AnyHarnessTaskDefinition;

/** One phase that waits on `event` (with `timeout`) and completes with what it got. */
const waitsOnce = ({
  event = "approved",
  name,
  runs,
  timeout,
}: {
  event?: string;
  name: string;
  runs: {count: number};
  timeout?: {minutes: number};
}): AnyHarnessTaskDefinition =>
  asAny(
    defineTask<unknown, unknown, unknown>({
      initial: () => ({phase: "await"}),
      name,
      phases: {
        await: {
          run: async (_task, rt) => {
            runs.count += 1;
            const payload = await rt.waitFor(event, {timeout});
            await rt.commit({terminal: {result: {payload: payload ?? null}, status: "completed"}});
          },
        },
      },
      version: 1,
    })
  );

const spansOf = async (task: HarnessTaskDocument) =>
  SpanModel.find({_id: {$ne: task.rootSpanId}, traceId: task.traceId}).sort({_id: 1});

describe("Harness events, waits, and sleep", () => {
  beforeAll(() => {
    createLocalObservabilityPlugin();
    SpanModel = registerObsSpan();
    TraceModel = registerObsTrace();
  });

  beforeEach(async () => {
    clock = START;
    Settings.now = () => clock.toMillis();
    await Promise.all([
      TaskModel.deleteMany({}),
      SpanModel.deleteMany({}),
      TraceModel.deleteMany({}),
      OwnerModel.deleteMany({}),
      InboxModel.deleteMany({}),
    ]);
  });

  afterEach(async () => {
    // Stop runners first so none sees real time (and passed timeouts) mid-stop.
    await Promise.all(openHarnesses.splice(0).map((harness) => harness.stop()));
    Settings.now = () => Date.now();
  });

  it("parks on rt.waitFor without a lease and resumes with the payload sent before the timeout", async () => {
    const runs = {count: 0};
    const definition = waitsOnce({name: "test.waitEvent", runs, timeout: {minutes: 10}});
    const harness = await openHarness([definition]);
    await harness.start();
    const created = await harness.createTask(definition, {});

    await waitUntil(statusIs(created._id, "waiting"), "waiting");
    const waiting = await findTask(created._id);
    expect(waiting.lease?.token).toBeUndefined();
    expect(waiting.waiting?.kind).toBe("event");
    expect(waiting.waiting?.key).toBe("approved");
    expect(waiting.waiting?.timeoutAt?.getTime()).toBe(START.plus({minutes: 10}).toMillis());

    // An event of another name is buffered and leaves the task parked.
    await harness.sendEvent(created._id, "other", 1);
    await pause(150);
    expect((await findTask(created._id)).status).toBe("waiting");
    expect(runs.count).toBe(1);

    clock = START.plus({minutes: 3});
    const sent = await harness.sendEvent(created._id, "approved", {by: "dr-lee", ok: true});
    const done = await harness.waitForTask(created._id, {timeout: {seconds: 10}});
    expect(done.status).toBe("completed");
    expect(done.outcome?.result).toEqual({payload: {by: "dr-lee", ok: true}});
    expect(runs.count).toBe(2);

    const inbox = await InboxModel.findExactlyOne({_id: sent._id});
    expect(inbox.consumedKey).toBe("0:0");
    expect(inbox.seq).toBe(2);

    const spans = await spansOf(done);
    expect(spans.map((span) => span.name)).toEqual(["await", "wait:approved", "await"]);
    expect(spans[0].output).toEqual({
      waiting: {
        key: "approved",
        kind: "event",
        timeoutAt: START.plus({minutes: 10}).toJSDate().toISOString(),
      },
    });
    const resume = spans[1];
    expect(resume.kind).toBe("CHAIN");
    expect(String(resume.parentSpanId)).toBe(String(done.rootSpanId));
    // The span records the payload's shape, not its values.
    expect(resume.output).toEqual({
      event: "approved",
      eventId: String(sent._id),
      payload: {keyCount: 2, keys: ["by", "ok"], type: "object"},
      seq: 2,
      timedOut: false,
    });
    expect(resume.durationMs).toBe(3 * 60 * 1000);
  }, 20_000);

  it("resolves rt.waitFor with undefined once its timeout passes, and not before", async () => {
    const runs = {count: 0};
    const definition = waitsOnce({name: "test.waitTimeout", runs, timeout: {minutes: 10}});
    const harness = await openHarness([definition]);
    await harness.start();
    const created = await harness.createTask(definition, {});
    await waitUntil(statusIs(created._id, "waiting"), "waiting");

    clock = START.plus({minutes: 9, seconds: 59});
    await pause(150);
    expect((await findTask(created._id)).status).toBe("waiting");
    expect(runs.count).toBe(1);

    clock = START.plus({minutes: 10});
    const done = await harness.waitForTask(created._id, {timeout: {seconds: 10}});
    expect(done.outcome?.result).toEqual({payload: null});
    const resume = (await spansOf(done)).find((span) => span.name === "wait:approved");
    expect(resume?.output).toEqual({event: "approved", timedOut: true});

    // The timed-out call completed the task, so a late event has nowhere to go.
    await expect(harness.sendEvent(created._id, "approved", {})).rejects.toThrow(
      /is already completed; it cannot receive event "approved"/
    );
  }, 20_000);

  it("delivers an event sent before the task reaches rt.waitFor without waiting at all", async () => {
    const runs = {count: 0};
    const definition = waitsOnce({name: "test.early", runs});
    const harness = await openHarness([definition]);
    const created = await harness.createTask(definition, {});
    await harness.sendEvent(created._id, "approved", "early bird");
    await harness.start();

    const done = await harness.waitForTask(created._id, {timeout: {seconds: 10}});
    expect(done.outcome?.result).toEqual({payload: "early bird"});
    expect(runs.count).toBe(1);
    expect((await spansOf(done)).map((span) => span.name)).toEqual(["wait:approved", "await"]);
  }, 20_000);

  it("delivers an event sent while no owner runs once a runner starts again", async () => {
    const runs = {count: 0};
    const definition = waitsOnce({name: "test.ownerDown", runs});
    const first = await openHarness([definition]);
    await first.start();
    const created = await first.createTask(definition, {});
    await waitUntil(statusIs(created._id, "waiting"), "waiting");
    await first.stop();

    // A process that never starts a runner (an API server) sends the event.
    const sender = await openHarness([definition]);
    await sender.sendEvent(created._id, "approved", {ok: true});
    expect((await findTask(created._id)).status).toBe("pending");
    await pause(100);
    expect(runs.count).toBe(1);

    const restarted = await openHarness([definition]);
    await restarted.start();
    const done = await restarted.waitForTask(created._id, {timeout: {seconds: 10}});
    expect(done.outcome?.result).toEqual({payload: {ok: true}});
    expect(runs.count).toBe(2);
  }, 20_000);

  it("treats a repeated requestId as one event and rejects reusing it for another name", async () => {
    const definition = waitsOnce({name: "test.idempotent", runs: {count: 0}});
    const harness = await openHarness([definition]);
    const created = await harness.createTask(definition, {});

    const first = await harness.sendEvent(created._id, "approved", 1, {requestId: "req-1"});
    const again = await harness.sendEvent(created._id, "approved", 2, {requestId: "req-1"});
    expect(String(again._id)).toBe(String(first._id));
    expect(again.payload).toBe(1);
    expect(await InboxModel.countDocuments({taskId: created._id})).toBe(1);
    expect((await findTask(created._id)).eventSeq).toBe(1);
    await expect(
      harness.sendEvent(created._id, "rejected", 3, {requestId: "req-1"})
    ).rejects.toThrow(/already sent event "approved"/);

    // The same key on another task is a different event.
    const other = await harness.createTask(definition, {});
    const otherEvent = await harness.sendEvent(other._id, "approved", 4, {requestId: "req-1"});
    expect(String(otherEvent._id)).not.toBe(String(first._id));
  }, 20_000);

  it("rt.sleep parks until its duration passes, then resumes", async () => {
    const runs = {count: 0};
    const definition = asAny(
      defineTask<unknown, unknown, unknown>({
        initial: () => ({phase: "nap"}),
        name: "test.sleep",
        phases: {
          nap: {
            run: async (_task, rt) => {
              runs.count += 1;
              await rt.sleep({minutes: 5});
              await rt.commit({terminal: {result: {woke: true}, status: "completed"}});
            },
          },
        },
        version: 1,
      })
    );
    const harness = await openHarness([definition]);
    await harness.start();
    const created = await harness.createTask(definition, {});
    await waitUntil(statusIs(created._id, "waiting"), "waiting");
    const waiting = await findTask(created._id);
    expect(waiting.waiting?.kind).toBe("sleep");
    expect(waiting.lease?.token).toBeUndefined();
    expect(waiting.waiting?.timeoutAt?.getTime()).toBe(START.plus({minutes: 5}).toMillis());

    clock = START.plus({minutes: 4});
    await pause(150);
    expect(runs.count).toBe(1);

    clock = START.plus({minutes: 5});
    const done = await harness.waitForTask(created._id, {timeout: {seconds: 10}});
    expect(done.outcome?.result).toEqual({woke: true});
    expect(runs.count).toBe(2);
    const spans = await spansOf(done);
    expect(spans.map((span) => span.name)).toEqual(["nap", "sleep", "nap"]);
    expect(spans[1].output).toEqual({elapsed: true});
    // The phase commit clears the visit's wait records.
    expect(done.waits).toBeUndefined();
  }, 20_000);

  it("aborts a waiting task, clears its wait, and refuses later events", async () => {
    const definition = waitsOnce({name: "test.abortWait", runs: {count: 0}, timeout: {minutes: 1}});
    const harness = await openHarness([definition]);
    await harness.start();
    const created = await harness.createTask(definition, {});
    await waitUntil(statusIs(created._id, "waiting"), "waiting");

    const aborted = await harness.abort(created._id, {reason: "Patient left"});
    expect(aborted.status).toBe("aborted");
    expect(aborted.waiting?.kind).toBeUndefined();
    expect(aborted.waits).toBeUndefined();

    // Its timeout passing later does not resurrect it.
    clock = START.plus({minutes: 2});
    await pause(150);
    expect((await findTask(created._id)).status).toBe("aborted");
    await expect(harness.sendEvent(created._id, "approved", {})).rejects.toThrow(
      /is already aborted/
    );
  }, 20_000);

  it("runs sequential waits in one phase, FIFO per event name, and replays recorded results", async () => {
    const runs = {count: 0};
    const seen: unknown[][] = [];
    const definition = asAny(
      defineTask<unknown, unknown, unknown>({
        initial: () => ({phase: "collect"}),
        name: "test.sequential",
        phases: {
          collect: {
            run: async (_task, rt) => {
              runs.count += 1;
              const first = await rt.waitFor<number>("item");
              const second = await rt.waitFor<number>("item");
              const done = await rt.waitFor<string>("done", {timeout: {minutes: 1}});
              seen.push([first, second, done]);
              // The first full run fails after its waits; the retry must not wait again.
              if (seen.length === 1) {
                throw new Error("EHR 503");
              }
              await rt.commit({terminal: {result: [first, second, done], status: "completed"}});
            },
          },
        },
        retry: {backoffMs: 0, maxAttempts: 2},
        version: 1,
      })
    );
    const harness = await openHarness([definition]);
    await harness.start();
    const created = await harness.createTask(definition, {});
    await waitUntil(statusIs(created._id, "waiting"), "first wait");
    await harness.sendEvent(created._id, "item", 1);
    await harness.sendEvent(created._id, "item", 2);
    await harness.sendEvent(created._id, "item", 3);
    await waitUntil(
      async () => (await findTask(created._id)).waiting?.key === "done",
      "waiting on done"
    );
    await harness.sendEvent(created._id, "done", "yes");

    const done = await harness.waitForTask(created._id, {timeout: {seconds: 10}});
    expect(done.status).toBe("completed");
    expect(done.outcome?.result).toEqual([1, 2, "yes"]);
    expect(seen).toEqual([
      [1, 2, "yes"],
      [1, 2, "yes"],
    ]);
    // The third "item" stays buffered for a later wait.
    const leftover = await InboxModel.find({consumedKey: {$exists: false}, taskId: created._id});
    expect(leftover.map((event) => event.payload)).toEqual([3]);
    const resumes = (await spansOf(done)).filter((span) => span.name.startsWith("wait:"));
    expect(resumes.map((span) => span.name)).toEqual(["wait:item", "wait:item", "wait:done"]);
  }, 20_000);

  it("rejects events for terminal tasks, blank names, and unknown tasks", async () => {
    const definition = asAny(
      defineTask<unknown, unknown, unknown>({
        initial: () => ({phase: "work"}),
        name: "test.quick",
        phases: {
          work: {run: async (_task, rt) => rt.commit({terminal: {status: "completed"}})},
        },
        version: 1,
      })
    );
    const harness = await openHarness([definition]);
    await harness.start();
    const created = await harness.createTask(definition, {});
    await harness.waitForTask(created._id, {timeout: {seconds: 10}});

    await expect(harness.sendEvent(created._id, "approved", {})).rejects.toThrow(
      `Task ${created._id} is already completed; it cannot receive event "approved"`
    );
    await expect(harness.sendEvent(created._id, " ", {})).rejects.toThrow(
      "sendEvent requires an event name"
    );
    await expect(harness.sendEvent(new mongoose.Types.ObjectId(), "approved")).rejects.toThrow(
      /no documents/
    );
  }, 20_000);

  it("fails the task when waits are misused", async () => {
    const make = (name: string, run: Parameters<typeof defineTask>[0]["phases"][string]["run"]) =>
      asAny(
        defineTask<unknown, unknown, unknown>({
          initial: () => ({phase: "work"}),
          name,
          phases: {work: {run}},
          version: 1,
        })
      );
    const blank = make("test.blankEvent", async (_task, rt) => {
      await rt.waitFor("");
    });
    const badSleep = make("test.badSleep", async (_task, rt) => {
      await rt.sleep({minutes: -1});
    });
    const afterCommit = make("test.waitAfterCommit", async (_task, rt) => {
      await rt.commit({terminal: {status: "completed"}});
      await rt.sleep({seconds: 1});
    });
    const harness = await openHarness([blank, badSleep, afterCommit]);
    await harness.start();

    const blankDone = await harness.waitForTask((await harness.createTask(blank, {}))._id, {
      timeout: {seconds: 10},
    });
    expect(blankDone.outcome?.error).toMatch(/rt.waitFor requires an event name/);
    expect(blankDone.attempt).toBe(0);
    const sleepDone = await harness.waitForTask((await harness.createTask(badSleep, {}))._id, {
      timeout: {seconds: 10},
    });
    expect(sleepDone.outcome?.error).toMatch(/rt.sleep duration must be a valid, non-negative/);
    // A wait after the commit is ignored with a warning; the checkpoint stands.
    const committed = await harness.waitForTask((await harness.createTask(afterCommit, {}))._id, {
      timeout: {seconds: 10},
    });
    expect(committed.status).toBe("completed");
  }, 20_000);

  it("fails the task when wait calls change order between runs of a phase", async () => {
    let isFirstRun = true;
    const definition = asAny(
      defineTask<unknown, unknown, unknown>({
        initial: () => ({phase: "work"}),
        name: "test.reorder",
        phases: {
          work: {
            run: async (_task, rt) => {
              const event = isFirstRun ? "a" : "b";
              isFirstRun = false;
              await rt.waitFor(event);
              await rt.commit({terminal: {status: "completed"}});
            },
          },
        },
        version: 1,
      })
    );
    const harness = await openHarness([definition]);
    await harness.start();
    const created = await harness.createTask(definition, {});
    await waitUntil(statusIs(created._id, "waiting"), "waiting");
    await harness.sendEvent(created._id, "a", 1);
    const done = await harness.waitForTask(created._id, {timeout: {seconds: 10}});
    expect(done.status).toBe("failed");
    expect(done.outcome?.error).toMatch(
      /wait call 0:0 was rt.waitFor\("a"\) on an earlier run and is rt.waitFor\("b"\) now/
    );
  }, 20_000);

  it("replays a recorded timeout while later waits run, and summarizes null and array payloads", async () => {
    const runs = {count: 0};
    const definition = asAny(
      defineTask<unknown, unknown, unknown>({
        initial: () => ({phase: "mixed"}),
        name: "test.mixed",
        phases: {
          mixed: {
            run: async (_task, rt) => {
              runs.count += 1;
              const first = await rt.waitFor("a", {timeout: {minutes: 1}});
              const second = await rt.waitFor("b");
              const third = await rt.waitFor("b");
              await rt.commit({
                terminal: {result: [first ?? "timed out", second, third], status: "completed"},
              });
            },
          },
        },
        version: 1,
      })
    );
    const harness = await openHarness([definition]);
    await harness.start();
    const created = await harness.createTask(definition, {});
    await waitUntil(statusIs(created._id, "waiting"), "waiting on a");
    clock = START.plus({minutes: 1});
    await waitUntil(async () => (await findTask(created._id)).waiting?.key === "b", "waiting on b");
    // An "a" arriving after the timeout is never handed to the timed-out call.
    const late = await harness.sendEvent(created._id, "a", "late");
    await harness.sendEvent(created._id, "b", null);
    // Parked at the third wait, so the next "b" wakes it instead of being found at once.
    await waitUntil(async () => {
      const task = await findTask(created._id);
      return runs.count === 3 && task.status === "waiting" && Boolean(task.waits?.["0:2"]);
    }, "parked at the second b wait");
    await harness.sendEvent(created._id, "b", [1, 2]);

    const done = await harness.waitForTask(created._id, {timeout: {seconds: 10}});
    expect(done.outcome?.result).toEqual(["timed out", null, [1, 2]]);
    expect((await InboxModel.findExactlyOne({_id: late._id})).consumedKey).toBeUndefined();
    expect(runs.count).toBe(4);
    const resumes = (await spansOf(done)).filter((span) => span.name.startsWith("wait:"));
    expect(resumes.map((span) => (span.output as {payload?: unknown}).payload)).toEqual([
      undefined,
      {type: "null"},
      {length: 2, type: "array"},
    ]);
  }, 20_000);

  it("keeps one event for concurrent sends with one requestId", async () => {
    const definition = waitsOnce({name: "test.concurrentSend", runs: {count: 0}});
    const harness = await openHarness([definition]);
    const created = await harness.createTask(definition, {});
    const sent = await Promise.all(
      [1, 2, 3].map((n) => harness.sendEvent(created._id, "approved", n, {requestId: "same"}))
    );
    expect(new Set(sent.map((event) => String(event._id))).size).toBe(1);
    expect(await InboxModel.countDocuments({taskId: created._id})).toBe(1);
    // The losing sends rolled back their eventSeq increments.
    expect((await findTask(created._id)).eventSeq).toBe(1);
  }, 20_000);

  it("fails the task when a wait duration is not a duration", async () => {
    const definition = asAny(
      defineTask<unknown, unknown, unknown>({
        initial: () => ({phase: "work"}),
        name: "test.notDuration",
        phases: {
          work: {
            run: async (_task, rt) => {
              await rt.waitFor("a", {timeout: "soon" as unknown as {minutes: number}});
            },
          },
        },
        version: 1,
      })
    );
    const harness = await openHarness([definition]);
    await harness.start();
    const done = await harness.waitForTask((await harness.createTask(definition, {}))._id, {
      timeout: {seconds: 10},
    });
    expect(done.outcome?.error).toMatch(/rt.waitFor timeout must be a Luxon duration/);
  }, 20_000);

  it("never loses an event sent while the waiting commit is in flight", async () => {
    const runs = {count: 0};
    const definition = waitsOnce({name: "test.overlap", runs});
    let harness: Harness | undefined;
    let taskId: unknown;
    let send: Promise<unknown> | undefined;
    harness = await openHarness([definition], {
      beforeCommitEnd: async ({phase}) => {
        // The first commit of "await" is the waiting commit. Start a send and hold the
        // transaction open so the send's own transaction runs against it.
        if (phase === "await" && !send && harness) {
          send = harness.sendEvent(String(taskId), "approved", "overlap");
          await pause(150);
        }
      },
    });
    const created = await harness.createTask(definition, {});
    taskId = created._id;
    await harness.start();

    const done = await harness.waitForTask(created._id, {timeout: {seconds: 10}});
    await send;
    expect(done.outcome?.result).toEqual({payload: "overlap"});
    expect(runs.count).toBe(2);
  }, 20_000);

  it("prefers an event that is already buffered over a timeout that passed before the claim", async () => {
    const runs = {count: 0};
    const definition = waitsOnce({name: "test.lateClaim", runs, timeout: {minutes: 1}});
    const first = await openHarness([definition]);
    await first.start();
    const created = await first.createTask(definition, {});
    await waitUntil(statusIs(created._id, "waiting"), "waiting");
    await first.stop();

    clock = START.plus({minutes: 5});
    await first.sendEvent(created._id, "approved", "made it");
    const restarted = await openHarness([definition]);
    await restarted.start();
    const done = await restarted.waitForTask(created._id, {timeout: {seconds: 10}});
    expect(done.outcome?.result).toEqual({payload: "made it"});
  }, 20_000);

  it("a run that lost its lease cannot take an event, even when the phase catches the error", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const caught: string[] = [];
    const definition = asAny(
      defineTask<unknown, unknown, unknown>({
        initial: () => ({phase: "work"}),
        name: "test.staleRun",
        phases: {
          work: {
            run: async (_task, rt) => {
              await gate;
              try {
                await rt.waitFor("a");
              } catch (error: unknown) {
                caught.push((error as Error).name);
              }
              // Carrying on after the conflict must not be able to checkpoint.
              await rt.commit({terminal: {status: "completed"}}).catch((error: Error) => {
                caught.push(error.message);
              });
            },
          },
        },
        version: 1,
      })
    );
    const harness = await openHarness([definition]);
    const created = await harness.createTask(definition, {});
    const sent = await harness.sendEvent(created._id, "a", 1);
    await harness.start();
    await waitUntil(statusIs(created._id, "running"), "running");
    // Another runner took the task over.
    await TaskModel.updateOne({_id: created._id}, {$set: {"lease.token": "taken-over"}});
    release();

    await waitUntil(async () => caught.length === 2, "phase finished");
    expect(caught[0]).toBe("HarnessCommitConflictError");
    expect(caught[1]).toMatch(/rt.commit called more than once/);
    expect((await InboxModel.findExactlyOne({_id: sent._id})).consumedKey).toBeUndefined();
    const task = await findTask(created._id);
    expect(task.status).toBe("running");
    expect(task.waits).toBeUndefined();
  }, 20_000);

  it("a wait commit that finds a buffered event returns the task straight to pending", async () => {
    // The race: an event lands between rt.waitFor's inbox check and its waiting commit.
    const definition = waitsOnce({name: "test.race", runs: {count: 0}});
    const harness = await openHarness([definition]);
    const created = await harness.createTask(definition, {});
    const running = await TaskModel.findOneAndUpdate(
      {_id: created._id},
      {
        $set: {
          lease: {expiresAt: START.plus({minutes: 1}).toJSDate(), token: "t1"},
          status: "running",
        },
      },
      {returnDocument: "after"}
    );
    await InboxModel.create({name: "approved", payload: 1, seq: 1, taskId: created._id});
    const models = {
      event: registerHarnessEvent(),
      eventStream: registerHarnessEventStream(),
      inbox: InboxModel,
      span: SpanModel,
      task: TaskModel,
      trace: TraceModel,
    } as unknown as HarnessModels;

    const parked = await commitWaiting({
      models,
      phaseStartedAt: START,
      task: running as HarnessTaskDocument,
      waitCall: {entry: {key: "approved", kind: "event", startedAt: START.toJSDate()}, key: "0:0"},
      waiting: {key: "approved", kind: "event"},
    });
    expect(parked.isWoken).toBe(true);
    const task = await findTask(created._id);
    expect(task.status).toBe("pending");
    expect(task.waiting?.kind).toBeUndefined();
    expect(task.waits?.["0:0"]?.key).toBe("approved");
  }, 20_000);
});
