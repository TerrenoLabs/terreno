import express from "express";
import mongoose from "mongoose";
import {asyncHandler} from "../api";
import {authenticateMiddleware, type User} from "../auth";
import {APIError, apiErrorMiddleware, apiUnauthorizedMiddleware} from "../errors";
import {logger} from "../logger";
import {checkPermissions} from "../permissions";
import {findOneOrNoneFor} from "../plugins";
import type {AnyTerrenoAccess} from "../rbac/types";
import {
  canListAdminBroadcastScope,
  getAdminBroadcastScope,
  resolveAdminBroadcastQueryFilter,
} from "./adminBroadcastScope";
import {canUseAdminBroadcastWindow} from "./adminWindowAccess";
import {
  computeStableFrontier,
  getCompactedThroughSeq,
  getOrCreateSyncKeyMaterial,
  SyncCounter,
  SyncScopeMove,
  type SyncScopeMoveDocument,
} from "./models";
import {findSyncEntryByCollectionTag, getSyncRegistry, type SyncRegistryEntry} from "./registry";
import {serializeSyncPayload} from "./serialize";
import {
  getScopeField,
  parseStreamKey,
  resolveStreamForDoc,
  resolveUserStreamsForEntry,
} from "./streams";
import {runSyncBatch, runSyncMutation} from "./syncBatch";
import type {
  SyncEntitiesResponse,
  SyncEntityPayload,
  SyncMutateBatchRequest,
  SyncMutateRequest,
  SyncNackCode,
  SyncSnapshotBatchRequest,
  SyncSnapshotBatchResponse,
  SyncSnapshotBatchStreamRequest,
  SyncSnapshotResponse,
  SyncStreamInfo,
  SyncStreamsResponse,
} from "./types";

/**
 * Maximum mutations per user per second on the HTTP mutate routes.
 *
 * Task 9.20: an alias for the shared budget — HTTP and socket mutations now draw from ONE
 * per-user window (see `syncBatch.ts`), so there is no longer a separate HTTP allowance.
 * Re-exported (rather than copied) so the two names can never drift; a live re-export also
 * keeps this module's evaluation independent of `syncBatch`, which imports back into it.
 */
export {MAX_SYNC_MUTATIONS_PER_SECOND as MAX_SYNC_HTTP_MUTATIONS_PER_SECOND} from "./syncBatch";

/** Options for the SyncApp plugin's HTTP routes. */
export interface SyncAppOptions {
  /**
   * Resolve the scope values a user belongs to for tenant-scoped models
   * (e.g. the user's organization ids). Required when any registered model uses a
   * tenant scope.
   */
  getUserScopes?: (user: User, entry: SyncRegistryEntry) => Promise<string[]> | string[];
  /** Default page size for snapshots (default 100, max 100). */
  defaultSnapshotLimit?: number;
  /**
   * When set, `{collection}|admin` window subscribe and cross-owner entity
   * hydrate require `admin:access` instead of the legacy `user.admin` flag.
   * AdminApp also registers per-model list/read/`queryFilter` so hydrate and
   * `|admin` deltas match `/admin` REST, not product `IsOwner`.
   */
  accessControl?: AnyTerrenoAccess;
  /**
   * Override the admin-window gate. Defaults to `admin:access` when
   * `accessControl` is set, otherwise `Permissions.IsAdmin`.
   */
  canOpenAdminWindow?: (user: User) => boolean | Promise<boolean>;
}

const MAX_SNAPSHOT_LIMIT = 100;
const DEFAULT_SNAPSHOT_LIMIT = 100;
/** Entity budget of one `POST /sync/snapshot/batch` response, shared by its streams. */
const DEFAULT_SNAPSHOT_BATCH_LIMIT = 5_000;
const MAX_SNAPSHOT_BATCH_LIMIT = 10_000;
/** Most streams one batch request may name. */
const MAX_SNAPSHOT_BATCH_STREAMS = 500;
/** Streams paged at once per batch request, so one request cannot drain the Mongo pool. */
const SNAPSHOT_BATCH_CONCURRENCY = 8;

/** Minimal shape of a synced document as read by the snapshot/entities routes. */
interface SyncedDoc {
  _syncSeq?: number;
  deleted?: boolean;
}

/** A registered sync model, viewed through the fields these routes read. */
type SyncedModel = mongoose.Model<SyncedDoc>;

/**
 * Look up a registered model by name as a `SyncedModel`. `mongoose.model(name)` has no
 * schema to infer from, so its static type carries none of the synced-document fields.
 */
const getSyncedModel = (modelName: string): SyncedModel =>
  mongoose.model(modelName) as unknown as SyncedModel;

