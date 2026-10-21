import {describe, expect, it} from "bun:test";

import {
  type BetterAuthAdapterOptions,
  betterAuthAdapter,
  DEFAULT_AUTH_POLL_INTERVAL_MS,
} from "./betterAuthAdapter";
import type {BetterAuthClientLike, BetterAuthGetSessionResult} from "./types";

const flush = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const makeClient = (
  result: () => Promise<BetterAuthGetSessionResult>,
  useSession?: BetterAuthClientLike["useSession"]
): BetterAuthClientLike => ({getSession: result, useSession});

describe("betterAuthAdapter", () => {
  describe("getToken / getUserId", () => {
    it("reads token and userId from the {data} envelope shape", async () => {
      const adapter = betterAuthAdapter(
        makeClient(async () => ({data: {session: {token: "tok-1"}, user: {id: "u1"}}}))
      );
      expect(await adapter.getToken()).toBe("tok-1");
      expect(await adapter.getUserId()).toBe("u1");
    });

    it("reads token and userId from the direct (unwrapped) shape", async () => {
      const adapter = betterAuthAdapter(
        makeClient(async () => ({session: {token: "tok-2"}, user: {id: "u2"}}))
      );
      expect(await adapter.getToken()).toBe("tok-2");
      expect(await adapter.getUserId()).toBe("u2");
    });

    it("returns null when signed out (null, undefined, or empty envelope)", async () => {
      for (const result of [null, undefined, {data: null}, {data: {}}, {}]) {
        const adapter = betterAuthAdapter(makeClient(async () => result));
        expect(await adapter.getToken()).toBeNull();
        expect(await adapter.getUserId()).toBeNull();
      }
    });

    it("returns null when the session payload is missing token or user id", async () => {
      const adapter = betterAuthAdapter(makeClient(async () => ({data: {session: {}, user: {}}})));
      expect(await adapter.getToken()).toBeNull();
      expect(await adapter.getUserId()).toBeNull();
    });

    it("returns null when getSession rejects", async () => {
      const adapter = betterAuthAdapter(
        makeClient(async () => {
          throw new Error("network down");
        })
      );
      expect(await adapter.getToken()).toBeNull();
      expect(await adapter.getUserId()).toBeNull();
    });

    it("keeps the confirmed user id when a later read fails, so offline is not a sign-out", async () => {
      let next: () => Promise<BetterAuthGetSessionResult> = async () => ({
        data: {session: {token: "tok"}, user: {id: "u1"}},
      });
      const adapter = betterAuthAdapter(makeClient(() => next()));
      expect(await adapter.getUserId()).toBe("u1");

      next = async () => {
        throw new TypeError("Failed to fetch");
      };
      expect(await adapter.getUserId()).toBe("u1");
      expect(await adapter.getToken()).toBeNull();

      next = async () =>
        ({
          data: null,
          error: {status: 0, statusText: "Failed to fetch"},
        }) as BetterAuthGetSessionResult;
      expect(await adapter.getUserId()).toBe("u1");
    });

    it("returns null after the server confirms sign-out, even if a later read fails", async () => {
      let next: () => Promise<BetterAuthGetSessionResult> = async () => ({
        data: {session: {token: "tok"}, user: {id: "u1"}},
      });
      const adapter = betterAuthAdapter(makeClient(() => next()));
      expect(await adapter.getUserId()).toBe("u1");

      next = async () => ({data: null});
      expect(await adapter.getUserId()).toBeNull();
      next = async () => {
        throw new TypeError("Failed to fetch");
      };
      expect(await adapter.getUserId()).toBeNull();
    });

    it("treats a 401 error envelope as signed out", async () => {
      let next: () => Promise<BetterAuthGetSessionResult> = async () => ({
        data: {session: {token: "tok"}, user: {id: "u1"}},
      });
      const adapter = betterAuthAdapter(makeClient(() => next()));
      expect(await adapter.getUserId()).toBe("u1");
      next = async () =>
        ({
          data: null,
          error: {status: 401, statusText: "Unauthorized"},
        }) as BetterAuthGetSessionResult;
      expect(await adapter.getUserId()).toBeNull();
    });

    it("returns null when getSession resolves to a non-object", async () => {
      const adapter = betterAuthAdapter(
        makeClient(async () => "nonsense" as unknown as BetterAuthGetSessionResult)
      );
      expect(await adapter.getToken()).toBeNull();
    });
  });

  describe("getBearerToken option", () => {
    const makeCountingClient = (): {client: BetterAuthClientLike; calls: () => number} => {
      let count = 0;
      return {
        calls: (): number => count,
        client: makeClient(async () => {
          count += 1;
          return {data: {session: {token: "session-tok"}, user: {id: "u1"}}};
        }),
      };
    };

    it("returns the bearer token without calling getSession", async () => {
      const {client, calls} = makeCountingClient();
      const adapter = betterAuthAdapter(client, {getBearerToken: () => "t1"});
      expect(await adapter.getToken()).toBe("t1");
      expect(calls()).toBe(0);
    });

    it("reads the getter on every call, so a rotated token is picked up", async () => {
      const {client, calls} = makeCountingClient();
      let bearer = "t1";
      const adapter = betterAuthAdapter(client, {getBearerToken: () => bearer});
      expect(await adapter.getToken()).toBe("t1");
      bearer = "t2";
      expect(await adapter.getToken()).toBe("t2");
      expect(calls()).toBe(0);
    });

    it("reads getSession when the getter returns null", async () => {
      const {client, calls} = makeCountingClient();
      const adapter = betterAuthAdapter(client, {getBearerToken: () => null});
      expect(await adapter.getToken()).toBe("session-tok");
      expect(calls()).toBe(1);
    });

    it("reads getSession when the getter returns an empty string", async () => {
      const {client, calls} = makeCountingClient();
      const adapter = betterAuthAdapter(client, {getBearerToken: () => ""});
      expect(await adapter.getToken()).toBe("session-tok");
      expect(calls()).toBe(1);
    });

    it("reads getSession when the getter throws", async () => {
      const {client, calls} = makeCountingClient();
      const adapter = betterAuthAdapter(client, {
        getBearerToken: () => {
          throw new Error("storage blocked");
        },
      });
      expect(await adapter.getToken()).toBe("session-tok");
      expect(calls()).toBe(1);
    });

    it("reads getSession without the option", async () => {
      const {client, calls} = makeCountingClient();
      const adapter = betterAuthAdapter(client);
      expect(await adapter.getToken()).toBe("session-tok");
      expect(calls()).toBe(1);
    });

    it("leaves getUserId and refresh reading getSession", async () => {
      const {client, calls} = makeCountingClient();
      const adapter = betterAuthAdapter(client, {getBearerToken: () => "t1"});
      expect(await adapter.getUserId()).toBe("u1");
      expect(await adapter.refresh?.()).toBe(true);
      expect(calls()).toBe(2);
    });
  });

  describe("refresh (A4)", () => {
    it("returns true when a re-fetched session carries a token", async () => {
      const adapter = betterAuthAdapter(
        makeClient(async () => ({data: {session: {token: "tok-1"}, user: {id: "u1"}}}))
      );
      expect(await adapter.refresh?.()).toBe(true);
    });

    it("returns false when the re-fetched session has no token (still signed out)", async () => {
      const adapter = betterAuthAdapter(makeClient(async () => ({data: null})));
      expect(await adapter.refresh?.()).toBe(false);
    });

    it("returns false rather than throwing when getSession rejects", async () => {
      const adapter = betterAuthAdapter(
        makeClient(async () => {
          throw new Error("network down");
        })
      );
      await expect(adapter.refresh?.()).resolves.toBe(false);
    });
  });

  describe("onAuthChange via useSession subscription", () => {
    interface FakeAtom {
      listeners: Set<(value: unknown) => void>;
      emit: (value: unknown) => void;
    }

    const makeAtom = (): FakeAtom => {
      const listeners = new Set<(value: unknown) => void>();
      return {
        emit: (value: unknown): void => {
          for (const listener of listeners) {
            listener(value);
          }
        },
        listeners,
      };
    };

    it("fans out session changes to every subscribed callback", async () => {
      const atom = makeAtom();
      const adapter = betterAuthAdapter(
        makeClient(async () => null, {
          subscribe: (listener) => {
            atom.listeners.add(listener);
            return () => atom.listeners.delete(listener);
          },
        })
      );
      let aCount = 0;
      let bCount = 0;
      const unsubscribeA = adapter.onAuthChange(() => {
        aCount += 1;
      });
      adapter.onAuthChange(() => {
        bCount += 1;
      });

      atom.emit({user: {id: "u1"}});
      expect(aCount).toBe(1);
      expect(bCount).toBe(1);

      unsubscribeA();
      atom.emit({user: null});
      expect(aCount).toBe(1);
      expect(bCount).toBe(2);
    });

    it("dedupes emissions by session identity (re-fetches with the same session do not fire)", () => {
      const atom = makeAtom();
      const adapter = betterAuthAdapter(
        makeClient(async () => null, {
          subscribe: (listener) => {
            atom.listeners.add(listener);
            return () => atom.listeners.delete(listener);
          },
        })
      );
      let calls = 0;
      adapter.onAuthChange(() => {
        calls += 1;
      });

      // Initial session emission fires once...
      atom.emit({data: {session: {token: "tok-a"}, user: {id: "u1"}}});
      expect(calls).toBe(1);
      // ...but re-emissions with the same identity (fresh objects per get-session
      // fetch) are swallowed — this is what breaks the auth-change feedback loop.
      atom.emit({data: {session: {token: "tok-a"}, user: {id: "u1"}}});
      atom.emit({data: {session: {token: "tok-a"}, user: {id: "u1"}}});
      expect(calls).toBe(1);

      // Token rotation (same user) is a genuine identity change.
      atom.emit({data: {session: {token: "tok-b"}, user: {id: "u1"}}});
      expect(calls).toBe(2);

      // Logout (null data) changes identity again.
      atom.emit({data: null});
      expect(calls).toBe(3);
      atom.emit({data: null});
      expect(calls).toBe(3);
    });

    it("ignores in-flight (isPending) emissions", () => {
      const atom = makeAtom();
      const adapter = betterAuthAdapter(
        makeClient(async () => null, {
          subscribe: (listener) => {
            atom.listeners.add(listener);
            return () => atom.listeners.delete(listener);
          },
        })
      );
      let calls = 0;
      adapter.onAuthChange(() => {
        calls += 1;
      });

      atom.emit({data: null, isPending: true});
      expect(calls).toBe(0);
      atom.emit({data: {session: {token: "tok"}, user: {id: "u1"}}, isPending: false});
      expect(calls).toBe(1);
      atom.emit({data: {session: {token: "tok"}, user: {id: "u1"}}, isPending: true});
      expect(calls).toBe(1);
    });

    it("ignores failed-read emissions so a transient error is never a phantom logout", () => {
      const atom = makeAtom();
      const adapter = betterAuthAdapter(
        makeClient(async () => null, {
          subscribe: (listener) => {
            atom.listeners.add(listener);
            return () => atom.listeners.delete(listener);
          },
        })
      );
      let count = 0;
      adapter.onAuthChange(() => {
        count += 1;
      });

      atom.emit({data: {session: {token: "tok"}, user: {id: "u1"}}});
      expect(count).toBe(1);

      // A get-session network failure emits {data: null, error} — shaped exactly like a
      // signed-out session. Treating it as a logout would clear the client's current
      // user and break local-first writes, so it must not fire.
      atom.emit({data: null, error: {message: "Failed to fetch"}});
      atom.emit({data: null, error: new Error("network down")});
      expect(count).toBe(1);

      // The identity is unchanged, so recovering to the SAME session is not a change.
      atom.emit({data: {session: {token: "tok"}, user: {id: "u1"}}});
      expect(count).toBe(1);

      // A genuine sign-out (successful read, no session) still fires.
      atom.emit({data: null});
      expect(count).toBe(2);
    });

    it("answers an auth-change callback's getUserId from the emission when the read fails", async () => {
      // The syncdb client re-reads getUserId inside its auth-change handler. When the
      // device goes offline between the emission and that read, a null answer would be
      // taken as a sign-out.
      const atom = makeAtom();
      const adapter = betterAuthAdapter(
        makeClient(
          async () => {
            throw new TypeError("Failed to fetch");
          },
          {
            subscribe: (listener) => {
              atom.listeners.add(listener);
              return () => atom.listeners.delete(listener);
            },
          }
        )
      );
      const seen: (string | null)[] = [];
      adapter.onAuthChange(() => {
        void adapter.getUserId().then((userId) => seen.push(userId));
      });

      atom.emit({data: {session: {token: "tok"}, user: {id: "u1"}}});
      await flush();
      expect(seen).toEqual(["u1"]);

      atom.emit({data: null});
      await flush();
      expect(seen).toEqual(["u1", null]);
    });

    it("forwards opaque emissions it cannot parse (back-compat)", () => {
      const atom = makeAtom();
      const adapter = betterAuthAdapter(
        makeClient(async () => null, {
          subscribe: (listener) => {
            atom.listeners.add(listener);
            return () => atom.listeners.delete(listener);
          },
        })
      );
      let calls = 0;
      adapter.onAuthChange(() => {
        calls += 1;
      });

      atom.emit(true);
      atom.emit(false);
      expect(calls).toBe(2);
    });

    it("tolerates a subscribe implementation that returns no unsubscribe function", () => {
      const adapter = betterAuthAdapter(
        makeClient(async () => null, {
          subscribe: (() => undefined) as unknown as (cb: (v: unknown) => void) => () => void,
        })
      );
      const unsubscribe = adapter.onAuthChange(() => {});
      expect(() => unsubscribe()).not.toThrow();
    });
  });

  describe("onAuthChange polling fallback", () => {
    interface FakeTimers {
      handlers: Map<number, () => void>;
      lastMs: number | undefined;
      cleared: number[];
      options: BetterAuthAdapterOptions;
      tick: () => Promise<void>;
    }

    const makeTimers = (): FakeTimers => {
      const handlers = new Map<number, () => void>();
      let nextHandle = 1;
      const timers: FakeTimers = {
        cleared: [],
        handlers,
        lastMs: undefined,
        options: {
          clearIntervalFn: (handle) => {
            timers.cleared.push(handle as number);
            handlers.delete(handle as number);
          },
          setIntervalFn: (handler, ms) => {
            timers.lastMs = ms;
            const handle = nextHandle;
            nextHandle += 1;
            handlers.set(handle, handler);
            return handle;
          },
        },
        tick: async () => {
          for (const handler of handlers.values()) {
            handler();
          }
          await flush();
        },
      };
      return timers;
    };

    it("polls with the default interval and fires only when the session identity changes", async () => {
      let session: BetterAuthGetSessionResult = {
        data: {session: {token: "tok-a"}, user: {id: "u1"}},
      };
      const timers = makeTimers();
      const adapter = betterAuthAdapter(
        makeClient(async () => session),
        timers.options
      );
      let calls = 0;
      const unsubscribe = adapter.onAuthChange(() => {
        calls += 1;
      });
      expect(timers.lastMs).toBe(DEFAULT_AUTH_POLL_INTERVAL_MS);
      // Let the baseline sample resolve, then poll with an unchanged session.
      await flush();
      await timers.tick();
      expect(calls).toBe(0);

      // Token refresh (same user): identity key changes → callback fires.
      session = {data: {session: {token: "tok-b"}, user: {id: "u1"}}};
      await timers.tick();
      expect(calls).toBe(1);

      // No further change → no further calls.
      await timers.tick();
      expect(calls).toBe(1);

      // User switch fires again.
      session = {data: {session: {token: "tok-c"}, user: {id: "u2"}}};
      await timers.tick();
      expect(calls).toBe(2);

      unsubscribe();
      expect(timers.cleared).toHaveLength(1);
      session = null;
      await timers.tick();
      expect(calls).toBe(2);
    });

    it("skips polls whose session read failed instead of sampling a phantom logout", async () => {
      let session: BetterAuthGetSessionResult = {
        data: {session: {token: "tok-a"}, user: {id: "u1"}},
      };
      let shouldThrow = false;
      const timers = makeTimers();
      const adapter = betterAuthAdapter(
        makeClient(async () => {
          if (shouldThrow) {
            throw new Error("network down");
          }
          return session;
        }),
        timers.options
      );
      let calls = 0;
      adapter.onAuthChange(() => {
        calls += 1;
      });
      await flush();
      await timers.tick();
      expect(calls).toBe(0);

      // A failing read must not be sampled as a signed-out identity.
      shouldThrow = true;
      await timers.tick();
      await timers.tick();
      expect(calls).toBe(0);

      // Recovering to the same session is still not a change.
      shouldThrow = false;
      await timers.tick();
      expect(calls).toBe(0);

      // A real sign-out (successful read, no session) still fires.
      session = null;
      await timers.tick();
      expect(calls).toBe(1);
    });

    it("uses the first poll as baseline when it beats the subscribe-time sample", async () => {
      let resolveBaseline: (() => void) | undefined;
      let firstCall = true;
      const timers = makeTimers();
      const adapter = betterAuthAdapter(
        makeClient(async () => {
          if (firstCall) {
            firstCall = false;
            // Hold the subscribe-time baseline sample until released.
            await new Promise<void>((resolve) => {
              resolveBaseline = resolve;
            });
          }
          return {data: {session: {token: "tok"}, user: {id: "u1"}}};
        }),
        {...timers.options, pollIntervalMs: 50}
      );
      let calls = 0;
      adapter.onAuthChange(() => {
        calls += 1;
      });
      expect(timers.lastMs).toBe(50);

      // First tick establishes the baseline (no change event).
      await timers.tick();
      expect(calls).toBe(0);

      // Late-resolving subscribe-time sample must not clobber the baseline.
      resolveBaseline?.();
      await flush();
      await timers.tick();
      expect(calls).toBe(0);
    });

    it("stops reacting after unsubscribe even with a poll in flight", async () => {
      let session: BetterAuthGetSessionResult = {data: {session: {token: "a"}, user: {id: "u1"}}};
      const timers = makeTimers();
      const adapter = betterAuthAdapter(
        makeClient(async () => session),
        timers.options
      );
      let calls = 0;
      const unsubscribe = adapter.onAuthChange(() => {
        calls += 1;
      });
      await flush();

      // Start a poll, then dispose before its async read lands.
      session = {data: {session: {token: "b"}, user: {id: "u1"}}};
      for (const handler of timers.handlers.values()) {
        handler();
      }
      unsubscribe();
      await flush();
      expect(calls).toBe(0);
    });

    it("falls back to real timers when no interval functions are injected", async () => {
      let session: BetterAuthGetSessionResult = {data: {session: {token: "a"}, user: {id: "u1"}}};
      const adapter = betterAuthAdapter(
        makeClient(async () => session),
        {pollIntervalMs: 5}
      );
      let calls = 0;
      const unsubscribe = adapter.onAuthChange(() => {
        calls += 1;
      });
      await new Promise((resolve) => setTimeout(resolve, 15));
      session = {data: {session: {token: "b"}, user: {id: "u1"}}};
      await new Promise((resolve) => setTimeout(resolve, 25));
      unsubscribe();
      expect(calls).toBeGreaterThanOrEqual(1);
    });
  });
});
