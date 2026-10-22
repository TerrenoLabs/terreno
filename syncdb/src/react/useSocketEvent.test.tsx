import "fake-indexeddb/auto";
import {describe, expect, it} from "bun:test";
import {renderHook} from "@testing-library/react-native";
import type React from "react";

import {createSyncDb, type SyncDb} from "../client";
import {memoryPersisterFactory} from "../persisters/memoryPersister";
import {createFakeTransport, type FakeTransport} from "../testing/fakeTransport";
import {SyncDbProvider} from "./provider";
import {useSocketEvent} from "./useSocketEvent";

let nameCounter = 0;

const makeClient = (): {client: SyncDb; transport: FakeTransport} => {
  nameCounter += 1;
  const transport = createFakeTransport();
  const client = createSyncDb({
    authProvider: {
      getToken: async () => "token",
      getUserId: async () => "u1",
      onAuthChange: () => () => {},
    },
    collections: ["todos"],
    name: `use-socket-event-${nameCounter}`,
    persisterFactory: memoryPersisterFactory,
    reconcileIntervalMs: 0,
    transport,
  });
  return {client, transport};
};

const providerWrapper =
  (client: SyncDb): React.FC<{children: React.ReactNode}> =>
  ({children}) => <SyncDbProvider client={client}>{children}</SyncDbProvider>;

describe("useSocketEvent", () => {
  it("calls the latest handler for events on the provider's socket", () => {
    const {client, transport} = makeClient();
    const calls: string[] = [];
    const {rerender} = renderHook(
      ({label}: {label: string}) => {
        useSocketEvent("featureFlagsChanged", (payload) => {
          calls.push(`${label}:${(payload as {key: string}).key}`);
        });
      },
      {initialProps: {label: "first"}, wrapper: providerWrapper(client)}
    );

    transport.emitEvent("featureFlagsChanged", {key: "a"});
    rerender({label: "second"});
    transport.emitEvent("featureFlagsChanged", {key: "b"});

    expect(calls).toEqual(["first:a", "second:b"]);
    // Re-rendering with a new handler does not rebind the listener.
    expect(transport.eventListenerCount("featureFlagsChanged")).toBe(1);
  });

  it("unbinds on unmount and while disabled", () => {
    const {client, transport} = makeClient();
    const {rerender, unmount} = renderHook(
      ({enabled}: {enabled: boolean}) => {
        useSocketEvent("ping", () => {}, {client, enabled});
      },
      {initialProps: {enabled: true}}
    );
    expect(transport.eventListenerCount("ping")).toBe(1);

    rerender({enabled: false});
    expect(transport.eventListenerCount("ping")).toBe(0);

    rerender({enabled: true});
    expect(transport.eventListenerCount("ping")).toBe(1);
    unmount();
    expect(transport.eventListenerCount("ping")).toBe(0);
  });

  it("listens to nothing when given a null client", () => {
    const {result} = renderHook(() => {
      useSocketEvent("ping", () => {}, {client: null});
      return "rendered";
    });
    expect(result.current).toBe("rendered");
  });

  it("throws without a provider or an explicit client", () => {
    const originalError = console.error;
    console.error = (): void => {};
    try {
      expect(() => renderHook(() => useSocketEvent("ping", () => {}))).toThrow(
        "useSocketEvent must be used within a <SyncDbProvider"
      );
    } finally {
      console.error = originalError;
    }
  });
});
