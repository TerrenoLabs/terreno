import {describe, it} from "bun:test";
import {assert} from "chai";
import {DateTime} from "luxon";

import {createSyncStore, type SyncStore} from "../storage/store";
import type {SyncEntitiesResponse} from "../types";
import {applyDelta} from "./deltaApplier";
import {hydrateWindowEntities} from "./windowHydrate";

const STREAM = "todos|admin";

interface HeldFetch {
  promise: Promise<SyncEntitiesResponse>;
  resolve: (response: SyncEntitiesResponse) => void;
}

const holdFetch = (): HeldFetch => {
  let resolve: (response: SyncEntitiesResponse) => void = () => {};
  const promise = new Promise<SyncEntitiesResponse>((res) => {
    resolve = res;
  });
  return {promise, resolve};
};

// Two overlapping window hydrates (e.g. a re-query while the first is in flight), both holding a
// REST page read before a PATCH; the second /sync/entities read lands after the server committed it.
const runOverlappingHydrates = async (store: SyncStore): Promise<void> => {
  const first = holdFetch();
  const second = holdFetch();
  const call1 = hydrateWindowEntities({
    channel: {fetchEntities: () => first.promise},
    collection: "todos",
    ids: ["t1"],
    restRows: {t1: {title: "old"}},
    store,
  });
  const call2 = hydrateWindowEntities({
    channel: {fetchEntities: () => second.promise},
    collection: "todos",
    ids: ["t1"],
    restRows: {t1: {title: "old"}},
    store,
  });

  first.resolve({entities: [{data: {title: "old"}, deleted: false, id: "t1", seq: 263}]});
  await call1;
  second.resolve({entities: [{data: {title: "new"}, deleted: false, id: "t1", seq: 264}]});
  await call2;

  applyDelta({
    delta: {
      collection: "todos",
      data: {title: "new"},
      id: "t1",
      method: "update",
      seq: 264,
      stream: STREAM,
    },
    store,
  });
};