/** HTTP status for each nack code returned by `POST /sync/mutate`. */
const NACK_HTTP_STATUS: Record<SyncNackCode, number> = {
  conflict: 409,
  error: 500,
  rate_limited: 429,
  unauthorized: 403,
  validation: 422,
};

/**
 * Serialize a document for a sync payload through the fallback chain:
 * sync responseHandler > modelRouter responseHandler > toJSON.
 * Delegates to the shared `serializeSyncPayload` (also used for `sync:delta` emission).
 */
export const serializeSyncDoc = async ({
  entry,
  doc,
  req,
}: {
  entry: SyncRegistryEntry;
  doc: mongoose.Document;
  req: express.Request;
}): Promise<unknown> =>
  serializeSyncPayload({doc: doc as unknown as Record<string, unknown>, entry, req});

/**
 * C2: build the server-enforced scope filter for a SINGLE stream. The stream's scope
 * value has already been verified against the user's membership set by the caller, so
 * this filters to exactly that one value (`{field: value}`), never an `$in`.
 *
 * Custom-resolver scopes cannot be inverted into a query field, so they still route
 * through the required `snapshotFilter` (parameterized by the user, as before).
 *
 * Task 9.19: for owner/tenant/broadcast scopes a consumer-supplied `snapshotFilter` used
 * to be computed and then discarded — silently widening the snapshot past what the
 * consumer asked for. It is now composed with the scope clause via `$and` (never
 * spread-merged, which would let one clobber the other).
 */
export const buildSnapshotScopeFilter = ({
  entry,
  scopeValue,
  snapshotFilterResult,
}: {
  entry: SyncRegistryEntry;
  scopeValue: string | null;
  snapshotFilterResult?: Record<string, unknown>;
}): Record<string, unknown> => {
  const {scope} = entry.config;
  if (typeof scope === "function") {
    // Custom scope: snapshotFilter is required at registration.
    if (!snapshotFilterResult) {
      throw new APIError({
        status: 500,
        title: `Sync collection ${entry.collectionTag} has a custom scope without a snapshotFilter`,
      });
    }
    return snapshotFilterResult;
  }
  const scopeClause: Record<string, unknown> =
    scope.type === "broadcast" ? {} : {[getScopeField(scope) as string]: scopeValue};
  if (!snapshotFilterResult) {
    return scopeClause;
  }
  return {$and: [scopeClause, snapshotFilterResult]};
};

/**
 * Task 9.19: resolve the modelRouter `queryFilter` for a sync read.
 *
 * The most common REST shape is `read: [IsAuthenticated]` plus a `queryFilter` (e.g.
 * `OwnerQueryFilter`) doing the actual row-level scoping. Sync built only scope + seq
 * clauses, so for a `broadcast`/`custom`-scoped collection every document in the stream
 * leaked through the snapshot and `GET /sync/entities` even though the REST list endpoint
 * hid it. Both read paths now `$and` the resolved filter into their query, giving sync and
 * REST the same visible row set.
 *
 * `queryFilter` is called with an empty query object: a sync read carries no user-supplied
 * query params, so there is nothing to validate — only the filter clause to apply.
 * Returning `null` means "this caller may see nothing" (REST answers with an empty list),
 * which sync mirrors by serving an empty page rather than erroring. A throwing filter is
 * denied the same way the realtime path denies it: fail closed, never fall through open.
 */
const resolveSyncQueryFilter = async ({
  entry,
  user,
}: {
  entry: SyncRegistryEntry;
  user: User;
}): Promise<{denied: boolean; filter?: Record<string, unknown>}> => {
  if (!entry.options.queryFilter) {
    return {denied: false};
  }
  let resolved: Record<string, unknown> | null;
  try {
    resolved = await entry.options.queryFilter(user, {});
  } catch (error: unknown) {
    logger.error("[sync] queryFilter threw for a sync read; denying the read", {
      collection: entry.collectionTag,
      error: String(error),
      userId: String(user.id),
    });
    return {denied: true};
  }
  if (resolved === null) {
    return {denied: true};
  }
  return {denied: false, filter: Object.keys(resolved).length > 0 ? resolved : undefined};
};

/**
 * `$and` the resolved `queryFilter` onto a sync read's scope filter. Spread-merging would
 * let either side clobber a same-named key (e.g. both constraining `ownerId`), so both
 * clauses are kept and both must match.
 */
const composeSyncReadFilter = ({
  queryFilter,
  scopeFilter,
}: {
  queryFilter?: Record<string, unknown>;
  scopeFilter: Record<string, unknown>;
}): Record<string, unknown> => {
  if (!queryFilter) {
    return scopeFilter;
  }
  if (Object.keys(scopeFilter).length === 0) {
    return queryFilter;
  }
  return {$and: [scopeFilter, queryFilter]};
};

