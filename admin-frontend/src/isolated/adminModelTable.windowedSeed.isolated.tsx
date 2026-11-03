/**
 * Isolated: runs with `ADMIN_USE_REAL_API=1` (see scripts/run-tests.sh). A windowed table under a
 * server seed renders the seeded REST rows before syncdb exists, keeps them (no empty frame) when
 * `AdminProvider` receives syncDb after `start()`, and catches up to changes made on the server
 * between the server render and that switch.
 */
// biome-ignore-all lint/suspicious/noExplicitAny: test mock typing
import {afterEach, describe, expect, it, mock} from "bun:test";
import {act} from "@testing-library/react-native";
import React, {Profiler} from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import type {AdminConfigResponse, AdminSyncDb} from "../types";

mock.module("expo-router", () => ({
  router: {push: mock(() => {})},
  useNavigation: () => ({setOptions: mock((_: unknown) => {})}),
}));

const todoConfig: AdminConfigResponse = {
  customScreens: [],
  models: [
    {
      adminBroadcast: true,
      defaultSort: "-created",
      displayName: "Todos",
      fields: {
        _id: {required: true, type: "string"},
        title: {required: true, type: "string"},
      },
      listFields: ["title"],
      name: "Todo",
      routePath: "/admin/todos",
      syncCollection: "todos",
    },
  ],
  scripts: [],
};

mock.module("../useAdminConfig", () => ({
  useAdminConfig: () => ({config: todoConfig, error: null, isLoading: false}),
}));

import {AdminModelTable} from "../AdminModelTable";
import {AdminProvider} from "../AdminProvider";
import {AdminRpcSeed, adminRpcSeedKey} from "../adminRpcSeed";

const TODO_LIST_URL = "/admin/todos?limit=20&page=1&sort=-created";
const originalFetch = globalThis.fetch;

const envelopeOf = (titles: string[]): Record<string, unknown> => ({
  data: titles.map((title, index) => ({_id: `todo-${index + 1}`, title})),
  limit: 20,
  more: false,
  page: 1,
  total: titles.length,
});

/** The server's current list; tests mutate it to simulate a change after the server render. */
const server: {current: Record<string, unknown>} = {current: envelopeOf([])};
const fetchedUrls: string[] = [];

const stubFetch = (): void => {
  fetchedUrls.length = 0;
  globalThis.fetch = (async (url: string) => {
    fetchedUrls.push(String(url));
    return new Response(JSON.stringify(server.current), {
      headers: {"Content-Type": "application/json"},
      status: 200,
    });
  }) as typeof fetch;
};

const flush = async (): Promise<void> => {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
};

/** A syncDb like the one `AdminProvider` receives after `client.start()`; hydrate writes the rows it is given. */
const createFakeSyncDb = (): {
  hydrateWindow: ReturnType<typeof mock>;
  syncDb: AdminSyncDb;
} => {
  const entities = new Map<string, {data: unknown; deleted?: boolean; id: string}>();
  const listeners = new Map<string, () => void>();
  const hydrateWindow = mock(async (args: {ids: string[]; restRows?: Record<string, unknown>}) => {
    for (const id of args.ids) {
      const rest = args.restRows?.[id];
      if (rest !== undefined) {
        entities.set(id, {data: rest, id});
      }
    }
    for (const listener of listeners.values()) {
      listener();
    }
    return {hydratedIds: args.ids};
  });
  return {
    hydrateWindow,
    syncDb: {
      hydrateWindow,
      mutate: mock(() => ({id: "todo-1", mutationId: "m1"})),
      store: {
        getEntity: ({id}: {id: string}) => entities.get(id),
        raw: {
          addTableListener: (_tableId: string, listener: () => void): string => {
            const id = `listener-${listeners.size}`;
            listeners.set(id, listener);
            return id;
          },
          delListener: (listenerId: string): void => {
            listeners.delete(listenerId);
          },
        },
      },
    } as unknown as AdminSyncDb,
  };
};

type View = ReturnType<typeof renderWithTheme>;

