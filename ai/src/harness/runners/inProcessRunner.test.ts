import {describe, expect, it} from "bun:test";

import type {HarnessRunnerContext, HarnessTaskDocument} from "../../types/harness";
import {InProcessRunner} from "./inProcessRunner";

const fakeTask = (id: string): HarnessTaskDocument => ({_id: id}) as unknown as HarnessTaskDocument;

const waitUntil = async (predicate: () => boolean): Promise<void> => {
  for (let i = 0; i < 200; i++) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("waitUntil timed out");
};

describe("InProcessRunner", () => {
  it("runs claimed tasks in order and sleeps when idle", async () => {
    const queue = [fakeTask("a"), fakeTask("b")];
    const ran: string[] = [];
    let claims = 0;
    const context: HarnessRunnerContext = {
      claimNext: async () => {
        claims += 1;
        return queue.shift() ?? null;
      },
      runTask: async (task) => {
        ran.push(String(task._id));
      },
    };
    const runner = new InProcessRunner({pollInterval: {milliseconds: 5}});

    await runner.start(context);
    // Two claims return work, then the idle runner keeps polling.
    await waitUntil(() => claims >= 5);
    await runner.stop();

    expect(ran).toEqual(["a", "b"]);
    expect(claims).toBeGreaterThanOrEqual(5);
  });

  it("wakes from an idle sleep when new work arrives", async () => {
    const queue: HarnessTaskDocument[] = [];
    const ran: string[] = [];
    const context: HarnessRunnerContext = {
      claimNext: async () => queue.shift() ?? null,
      runTask: async (task) => {
        ran.push(String(task._id));
      },
    };
    // A poll interval far longer than the test: only wake() can pick up the task.
    const runner = new InProcessRunner({pollInterval: {minutes: 10}});
    await runner.start(context);
    await new Promise((resolve) => setTimeout(resolve, 10));

    queue.push(fakeTask("late"));
    runner.wake();
    await waitUntil(() => ran.length > 0);
    await runner.stop();

    expect(ran).toEqual(["late"]);
  });

  it("keeps polling after a claim error", async () => {
    let claims = 0;
    const ran: string[] = [];
    const context: HarnessRunnerContext = {
      claimNext: async () => {
        claims += 1;
        if (claims === 1) {
          throw new Error("primary stepped down");
        }
        return claims === 2 ? fakeTask("recovered") : null;
      },
      runTask: async (task) => {
        ran.push(String(task._id));
      },
    };
    const runner = new InProcessRunner({pollInterval: {milliseconds: 5}});

    await runner.start(context);
    await waitUntil(() => ran.length > 0);
    await runner.stop();

    expect(ran).toEqual(["recovered"]);
  });

  it("does not lose a wake that arrives while a claim is in flight", async () => {
    const ran: string[] = [];
    let claims = 0;
    let runner: InProcessRunner | undefined;
    const context: HarnessRunnerContext = {
      claimNext: async () => {
        claims += 1;
        if (claims === 1) {
          // New work lands after this claim looked but before the runner sleeps.
          runner?.wake();
          return null;
        }
        return claims === 2 ? fakeTask("racing") : null;
      },
      runTask: async (task) => {
        ran.push(String(task._id));
      },
    };
    runner = new InProcessRunner({pollInterval: {minutes: 10}});

    await runner.start(context);
    await waitUntil(() => ran.length > 0);
    await runner.stop();

    expect(ran).toEqual(["racing"]);
  });

  it("waits for the task in flight before stop resolves", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started = false;
    let isStopped = false;
    const queue = [fakeTask("slow")];
    const context: HarnessRunnerContext = {
      claimNext: async () => queue.shift() ?? null,
      runTask: async () => {
        started = true;
        await gate;
      },
    };
    const runner = new InProcessRunner({pollInterval: {milliseconds: 5}});
    await runner.start(context);
    await waitUntil(() => started);

    const stopping = runner.stop().then(() => {
      isStopped = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(isStopped).toBe(false);

    release();
    await stopping;
    expect(isStopped).toBe(true);
  });

  it("rejects a second start while running", async () => {
    const context: HarnessRunnerContext = {claimNext: async () => null, runTask: async () => {}};
    const runner = new InProcessRunner({pollInterval: {milliseconds: 5}});
    await runner.start(context);
    await expect(runner.start(context)).rejects.toThrow("InProcessRunner is already started");
    await runner.stop();
  });
});