/**
 * Task 9.27: parse strictly. `Number.parseInt` stops at the first non-digit, so `"12abc"`
 * and `"1e9"` used to silently become 12 and 1 — a client with a malformed cursor got a
 * plausible-looking page instead of an error, and resumed paging from the wrong seq.
 */
const parseNonNegativeInt = (raw: unknown, name: string, fallback: number): number => {
  if (raw === undefined) {
    return fallback;
  }
  const text = String(raw).trim();
  if (!/^\d+$/.test(text)) {
    throw new APIError({status: 400, title: `Invalid ${name}: ${String(raw)}`});
  }
  const value = Number.parseInt(text, 10);
  if (!Number.isSafeInteger(value)) {
    throw new APIError({status: 400, title: `Invalid ${name}: ${String(raw)}`});
  }
  return value;
};

/**
 * Task 9.14: the legacy cursor is a raw `_id` string, so it must be compared in the
 * model's OWN `_id` BSON type. Synced models are designed around client-minted string
 * `_id`s: casting those to `ObjectId` either throws (non-hex ids) or — worse — silently
 * compares across BSON types and matches nothing, so the legacy stratum reported itself
 * exhausted after one page and the remaining documents were never bootstrapped.
 * Only ObjectId-keyed models get the cast; a malformed cursor for one is a 400, not a 500.
 */
const legacyCursorClause = ({
  model,
  legacyCursorIn,
}: {
  model: SyncedModel;
  legacyCursorIn: string;
}): Record<string, unknown> => {
  const idInstance = (model.schema?.path("_id") as {instance?: string} | undefined)?.instance;
  if (idInstance !== "ObjectId") {
    return {_id: {$gt: legacyCursorIn}};
  }
  if (!mongoose.isValidObjectId(legacyCursorIn)) {
    throw new APIError({status: 400, title: `Invalid legacyCursor: ${legacyCursorIn}`});
  }
  return {_id: {$gt: new mongoose.Types.ObjectId(legacyCursorIn)}};
};

/**
 * C3: page the legacy (seq-0) stratum by `_id`. Legacy documents predate `syncPlugin`
 * and carry no `_syncSeq` (or a literal 0). Returns a page + a forward `legacyCursor`
 * while the stratum has more; returns `undefined` once the stratum is exhausted, at
 * which point the caller switches to normal seq paging. Runs the same per-doc read
 * check as the seq page (C6/M2).
 */
const pageLegacyStratum = async ({
  model,
  scopeFilter,
  legacyCursorIn,
  limit,
  entry,
  req,
}: {
  model: SyncedModel;
  scopeFilter: Record<string, unknown>;
  legacyCursorIn?: string;
  limit: number;
  entry: SyncRegistryEntry;
  req: express.Request;
}): Promise<{entities: SyncEntityPayload[]; legacyCursor: string} | undefined> => {
  const user = req.user as User | undefined;
  // `deleted` MUST stay a TOP-LEVEL key so isDeletedPlugin does not re-inject its
  // {deleted: {$ne: true}} exclusion (which only fires when the top-level filter has no
  // `deleted` key) and hide legacy tombstones. See the seq-page query for the full note.
  const legacyFilter: Record<string, unknown> = {
    $and: [
      scopeFilter,
      {_syncSeq: {$in: [null, 0]}},
      ...(legacyCursorIn ? [legacyCursorClause({legacyCursorIn, model})] : []),
    ],
    deleted: {$in: [true, false]},
  };
  const docs = await model
    .find(legacyFilter)
    .sort({_id: 1})
    .limit(limit + 1);
  if (docs.length === 0) {
    // Stratum exhausted (or never had legacy docs) — caller proceeds by seq.
    return undefined;
  }
  const page = docs.slice(0, limit);
  const entities: SyncEntityPayload[] = [];
  for (const doc of page) {
    if (!(await checkPermissions("read", entry.options.permissions.read, user, doc))) {
      continue;
    }
    entities.push({
      data: await serializeSyncDoc({doc, entry, req}),
      deleted: Boolean(doc.deleted),
      id: String(doc._id),
      seq: 0,
    });
  }
  const lastId = String(page[page.length - 1]._id);
  return {entities, legacyCursor: lastId};
};

/**
 * C1: true when the stream's head (highest claimed seq) exceeds the stable frontier —
 * i.e. committed seqs are still coming once the in-flight writes below the frontier land.
 */
const frontierBelowStreamHead = async (
  streamKey: string,
  frontierSeq: number
): Promise<boolean> => {
  const counter = await findOneOrNoneFor(SyncCounter, {stream: streamKey});
  const head = counter?.seq ?? 0;
  return head > frontierSeq;
};