describe("hydrateWindowEntities", () => {
  it("hydrates 2 of 3 ids and ignores the unknown id", async () => {
    const store = createSyncStore({collections: ["todos"]});
    const requested: string[] = [];
    const result = await hydrateWindowEntities({
      channel: {
        fetchEntities: async ({ids}) => {
          requested.push(...ids);
          return {
            entities: [
              {data: {title: "one"}, deleted: false, id: "a", seq: 4},
              {data: {title: "two"}, deleted: false, id: "b", seq: 5},
            ],
          };
        },
      },
      collection: "todos",
      ids: ["a", "b", "missing"],
      store,
    });

    assert.deepEqual(requested, ["a", "b", "missing"]);
    assert.deepEqual(result.hydratedIds.sort(), ["a", "b"]);
    const rowA = store.getEntity<{title: string}>({collection: "todos", id: "a"});
    const rowB = store.getEntity<{title: string}>({collection: "todos", id: "b"});
    assert.equal(rowA?.data.title, "one");
    assert.equal(rowB?.seq, 5);
    assert.isUndefined(store.getEntity({collection: "todos", id: "missing"}));
    assert.equal(rowA?.stream, STREAM);
  });

  it("upserts REST rows immediately and fetches every id for seq/deleted metadata", async () => {
    const store = createSyncStore({collections: ["todos"]});
    const fetched: string[][] = [];
    await hydrateWindowEntities({
      channel: {
        fetchEntities: async ({ids}) => {
          fetched.push(ids);
          return {
            entities: [
              {data: {title: "canonical-a"}, deleted: false, id: "a", seq: 7},
              {data: {title: "from-entities"}, deleted: false, id: "b", seq: 9},
            ],
          };
        },
      },
      collection: "todos",
      ids: ["a", "b"],
      restRows: {a: {title: "from-rest"}},
      store,
    });

    assert.deepEqual(fetched, [["a", "b"]]);
    const restRow = store.getEntity<{title: string}>({collection: "todos", id: "a"});
    const entityRow = store.getEntity<{title: string}>({collection: "todos", id: "b"});
    // The fetched entity replaces the REST row: `/sync/entities` is read after the REST page.
    assert.equal(restRow?.data.title, "canonical-a");
    assert.equal(restRow?.seq, 7);
    assert.equal(entityRow?.data.title, "from-entities");
    assert.equal(entityRow?.seq, 9);
  });

  it("exposes REST row data before entities fetch resolves", async () => {
    const store = createSyncStore({collections: ["todos"]});
    const updatedAt = DateTime.utc().toISO();
    let restRowDuringFetch: {data?: {title?: string; updated?: string}; seq?: number} | undefined;

    await hydrateWindowEntities({
      channel: {
        fetchEntities: async () => {
          restRowDuringFetch = store.getEntity<{title: string; updated?: string}>({
            collection: "todos",
            id: "a",
          });
          return {
            entities: [{data: {title: "canonical"}, deleted: false, id: "a", seq: 11}],
          };
        },
      },
      collection: "todos",
      ids: ["a"],
      restRows: {a: {title: "from-rest", updated: updatedAt}},
      store,
    });

    assert.equal(restRowDuringFetch?.data?.title, "from-rest");
    assert.equal(restRowDuringFetch?.data?.updated, updatedAt);
    assert.equal(restRowDuringFetch?.seq, 0);
    const row = store.getEntity<{title: string; updated?: string}>({collection: "todos", id: "a"});
    assert.equal(row?.seq, 11);
  });

  it("applies deleted metadata from entities onto REST rows", async () => {
    const store = createSyncStore({collections: ["todos"]});
    await hydrateWindowEntities({
      channel: {
        fetchEntities: async () => ({
          entities: [{data: {title: "gone"}, deleted: true, id: "a", seq: 12}],
        }),
      },
      collection: "todos",
      ids: ["a"],
      restRows: {a: {title: "from-rest"}},
      store,
    });

    const row = store.getEntity<{title: string}>({collection: "todos", id: "a"});
    assert.equal(row?.data.title, "gone");
    assert.equal(row?.seq, 12);
    assert.isTrue(row?.deleted);
  });

  it("keeps a newer live delta when the entities snapshot is already stale", async () => {
    const store = createSyncStore({collections: ["todos"]});
    const result = await hydrateWindowEntities({
      channel: {
        fetchEntities: async () => {
          // A `{collection}|admin` delta lands while the entities request is in flight.
          store.upsertEntity({
            collection: "todos",
            data: {title: "live-delta"},
            id: "a",
            seq: 20,
            stream: STREAM,
          });
          return {
            entities: [{data: {title: "stale-snapshot"}, deleted: true, id: "a", seq: 12}],
          };
        },
      },
      collection: "todos",
      ids: ["a"],
      store,
    });

    const row = store.getEntity<{title: string}>({collection: "todos", id: "a"});
    assert.deepEqual(result.hydratedIds, ["a"]);
    assert.equal(row?.data.title, "live-delta");
    assert.equal(row?.seq, 20);
    assert.isNotTrue(row?.deleted);
  });

  it("skips REST and entities upserts when a pending optimistic mutation owns the row", async () => {
    const store = createSyncStore({collections: ["todos"]});
    store.upsertEntity({
      collection: "todos",
      data: {title: "pending-local"},
      id: "a",
      pendingMutationId: "m-pending",
      seq: 3,
      stream: STREAM,
    });

    await hydrateWindowEntities({
      channel: {
        fetchEntities: async () => ({
          entities: [{data: {title: "server"}, deleted: false, id: "a", seq: 99}],
        }),
      },
      collection: "todos",
      ids: ["a"],
      restRows: {a: {title: "from-rest"}},
      store,
    });

    const row = store.getEntity<{title: string}>({collection: "todos", id: "a"});
    assert.equal(row?.data.title, "pending-local");
    assert.equal(row?.seq, 3);
    assert.equal(row?.pendingMutationId, "m-pending");
  });

  describe("when the store already holds a server-seq entity", () => {
    const seed = (store: ReturnType<typeof createSyncStore>, seq: number, title: string): void => {
      store.upsertEntity({collection: "todos", data: {title}, id: "t1", seq, stream: STREAM});
    };

    it("never overwrites a stored seq>0 entity with a stale REST row, and keeps it on equal fetched seq", async () => {
      const store = createSyncStore({collections: ["todos"]});
      seed(store, 5, "new");
      let titleDuringFetch: string | undefined;

      await hydrateWindowEntities({
        channel: {
          fetchEntities: async () => {
            titleDuringFetch = store.getEntity<{title: string}>({collection: "todos", id: "t1"})
              ?.data.title;
            return {entities: [{data: {title: "new"}, deleted: false, id: "t1", seq: 5}]};
          },
        },
        collection: "todos",
        ids: ["t1"],
        restRows: {t1: {title: "old"}},
        store,
      });

      assert.equal(titleDuringFetch, "new");
      const row = store.getEntity<{title: string}>({collection: "todos", id: "t1"});
      assert.equal(row?.data.title, "new");
      assert.equal(row?.seq, 5);
    });

    it("keeps stored canonical data when the fetched seq equals the stored seq", async () => {
      const store = createSyncStore({collections: ["todos"]});
      seed(store, 5, "new");

      await hydrateWindowEntities({
        channel: {
          fetchEntities: async () => ({
            entities: [{data: {title: "same-seq-other"}, deleted: false, id: "t1", seq: 5}],
          }),
        },
        collection: "todos",
        ids: ["t1"],
        restRows: {t1: {title: "old"}},
        store,
      });

      const row = store.getEntity<{title: string}>({collection: "todos", id: "t1"});
      assert.equal(row?.data.title, "new");
      assert.equal(row?.seq, 5);
    });

    it("keeps the stored entity when the fetched seq is older", async () => {
      const store = createSyncStore({collections: ["todos"]});
      seed(store, 5, "new");

      await hydrateWindowEntities({
        channel: {
          fetchEntities: async () => ({
            entities: [{data: {title: "stale"}, deleted: false, id: "t1", seq: 4}],
          }),
        },
        collection: "todos",
        ids: ["t1"],
        restRows: {t1: {title: "old"}},
        store,
      });

      const row = store.getEntity<{title: string}>({collection: "todos", id: "t1"});
      assert.equal(row?.data.title, "new");
      assert.equal(row?.seq, 5);
    });

    it("takes fetched data and seq when the fetched seq is newer than the stored seq", async () => {
      const store = createSyncStore({collections: ["todos"]});
      seed(store, 2, "older");

      await hydrateWindowEntities({
        channel: {
          fetchEntities: async () => ({
            entities: [{data: {title: "canon-new"}, deleted: false, id: "t1", seq: 6}],
          }),
        },
        collection: "todos",
        ids: ["t1"],
        restRows: {t1: {title: "rest-new"}},
        store,
      });

      const row = store.getEntity<{title: string}>({collection: "todos", id: "t1"});
      assert.equal(row?.seq, 6);
      assert.equal(row?.data.title, "canon-new");
    });
  });

  // Replaces "keeps REST data once the fetched seq lands": /sync/entities is always read after the
  // REST page, so a fetched seq newer than the stored one carries data at least as new as REST.
  it("fills an id the store lacks from REST, then takes the fetched data once a newer seq lands", async () => {
    const store = createSyncStore({collections: ["todos"]});

    await hydrateWindowEntities({
      channel: {
        fetchEntities: async () => ({
          entities: [{data: {title: "canon"}, deleted: false, id: "t1", seq: 3}],
        }),
      },
      collection: "todos",
      ids: ["t1"],
      restRows: {t1: {title: "rest"}},
      store,
    });

    const row = store.getEntity<{title: string}>({collection: "todos", id: "t1"});
    assert.equal(row?.seq, 3);
    assert.equal(row?.data.title, "canon");
  });

  describe("two overlapping hydrates race a PATCH", () => {
    it("ends at the fetched seq 264 data when the store started without the entity", async () => {
      const store = createSyncStore({collections: ["todos"]});

      await runOverlappingHydrates(store);

      const row = store.getEntity<{title: string}>({collection: "todos", id: "t1"});
      assert.equal(row?.data.title, "new");
      assert.equal(row?.seq, 264);
    });

    it("ends at the fetched seq 264 data when the store held a REST-only fill at seq 0", async () => {
      const store = createSyncStore({collections: ["todos"]});
      store.upsertEntity({collection: "todos", data: {title: "old"}, id: "t1", stream: STREAM});

      await runOverlappingHydrates(store);

      const row = store.getEntity<{title: string}>({collection: "todos", id: "t1"});
      assert.equal(row?.data.title, "new");
      assert.equal(row?.seq, 264);
    });
  });

  it("leaves a pending-mutation row untouched even when REST and a newer fetched seq differ", async () => {
    const store = createSyncStore({collections: ["todos"]});
    store.upsertEntity({
      collection: "todos",
      data: {title: "local"},
      id: "t1",
      pendingMutationId: "m1",
      seq: 5,
      stream: STREAM,
    });

    await hydrateWindowEntities({
      channel: {
        fetchEntities: async () => ({
          entities: [{data: {title: "canon-new"}, deleted: false, id: "t1", seq: 9}],
        }),
      },
      collection: "todos",
      ids: ["t1"],
      restRows: {t1: {title: "rest"}},
      store,
    });

    const row = store.getEntity<{title: string}>({collection: "todos", id: "t1"});
    assert.equal(row?.data.title, "local");
    assert.equal(row?.seq, 5);
    assert.equal(row?.pendingMutationId, "m1");
  });
});