const tree = (
  syncDb: AdminSyncDb | undefined,
  seed: boolean,
  onRender?: () => void
): React.ReactElement => {
  const table = (
    <AdminProvider apiBase="/admin" credentials="same-origin" routeBase="" syncDb={syncDb}>
      <AdminModelTable apiBase="/admin" modelName="Todo" routeBase="" />
    </AdminProvider>
  );
  const seeded = seed ? (
    <AdminRpcSeed data={{[adminRpcSeedKey(TODO_LIST_URL)]: server.current}}>{table}</AdminRpcSeed>
  ) : (
    table
  );
  return (
    <Profiler id="t" onRender={() => onRender?.()}>
      {seeded}
    </Profiler>
  );
};

const mounted: View[] = [];

describe("AdminModelTable windowed path under a server seed", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    while (mounted.length > 0) {
      mounted.pop()?.unmount();
    }
  });

  it("renders seeded rows on the first render and requests no list while syncDb is absent", async () => {
    server.current = envelopeOf(["Alpha", "Beta"]);
    stubFetch();
    const view = renderWithTheme(tree(undefined, true));
    mounted.push(view);
    expect(view.getAllByText("Alpha").length).toBeGreaterThan(0);
    expect(view.getAllByText("Beta").length).toBeGreaterThan(0);
    await flush();
    expect(fetchedUrls).toEqual([]);
  });

  it("keeps the seeded rows with no empty frame when syncDb arrives, and hydrates the seeded ids", async () => {
    server.current = envelopeOf(["Alpha", "Beta"]);
    stubFetch();
    const {hydrateWindow, syncDb} = createFakeSyncDb();
    let view: View | undefined;
    const frames: string[][] = [];
    const record = (): void => {
      if (!view) {
        return;
      }
      frames.push(["Alpha", "Beta"].filter((t) => view?.queryAllByText(t).length));
    };
    view = renderWithTheme(tree(undefined, true, record));
    mounted.push(view);
    await flush();
    frames.length = 0;
    view.rerender(tree(syncDb, true, record));
    await flush();

    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) {
      expect(frame).toEqual(["Alpha", "Beta"]);
    }
    expect(hydrateWindow.mock.calls.length).toBeGreaterThan(0);
    for (const call of hydrateWindow.mock.calls) {
      expect((call[0] as {ids: string[]}).ids).toEqual(["todo-1", "todo-2"]);
    }
  });

  it("catches up to a change made after the seed, never reverting to the stale row or going empty", async () => {
    server.current = envelopeOf(["Stale title"]);
    stubFetch();
    const {syncDb} = createFakeSyncDb();
    let view: View | undefined;
    const frames: Array<{newer: boolean; stale: boolean}> = [];
    const record = (): void => {
      if (!view) {
        return;
      }
      frames.push({
        newer: view.queryAllByText("Newer title").length > 0,
        stale: view.queryAllByText("Stale title").length > 0,
      });
    };
    view = renderWithTheme(tree(undefined, true, record));
    mounted.push(view);
    await flush();
    expect(view.getAllByText("Stale title").length).toBeGreaterThan(0);

    // The entity changes on the server between the server render and start().
    server.current = envelopeOf(["Newer title"]);
    frames.length = 0;
    view.rerender(tree(syncDb, true, record));
    await flush();

    expect(view.queryAllByText("Newer title").length).toBeGreaterThan(0);
    expect(view.queryAllByText("Stale title").length).toBe(0);
    expect(frames.some((frame) => !frame.newer && !frame.stale)).toBe(false);
    const firstNewer = frames.findIndex((frame) => frame.newer);
    expect(firstNewer).toBeGreaterThanOrEqual(0);
    expect(frames.slice(firstNewer).some((frame) => frame.stale)).toBe(false);
  });

  it("without a seed behaves as before: fetches the list, then hydrates once syncDb is present", async () => {
    server.current = envelopeOf(["Alpha"]);
    stubFetch();
    const {hydrateWindow, syncDb} = createFakeSyncDb();
    const view = renderWithTheme(tree(syncDb, false));
    mounted.push(view);
    await flush();
    expect(fetchedUrls).toEqual([TODO_LIST_URL]);
    expect(view.getAllByText("Alpha").length).toBeGreaterThan(0);
    expect(hydrateWindow.mock.calls.length).toBeGreaterThan(0);
    // Today the first call carries no ids (list still loading); a later call carries the fetched id.
    const idLists = hydrateWindow.mock.calls.map((call) => (call[0] as {ids: string[]}).ids);
    expect(idLists).toContainEqual(["todo-1"]);
  });
});