/**
 * Page the normal seq stratum: documents with `_syncSeq` in `(cursor, frontierSeq]`, unioned
 * with the `SyncScopeMove` tombstones for the same seq range (C4). Mirrors
 * `pageLegacyStratum` as the other half of the snapshot's paging: the caller drains the
 * legacy stratum first, then hands every subsequent page to this helper.
 *
 * Returns the page's entities plus the cursor to resume from and whether more remains.
 */
const pageSeqStratum = async ({
  model,
  scopeFilter,
  cursor,
  limit,
  frontierSeq,
  streamKey,
  entry,
  req,
}: {
  model: SyncedModel;
  scopeFilter: Record<string, unknown>;
  cursor: number;
  limit: number;
  frontierSeq: number;
  streamKey: string;
  entry: SyncRegistryEntry;
  req: express.Request;
}): Promise<{cursor: number; entities: SyncEntityPayload[]; hasMore: boolean}> => {
  const user = req.user as User | undefined;
  // C1: never page past the stable frontier — a cursor must not cross an uncommitted hole.
  const seqFilter = {_syncSeq: {$gt: cursor, $lte: frontierSeq}};
  // M1: compose the scope + seq clauses with $and (never spread-merge, which lets a
  // scopeFilter $or clobber the seq clause). `deleted` MUST stay a TOP-LEVEL key:
  // isDeletedPlugin injects {deleted: {$ne: true}} only when the top-level filter has
  // no `deleted` key — burying it inside $and would let the plugin re-inject its
  // exclusion and hide the tombstones catch-up depends on.
  const query = {$and: [scopeFilter, seqFilter], deleted: {$in: [true, false]}};
  const docs = await model
    .find(query)
    .sort({_syncSeq: 1})
    .limit(limit + 1);

  // C4: merge SyncScopeMove markers for THIS (old) stream into the page as tombstones,
  // so an offline old-stream client learns the doc left its stream.
  const markers = await SyncScopeMove.find({
    fromStream: streamKey,
    seq: {$gt: cursor, $lte: frontierSeq},
  })
    .sort({seq: 1})
    .limit(limit + 1)
    .lean();

  const page = docs.slice(0, limit);
  const markerPage = markers.slice(0, limit);
  const docsHaveMore = docs.length > limit;
  const markersHaveMore = markers.length > limit;

  // The highest seq this page has fully examined. Docs and markers are fetched with
  // independent limits, so coverage stops at the lower of the two: past that seq, the
  // truncated side may still hold rows this page never saw. When a side was not
  // truncated, everything up to the frontier is covered.
  const lastDocSeq = page.length > 0 ? (page[page.length - 1]._syncSeq ?? 0) : 0;
  const lastMarkerSeq = markerPage.length > 0 ? markerPage[markerPage.length - 1].seq : 0;
  const coveredSeq = Math.min(
    docsHaveMore ? lastDocSeq : frontierSeq,
    markersHaveMore ? lastMarkerSeq : frontierSeq
  );

  // C6 (M2): run the same per-doc read permission the delta path uses; drop denied
  // docs but still advance the cursor past them (parity with delta behavior).
  const docEntities: SyncEntityPayload[] = [];
  for (const doc of page) {
    const allowed = await checkPermissions("read", entry.options.permissions.read, user, doc);
    if (!allowed) {
      continue;
    }
    const isTombstone = Boolean(doc.deleted);
    docEntities.push({
      // C7: tombstones carry no data (privacy + payload growth) — only id/seq/deleted.
      data: isTombstone ? null : await serializeSyncDoc({doc, entry, req}),
      deleted: isTombstone,
      id: String(doc._id),
      seq: doc._syncSeq ?? 0,
    });
  }
  const markerEntities: SyncEntityPayload[] = markerPage.map(
    (m: SyncScopeMoveDocument): SyncEntityPayload => ({
      data: null,
      deleted: true,
      id: m.entityId,
      seq: m.seq,
    })
  );
  // Union doc page + marker tombstones, sort by seq, and drop anything beyond the
  // covered range (it is re-fetched on the next page, in order).
  const merged = [...docEntities, ...markerEntities]
    .sort((a, b) => a.seq - b.seq)
    .filter((entity) => entity.seq <= coveredSeq);
  const entities = merged.slice(0, limit);
  const entitiesTruncated = merged.length > entities.length;

  // hasMore when: a full doc page was returned, extra markers remain, included
  // entities were truncated by the limit, or the frontier sits below the head (more
  // committed seqs are coming once in-flight writes land).
  const frontierBelowHead = await frontierBelowStreamHead(streamKey, frontierSeq);
  const hasMore = docsHaveMore || markersHaveMore || entitiesTruncated || frontierBelowHead;

  // Advance the cursor over every seq this page CONSUMED, not just the entities it
  // returned: a page whose docs were all read-denied returns nothing, and stalling the
  // cursor there loops the client forever. Truncation by `limit` still pins the cursor
  // to the last delivered entity so nothing undelivered is skipped, and the cursor
  // never crosses the stable frontier (C1) nor moves backwards.
  const advanceTo = entitiesTruncated ? entities[entities.length - 1].seq : coveredSeq;
  return {cursor: Math.max(cursor, Math.min(advanceTo, frontierSeq)), entities, hasMore};
};

