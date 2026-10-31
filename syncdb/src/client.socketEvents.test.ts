import "fake-indexeddb/auto";
import {describe, expect, it} from "bun:test";

import {createSyncDb, type SyncDb} from "./client";
import {memoryPersisterFactory} from "./persisters/memoryPersister";
import type {SyncTransport} from "./sync/transport";
import {createFakeTransport, type FakeTransport} from "./testing/fakeTransport";
import type {AuthProvider} from "./types";

let nameCounter = 0;

const authProvider: AuthProvider = {
  getToken: async () => "token",
  getUserId: async () => "u1",
  onAuthChange: () => () => {},
};

const makeClient = (transport: SyncTransport): SyncDb => {
  nameCounter += 1;
  return createSyncDb({
    authProvider,
    collections: ["todos"],
    name: `socket-events-${nameCounter}`,
    persisterFactory: memoryPersisterFactory,
    reconcileIntervalMs: 0,
    transport,
  });
};

describe("SyncDb.onSocketEvent", () => {
  it("forwards server events from the sync transport until unsubscribed", () => {
    const transport: FakeTransport = createFakeTransport();
    const client = makeClient(transport);
    const received: unknown[][] = [];

    const unsubscribe = client.onSocketEvent("featureFlagsChanged", (...args) => {
      received.push(args);
    });
    transport.emitEvent("featureFlagsChanged", {key: "beta"});
    transport.emitEvent("somethingElse", {ignored: true});
    expect(received).toEqual([[{key: "beta"}]]);

    unsubscribe();
    transport.emitEvent("featureFlagsChanged", {key: "later"});
    expect(received).toHaveLength(1);
    expect(transport.eventListenerCount("featureFlagsChanged")).toBe(0);
  });

  it("keeps listeners bound across stop() and start()", async () => {
    const transport = createFakeTransport();
    const client = makeClient(transport);
    let calls = 0;
    client.onSocketEvent("featureFlagsChanged", () => {
      calls += 1;
    });

    await client.start();
    await client.stop();
    await client.start();
    transport.emitEvent("featureFlagsChanged");
    await client.stop();

    expect(calls).toBe(1);
  });

  it("throws for names the sync protocol reserves", () => {
    const client = makeClient(createFakeTransport());
    expect(() => client.onSocketEvent("sync:delta", () => {})).toThrow("reserved");
  });

  it("returns a no-op unsubscribe when the transport has no event support", () => {
    const {onEvent: _onEvent, ...withoutEvents} = createFakeTransport();
    const client = makeClient(withoutEvents);
    const unsubscribe = client.onSocketEvent("featureFlagsChanged", () => {});
    expect(() => unsubscribe()).not.toThrow();
  });
});
