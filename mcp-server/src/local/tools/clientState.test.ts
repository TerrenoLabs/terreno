import {afterEach, beforeEach, describe, it} from "bun:test";
import {assert} from "chai";

import {handleLocalToolCall, localMcpTools} from "../localTools.js";
import {getClientState} from "./runtime.js";

interface ClientStateResult {
  layer: string;
  hint?: string;
  connection?: string;
  rtk?: Record<string, unknown>;
  syncdb?: Record<string, unknown>;
}

type DevGlobal = typeof globalThis & {
  __TERRENO_STORE__?: {getState: () => Record<string, unknown>};
  __TERRENO_SYNCDB__?: unknown;
};

const devGlobal = globalThis as DevGlobal;

const installRtkStore = (): void => {
  devGlobal.__TERRENO_STORE__ = {
    getState: (): Record<string, unknown> => ({
      auth: {token: "secret-token", userId: "user-1"},
      "terreno-rtk": {
        mutations: {},
        queries: {
          todos: {endpointName: "getTodos", originalArgs: {}, status: "fulfilled"},
          users: {endpointName: "getUsers", originalArgs: {}, status: "fulfilled"},
        },
      },
    }),
  };
};

const installSyncDbRegistry = (): void => {
  devGlobal.__TERRENO_SYNCDB__ = {
    clients: {
      app: {
        inspect: (options?: Record<string, unknown>): Record<string, unknown> => ({
          collections: {
            todos: {entities: [{data: {password: "pw", title: "Buy milk"}, id: "todo-1"}]},
          },
          options: options ?? {},
          status: {queuedCount: 2},
        }),
      },
    },
    list: (): string[] => ["app"],
  };
};

const parse = (text: string): ClientStateResult => JSON.parse(text) as ClientStateResult;

describe("get_client_state", () => {
  let previousMetroUrl: string | undefined;

  beforeEach((): void => {
    previousMetroUrl = process.env.TERRENO_METRO_URL;
    Reflect.deleteProperty(process.env, "TERRENO_METRO_URL");
    Reflect.deleteProperty(devGlobal, "__TERRENO_STORE__");
    Reflect.deleteProperty(devGlobal, "__TERRENO_SYNCDB__");
  });

  afterEach((): void => {
    Reflect.deleteProperty(devGlobal, "__TERRENO_STORE__");
    Reflect.deleteProperty(devGlobal, "__TERRENO_SYNCDB__");
    if (previousMetroUrl === undefined) {
      Reflect.deleteProperty(process.env, "TERRENO_METRO_URL");
    } else {
      process.env.TERRENO_METRO_URL = previousMetroUrl;
    }
  });

  it("reports the syncdb layer when a SyncDB client is registered", async (): Promise<void> => {
    installSyncDbRegistry();
    const result = parse(await getClientState({collection: "todos", limit: 5}));
    assert.equal(result.layer, "syncdb");
    assert.isUndefined(result.rtk);
    assert.deepEqual(result.syncdb?.status, {queuedCount: 2});
    assert.deepEqual(result.syncdb?.options, {collection: "todos", limit: 5});
    const collections = result.syncdb?.collections as
      | Record<string, {entities: unknown[]}>
      | undefined;
    const todos = collections?.todos;
    assert.deepEqual(todos?.entities[0], {
      data: {password: "[REDACTED]", title: "Buy milk"},
      id: "todo-1",
    });
  });

  it("reports the rtk layer and keeps slice and query filters", async (): Promise<void> => {
    installRtkStore();
    const result = parse(await getClientState({query: "todo", slice: "rtk"}));
    assert.equal(result.layer, "rtk");
    assert.isUndefined(result.syncdb);
    assert.deepEqual(result.rtk, {
      mutations: [],
      queries: [{args: {}, endpoint: "getTodos", status: "fulfilled"}],
    });
    const auth = parse(await getClientState({slice: "auth"}));
    assert.deepEqual(auth.rtk, {auth: {token: "[REDACTED]", userId: "user-1"}});
  });

  it("returns both payloads when RTK and SyncDB are present", async (): Promise<void> => {
    installRtkStore();
    installSyncDbRegistry();
    const result = parse(await getClientState({}));
    assert.equal(result.layer, "syncdb+rtk");
    assert.deepEqual(result.syncdb?.status, {queuedCount: 2});
    assert.deepEqual((result.rtk as {auth?: unknown}).auth, {
      token: "[REDACTED]",
      userId: "user-1",
    });
  });

  it("returns layer none with a hint when neither store is present", async (): Promise<void> => {
    const result = parse(await getClientState({}));
    assert.equal(result.layer, "none");
    assert.isUndefined(result.rtk);
    assert.isUndefined(result.syncdb);
    assert.include(result.hint ?? "", "registerTerrenoDevStore");
    assert.include(result.hint ?? "", "debug: true");
    assert.include(result.connection ?? "", "CDP:");
  });

  it("keeps get_rtk_state as a deprecated alias of get_client_state", async (): Promise<void> => {
    const current = localMcpTools.find((tool) => tool.name === "get_client_state");
    const alias = localMcpTools.find((tool) => tool.name === "get_rtk_state");
    assert.exists(current);
    assert.exists(alias);
    assert.match(alias?.description ?? "", /deprecated/i);
    assert.include(alias?.description ?? "", "get_client_state");
    assert.deepEqual(alias?.inputSchema, current?.inputSchema);
    assert.include(current?.description ?? "", "layer");

    installRtkStore();
    installSyncDbRegistry();
    const viaCurrent = await handleLocalToolCall("get_client_state", {slice: "auth"});
    const viaAlias = await handleLocalToolCall("get_rtk_state", {slice: "auth"});
    assert.deepEqual(viaAlias, viaCurrent);
    assert.equal(parse(viaAlias.content[0]?.text ?? "").layer, "syncdb+rtk");
  });
});