/** Hard cap on ids per `GET /sync/entities` request. */
export const MAX_ENTITY_FETCH = 100;

/**
 * Task 9.27: `_id: {$in: ids}` leaves the cast to Mongoose, so one non-hex id against an
 * ObjectId-keyed model threw a CastError that surfaced as a 500 for what is purely bad
 * caller input. Validate up front and name the offending ids in a 400. Models with
 * client-minted string `_id`s (the syncdb default, see `legacyCursorClause`) take any shape.
 */
const castEntityIds = ({
  model,
  ids,
}: {
  ids: string[];
  model: SyncedModel;
}): (string | mongoose.Types.ObjectId)[] => {
  const idInstance = (model.schema?.path("_id") as {instance?: string} | undefined)?.instance;
  if (idInstance !== "ObjectId") {
    return ids;
  }
  const invalid = ids.filter((id) => !mongoose.isValidObjectId(id));
  if (invalid.length > 0) {
    throw new APIError({
      status: 400,
      title: `Invalid ids for ${model.modelName}: ${invalid.join(",")}`,
    });
  }
  return ids.map((id) => new mongoose.Types.ObjectId(id));
};

/**
 * Serve one snapshot page for one stream: membership/permission checks, frontier and
 * retention signals, then the legacy or seq stratum. Shared by `GET /sync/snapshot` and
 * `POST /sync/snapshot/batch`.
 */
const snapshotStreamPage = async ({
  req,
  user,
  streamKey,
  cursor,
  limit,
  legacyCursorIn,
  options,
}: {
  req: express.Request;
  user: User;
  streamKey: string;
  cursor: number;
  limit: number;
  legacyCursorIn?: string;
  options: SyncAppOptions;
}): Promise<SyncSnapshotResponse> => {
  if (!streamKey) {
    throw new APIError({status: 400, title: "stream query parameter is required"});
  }
  const parsed = parseStreamKey(streamKey);
  if (!parsed) {
    throw new APIError({status: 400, title: `Invalid stream key: ${streamKey}`});
  }
  const entry = findSyncEntryByCollectionTag(parsed.collectionTag);
  if (!entry) {
    throw new APIError({
      status: 404,
      title: `Unknown sync collection: ${parsed.collectionTag}`,
    });
  }
  if (!(await checkPermissions("list", entry.options.permissions.list, user))) {
    throw new APIError({
      status: 403,
      title: `Access to sync snapshot for ${parsed.collectionTag} denied for ${user.id}`,
    });
  }
  // C2: a client must not snapshot a stream it does not belong to.
  const memberStreams = await resolveUserStreamsForEntry({
    entry,
    getUserScopes: options.getUserScopes,
    user,
  });
  if (!memberStreams.includes(streamKey)) {
    throw new APIError({
      status: 403,
      title: `User ${user.id} does not belong to stream ${streamKey}`,
    });
  }

  const snapshotFilterResult = entry.config.snapshotFilter
    ? await entry.config.snapshotFilter({id: String(user.id)})
    : undefined;
  const queryFilterResult = await resolveSyncQueryFilter({entry, user});
  const scopeFilter = composeSyncReadFilter({
    queryFilter: queryFilterResult.filter,
    scopeFilter: buildSnapshotScopeFilter({
      entry,
      scopeValue: parsed.scopeValue,
      snapshotFilterResult,
    }),
  });
  const model = getSyncedModel(entry.modelName);
  const frontierSeq = await computeStableFrontier({stream: streamKey});
  // C7 (Task 9.15): the retention signal is the durable compaction watermark, not
  // min(retained seq). The old computation was pinned low forever by any early doc that
  // was never deleted, so a stale cursor sitting above a compacted tombstone's seq
  // passed the check and silently never learned about that deletion.
  const oldestRetainedSeq = await getCompactedThroughSeq({stream: streamKey});

  // Task 9.19: a `queryFilter` that denies this caller means "no visible rows", exactly
  // as REST's list endpoint answers. Serve a terminal empty page (cursor at the
  // frontier, hasMore false) so the client settles instead of paging forever.
  if (queryFilterResult.denied) {
    const deniedResponse: SyncSnapshotResponse = {
      cursor: frontierSeq,
      entities: [],
      frontierSeq,
      hasMore: false,
      oldestRetainedSeq,
      stream: streamKey,
    };
    return deniedResponse;
  }

  // C3: legacy (seq-0) stratum, paged by _id. Drained fully before seq paging begins.
  if (cursor === 0) {
    const legacyResult = await pageLegacyStratum({
      entry,
      legacyCursorIn,
      limit,
      model,
      req,
      scopeFilter,
    });
    if (legacyResult) {
      const response: SyncSnapshotResponse = {
        cursor: 0,
        entities: legacyResult.entities,
        frontierSeq,
        hasMore: true,
        legacyCursor: legacyResult.legacyCursor,
        oldestRetainedSeq,
        stream: streamKey,
      };
      return response;
    }
  }

  const seqResult = await pageSeqStratum({
    cursor,
    entry,
    frontierSeq,
    limit,
    model,
    req,
    scopeFilter,
    streamKey,
  });
  const response: SyncSnapshotResponse = {
    cursor: seqResult.cursor,
    entities: seqResult.entities,
    frontierSeq,
    hasMore: seqResult.hasMore,
    oldestRetainedSeq,
    stream: streamKey,
  };
  return response;
};

