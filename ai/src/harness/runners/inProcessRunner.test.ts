import {describe, expect, it} from "bun:test";
import {harnessErrorMatching} from "../../tests/harnessErrors";
import type {
  HarnessLeaseSettings,
  HarnessRunnerContext,
  HarnessTaskDocument,
} from "../../types/harness";
import {InProcessRunner} from "./inProcessRunner";

const fakeTask = (id: string): HarnessTaskDocument => ({_id: id}) as unknown as HarnessTaskDocument;

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
    const context = fakeContext({
      claimNext: async () => {
        claims += 1;
        return queue.shift() ?? null;
      },
      runTask: async (task) => {
        ran.push(String(task._id));
      },
    });
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
    const context = fakeContext({
      claimNext: async () => queue.shift() ?? null,
      runTask: async (task) => {
        ran.push(String(task._id));
      },
    });
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
    const context = fakeContext({
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
    });
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
    const context = fakeContext({
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
    });
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
    const context = fakeContext({
      claimNext: async () => queue.shift() ?? null,
      runTask: async () => {
        started = true;
        await gate;
      },
    });
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

  describe("concurrency", () => {
    const blockingTask = (): {done: Promise<void>; release: () => void} => {
      let release: () => void = () => {};
      const done = new Promise<void>((resolve) => {
        release = resolve;
      });
      return {done, release};
    };

    it("defaults to 8 tasks at a time", async () => {
      const gates = Array.from({length: 10}, () => blockingTask());
      const queue = gates.map((_gate, index) => fakeTask(String(index)));
      let running = 0;
      let peak = 0;
      const context = fakeContext({
        claimNext: async () => queue.shift() ?? null,
        runTask: async (task) => {
          running += 1;
          peak = Math.max(peak, running);
          await gates[Number(task._id)].done;
          running -= 1;
        },
      });
      const runner = new InProcessRunner({pollInterval: {milliseconds: 5}});
      await runner.start(context);
      await waitUntil(() => running === 8);
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(running).toBe(8);
      expect(queue.length).toBe(2);
      for (const gate of gates) {
        gate.release();
      }
      await waitUntil(() => queue.length === 0 && running === 0);
      await runner.stop();
      expect(peak).toBe(8);
    });

    it("lets a second task complete while the first is blocked on a gate", async () => {
      const slow = blockingTask();
      const finished: string[] = [];
      const queue = [fakeTask("slow"), fakeTask("fast")];
      const context = fakeContext({
        claimNext: async () => queue.shift() ?? null,
        runTask: async (task) => {
          if (String(task._id) === "slow") {
            await slow.done;
          }
          finished.push(String(task._id));
        },
      });
      const runner = new InProcessRunner({concurrency: 2, pollInterval: {minutes: 10}});
      await runner.start(context);

      await waitUntil(() => finished.length === 1);
      expect(finished).toEqual(["fast"]);
      slow.release();
      await waitUntil(() => finished.length === 2);
      await runner.stop();
      expect(finished).toEqual(["fast", "slow"]);
    });

    it("never runs more than concurrency tasks and claims again as soon as a slot frees", async () => {
      const queue = ["a", "b", "c", "d", "e"].map(fakeTask);
      const ran: string[] = [];
      let running = 0;
      let peak = 0;
      const context = fakeContext({
        claimNext: async () => queue.shift() ?? null,
        runTask: async (task) => {
          running += 1;
          peak = Math.max(peak, running);
          await new Promise((resolve) => setTimeout(resolve, 15));
          ran.push(String(task._id));
          running -= 1;
        },
      });
      // Only a freed slot (not the 10-minute poll) can pick up the rest.
      const runner = new InProcessRunner({concurrency: 2, pollInterval: {minutes: 10}});
      await runner.start(context);
      await waitUntil(() => ran.length === 5);
      await runner.stop();

      expect(peak).toBe(2);
      expect([...ran].sort()).toEqual(["a", "b", "c", "d", "e"]);
    });

    it("waits for every task in flight before stop resolves", async () => {
      const gates = [blockingTask(), blockingTask()];
      const queue = [fakeTask("0"), fakeTask("1")];
      let started = 0;
      let isStopped = false;
      const context = fakeContext({
        claimNext: async () => queue.shift() ?? null,
        runTask: async (task) => {
          started += 1;
          await gates[Number(task._id)].done;
        },
      });
      const runner = new InProcessRunner({concurrency: 2, pollInterval: {milliseconds: 5}});
      await runner.start(context);
      await waitUntil(() => started === 2);

      const stopping = runner.stop().then(() => {
        isStopped = true;
      });
      gates[0].release();
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(isStopped).toBe(false);
      gates[1].release();
      await stopping;
      expect(isStopped).toBe(true);
    });

    it("rejects a concurrency that is not a positive integer", () => {
      for (const concurrency of [0, -1, 1.5]) {
        expect(() => new InProcessRunner({concurrency})).toThrow(
          harnessErrorMatching(
            "configInvalid",
            "InProcessRunner concurrency must be a positive integer"
          )
        );
      }
    });
  });

  it("rejects a second start while running", async () => {
    const context = fakeContext({claimNext: async () => null, runTask: async () => {}});
    const runner = new InProcessRunner({pollInterval: {milliseconds: 5}});
    await runner.start(context);
    await expect(runner.start(context)).rejects.toThrow(
      harnessErrorMatching("alreadyStarted", "InProcessRunner is already started")
    );
    await runner.stop();
  });

  describe("owner lease", () => {
    const fastLease = {heartbeatInterval: {milliseconds: 10}, leaseDuration: {milliseconds: 100}};

    it("stays standby without claiming until the owner lease is free, then recovers first", async () => {
      const calls: string[] = [];
      let isLeaseFree = false;
      let seenLease: HarnessLeaseSettings | undefined;
      const runner = new InProcessRunner({
        ...fastLease,
        ownerId: "runner-b",
        pollInterval: {milliseconds: 5},
      });
      const context = fakeContext({
        acquireOwnerLease: async (lease) => {
          seenLease = lease;
          calls.push(isLeaseFree ? "acquire:ok" : "acquire:held");
          return isLeaseFree;
        },
        claimNext: async () => {
          calls.push("claim");
          return null;
        },
        recoverExpired: async () => {
          calls.push("recover");
          return 0;
        },
      });

      await runner.start(context);
      await waitUntil(() => calls.length >= 3);
      expect(runner.role).toBe("standby");
      expect(calls.every((call) => call === "acquire:held")).toBe(true);

      isLeaseFree = true;
      await waitUntil(() => calls.includes("claim"));
      expect(runner.role).toBe("owner");
      const tookOver = calls.indexOf("acquire:ok");
      expect(calls.slice(tookOver, tookOver + 3)).toEqual(["acquire:ok", "recover", "claim"]);
      expect(seenLease?.owner).toBe("runner-b");
      expect(seenLease?.duration.toMillis()).toBe(100);
      expect(seenLease?.heartbeat.toMillis()).toBe(10);
      await runner.stop();
      expect(runner.role).toBe("stopped");
    });

    it("renews the lease and sweeps for expired tasks on every heartbeat", async () => {
      let renewals = 0;
      let sweeps = 0;
      const runner = new InProcessRunner({...fastLease, pollInterval: {minutes: 10}});
      await runner.start(
        fakeContext({
          acquireOwnerLease: async () => {
            renewals += 1;
            return true;
          },
          recoverExpired: async () => {
            sweeps += 1;
            return 0;
          },
        })
      );
      await waitUntil(() => renewals >= 4 && sweeps >= 4);
      await runner.stop();
      expect(runner.role).toBe("stopped");
    });

    it("wakes to claim when a heartbeat sweep makes a task runnable", async () => {
      const queue: HarnessTaskDocument[] = [];
      const ran: string[] = [];
      let sweeps = 0;
      // Only the heartbeat's wake can end this idle sleep inside the test.
      const runner = new InProcessRunner({...fastLease, pollInterval: {minutes: 10}});
      await runner.start(
        fakeContext({
          claimNext: async () => queue.shift() ?? null,
          recoverExpired: async () => {
            sweeps += 1;
            if (sweeps === 2) {
              queue.push(fakeTask("recovered"));
              return 1;
            }
            return 0;
          },
          runTask: async (task) => {
            ran.push(String(task._id));
          },
        })
      );
      await waitUntil(() => ran.length > 0);
      await runner.stop();
      expect(ran).toEqual(["recovered"]);
    });

    it("drops to standby and stops claiming when a renewal loses the lease", async () => {
      let acquisitions = 0;
      let claimsAfterLoss = 0;
      let isLost = false;
      const runner = new InProcessRunner({...fastLease, pollInterval: {milliseconds: 5}});
      await runner.start(
        fakeContext({
          acquireOwnerLease: async () => {
            acquisitions += 1;
            if (acquisitions >= 2) {
              isLost = true;
              return false;
            }
            return true;
          },
          claimNext: async () => {
            if (isLost && runner.role === "standby") {
              claimsAfterLoss += 1;
            }
            return null;
          },
        })
      );
      await waitUntil(() => isLost && runner.role === "standby");
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(runner.role).toBe("standby");
      expect(claimsAfterLoss).toBe(0);
      await runner.stop();
    });

    it("keeps renewing the owner lease while stop waits for the task in flight", async () => {
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let isRunning = false;
      let renewalsWhileStopping = 0;
      let sweepsWhileStopping = 0;
      let isStopRequested = false;
      const queue = [fakeTask("long")];
      const runner = new InProcessRunner({...fastLease, pollInterval: {milliseconds: 5}});
      await runner.start(
        fakeContext({
          acquireOwnerLease: async () => {
            if (isStopRequested) {
              renewalsWhileStopping += 1;
            }
            return true;
          },
          claimNext: async () => queue.shift() ?? null,
          recoverExpired: async () => {
            if (isStopRequested) {
              sweepsWhileStopping += 1;
            }
            return 0;
          },
          runTask: async () => {
            isRunning = true;
            await gate;
          },
        })
      );
      await waitUntil(() => isRunning);

      isStopRequested = true;
      const stopping = runner.stop();
      // The task outlives several lease lifetimes' worth of heartbeats.
      await waitUntil(() => renewalsWhileStopping >= 3);
      release();
      await stopping;

      expect(sweepsWhileStopping).toBe(0);
      const renewalsAtStop = renewalsWhileStopping;
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(renewalsWhileStopping).toBe(renewalsAtStop);
    });

    it("releases the owner lease on stop, but not when it never owned it", async () => {
      const released: string[] = [];
      const owner = new InProcessRunner({...fastLease, ownerId: "owner"});
      await owner.start(
        fakeContext({releaseOwnerLease: async (lease) => void released.push(lease.owner)})
      );
      await waitUntil(() => owner.role === "owner");
      await owner.stop();

      const standby = new InProcessRunner({...fastLease, ownerId: "standby"});
      await standby.start(
        fakeContext({
          acquireOwnerLease: async () => false,
          releaseOwnerLease: async (lease) => void released.push(lease.owner),
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
      await standby.stop();

      expect(released).toEqual(["owner"]);
    });

    it("keeps standby when acquiring the lease throws", async () => {
      let attempts = 0;
      const runner = new InProcessRunner({...fastLease, pollInterval: {milliseconds: 5}});
      await runner.start(
        fakeContext({
          acquireOwnerLease: async () => {
            attempts += 1;
            if (attempts === 1) {
              throw new Error("primary stepped down");
            }
            return true;
          },
        })
      );
      await waitUntil(() => runner.role === "owner");
      expect(attempts).toBeGreaterThanOrEqual(2);
      await runner.stop();
    });

    it("rejects a heartbeat that is not shorter than the lease", () => {
      expect(
        () => new InProcessRunner({heartbeatInterval: {seconds: 30}, leaseDuration: {seconds: 30}})
      ).toThrow(
        harnessErrorMatching(
          "configInvalid",
          "InProcessRunner heartbeatInterval must be positive and shorter than leaseDuration"
        )
      );
      expect(() => new InProcessRunner({heartbeatInterval: {seconds: 0}})).toThrow(
        harnessErrorMatching("configInvalid", "heartbeatInterval must be positive")
      );
    });

    it("defaults the owner id to host, pid, and a unique suffix", () => {
      const first = new InProcessRunner();
      const second = new InProcessRunner();
      expect(first.ownerId).toContain(`:${process.pid}:`);
      expect(first.ownerId).not.toBe(second.ownerId);
      expect(new InProcessRunner({ownerId: "named"}).ownerId).toBe("named");
    });
  });
});
