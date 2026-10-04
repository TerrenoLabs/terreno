import {describe, expect, it} from "bun:test";
import {act, renderHook, waitFor} from "@testing-library/react-native";
import React from "react";

import {createSyncDb, type SyncDb} from "../client";
import {memoryPersisterFactory} from "../persisters/memoryPersister";
import {compileWhere} from "../query/where";
import type {HttpChannel} from "../sync/httpChannel";
import {createFakeTransport, type FakeTransport} from "../testing/fakeTransport";
import type {AuthProvider} from "../types";
import {useQuery, useWindowQuery} from "./hooks";
import {SyncDbProvider} from "./provider";

interface Message {
  _id: string;
  _syncSeq: number;
  threadId: string;
  pinned: boolean;
  text: string;
}

const ROWS: Message[] = [
  {_id: "m1", _syncSeq: 1, pinned: false, text: "one", threadId: "a"},
  {_id: "m2", _syncSeq: 1, pinned: true, text: "two", threadId: "a"},
  {_id: "m3", _syncSeq: 1, pinned: true, text: "three", threadId: "b"},
];

const auth: AuthProvider = {
  getToken: async () => "token",
  getUserId: async () => "u1",
  onAuthChange: () => () => {},
};

let nameCounter = 0;

interface Harness {
  client: SyncDb;
  transport: FakeTransport;
  listCalls: number;
  wrapper: React.FC<{children: React.ReactNode}>;
}

const setup = async (): Promise<Harness> => {
  nameCounter += 1;
  const transport = createFakeTransport();
  const harness = {listCalls: 0} as Harness;
  const channel: HttpChannel = {
    fetchEntities: async () => ({entities: []}),
    fetchKeyMaterial: async () => "",
    fetchList: async ({params}) => {
      harness.listCalls += 1;
      const {limit: _limit, page: _page, sort: _sort, ...where} = params;
      const {match} = compileWhere(where);
      return {data: ROWS.filter((row) => match?.(row)), more: false};
    },
    fetchSnapshotPage: async ({stream}) => ({
      cursor: 0,
      entities: [],
      frontierSeq: 0,
      hasMore: false,
      oldestRetainedSeq: 0,
      stream,
    }),
    fetchStreams: async () => [],
    sendMutation: async () => {
      throw new Error("not expected");
    },
  };
  const client = createSyncDb({
    authProvider: auth,
    collections: ["messages"],
    httpChannel: channel,
    name: `window-hooks-test-${nameCounter}`,
    persisterFactory: memoryPersisterFactory,
    queryCollections: ["messages"],
    reconcileIntervalMs: 0,
    transport,
  });
  await client.start();
  await client.reconcile();
  harness.client = client;
  harness.transport = transport;
  harness.wrapper = ({children}) => <SyncDbProvider client={client}>{children}</SyncDbProvider>;
  return harness;
};

describe("useWindowQuery", () => {
  it("renders two overlapping filtered views from shared rows", async () => {
    const harness = await setup();
    const {client, transport, wrapper} = harness;
    const {result} = renderHook(
      () => ({
        pinned: useWindowQuery<Message>("messages", {where: {pinned: true}}),
        threadA: useWindowQuery<Message>("messages", {where: {threadId: "a"}}),
      }),
      {wrapper}
    );
    expect(result.current.threadA.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.threadA.ids).toEqual(["m1", "m2"]);
      expect(result.current.pinned.ids).toEqual(["m2", "m3"]);
    });
    expect(result.current.threadA.isLoading).toBe(false);
    expect(harness.listCalls).toBe(2);

    act(() => {
      transport.deliverDelta({
        collection: "messages",
        data: {...ROWS[1], text: "two edited"},
        id: "m2",
        method: "update",
        seq: 2,
        stream: "messages|owner:u1",
      });
    });
    expect(result.current.threadA.data.find((row) => row._id === "m2")?.text).toBe("two edited");
    expect(result.current.pinned.data.find((row) => row._id === "m2")?.text).toBe("two edited");

    await act(async () => {
      await client.stop();
    });
  });

  it("does not refetch when rerendered with an equal inline query", async () => {
    const harness = await setup();
    const {client, wrapper} = harness;
    const {result, rerender} = renderHook(
      () => useWindowQuery<Message>("messages", {where: {threadId: "a"}}),
      {wrapper}
    );
    await waitFor(() => {
      expect(result.current.ids).toEqual(["m1", "m2"]);
    });
    rerender({});
    rerender({});
    expect(harness.listCalls).toBe(1);
    await act(async () => {
      await client.stop();
    });
  });

  it("does nothing while skip is set", async () => {
    const harness = await setup();
    const {client, wrapper} = harness;
    const {result} = renderHook(
      () => useWindowQuery<Message>("messages", {skip: true, where: {threadId: "a"}}),
      {wrapper}
    );
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toEqual([]);
    expect(harness.listCalls).toBe(0);
    await act(async () => {
      await client.stop();
    });
  });
});

describe("useQuery where/sort/limit", () => {
  it("filters, sorts, and limits local rows with the shared syntax", async () => {
    const {client, wrapper} = await setup();
    await client.queryWindows.fetchWindow({query: {collection: "messages"}});
    const {result} = renderHook(
      () => useQuery<Message>("messages", {limit: 1, sort: "-text", where: {pinned: true}}),
      {wrapper}
    );
    expect(result.current.map((row) => row._id)).toEqual(["m2"]);
    await act(async () => {
      await client.stop();
    });
  });
});