/** Validate the `streams` list of a snapshot batch body: non-empty, capped, no repeats. */
const parseSnapshotBatchStreams = (raw: unknown): SyncSnapshotBatchStreamRequest[] => {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new APIError({status: 400, title: "streams must be a non-empty array"});
  }
  if (raw.length > MAX_SNAPSHOT_BATCH_STREAMS) {
    throw new APIError({
      detail: `Requested ${raw.length} streams; the limit is ${MAX_SNAPSHOT_BATCH_STREAMS}`,
      status: 400,
      title: "Too many streams in snapshot batch",
    });
  }
  const seen = new Set<string>();
  return raw.map((item: unknown) => {
    const candidate = item as Partial<SyncSnapshotBatchStreamRequest> | null;
    if (!candidate || typeof candidate.stream !== "string" || !candidate.stream) {
      throw new APIError({status: 400, title: "Each snapshot batch entry needs a stream"});
    }
    if (candidate.legacyCursor !== undefined && typeof candidate.legacyCursor !== "string") {
      throw new APIError({status: 400, title: `Invalid legacyCursor for ${candidate.stream}`});
    }
    if (seen.has(candidate.stream)) {
      throw new APIError({
        status: 400,
        title: `Duplicate stream in snapshot batch: ${candidate.stream}`,
      });
    }
    seen.add(candidate.stream);
    return {
      cursor: candidate.cursor,
      legacyCursor: candidate.legacyCursor,
      stream: candidate.stream,
    };
  });
};

/** `items.map(map)` with at most `concurrency` calls in flight; results keep item order. */
const mapWithConcurrency = async <T, R>({
  items,
  concurrency,
  map,
}: {
  items: T[];
  concurrency: number;
  map: (item: T) => Promise<R>;
}): Promise<R[]> => {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await map(items[index] as T);
    }
  };
  await Promise.all(Array.from({length: Math.min(concurrency, items.length)}, worker));
  return results;
};

/**
 * Mount the SyncDB HTTP routes:
 * - GET /sync/streams — the authoritative set of streams the caller belongs to (C2)
 * - GET /sync/snapshot — per-stream bootstrap/catch-up with server-enforced scoping
 * - POST /sync/snapshot/batch — one page for each of many streams in one round trip
 * - POST /sync/mutate — HTTP fallback mutation channel over applySyncMutation
 * - GET /sync/key — per-user key material for the default encryption KeyProvider
 */

