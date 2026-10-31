import {describe, it} from "bun:test";
import {assert} from "chai";

import {isWindowedAdminTable, resolveWindowedTableRows} from "./adminWindowedTable";
import type {AdminModelConfig, AdminSyncDb} from "./types";

// The gate reads only the broadcast flag, sync collection, and `_id` type.
const stringIdConfig = {
  adminBroadcast: true,
  fields: {_id: {required: true, type: "string"}, title: {required: true, type: "string"}},
  syncCollection: "todos",
} as Partial<AdminModelConfig> as AdminModelConfig;

// Test double: the gate only checks that a sync client is present.
const fakeSyncDb = {
  hydrateWindow: async () => ({hydratedIds: []}),
  store: {getEntity: () => undefined},
} as unknown as AdminSyncDb;

describe("isWindowedAdminTable", () => {
  it("requires syncDb, fetch client, adminBroadcast, syncCollection, and string _id", () => {
    assert.isTrue(
      isWindowedAdminTable({
        hasFetchClient: true,
        modelConfig: stringIdConfig,
        syncDb: fakeSyncDb,
      })
    );
    assert.isFalse(
      isWindowedAdminTable({
        hasFetchClient: true,
        modelConfig: stringIdConfig,
      })
    );
    assert.isFalse(
      isWindowedAdminTable({
        hasFetchClient: false,
        modelConfig: stringIdConfig,
        syncDb: fakeSyncDb,
      })
    );
    assert.isFalse(
      isWindowedAdminTable({
        hasFetchClient: true,
        modelConfig: {...stringIdConfig, adminBroadcast: false},
        syncDb: fakeSyncDb,
      })
    );
    assert.isFalse(
      isWindowedAdminTable({
        hasFetchClient: true,
        modelConfig: {...stringIdConfig, syncCollection: undefined},
        syncDb: fakeSyncDb,
      })
    );
    assert.isFalse(
      isWindowedAdminTable({
        hasFetchClient: true,
        modelConfig: {
          ...stringIdConfig,
          fields: {_id: {required: true, type: "objectid"}},
        },
        syncDb: fakeSyncDb,
      })
    );
  });
});

describe("resolveWindowedTableRows", () => {
  it("keeps REST membership order and ignores store ids outside the page", () => {
    const restById = new Map([
      ["a", {_id: "a", title: "Alpha"}],
      ["b", {_id: "b", title: "Beta"}],
    ]);
    const store: Record<string, {data: unknown; deleted?: boolean; id: string}> = {
      a: {data: {_id: "a", title: "Alpha store"}, id: "a"},
      b: {data: {_id: "b", title: "Beta"}, deleted: true, id: "b"},
      ghost: {data: {_id: "ghost", title: "Should not render"}, id: "ghost"},
    };
    const rows = resolveWindowedTableRows({
      collection: "todos",
      getEntity: ({id}) => store[id],
      membershipIds: ["a", "b", "c"],
      restById,
    });
    assert.deepEqual(
      rows.map((row) => row.title),
      ["Alpha store"]
    );
    assert.isUndefined(rows.find((row) => row._id === "ghost"));
  });
});
