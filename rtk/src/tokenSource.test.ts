import {afterEach, describe, expect, it} from "bun:test";
import type {AuthProvider} from "@terreno/syncdb";

import {emitAuthChange, onAuthChange} from "./authEvents";
import {isJwtTokenSource, jwtTokenSource} from "./emptyApi";
import {getTokenSource, setTokenSource} from "./tokenSource";

const fakeSource = (token: string | null): AuthProvider => ({
  getToken: async () => token,
  getUserId: async () => (token ? "user-1" : null),
  onAuthChange: () => () => {},
});

describe("token source registry", () => {
  afterEach(() => {
    setTokenSource(undefined);
  });

  it("has no registered source until an app registers one", () => {
    expect(getTokenSource()).toBeUndefined();
  });

  it("returns the registered source and can be reset", async () => {
    const source = fakeSource("t1");
    setTokenSource(source);
    expect(getTokenSource()).toBe(source);
    expect(await getTokenSource()?.getToken()).toBe("t1");

    setTokenSource(undefined);
    expect(getTokenSource()).toBeUndefined();
  });

  it("replaces a previously registered source", () => {
    setTokenSource(fakeSource("t1"));
    const next = fakeSource("t2");
    setTokenSource(next);
    expect(getTokenSource()).toBe(next);
  });
});

describe("authEvents", () => {
  it("calls subscribers on every change until they unsubscribe", () => {
    let calls = 0;
    const unsubscribe = onAuthChange(() => {
      calls += 1;
    });

    emitAuthChange();
    emitAuthChange();
    unsubscribe();
    emitAuthChange();

    expect(calls).toBe(2);
  });

  it("keeps notifying other subscribers when one throws", () => {
    let calls = 0;
    const unsubscribeThrowing = onAuthChange(() => {
      throw new Error("listener failed");
    });
    const unsubscribe = onAuthChange(() => {
      calls += 1;
    });

    emitAuthChange();
    unsubscribeThrowing();
    unsubscribe();

    expect(calls).toBe(1);
  });
});

// getToken, refresh and getUserId delegate to storage-backed helpers, so their cases live in
// isolated/emptyApi.staggered.isolated.ts, which controls storage and axios.
describe("jwtTokenSource", () => {
  it("is the JWT path's source", () => {
    expect(isJwtTokenSource(undefined)).toBe(true);
    expect(isJwtTokenSource(jwtTokenSource)).toBe(true);
    expect(isJwtTokenSource(fakeSource("t1"))).toBe(false);
  });

  it("subscribes onAuthChange to the JWT auth events", () => {
    let calls = 0;
    const unsubscribe = jwtTokenSource.onAuthChange(() => {
      calls += 1;
    });

    emitAuthChange();
    unsubscribe();
    emitAuthChange();

    expect(calls).toBe(1);
  });
});