export const addSyncRoutes = (app: express.Application, options: SyncAppOptions = {}): void => {
  const router = express.Router();

  // C2: authoritative membership discovery. Runs against the full req.user (D2) so
  // tenant memberships resolve from current organizationIds.
  router.get(
    "/sync/streams",
    authenticateMiddleware(),
    asyncHandler(async (req, res) => {
      const user = req.user as User | undefined;
      if (!user) {
        throw new APIError({status: 401, title: "Authentication required"});
      }
      const streams: SyncStreamInfo[] = [];
      for (const entry of getSyncRegistry()) {
        if (!(await checkPermissions("list", entry.options.permissions.list, user))) {
          continue;
        }
        try {
          const entryStreams = await resolveUserStreamsForEntry({
            entry,
            getUserScopes: options.getUserScopes,
            user,
          });
          for (const stream of entryStreams) {
            streams.push({collection: entry.collectionTag, stream});
          }
        } catch (error: unknown) {
          throw new APIError({
            status: 500,
            title: `Failed to resolve streams for ${entry.collectionTag}: ${String(error)}`,
          });
        }
      }
      const response: SyncStreamsResponse = {streams};
      return res.json(response);
    })
  );

  router.get(
    "/sync/snapshot",
    authenticateMiddleware(),
    asyncHandler(async (req, res) => {
      const user = req.user as User | undefined;
      if (!user) {
        throw new APIError({status: 401, title: "Authentication required"});
      }
      const cursor = parseNonNegativeInt(req.query.cursor, "cursor", 0);
      const requestedLimit = parseNonNegativeInt(
        req.query.limit,
        "limit",
        options.defaultSnapshotLimit ?? DEFAULT_SNAPSHOT_LIMIT
      );
      const limit = Math.min(Math.max(requestedLimit, 1), MAX_SNAPSHOT_LIMIT);
      const legacyCursorIn =
        typeof req.query.legacyCursor === "string" && req.query.legacyCursor.length > 0
          ? req.query.legacyCursor
          : undefined;
      const response = await snapshotStreamPage({
        cursor,
        legacyCursorIn,
        limit,
        options,
        req,
        streamKey: String(req.query.stream ?? ""),
        user,
      });
      return res.json(response);
    })
  );

  // Page many streams in one round trip: one page per requested stream, in request order.
  // `limit` is the entity budget for the whole response, split evenly across the streams,
  // so a request stays bounded however many streams it names; streams with more pages
  // are asked for again (with a larger share) in the client's next round.
  router.post(
    "/sync/snapshot/batch",
    authenticateMiddleware(),
    asyncHandler(async (req, res) => {
      const user = req.user as User | undefined;
      if (!user) {
        throw new APIError({status: 401, title: "Authentication required"});
      }
      const body = req.body as Partial<SyncSnapshotBatchRequest> | undefined;
      const items = parseSnapshotBatchStreams(body?.streams);
      const budget = Math.min(
        Math.max(
          parseNonNegativeInt(body?.limit, "limit", DEFAULT_SNAPSHOT_BATCH_LIMIT),
          items.length
        ),
        MAX_SNAPSHOT_BATCH_LIMIT
      );
      const limit = Math.max(1, Math.floor(budget / items.length));
      const pages = await mapWithConcurrency({
        concurrency: SNAPSHOT_BATCH_CONCURRENCY,
        items,
        map: (item) =>
          snapshotStreamPage({
            cursor: parseNonNegativeInt(item.cursor, "cursor", 0),
            legacyCursorIn: item.legacyCursor || undefined,
            limit,
            options,
            req,
            streamKey: item.stream,
            user,
          }),
      });
      const response: SyncSnapshotBatchResponse = {pages};
      return res.json(response);
    })
  );

  router.get(
    "/sync/entities",
    authenticateMiddleware(),
    asyncHandler(async (req, res) => {
      const user = req.user as User | undefined;
      if (!user) {
        throw new APIError({status: 401, title: "Authentication required"});
      }
      const collection = String(req.query.collection ?? "").trim();
      if (!collection) {
        throw new APIError({status: 400, title: "collection query parameter is required"});
      }
      const idsParam = req.query.ids;
      const ids =
        typeof idsParam === "string"
          ? idsParam
              .split(",")
              .map((id) => id.trim())
              .filter((id) => id.length > 0)
          : [];
      if (ids.length === 0) {
        throw new APIError({status: 400, title: "ids query parameter is required"});
      }
      // Task 9.27: this used to `.slice(0, MAX_ENTITY_FETCH)`, so an over-cap repair fetch
      // came back 200 with a partial body and the client treated the entities it never
      // received as absent. Reject instead, so the caller re-requests in chunks.
      if (ids.length > MAX_ENTITY_FETCH) {
        throw new APIError({
          status: 400,
          title: `Too many ids: ${ids.length} requested, limit is ${MAX_ENTITY_FETCH}`,
        });
      }

      const entry = findSyncEntryByCollectionTag(collection);
      if (!entry) {
        throw new APIError({
          status: 404,
          title: `Unknown sync collection: ${collection}`,
        });
      }
      if (!(await checkPermissions("list", entry.options.permissions.list, user))) {
        throw new APIError({
          status: 403,
          title: `Access to sync entities for ${collection} denied for ${user.id}`,
        });
      }

      const isAdminWindow =
        entry.config.adminBroadcast === true &&
        (await canUseAdminBroadcastWindow({
          accessControl: options.accessControl,
          canOpenAdminWindow: options.canOpenAdminWindow,
          user,
        }));
      const adminScope = isAdminWindow ? getAdminBroadcastScope(entry.modelName) : undefined;
      if (adminScope && !(await canListAdminBroadcastScope({scope: adminScope, user}))) {
        const deniedResponse: SyncEntitiesResponse = {entities: []};
        return res.json(deniedResponse);
      }

      const memberStreams = isAdminWindow
        ? []
        : await resolveUserStreamsForEntry({
            entry,
            getUserScopes: options.getUserScopes,
            user,
          });
      const memberSet = new Set(memberStreams);

      // Task 9.19: mirror the REST list endpoint's row-level scoping. Without this, a
      // collection that relies on `queryFilter` (rather than a per-doc read permission)
      // served every requested id here, whatever the caller was allowed to list.
      // Admin window hydrate skips the *product* filter so REST-selected ids can load
      // across owners, then applies AdminApp list/read/`queryFilter` when registered.
      const queryFilterResult = adminScope
        ? await resolveAdminBroadcastQueryFilter({scope: adminScope, user})
        : isAdminWindow
          ? {denied: false as const, filter: undefined}
          : await resolveSyncQueryFilter({entry, user});
      if (queryFilterResult.denied) {
        const deniedResponse: SyncEntitiesResponse = {entities: []};
        return res.json(deniedResponse);
      }

      const model = getSyncedModel(entry.modelName);
      const castIds = castEntityIds({ids, model});
      const docs = await model.find({
        // `deleted` MUST stay a TOP-LEVEL key so isDeletedPlugin does not re-inject its
        // {deleted: {$ne: true}} exclusion and hide the tombstones a re-fetching client needs.
        ...composeSyncReadFilter({
          queryFilter: queryFilterResult.filter,
          scopeFilter: {_id: {$in: castIds}},
        }),
        deleted: {$in: [true, false]},
      });

      const entities: SyncEntityPayload[] = [];
      for (const doc of docs as mongoose.Document[]) {
        const allowed = adminScope
          ? await checkPermissions("read", adminScope.readPermissions, user, doc)
          : await checkPermissions("read", entry.options.permissions.read, user, doc);
        if (!allowed) {
          continue;
        }
        const docObj = doc.toObject() as Record<string, unknown>;
        const stream = resolveStreamForDoc({
          collectionTag: entry.collectionTag,
          doc: docObj,
          scope: entry.config.scope,
        });
        if (!isAdminWindow && !memberSet.has(stream)) {
          continue;
        }
        const isTombstone = Boolean(docObj.deleted);
        entities.push({
          data: isTombstone ? null : await serializeSyncDoc({doc, entry, req}),
          deleted: isTombstone,
          id: String(doc._id),
          seq: (docObj._syncSeq as number | undefined) ?? 0,
        });
      }

      const response: SyncEntitiesResponse = {entities};
      return res.json(response);
    })
  );

  router.post(
    "/sync/mutate",
    authenticateMiddleware(),
    asyncHandler(async (req, res) => {
      const user = req.user as User | undefined;
      if (!user) {
        throw new APIError({status: 401, title: "Authentication required"});
      }
      // Task 9.20: rate limiting + apply live in the shared runner, so this route and
      // `sync:mutate` behave identically under the same inputs.
      const {outcome} = await runSyncMutation({
        mutation: req.body as SyncMutateRequest,
        req,
        scopeResolver: options.getUserScopes,
        syncOptions: options,
        user,
      });
      if (outcome.type === "ack") {
        return res.json({ack: outcome.ack});
      }
      // Duplicate deliveries reading a recorded outcome map to the same statuses.
      return res.status(NACK_HTTP_STATUS[outcome.nack.code]).json({nack: outcome.nack});
    })
  );

  router.post(
    "/sync/mutate/batch",
    authenticateMiddleware(),
    asyncHandler(async (req, res) => {
      const user = req.user as User | undefined;
      if (!user) {
        throw new APIError({status: 401, title: "Authentication required"});
      }
      const body = req.body as SyncMutateBatchRequest | undefined;
      const mutations = Array.isArray(body?.mutations) ? body.mutations : [];

      // Task 9.20: validate -> rate limit -> apply, shared with `sync:mutateBatch`. An
      // invalid batch (oversized, duplicate ids) is rejected before any budget is charged.
      const {response, stage} = await runSyncBatch({
        mutations,
        req,
        scopeResolver: options.getUserScopes,
        syncOptions: options,
        user,
      });
      if (stage === "validation") {
        return res.status(422).json(response);
      }
      if (stage === "rate_limited") {
        return res.status(NACK_HTTP_STATUS.rate_limited).json(response);
      }
      return res.json(response);
    })
  );

  router.get(
    "/sync/key",
    authenticateMiddleware(),
    asyncHandler(async (req, res) => {
      const user = req.user as User | undefined;
      if (!user) {
        throw new APIError({status: 401, title: "Authentication required"});
      }
      const keyMaterial = await getOrCreateSyncKeyMaterial({userId: String(user.id)});
      return res.json({keyMaterial});
    })
  );

  // Authenticate middleware rejects with Error("Unauthorized"); convert that to
  // 401 before the generic error handler (and before Express's default 500).
  router.use(apiUnauthorizedMiddleware);
  router.use(apiErrorMiddleware);
  app.use(router);
};
