import type {SyncStore} from "../storage/store";
import {MAX_REPAIR_FETCH_IDS} from "./entityRepair";
import type {HttpChannel} from "./httpChannel";

/** Stream key window subscribers join (`{collection}|admin`). */
const adminWindowStream = (collection: string): string => `${collection}|admin`;

export interface HydrateWindowEntitiesArgs {
  store: SyncStore;
  channel: Pick<HttpChannel, "fetchEntities">;
  collection: string;
  ids: string[];
  /**
   * Optional REST membership payloads keyed by id. For ids the store does not hold yet they
   * upsert immediately for fast UI; every requested id is still fetched from
   * `GET /sync/entities` before this call resolves, and that canonical entity replaces them.
   */
  restRows?: Record<string, unknown>;
}

export interface HydrateWindowEntitiesResult {
  hydratedIds: string[];
}

/**
 * Upsert a window of known ids into TinyBase. REST rows render immediately for ids the store
 * lacks; the canonical entity (data, seq, deleted) from `GET /sync/entities` then replaces any
 * stored version older than it, and never a version at least as new (a live delta that landed
 * first). Overlapping calls stay safe: a stale REST page can never be stored under a newer seq.
 * Server ids that `/sync/entities` does not return are ignored (no empty rows) unless a REST
 * row already landed.
 */
export const hydrateWindowEntities = async ({
  store,
  channel,
  collection,
  ids,
  restRows,
}: HydrateWindowEntitiesArgs): Promise<HydrateWindowEntitiesResult> => {
  const uniqueIds = [...new Set(ids.filter((id) => id.length > 0))];
  if (uniqueIds.length === 0) {
    return {hydratedIds: []};
  }

  const stream = adminWindowStream(collection);
  const hydrated = new Set<string>();

  for (const id of uniqueIds) {
    const restData = restRows?.[id];
    if (restData === undefined) {
      continue;
    }
    const existing = store.getEntity({collection, id});
    if (existing?.pendingMutationId) {
      continue;
    }
    // REST rows only fill ids the store lacks. An entity with a server seq (from a live delta or
    // an earlier hydrate) is at least as new as a REST page read before it, so it is kept.
    if (existing && existing.seq > 0) {
      continue;
    }
    store.upsertEntity({
      collection,
      data: restData,
      id,
      stream,
    });
    hydrated.add(id);
  }

  for (let i = 0; i < uniqueIds.length; i += MAX_REPAIR_FETCH_IDS) {
    const chunk = uniqueIds.slice(i, i + MAX_REPAIR_FETCH_IDS);
    const response = await channel.fetchEntities({collection, ids: chunk});
    for (const entity of response.entities) {
      if (!uniqueIds.includes(entity.id)) {
        continue;
      }
      const existing = store.getEntity({collection, id: entity.id});
      if (existing?.pendingMutationId) {
        continue;
      }
      // A live `{collection}|admin` delta can land while this fetch is in flight, and an entity
      // the store already holds at this seq is the same version. Writing the fetched snapshot
      // back would rewind data, seq or deleted and make the next mutate conflict against a stale
      // baseline.
      if (existing && existing.seq > 0 && existing.seq >= entity.seq) {
        hydrated.add(entity.id);
        continue;
      }
      store.upsertEntity({
        collection,
        // `/sync/entities` is read after the REST page, so a newer fetched entity is never older
        // than a REST row; keeping REST data here could store a pre-update title under the new
        // seq, and the live delta for that seq would then be skipped as already applied.
        data: entity.data,
        deleted: entity.deleted,
        id: entity.id,
        pendingMutationId: "",
        seq: entity.seq,
        stream,
      });
      hydrated.add(entity.id);
    }
  }

  return {hydratedIds: [...hydrated]};
};
