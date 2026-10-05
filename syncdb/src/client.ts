import {DateTime} from "luxon";
import type {AnyPersister} from "tinybase/persisters";

import {createServerKeyProvider, DEFAULT_KEY_CACHE_DB_NAME} from "./crypto/keyProviders";
import type {KeyProvider} from "./crypto/types";
import {attachDebugChannel, type DebugChannelBridge} from "./debug/debugChannel";
import {resolveDebugLog, type SyncDebugLog, type SyncDebugLogOptions} from "./debug/debugLog";
import {registerSyncDbDevtools} from "./debug/devtools";
import {getConflict, listConflicts, pruneGhostConflicts} from "./mutations/conflicts";
import {createOutbox, generateMutationId, type Outbox} from "./mutations/outbox";
import {resolveConflict as applyConflictResolution} from "./mutations/resolveConflict";
import {createDefaultPersisterFactory} from "./persisters/defaultPersisterFactory";
import type {DefaultPersisterFactoryConfig, PersisterFactory} from "./persisters/types";
import {createQueryWindows, type QueryWindows} from "./query/queryWindows";
import {SYNC_SCHEMA_VERSION} from "./storage/schema";
import {createSyncStore, type SyncStore} from "./storage/store";
import {CURSORS_TABLE, KNOWN_STREAMS_TABLE} from "./storage/types";
import {wipeLocalData} from "./storage/wipe";
import {bootstrapStream} from "./sync/bootstrap";
import {getAllCursors} from "./sync/cursor";
import {applyDelta} from "./sync/deltaApplier";
import {repairMarkedEntities} from "./sync/entityRepair";
import {AuthRequiredError, createHttpChannel, type HttpChannel} from "./sync/httpChannel";
import {createReplayCoordinator, type ReplayCoordinator} from "./sync/replayCoordinator";
import {createSocketTransport} from "./sync/socketTransport";
import type {SendMutationBatchResult, SendMutationResult, SyncTransport} from "./sync/transport";
import {type HydrateWindowEntitiesResult, hydrateWindowEntities} from "./sync/windowHydrate";
import type {
  AuthProvider,
  ConflictResolutionStrategy,
  SyncCollectionStatus,
  SyncConflict,
  SyncDelta,
  SyncMutateBatchRequest,
  SyncMutateRequest,
  SyncMutationOperation,
  SyncStatus,
} from "./types";

/** Periodic reconcile interval when not configured (5 minutes). */
export const DEFAULT_RECONCILE_INTERVAL_MS = 5 * 60_000;

/** Minimum interval between seq-jump-triggered reconciles per stream (30s). */
export const DEFAULT_SEQ_JUMP_RECONCILE_MIN_INTERVAL_MS = 30_000;

/** E5: default local tombstone retention window (90 days), matching the server's (C7). */
export const DEFAULT_TOMBSTONE_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;

/**
 * `start()` auth-resolution retry defaults. A host app only calls `start()` once it
 * already believes the user is authenticated (e.g. right after its own login flow
 * resolved), so a `null` from `authProvider.getUserId()` on the first attempt is far
 * more likely a transient hiccup — the session cookie/token not yet queryable, or a
 * one-off fetch failure racing a just-completed navigation — than a genuine
 * logged-out state. Retrying briefly avoids `start()` giving up permanently on a call
 * site that (by design, see the client.ts start() doc) never retries itself.
 */
export const DEFAULT_START_AUTH_RETRY_ATTEMPTS = 3;
export const DEFAULT_START_AUTH_RETRY_DELAY_MS = 250;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface SyncDbConfig {
  /** App/store name; used as the persisted database name. */
  name: string;
  /** Collections to sync (become local entity tables and subscriptions). */
  collections: string[];
  authProvider: AuthProvider;
  /** Server origin; required unless both transport and httpChannel are injected. */
  baseUrl?: string;
  /** Transport override (tests inject a fake; default is the socket transport). */
  transport?: SyncTransport;
  /**
   * Optional selected organization id for `X-Organization-Id` on HTTP sync
   * calls and the `organizationId` field on socket mutate payloads. Read at
   * send time so admin org switches apply without reconnecting.
   */
  organizationIdProvider?: () => string | undefined;
  /** HTTP channel override (default is built from baseUrl when present). */
  httpChannel?: HttpChannel;
  /** Persister factory override (default is the platform default factory). */
  persisterFactory?: PersisterFactory;
  /** Encryption key provider forwarded to the default persister factory (web). */
  keyProvider?: KeyProvider;
  /**
   * Test-only IndexedDB read/write overrides forwarded to the default web
   * persister factory (e.g. to simulate a read error or a quota-exceeded
   * write in tests without a real broken IndexedDB). Ignored on native and
   * ignored entirely when `persisterFactory` is overridden.
   */
  idbGetImpl?: DefaultPersisterFactoryConfig["idbGetImpl"];
  idbSetImpl?: DefaultPersisterFactoryConfig["idbSetImpl"];
  /** Periodic reconcile interval in ms; 0 disables (default 5 minutes). */
  reconcileIntervalMs?: number;
  /**
   * Collections that subscribe in admin window mode: join `{collection}|admin`,
   * skip `GET /sync/snapshot` paging (startup, catch-up, and the reconcile timer).
   * Hydrate rows via REST membership + `/sync/entities` instead.
   */
  windowCollections?: string[];
  /**
   * Collections too large to sync whole: no snapshot bootstrap or reconcile paging.
   * Rows arrive through server query windows (`client.queryWindows`,
   * `useWindowQuery`) against the collection's `modelRouter` list endpoint, plus
   * live deltas on the user's normal streams. Every window shares one entity row per
   * id. Each entry must also appear in `collections`. `path` defaults to `/{collection}`.
   * `fullSync: true` keeps normal snapshot sync and only enables windows (server
   * filtering, paging, and totals over a collection that is also synced whole).
   */
  queryCollections?: Array<string | {collection: string; path?: string; fullSync?: boolean}>;
  /** Rate limit for seq-jump-triggered reconciles per stream (default 30s). */
  seqJumpReconcileMinIntervalMs?: number;
  /** Millisecond clock, injectable for deterministic rate-limit tests. */
  now?: () => number;
  /** Random source in [0, 1), injectable for deterministic backoff-jitter tests. */
  random?: () => number;
  /**
   * Enable the in-memory debug event log (patches, mutations, acks/nacks,
   * conflicts, reconcile/replay, connectivity). `true` uses defaults; pass
   * options to size the buffer. Off by default — zero overhead when disabled.
   * Powers the sync debugger UI and the future MCP introspection surface.
   */
  debug?: boolean | SyncDebugLogOptions;
  /**
   * Fired at most once per auth-pause episode when the client enters
   * `paused: "auth"` (INV-2), so the host app can show a re-login prompt.
   * Clears and can fire again after a subsequent pause episode.
   */
  onAuthRequired?: () => void;
  /**
   * When true, `client.signOut()` wipes local data for the current user (in
   * addition to clearing auth state). Local data is otherwise NEVER wiped on
   * logout or 401 (INV-2) — only on a confirmed different-user login, or via
   * this explicit, host-app-initiated opt-in.
   */
  wipeOnSignOut?: boolean;
  /** Max mutations per batched drain send (B3, default 50; server caps at 100). */
  batchSize?: number;
  /**
   * B4: when true, a conflict halts the ENTIRE drain instead of just blocking
   * its entity. Default false (per-entity blocking — see README "Conflict
   * handling modes").
   */
  haltQueueOnConflict?: boolean;
  /**
   * E3(b): invoked when persisted local data cannot be decrypted (web only —
   * corrupt data, or a rotated/lost encryption key). DEFAULT BEHAVIOR when
   * omitted: wipe all local data for the current user, re-stamp the schema
   * version, and run a full snapshot re-bootstrap — always preceded by a
   * `console.warn`. Pass this to override that default (e.g. to prompt the
   * user before wiping); when provided, the client's own wipe/re-bootstrap is
   * skipped and the host app is fully responsible for recovery.
   */
  onDecryptFailure?: () => void;
  /**
   * E5: client-side compaction — local tombstone rows (`deleted: true`) older
   * than this window (from their `deletedAt` stamp) are deleted after each
   * successful reconcile. Default 90 days, matching the server's own
   * tombstone retention (C7); keep the two in sync — compacting locally
   * before the server's retention window elapses risks a client permanently
   * missing a delete it hasn't converged on yet. 0 disables compaction.
   */
  tombstoneRetentionMs?: number;
  /**
   * Number of `authProvider.getUserId()` attempts `start()` makes before giving up
   * with "requires an authenticated user" (default {@link DEFAULT_START_AUTH_RETRY_ATTEMPTS}).
   * A host app calls `start()` only once it believes the user is signed in, so an
   * initial `null` is usually a transient auth-provider hiccup (e.g. a session fetch
   * racing a just-completed login) rather than a real logged-out state — retrying
   * a few times avoids `start()` permanently failing on that race. Set to 1 to
   * disable retrying.
   */
  startAuthRetryAttempts?: number;
  /** Delay between `start()` auth-resolution retries (default {@link DEFAULT_START_AUTH_RETRY_DELAY_MS}). */
  startAuthRetryDelayMs?: number;
}

/**
 * Why a {@link SyncDb.forceResync} call could not run (or could not finish).
 *
 * `"superseded"` means a `stop()`/`start()` cycle or a different-user login took over
 * mid-flight, so the resync abandoned its work rather than writing into a store that
 * now belongs to another lifecycle or user — distinct from `"noStreams"` (the server
 * reported no streams for this user, and there was no local set to fall back on),
 * which is a stable outcome that retrying will reproduce.
 */
export type ForceResyncSkipReason =
  | "noHttpChannel"
  | "offline"
  | "authPaused"
  | "noStreams"
  | "superseded";

/** Outcome of a {@link SyncDb.forceResync} call. */
export interface ForceResyncResult {
  /** False when the resync could not run at all; `reason` explains why. */
  ok: boolean;
  reason?: ForceResyncSkipReason;
  /** Streams purged and re-bootstrapped. */
  streams: number;
  /** Local entity rows deleted before re-bootstrapping. */
  purged: number;
  /** Entities re-fetched by the point-lookup repair pass. */
  repaired: number;
}

export interface MutateArgs {
  collection: string;
  operation: SyncMutationOperation;
  /** Target entity id; required for update/delete, generated for create. */
  id?: string;
  /** Fields to write (create/update). */
  data?: Record<string, unknown>;
  /**
   * Optional error-nack retry budget. `1` fails after a single error nack.
   * Omitted uses the engine default (`MAX_ERROR_NACK_ATTEMPTS`).
   */
  maxAttempts?: number;
}

export interface SyncDb {
  /** Local-first entity store (the UI's source of truth). */
  readonly store: SyncStore;
  /** Durable mutation outbox. */
  readonly outbox: Outbox;
  /**
   * Resolve the user, run the wipe-on-user-change check, start persistence,
   * connect the transport, subscribe collections, and start the periodic
   * reconcile timer. Resolves even when the transport cannot connect
   * (local-first: the app works offline and syncs when connectivity returns).
   */
  start: () => Promise<void>;
  /** Disconnect, stop persistence, clear timers, and remove listeners. */
  stop: () => Promise<void>;
  /**
   * Simulate a network outage: disconnect the transport and pause replay,
   * reconcile, and the periodic timer. Unlike stop(), the resolved user and
   * persistence stay alive, so mutations keep applying locally and queueing
   * in the durable outbox. `getSyncStatus().isOnline` reports false until
   * goOnline() (or a stop()/start() cycle) restores connectivity.
   */
  goOffline: () => void;
  /**
   * End a simulated outage: reconnect the transport, resubscribe, and restart
   * the periodic timer. The reconnect status event triggers a reconcile and
   * replays the queued outbox.
   */
  goOnline: () => Promise<void>;
  /**
   * Apply a mutation optimistically to the local store, enqueue it in the
   * outbox, and kick off a fire-and-forget replay. Returns the generated
   * mutation id and the entity id (generated for creates).
   */
  mutate: (args: MutateArgs) => {mutationId: string; id: string};
  /** Snapshot-from-cursor catch-up for every collection (no-op without HTTP). */
  reconcile: () => Promise<void>;
  /**
   * Upsert a window of known ids (admin membership). Missing rows are fetched
   * from `GET /sync/entities`; ids the server does not return are ignored.
   */
  hydrateWindow: (args: {
    collection: string;
    ids: string[];
    restRows?: Record<string, unknown>;
  }) => Promise<HydrateWindowEntitiesResult>;
  /**
   * Server-filtered query windows for `queryCollections`: per-query membership over
   * the shared entity table. Prefer the `useWindowQuery` hook in React.
   */
  readonly queryWindows: QueryWindows;
  /**
   * Purge every known stream locally and re-bootstrap from cursor 0. Use when
   * devices have diverged and a full server snapshot is needed without wiping
   * the outbox or conflicts. Reports what it did (or why it could not run) so a
   * caller can surface the outcome instead of a silent no-op.
   */
  forceResync: () => Promise<ForceResyncResult>;
  /** Drain queued mutations for the current user now. */
  replayOutbox: () => Promise<void>;
  /** Resolve a recorded conflict with the given strategy. */
  resolveConflict: (args: {mutationId: string; strategy: ConflictResolutionStrategy}) => void;
  /**
   * B4: re-enable an entity's queued successors after a terminal validation
   * failure blocked them. Does not touch unresolved conflicts (those clear
   * via `resolveConflict`); kicks off a replay so the re-enabled mutations
   * drain immediately rather than waiting for the next trigger.
   */
  retryFailed: (args: {entityId: string}) => void;
  /**
   * Explicit, host-app-initiated sign-out. Tears the client down like `stop()`
   * (transport disconnected, listeners and timers cleared, persister flushed and
   * destroyed) and clears the in-memory current-user pointer; wipes local data
   * ONLY when `wipeOnSignOut` is configured (INV-2 — a bare 401/logout event
   * never triggers this on its own). Safe to call whether or not the client is
   * currently paused, and safe to race against `start()`/`stop()`/an auth
   * change. Call `start()` again to sync as the next signed-in user.
   */
  signOut: () => Promise<void>;
  /** Aggregate sync state for status UI. */
  getSyncStatus: () => SyncStatus;
  /**
   * Subscribe to non-store status inputs (connectivity, syncing activity).
   * `getSyncStatus()` is a snapshot; store-backed inputs (outbox, conflicts,
   * cursors) already emit through TinyBase listeners on `store.raw`, but
   * `isOnline`/`isSyncing` live outside the store — this hook covers them.
   * Returns an unsubscribe function.
   */
  onStatusChange: (callback: () => void) => () => void;
  /**
   * In-memory debug event log when `config.debug` is enabled; otherwise
   * undefined. Its `snapshot()` is a plain serializable object suitable for
   * returning directly over MCP.
   */
  readonly debug?: SyncDebugLog;
}

/**
 * Assemble the full local-first client: store + outbox + persister + transport
 * + HTTP channel + replay coordinator + reconcile heuristics.
 *
 * Reconcile triggers: transport (re)connect, rate-limited seq-jump hints from
 * deltas, and a periodic timer. Replay triggers: (re)connect, auth changes,
 * and every `mutate()`.
 */
export const createSyncDb = (config: SyncDbConfig): SyncDb => {
  if (!config.transport && !config.baseUrl) {
    throw new Error("createSyncDb requires a transport or a baseUrl");
  }

  const now = config.now ?? ((): number => Date.now());
  const transport =
    config.transport ??
    createSocketTransport({
      authProvider: config.authProvider,
      // biome-ignore lint/style/noNonNullAssertion: guarded above — no transport implies baseUrl.
      baseUrl: config.baseUrl!,
      organizationIdProvider: config.organizationIdProvider,
    });
  const httpChannel =
    config.httpChannel ??
    (config.baseUrl
      ? createHttpChannel({
          authProvider: config.authProvider,
          baseUrl: config.baseUrl,
          organizationIdProvider: config.organizationIdProvider,
        })
      : undefined);

  const store = createSyncStore({
    collections: config.collections,
    now: () => DateTime.fromMillis(now()).toISO() ?? new Date(now()).toISOString(),
  });
  const windowCollectionSet = new Set(config.windowCollections ?? []);
  const isWindowCollection = (collection: string): boolean => windowCollectionSet.has(collection);
  const queryCollectionPaths = new Map<string, string>();
  const windowOnlyCollections = new Set<string>();
  for (const entry of config.queryCollections ?? []) {
    const collection = typeof entry === "string" ? entry : entry.collection;
    const path = typeof entry === "string" ? undefined : entry.path;
    if (!config.collections.includes(collection)) {
      throw new Error(`queryCollections entry "${collection}" must also be listed in collections`);
    }
    if (windowCollectionSet.has(collection)) {
      throw new Error(`"${collection}" cannot be both a windowCollection and a queryCollection`);
    }
    queryCollectionPaths.set(collection, path ?? `/${collection}`);
    if (typeof entry === "string" || !entry.fullSync) {
      windowOnlyCollections.add(collection);
    }
  }
  /** Query collections that skip snapshot sync (rows come only from windows and deltas). */
  const isQueryCollection = (collection: string): boolean => windowOnlyCollections.has(collection);
  const skipSnapshotPaging = ({
    collection,
    stream,
    mode,
  }: {
    collection: string;
    stream: string;
    mode?: "window";
  }): boolean =>
    isWindowCollection(collection) ||
    isQueryCollection(collection) ||
    mode === "window" ||
    stream.endsWith("|admin");
  const subscribeConfiguredCollections = (): void => {
    const windowed = config.collections.filter((collection) => isWindowCollection(collection));
    const full = config.collections.filter((collection) => !isWindowCollection(collection));
    if (full.length > 0) {
      transport.subscribe(full);
    }
    if (windowed.length > 0) {
      transport.subscribe(windowed, {mode: "window"});
    }
  };
  const outbox = createOutbox({store});
  const debugLog = resolveDebugLog(config.debug);
  // Mirror the debug log across browser windows/tabs (web only) so a debugger
  // opened in a second window sees this window's events — including local
  // mutations. No-ops when BroadcastChannel is unavailable (native/SSR). The
  // bridge is retained so stop()/signOut() can close the underlying
  // BroadcastChannel (and drop its log subscription) instead of leaking one per
  // client; start() re-attaches it.
  let debugChannel: DebugChannelBridge | undefined;
  const attachDebugBridge = (): void => {
    if (!debugLog || debugChannel) {
      return;
    }
    debugChannel = attachDebugChannel({log: debugLog, name: config.name});
  };
  const closeDebugBridge = (): void => {
    debugChannel?.close();
    debugChannel = undefined;
  };
  attachDebugBridge();

  let currentUserId: string | undefined;
  let persister: ReturnType<PersisterFactory> | undefined;
  const pendingDurableConflicts = new Map<string, string>();
  let connected = false;
  let simulatedOffline = false;
  let syncingCount = 0;
  let reconcileTimer: ReturnType<typeof setInterval> | undefined;
  let unsubscribers: (() => void)[] = [];
  /** The reconcile pass every concurrent trigger shares; see `reconcile()`. */
  let inFlightReconcile:
    | {generation: number; promise: Promise<void>; userId: string | undefined}
    | undefined;
  const lastSeqJumpReconcileAt = new Map<string, number>();
  const statusListeners = new Set<() => void>();
  // A4: auth-pause state. `authPaused` gates reconcile/replay/timer triggers
  // (INV-2 — nothing else may unpause except a same-user auth change).
  // `refreshAttempted` tracks whether the auth adapter's one-shot silent
  // refresh has already run for the CURRENT pause episode.
  let authPaused = false;
  let refreshAttempted = false;
  // E1: lifecycle serialization. `generation` bumps on every start()/stop() so
  // an in-flight operation that resumes after an await can detect it has been
  // superseded (a rapid stop()-then-start() for a new user) and abort instead
  // of mutating state (persister, currentUserId, listeners) that a LATER
  // operation already owns. `lifecycle` is a promise-chain mutex: every call
  // to start()/stop()/handleAuthChange()/runUserCheck() (the latter only ever
  // invoked FROM start()/handleAuthChange(), never directly) is appended to it
  // so at most one of these runs at a time, in call order — this is what
  // prevents the interleaving the mutex exists to fix, not the generation
  // check alone (the generation check only guards against a stale resume
  // AFTER an await; the chain prevents two lifecycle ops from running
  // concurrently in the first place).
  let generation = 0;
  let lifecycle: Promise<void> = Promise.resolve();
  // The socket authenticates per connection (the handshake token is read inside
  // the transport's auth callback), so a confirmed identity change must bounce
  // the transport — otherwise the previous user's live socket keeps pushing that
  // user's deltas into the new user's freshly wiped store and the new user's
  // mutations go out under the old identity. `connectionEpoch` bumps on every
  // bounce; the delta handler captures the epoch it was bound under and ignores
  // anything delivered once a bounce has superseded it, so a delta the old
  // connection flushes mid-bounce can never be applied.
  let connectionEpoch = 0;
  let unbindDeltaHandler: (() => void) | undefined;
  /** True once a start() has completed without a matching stop() (E1 double-start guard). */
  let isStarted = false;

  /**
   * Queue `op` onto the lifecycle mutex; resolves/rejects with `op`'s own
   * outcome once every previously-queued op has settled. `lifecycle` itself
   * NEVER rejects (see below), so chaining with a plain `.then` is safe — a
   * prior op's failure never wedges the mutex or blocks later queued calls.
   */
  const withLifecycle = <T>(op: () => Promise<T>): Promise<T> => {
    const result = lifecycle.then(op);
    // Keep the chain alive regardless of this op's outcome; `result` itself
    // (returned below) carries the outcome to THIS call's caller.
    lifecycle = result.then(
      () => {},
      () => {}
    );
    return result;
  };

  const waitForLifecycleIdle = async (): Promise<void> => {
    let pending = lifecycle;
    await pending;
    while (pending !== lifecycle) {
      pending = lifecycle;
      await pending;
    }
  };

  const notifyStatusChange = (): void => {
    for (const listener of statusListeners) {
      listener();
    }
  };

  const clearPendingDurableConflicts = (): void => {
    if (pendingDurableConflicts.size === 0) {
      return;
    }
    pendingDurableConflicts.clear();
    notifyStatusChange();
  };

  const setConnected = (value: boolean): void => {
    if (connected === value) {
      return;
    }
    connected = value;
    debugLog?.record({
      direction: "system",
      label: value ? "transport connected" : "transport disconnected",
      type: value ? "connect" : "disconnect",
    });
    notifyStatusChange();
  };

  const addSyncing = (delta: number): void => {
    const wasSyncing = syncingCount > 0;
    syncingCount += delta;
    if (wasSyncing !== syncingCount > 0) {
      notifyStatusChange();
    }
  };

  // Prefer the socket for mutations; fall back to HTTP while disconnected.
  const sendMutation = async (request: SyncMutateRequest): Promise<SendMutationResult> => {
    if (connected || !httpChannel) {
      return transport.sendMutation(request);
    }
    return httpChannel.sendMutation(request);
  };

  // B3: batched sends mirror the same socket-preferred/HTTP-fallback selection.
  // Omitted entirely when neither channel supports batching, so the
  // coordinator falls back to sendMutation for every send.
  const sendMutationBatch =
    transport.sendMutationBatch || httpChannel?.sendMutationBatch
      ? async (request: SyncMutateBatchRequest): Promise<SendMutationBatchResult> => {
          if ((connected || !httpChannel) && transport.sendMutationBatch) {
            return transport.sendMutationBatch(request);
          }
          if (httpChannel?.sendMutationBatch) {
            return httpChannel.sendMutationBatch(request);
          }
          return {type: "unsupported"};
        }
      : undefined;

  const setAuthPaused = (value: boolean): void => {
    if (authPaused === value) {
      return;
    }
    authPaused = value;
    refreshAttempted = false;
    if (value) {
      config.onAuthRequired?.();
      // A4 step 5: every pause episode gets exactly one silent refresh attempt,
      // wherever the auth failure was observed — a drain nack, a reconcile 401,
      // or the server's session sweep (`sync:auth-expired`). Wiring it here
      // (rather than per call site) is what makes that uniform; the early return
      // above plus `refreshAttempted` keep it to one attempt per episode.
      void attemptAuthRecovery();
    }
    notifyStatusChange();
  };

  const warn = (message: string): ((error: unknown) => void) => {
    return (error: unknown): void => {
      console.warn(`[syncdb] ${message}`, error);
    };
  };

  const queryWindows = createQueryWindows({
    getChannel: () => httpChannel,
    getEpoch: () => `${generation}:${currentUserId ?? ""}`,
    getListPath: (collection: string): string => {
      const path = queryCollectionPaths.get(collection);
      if (!path) {
        throw new Error(`"${collection}" is not configured in queryCollections`);
      }
      return path;
    },
    now: () => DateTime.fromMillis(now()).toISO() ?? new Date(now()).toISOString(),
    onError: warn("query window fetch failed"),
    store,
  });

  const coordinator: ReplayCoordinator = createReplayCoordinator({
    batchSize: config.batchSize,
    debug: debugLog,
    haltQueueOnConflict: config.haltQueueOnConflict,
    now,
    // Report the pause from the coordinator hook (not a replayOutbox()
    // return-value check): drain-until-empty's internal recheck/wake-timer
    // continuations can be the call that actually observes the auth failure,
    // orphaned from whichever replayOutbox() wrapper kicked off the original
    // drain. The silent-refresh attempt is triggered by setAuthPaused itself.
    onAuthPause: () => {
      setAuthPaused(true);
    },
    onDrainPass: ({userId}) => {
      outbox.prune({userId});
    },
    onEntityReleasedWithoutServerAck: (mutation) => {
      if (!httpChannel) {
        return;
      }
      void repairMarkedEntities({
        channel: httpChannel,
        collection: mutation.collection,
        entityIds: [mutation.entityId],
        store,
      }).catch(warn("entity repair failed"));
    },
    onProgress: () => {
      // B5: drain progress (sentThisDrain/totalThisDrain) is exposed through
      // getSyncStatus() — nudge status listeners so a progress UI re-renders
      // as each chunk/mutation resolves, not just at the start/end of replay.
      notifyStatusChange();
    },
    outbox,
    random: config.random,
    sendMutation,
    sendMutationBatch,
    // Internally-scheduled drains (armed wake-up timers, the mid-drain-enqueue
    // recheck) must respect the same gating as an external replayOutbox()
    // call: never send while simulated-offline or auth-paused.
    shouldDrain: () => !simulatedOffline && !authPaused,
    store,
  });

  /**
   * C2: discover the streams the user currently belongs to (`GET /sync/streams`), then
   * diff against the persisted `_knownStreams` set to detect joins and leaves.
   *
   * INV-2 (the whole ballgame): the leave-purge only runs when `fetchStreams` returned
   * HTTP 200. A 401 (AuthRequiredError) or any transport error is NOT a membership
   * change — it enters auth-pause (401) or is rethrown (transport) with every local
   * entity, cursor, and known-stream entry left intact. Joins backfill from cursor 0;
   * leaves purge that stream's local entities + cursor + known-stream entry.
   *
   * Returns the current membership set (stream → collection) on success so the caller
   * can bootstrap each; returns `undefined` when auth-paused (no membership known).
   */
  const syncStreams = async ({
    isSuperseded,
  }: {
    /**
     * Optional lifecycle guard checked AFTER the network fetch resolves but BEFORE any
     * store mutation. A fired-and-forgotten reconcile's `fetchStreams()` await can straddle
     * a stop()/start() or different-user wipe; without this, the post-await store reads and
     * purges/joins below run against the swapped-in store and can resurrect wiped rows via
     * TinyBase's mergeable-schema re-materialization. Returns undefined when superseded.
     */
    isSuperseded?: () => boolean;
  } = {}): Promise<Map<string, string> | undefined> => {
    if (!httpChannel) {
      // No HTTP channel: fall back to the configured collections' streams are unknown;
      // bootstrap cannot run. Callers treat undefined as "skip stream sync".
      return undefined;
    }
    let serverStreams: {stream: string; collection: string}[];
    try {
      serverStreams = await httpChannel.fetchStreams();
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        // INV-2: a 401 is NOT a leave. Pause; leave every stream/entity intact.
        setAuthPaused(true);
        return undefined;
      }
      // Transport error: also not a membership change — leave data intact, rethrow so
      // the caller's catch handles retry/backoff.
      throw error;
    }
    if (isSuperseded?.()) {
      // A newer lifecycle/user took over during the fetch — do not touch the store.
      return undefined;
    }

    // A backend can host more collections than this client is configured to sync
    // (e.g. a tenant-scoped `projects` stream exposed to org members while this
    // app only subscribes to `todos`). The socket path already filters deltas by
    // `config.collections` via `transport.subscribe`; mirror that here so the
    // discovery/bootstrap path never tries to write an unconfigured collection
    // into the store (which would throw "Unknown collection" in the store's
    // schema guard). Streams for unknown collections are simply ignored.
    const configuredCollections = new Set(store.collections);
    const serverSet = new Map<string, string>();
    for (const {stream, collection} of serverStreams) {
      if (!configuredCollections.has(collection)) {
        debugLog?.record({
          detail: {collection, stream},
          direction: "system",
          label: `stream skipped (unconfigured collection): ${stream}`,
          type: "reconcile",
        });
        continue;
      }
      serverSet.set(stream, collection);
    }
    const known = new Set(store.getKnownStreams());

    // Leaves: known locally but absent from the (HTTP-200) server set → purge.
    for (const stream of known) {
      if (!serverSet.has(stream)) {
        const purged = store.purgeStream({stream});
        debugLog?.record({
          detail: {purged, stream},
          direction: "system",
          label: `stream leave: purged ${stream} (${purged} entities)`,
          type: "reconcile",
        });
      }
    }
    // Joins: in the server set but not yet known → mark known (cursor 0 bootstrap follows).
    for (const [stream, collection] of serverSet) {
      if (!known.has(stream)) {
        store.addKnownStream({collection, stream});
        debugLog?.record({
          detail: {collection, stream},
          direction: "system",
          label: `stream join: ${stream}`,
          type: "reconcile",
        });
      }
    }
    return serverSet;
  };

  const runReconcile = async (): Promise<void> => {
    // Simulated offline severs all network activity, including the HTTP
    // channel; an auth pause stands down every network trigger (INV-2) until
    // the same user re-authenticates.
    if (!httpChannel || simulatedOffline || authPaused) {
      return;
    }
    // E1 + C2: reconcile is fired-and-forgotten (startup, reconnect, periodic,
    // post-auth) and its network awaits below can straddle a stop()/start() (bumps
    // `generation`) or a different-user switch (changes `currentUserId` + swaps the
    // persister, via runUserCheck). Capture both at entry and re-check after every await
    // so a stale reconcile never writes discovered streams or snapshot pages into a store
    // that now belongs to a different lifecycle or user — the resurrection bug where an
    // in-flight reconcile for the previous user re-materialized purged rows after a wipe.
    const myGeneration = generation;
    const myUserId = currentUserId;
    const isSuperseded = (): boolean => generation !== myGeneration || currentUserId !== myUserId;
    addSyncing(1);
    const startedAt = now();
    debugLog?.record({
      direction: "system",
      label: "reconcile start",
      phase: "start",
      type: "reconcile",
    });
    try {
      const streams = await syncStreams({isSuperseded});
      if (!streams || isSuperseded()) {
        // Auth-paused during discovery (401 → INV-2), or superseded by a newer
        // lifecycle/user while awaiting discovery.
        return;
      }
      for (const [stream, collection] of streams) {
        if (skipSnapshotPaging({collection, stream})) {
          continue;
        }
        await bootstrapStream({channel: httpChannel, collection, store, stream});
        if (isSuperseded()) {
          return;
        }
      }
      // E5: client-side compaction runs only after a successful per-stream reconcile —
      // reconcile just proved the local store caught up with the server via real network
      // round trips (discovery + each stream), which is the signal that it is safe to age
      // out old tombstones (never on a failed/incomplete reconcile).
      const retentionMs = config.tombstoneRetentionMs ?? DEFAULT_TOMBSTONE_RETENTION_MS;
      if (retentionMs > 0) {
        // No explicit `now` override here — compactTombstones defaults to the same
        // injected clock the store itself was created with above.
        const {removed} = store.compactTombstones({olderThanMs: retentionMs});
        if (removed > 0) {
          debugLog?.record({
            detail: {removed},
            direction: "system",
            label: `compacted ${removed} tombstone(s)`,
            type: "reconcile",
          });
        }
      }
      await repairAllMarkedEntities();
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        setAuthPaused(true);
        return;
      }
      throw error;
    } finally {
      addSyncing(-1);
      debugLog?.record({
        direction: "system",
        durationMs: now() - startedAt,
        label: "reconcile end",
        phase: "end",
        type: "reconcile",
      });
    }
  };

  /**
   * Coalesce concurrent reconcile triggers into one pass, the way the replay
   * coordinator coalesces drains: startup, transport reconnect, the periodic timer, a
   * rate-limited seq-jump hint, and the post-auth resume all fire independently, and
   * each pass is a full stream discovery plus snapshot paging for every stream.
   * Tagged with the lifecycle generation and user it belongs to, so a caller arriving
   * after a stop()/start() or a user switch starts a fresh pass instead of awaiting
   * one that is about to abort as superseded.
   */
  const reconcile = (): Promise<void> => {
    const existing = inFlightReconcile;
    if (existing && existing.generation === generation && existing.userId === currentUserId) {
      // Joining a pass already past its discovery step can miss a stream that
      // appeared moments ago; the next trigger (the periodic timer at the latest)
      // catches it, and every apply is cursor-guarded and idempotent, so sharing a
      // pass only ever costs latency, never convergence.
      return existing.promise;
    }
    const promise = runReconcile().finally(() => {
      if (inFlightReconcile?.promise === promise) {
        inFlightReconcile = undefined;
      }
    });
    inFlightReconcile = {generation, promise, userId: currentUserId};
    return promise;
  };

  /**
   * Catch up the streams the server just confirmed this socket joined
   * (`sync:subscribed`).
   *
   * Closing the join gap: `start()` (and every reconnect) emits `sync:subscribe` and
   * then immediately kicks off a snapshot reconcile over HTTP. The server, meanwhile,
   * resolves the full user and its scopes before joining the `sync:{stream}` rooms, so
   * the reconcile can finish paging a stream to its head BEFORE the socket is in the
   * room. A write landing in that window is in neither the snapshot (too late) nor a
   * delta (room not joined yet), leaving the client silently stale until the next
   * periodic reconcile — minutes later.
   *
   * The confirmation is the first instant live delivery is guaranteed, so paging each
   * confirmed stream from its cursor here makes snapshot + delta coverage contiguous.
   * It deliberately does NOT go through `reconcile()`: that call coalesces onto a pass
   * which may have started before the join (exactly the pass that could have missed the
   * write). Per-stream paging is idempotent and cursor-guarded, so running it beside an
   * in-flight reconcile is safe.
   */
  const catchUpSubscribedStreams = async ({
    collection,
    mode,
    streams,
  }: {
    collection: string;
    mode?: "window";
    streams: string[];
  }): Promise<void> => {
    if (!httpChannel || simulatedOffline || authPaused || streams.length === 0) {
      return;
    }
    if (!store.collections.includes(collection)) {
      return;
    }
    if (mode === "window" || isWindowCollection(collection)) {
      return;
    }
    const myGeneration = generation;
    const myUserId = currentUserId;
    const isSuperseded = (): boolean => generation !== myGeneration || currentUserId !== myUserId;
    addSyncing(1);
    try {
      for (const stream of streams) {
        if (isSuperseded()) {
          return;
        }
        if (skipSnapshotPaging({collection, mode, stream})) {
          continue;
        }
        store.addKnownStream({collection, stream});
        await bootstrapStream({channel: httpChannel, collection, store, stream});
      }
      debugLog?.record({
        detail: {collection, streams},
        direction: "system",
        label: `subscribe catch-up: ${streams.join(", ")}`,
        type: "reconcile",
      });
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        setAuthPaused(true);
        return;
      }
      throw error;
    } finally {
      addSyncing(-1);
    }
  };

  /**
   * C2 migration: deployed clients hold legacy `snapshot:{collection}` pseudo-cursors.
   * On start, delete all of them and clear `_knownStreams` so the normal discovery path
   * re-bootstraps every stream from cursor 0. Idempotent upserts + seq guards make
   * re-bootstrap cheap and non-destructive (existing entities keep their data). Runs once.
   *
   * NOTE (Phase E merge): Phase E is adding the schema-version wipe machinery in the main
   * worktree. Ideally this migration gates behind that version bump so it runs exactly
   * once. That hook does not exist in this worktree, so this implements the minimal
   * standalone cursor-migration path — it is self-idempotent (after the first run there
   * are no `snapshot:` keys left, so subsequent runs are no-ops). When merging, this can
   * be moved behind the E2 version bump.
   */
  const migrateLegacySnapshotCursors = (): void => {
    const cursorRows = store.raw.getTable(CURSORS_TABLE);
    let migrated = 0;
    for (const key of Object.keys(cursorRows)) {
      if (key.startsWith("snapshot:")) {
        store.raw.delRow(CURSORS_TABLE, key);
        migrated += 1;
      }
    }
    if (migrated > 0) {
      // Clear the known-streams set so discovery re-bootstraps every stream from 0.
      for (const stream of store.getKnownStreams()) {
        store.removeKnownStream({stream});
      }
      debugLog?.record({
        detail: {migrated},
        direction: "system",
        label: `migrated ${migrated} legacy snapshot cursors`,
        type: "reconcile",
      });
    }
  };

  const repairAllMarkedEntities = async (): Promise<number> => {
    if (!httpChannel) {
      return 0;
    }
    const byCollection = new Map<string, string[]>();
    for (const row of store.listNeedsRepair()) {
      const ids = byCollection.get(row.collection) ?? [];
      ids.push(row.entityId);
      byCollection.set(row.collection, ids);
    }
    let repaired = 0;
    for (const [collection, entityIds] of byCollection) {
      repaired += await repairMarkedEntities({channel: httpChannel, collection, entityIds, store});
    }
    return repaired;
  };

  const forceResync = async (): Promise<ForceResyncResult> => {
    const skip = (reason: ForceResyncSkipReason): ForceResyncResult => {
      debugLog?.record({
        detail: {reason},
        direction: "system",
        label: `force resync skipped (${reason})`,
        type: "reconcile",
      });
      return {ok: false, purged: 0, reason, repaired: 0, streams: 0};
    };
    if (!httpChannel) {
      return skip("noHttpChannel");
    }
    if (simulatedOffline) {
      return skip("offline");
    }
    if (authPaused) {
      return skip("authPaused");
    }
    const myGeneration = generation;
    const myUserId = currentUserId;
    const isSuperseded = (): boolean => generation !== myGeneration || currentUserId !== myUserId;
    addSyncing(1);
    const startedAt = now();
    debugLog?.record({
      direction: "system",
      label: "force resync start",
      phase: "start",
      type: "reconcile",
    });
    let purged = 0;
    let repaired = 0;
    let streamInfos: Array<{stream: string; collection: string}> = [];
    try {
      // Always re-discover membership: a stale local `_knownStreams` set is one of
      // the ways a device diverges in the first place, so it cannot be trusted as
      // the authoritative list for a repair operation.
      const streams = await syncStreams({isSuperseded});
      await waitForLifecycleIdle();
      if (isSuperseded()) {
        return skip("superseded");
      }
      if (streams) {
        streamInfos = [...streams].map(([stream, collection]) => ({collection, stream}));
      }
      if (streamInfos.length === 0) {
        for (const stream of store.getKnownStreams()) {
          const row = store.raw.getRow(KNOWN_STREAMS_TABLE, stream) as {collection?: string};
          if (row?.collection) {
            streamInfos.push({collection: row.collection, stream});
          }
        }
      }
      if (streamInfos.length === 0) {
        return skip("noStreams");
      }
      // Drop rows with no stream provenance once per collection: phantoms from
      // locally-failed creates carry `stream: ""`, so a per-stream purge alone
      // leaves them behind and re-bootstrap cannot remove them (the server never
      // had them). Rows still protected by a pending mutation are preserved.
      for (const collection of new Set(streamInfos.map((info) => info.collection))) {
        purged += store.purgeUnknownStreamEntities({collection});
      }
      for (const {stream, collection} of streamInfos) {
        if (isQueryCollection(collection)) {
          // Query collections have no snapshot to rebuild from; their retained
          // windows are refetched below instead.
          continue;
        }
        purged += store.purgeStream({stream});
        store.addKnownStream({collection, stream});
        await bootstrapStream({channel: httpChannel, collection, store, stream});
        await waitForLifecycleIdle();
        if (isSuperseded()) {
          return {ok: false, purged, reason: "superseded", repaired, streams: streamInfos.length};
        }
      }
      repaired = await repairAllMarkedEntities();
      await queryWindows.refetchRetained();
      return {ok: true, purged, repaired, streams: streamInfos.length};
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        setAuthPaused(true);
        return {ok: false, purged, reason: "authPaused", repaired, streams: streamInfos.length};
      }
      throw error;
    } finally {
      addSyncing(-1);
      debugLog?.record({
        detail: {purged, repaired, streams: streamInfos.length},
        direction: "system",
        durationMs: now() - startedAt,
        label: `force resync end (${streamInfos.length} streams, ${purged} purged, ${repaired} repaired)`,
        phase: "end",
        type: "reconcile",
      });
    }
  };

  const replayOutbox = async (): Promise<void> => {
    // While simulated-offline or auth-paused, mutations stay queued in the
    // durable outbox (INV-2: an auth pause stands down replay until the same
    // user re-authenticates).
    if (!currentUserId || simulatedOffline || authPaused) {
      return;
    }
    addSyncing(1);
    const startedAt = now();
    // A3: this listQueued scan exists purely to label a debug event — never
    // pay for it when debug logging is disabled (the common case).
    if (debugLog) {
      const queued = outbox.listQueued({userId: currentUserId}).length;
      debugLog.record({
        detail: {queued},
        direction: "system",
        label: `replay start (${queued} queued)`,
        phase: "start",
        type: "replay",
      });
    }
    try {
      // Auth-pause recovery (the one-shot silent refresh) is wired through
      // the coordinator's onAuthPause hook, not this return value — it fires
      // reliably regardless of which internal call (this one, the wake
      // timer, or the mid-drain recheck) is the one that actually observes
      // the auth failure.
      await coordinator.replay({userId: currentUserId});
    } finally {
      addSyncing(-1);
      debugLog?.record({
        direction: "system",
        durationMs: now() - startedAt,
        label: "replay end",
        phase: "end",
        type: "replay",
      });
    }
  };

  /**
   * Give the auth adapter one chance to silently refresh before the pause is
   * fully surfaced to the app (A4 step 5). Runs at most once per pause
   * episode; a successful refresh immediately retries replay.
   */
  const attemptAuthRecovery = async (): Promise<void> => {
    if (refreshAttempted || !config.authProvider.refresh) {
      return;
    }
    if (!currentUserId) {
      // An explicit logout (the auth provider reporting no user) is not an
      // expired session: there is nothing to refresh silently, and a refresh
      // that did succeed could only resolve some OTHER user's session, which the
      // INV-2 check below would reject anyway.
      return;
    }
    refreshAttempted = true;
    try {
      const refreshed = await config.authProvider.refresh();
      if (!refreshed || !authPaused) {
        return;
      }
      // INV-2: a successful refresh does NOT prove the session still belongs to
      // the paused user — another tab may have signed a different user in while
      // this client was paused. Unpausing then would drain the previous user's
      // outbox under the new user's identity. Stay paused and let
      // handleAuthChange's different-user path wipe and bounce instead.
      const refreshedUserId = await config.authProvider.getUserId();
      if (!refreshedUserId || refreshedUserId !== currentUserId) {
        debugLog?.record({
          detail: {currentUserId, refreshedUserId},
          direction: "system",
          label: "auth refresh resolved a different user; staying paused",
          type: "connect",
        });
        return;
      }
      setAuthPaused(false);
      void replayOutbox().catch(warn("post-refresh replay failed"));
    } catch (error) {
      warn("auth refresh attempt failed")(error);
    }
  };

  /**
   * E3(c): the web factory (`persisters/defaultPersisterFactory.web.ts`) falls
   * back to the in-memory persister when `globalThis.indexedDB` is absent
   * (private browsing / a locked-down embedded webview), emitting a one-time
   * console.warn. That fallback is invisible to the caller unless it inspects
   * the returned persister — surface it on the client's status instead so a
   * host app can tell durable persistence apart from a session that silently
   * never survives reload. Defaults to "durable"; a persister factory may
   * report "memory" via `persister.persistenceMode` (see
   * `defaultPersisterFactory.web.ts`), and a load failure (E3a) downgrades to
   * "error" for the remainder of the session.
   */
  let persistenceMode: "durable" | "memory" | "error" = "durable";

  const createAndStartPersister = async (userId: string): Promise<void> => {
    // Reset per-call: a fresh persister/load attempt starts optimistic even
    // if a PRIOR persister instance (e.g. before a wipe-and-rebuild) had
    // flagged a load failure.
    persistenceMode = "durable";
    // Default key provider is SERVER-DERIVED (HKDF over GET /sync/key material) so the
    // server can rotate/revoke; pass keyProvider: createLocalKeyProvider() for a purely
    // device-local key with no server-side copy of the material.
    const keyProvider =
      config.keyProvider ??
      (httpChannel
        ? createServerKeyProvider({
            appName: config.name,
            fetchKeyMaterial: httpChannel.fetchKeyMaterial,
          })
        : undefined);
    // E3(b): decrypt/corrupt-data failures wipe + re-bootstrap by default
    // (documented behavior) unless the host app overrides via
    // `config.onDecryptFailure`. Either way it always warns.
    const onDecryptFailure = (): void => {
      console.warn(
        `[syncdb] persisted data for "${config.name}" could not be decrypted; wiping and re-bootstrapping`
      );
      if (config.onDecryptFailure) {
        config.onDecryptFailure();
        return;
      }
      void wipeAndRebootstrap(userId).catch(warn("post-decrypt-failure wipe/rebootstrap failed"));
    };
    // E3(a): a read ERROR (not "no data") must never be treated as a fresh
    // store — flag it so the caller skips autosave (which would otherwise
    // overwrite the still-good persisted blob with an empty in-memory store).
    const onLoadFailure = (): void => {
      persistenceMode = "error";
      console.warn(
        `[syncdb] failed to read persisted data for "${config.name}"; leaving the stored snapshot untouched this session`
      );
      notifyStatusChange();
    };
    // E3(a): a save (write) failure — e.g. IndexedDB quota exceeded — is
    // surfaced the same way: local writes are no longer reliably durable this
    // session, so the host app should warn the user rather than silently
    // losing data. Unlike a load failure this does NOT skip future save
    // attempts (a transient quota issue may clear once the user frees space).
    const onSaveFailure = (error: unknown): void => {
      persistenceMode = "error";
      console.warn(`[syncdb] failed to persist local data for "${config.name}"`, error);
      notifyStatusChange();
    };
    const factory =
      config.persisterFactory ??
      createDefaultPersisterFactory({
        idbGetImpl: config.idbGetImpl,
        idbSetImpl: config.idbSetImpl,
        keyProvider,
        onDecryptFailure,
        onLoadFailure,
        onSaveFailure,
        userId,
      });
    // `hooks` is always passed (even to a custom persisterFactory) so a host
    // app supplying its own storage backend can still opt into E3 SyncStatus
    // surfacing; the default factory already received the same callbacks
    // above (at creation time) and ignores this second copy.
    persister = factory({
      databaseName: config.name,
      hooks: {onDecryptFailure, onLoadFailure, onSaveFailure},
      store: store.raw,
    });
    await persister.startAutoLoad();
    // Read through a function call: `onLoadFailure` (invoked synchronously
    // from inside `startAutoLoad()`, not after it returns) mutates
    // `persistenceMode` by closure, which TypeScript's control-flow narrowing
    // cannot see across the awaited call above — without this indirection it
    // would (wrongly) treat the "durable" assignment at the top of this
    // function as still in effect here.
    const getPersistenceMode = (): typeof persistenceMode => persistenceMode;
    if (getPersistenceMode() === "error") {
      // Do NOT startAutoSave(): the in-memory store is empty (load bailed out
      // before touching it) and autosaving now would clobber the real blob.
      return;
    }
    // E3(c): the web factory tags its returned persister with a
    // `persistenceMode` marker when it fell back to in-memory (no
    // globalThis.indexedDB) — surface that on SyncStatus.
    const reportedMode = (persister as AnyPersister & {persistenceMode?: "durable" | "memory"})
      .persistenceMode;
    if (reportedMode === "memory") {
      persistenceMode = "memory";
      notifyStatusChange();
    }
    await persister.startAutoSave();
  };

  /**
   * Sanctioned wipe + fresh start for `userId`: clears every local table and
   * the persisted databases (including cached encryption keys — E3f), stamps
   * the current schema version and userId on the now-empty store, rebuilds
   * the persister, and — when an HTTP channel is available — runs a full
   * snapshot re-bootstrap so the app is immediately usable again rather than
   * waiting for the next reconcile trigger. Shared by the E2 schema-mismatch
   * path and the E3(b) decrypt-failure default handler; NOT used for the
   * different-user wipe (that path's re-bootstrap comes from the caller's own
   * subsequent reconcile()/replayOutbox() calls, matching pre-E2 behavior).
   */
  const wipeAndRebootstrap = async (userId: string): Promise<void> => {
    coordinator.reset();
    await wipeLocalData({
      databaseNames: [config.name],
      keyCacheDbNames: [DEFAULT_KEY_CACHE_DB_NAME],
      persister,
      store,
    });
    clearPendingDurableConflicts();
    lastSeqJumpReconcileAt.clear();
    queryWindows.reset();
    persistenceMode = "durable";
    await createAndStartPersister(userId);
    store.raw.setValue("schemaVersion", SYNC_SCHEMA_VERSION);
    store.setLastUserId({userId});
    currentUserId = userId;
    if (httpChannel) {
      // C2: after a wipe the known-streams set is empty, so discover the user's current
      // stream membership and bootstrap each from cursor 0. syncStreams() handles the
      // INV-2 auth-pause case (returns undefined on a 401) — skip bootstrap then.
      const streams = await syncStreams();
      if (streams) {
        for (const [stream, collection] of streams) {
          await bootstrapStream({channel: httpChannel, collection, store, stream});
        }
      }
    }
  };

  /**
   * Wipe-on-user-change: when the persisted `lastUserId` differs from the
   * authenticated user, destroy all local data (entities, outbox, cursors,
   * conflicts, persisted databases) and start fresh for the new user.
   *
   * E2: also checked here (after the persister's autoload has populated the
   * store from disk) is the persisted schema version — a mismatch is a
   * sanctioned wipe (schema migration, not an auth event) distinct from the
   * user-change wipe above, so it runs regardless of whether the user changed.
   *
   * Reports whether the wipe-on-user-change branch ran so the caller can bounce
   * the transport for the new identity (9.4).
   */
  const runUserCheck = async (userId: string): Promise<{userChanged: boolean}> => {
    const lastUserId = store.getLastUserId();
    const userChanged = lastUserId !== undefined && lastUserId !== userId;
    if (userChanged) {
      // FIX 3: a different-user login must not let the PREVIOUS user's
      // in-memory coordinator state (validationBlockedEntities keyed
      // user-scoped, retry/backoff bookkeeping, the batch-capability latch,
      // armed timers) leak into the new user's session — reset before the
      // new user's persister/outbox come online.
      coordinator.reset();
      // E3(f): also clear the cached derived encryption key for the key-cache
      // database — the same rationale as wiping local data: nothing from the
      // previous user's session should linger once a different user has
      // authenticated (the new user's persister derives/caches its own key
      // fresh via createAndStartPersister below).
      await wipeLocalData({
        databaseNames: [config.name],
        keyCacheDbNames: [DEFAULT_KEY_CACHE_DB_NAME],
        persister,
        store,
      });
      clearPendingDurableConflicts();
      lastSeqJumpReconcileAt.clear();
      queryWindows.reset();
      await createAndStartPersister(userId);
    }
    // E2: schema version check. `getSchemaVersion()` reads the persisted
    // value with a same-as-current default (so a genuinely fresh store never
    // trips this), meaning a real mismatch can only come from a persisted
    // store written under an OLDER `SYNC_SCHEMA_VERSION`. Always stamp the
    // current version afterward so a fresh store (and one just wiped above)
    // is never mistaken for stale on the next start().
    const persistedVersion = store.getSchemaVersion();
    if (persistedVersion !== SYNC_SCHEMA_VERSION) {
      await wipeAndRebootstrap(userId);
      return {userChanged};
    }
    store.raw.setValue("schemaVersion", SYNC_SCHEMA_VERSION);
    store.setLastUserId({userId});
    currentUserId = userId;
    return {userChanged};
  };

  const handleDelta = (delta: SyncDelta): void => {
    const {seqJump, applied} = applyDelta({delta, store});
    debugLog?.record({
      collection: delta.collection,
      detail: {applied, data: delta.data, deleted: delta.deleted === true, seqJump},
      direction: "inbound",
      entityId: delta.id,
      label: `delta ${delta.method} ${delta.collection}/${delta.id} @${delta.seq}`,
      operation: delta.method,
      seq: delta.seq,
      stream: delta.stream,
      type: "delta",
    });
    if (!seqJump) {
      return;
    }
    // Seq jumps are hints, not proofs (permission-filtered deltas legitimately
    // skip seqs) — rate-limit the reconcile per stream.
    const minInterval =
      config.seqJumpReconcileMinIntervalMs ?? DEFAULT_SEQ_JUMP_RECONCILE_MIN_INTERVAL_MS;
    const last = lastSeqJumpReconcileAt.get(delta.stream);
    if (last !== undefined && now() - last < minInterval) {
      return;
    }
    lastSeqJumpReconcileAt.set(delta.stream, now());
    void reconcile().catch(warn("seq-jump reconcile failed"));
  };

  /**
   * (Re)bind the delta handler under the CURRENT connection epoch, dropping any
   * previous binding. The bound closure compares its captured epoch against the
   * live one, so a delta delivered through a transport whose listener set
   * survives reconnects (the socket transport keeps one set for the lifetime of
   * the client) is ignored once a user-switch bounce has moved the epoch on.
   */
  const bindDeltaHandler = (): void => {
    const myEpoch = connectionEpoch;
    const unbindPrevious = unbindDeltaHandler;
    const isCurrentEpoch = (): boolean => {
      if (myEpoch !== connectionEpoch) {
        // A stale connection's delta arriving after a bounce for a new user.
        return false;
      }
      return true;
    };
    if (transport.onDeltaBatch) {
      unbindDeltaHandler = transport.onDeltaBatch((deltas: SyncDelta[]): void => {
        if (!isCurrentEpoch()) {
          return;
        }
        store.raw.transaction(() => {
          for (const delta of deltas) {
            handleDelta(delta);
          }
        });
      });
    } else {
      unbindDeltaHandler = transport.onDelta((delta: SyncDelta): void => {
        if (!isCurrentEpoch()) {
          return;
        }
        handleDelta(delta);
      });
    }
    unbindPrevious?.();
  };

  /**
   * Re-handshake the transport for the currently-resolved user: invalidate the
   * old connection's deltas, disconnect, reconnect, and resubscribe. Called only
   * on a confirmed identity change (never on a same-user re-auth, which must
   * keep the live socket). Resolves even when the reconnect fails — local-first:
   * the transport's own background reconnection surfaces a later success.
   */
  const bounceTransport = async (): Promise<void> => {
    connectionEpoch += 1;
    transport.disconnect();
    setConnected(false);
    if (simulatedOffline) {
      // A simulated outage owns connectivity; rebind so deltas land again after
      // goOnline() without reconnecting behind the caller's back here.
      bindDeltaHandler();
      return;
    }
    try {
      await transport.connect();
    } catch (error) {
      warn("transport reconnect after user change failed; continuing offline")(error);
    }
    bindDeltaHandler();
    subscribeConfiguredCollections();
  };

  const handleStatusChange = ({
    connected: isConnected,
    authExpired,
  }: {
    connected: boolean;
    authExpired?: boolean;
  }): void => {
    setConnected(isConnected);
    if (!isConnected) {
      // D1: the server's session re-validation sweep disconnected this socket
      // (sync:auth-expired). Map straight into the existing A4 auth-pause path —
      // INV-2: no wipe, outbox untouched, zero retry budget consumed. The
      // reconnect attempt Socket.io makes on its own will keep failing the
      // handshake with the same expired/invalid credentials until the host app
      // re-authenticates (handleAuthChange clears the pause on same-user re-auth).
      if (authExpired) {
        setAuthPaused(true);
      }
      return;
    }
    // B3: re-probe batch support on every reconnect — a previous
    // `batchUnsupported` determination may have been against an old server
    // that has since been upgraded, or the reconnect landed on a different
    // instance behind a load balancer.
    coordinator.notifyReconnect();
    void reconcile().catch(warn("reconnect reconcile failed"));
    void replayOutbox().catch(warn("reconnect replay failed"));
    // Query collections skip snapshot catch-up, so deltas missed while offline are
    // recovered by refetching the windows on screen.
    void queryWindows.refetchRetained();
  };

  /**
   * E1: `handleAuthChange` goes through the SAME lifecycle mutex as
   * `start`/`stop` — it mutates the same shared state (`currentUserId`,
   * `persister` via `runUserCheck`) that a concurrent stop()/start() would.
   * Queuing it here means a rapid stop()-then-start() for a new user can
   * never interleave with an in-flight auth-change handler from the OLD
   * user's session; whichever queued first fully completes before the next
   * runs. The generation check additionally covers the case where THIS
   * handler itself is stale — e.g. it was queued behind a stop() while
   * `getUserId()` resolves, and by the time it runs a fresh generation has
   * already started up for a different user.
   */
  const handleAuthChange = (): void => {
    void withLifecycle(async (): Promise<void> => {
      const myGeneration = generation;
      const userId = await config.authProvider.getUserId();
      if (generation !== myGeneration) {
        // Superseded by a stop()/start() while awaiting the auth provider —
        // that operation now owns currentUserId/persister; do nothing.
        return;
      }
      if (!userId) {
        // Logged out: NEVER wipe (INV-2). Keep all local data, clear the
        // current-user pointer (mutate() requires start() again), and remain
        // paused — reconcile/replay stand down until the same user (or a
        // different one, via the wipe path below) re-authenticates.
        currentUserId = undefined;
        // 9.4: drop the socket — its handshake credentials belong to a session
        // that no longer exists, and anything it still pushes must not be
        // applied. No reconnect: the next authenticated auth change owns that.
        connectionEpoch += 1;
        transport.disconnect();
        setConnected(false);
        setAuthPaused(true);
        return;
      }
      if (userId === currentUserId) {
        // Same-user re-auth: the pause (if any) clears fully and replay
        // resumes with the outbox completely intact. The live socket already
        // authenticated as this same identity, so it is deliberately NOT
        // bounced — a reconnect here would drop deltas for no reason.
        setAuthPaused(false);
        void replayOutbox().catch(warn("post-auth replay failed"));
        return;
      }
      // Different userId: existing wipe-on-user-change behavior, or a first
      // login after a logout (currentUserId undefined) — either way this is a
      // confirmed identity change, never inferred from a bare 401.
      await runUserCheck(userId);
      if (generation !== myGeneration) {
        return;
      }
      // 9.4: the connection (and its per-connection server-side subscriptions)
      // was authenticated as the PREVIOUS identity — or was dropped by the
      // logout branch above — so re-handshake before any sync work resumes.
      await bounceTransport();
      if (generation !== myGeneration) {
        return;
      }
      setAuthPaused(false);
      void reconcile().catch(warn("post-auth reconcile failed"));
      void replayOutbox().catch(warn("post-auth replay failed"));
    }).catch(warn("auth change handling failed"));
  };

  const startReconcileTimer = (): void => {
    const interval = config.reconcileIntervalMs ?? DEFAULT_RECONCILE_INTERVAL_MS;
    if (interval <= 0) {
      return;
    }
    reconcileTimer = setInterval(() => {
      void reconcile().catch(warn("periodic reconcile failed"));
      void replayOutbox().catch(warn("periodic replay failed"));
    }, interval);
  };

  const stopReconcileTimer = (): void => {
    if (reconcileTimer !== undefined) {
      clearInterval(reconcileTimer);
      reconcileTimer = undefined;
    }
  };

  /**
   * E1: lifecycle serialization. `start`/`stop` both queue through the same
   * `lifecycle` mutex as `handleAuthChange`, so at most one of these ever
   * runs at a time, in call order — the bug this fixes was a `stop()`
   * re-reading the module-level `persister` after awaiting a debounced
   * `save()`, by which point an interleaved `start()` for a new user had
   * already replaced it, destroying the NEW user's persister instead of the
   * old one. On top of mutual exclusion, every operation captures its own
   * `myGeneration` and re-checks `generation === myGeneration` after each
   * `await` — belt-and-suspenders against any future call site that manages
   * to bypass the mutex (e.g. a direct call from a test), and cheap enough to
   * always do.
   */
  const start = async (): Promise<void> =>
    withLifecycle(async (): Promise<void> => {
      if (isStarted) {
        // E1: double-start() is a no-op rather than a second full
        // initialization — calling start() again would double-register the
        // transport/auth-change listeners and leak a second reconcile timer.
        // A caller that wants a hard restart should stop() first.
        return;
      }
      generation += 1;
      const myGeneration = generation;
      const authRetryAttempts = Math.max(
        1,
        config.startAuthRetryAttempts ?? DEFAULT_START_AUTH_RETRY_ATTEMPTS
      );
      const authRetryDelayMs = config.startAuthRetryDelayMs ?? DEFAULT_START_AUTH_RETRY_DELAY_MS;
      let userId: string | null = null;
      for (let attempt = 1; attempt <= authRetryAttempts; attempt += 1) {
        userId = await config.authProvider.getUserId();
        if (userId || attempt === authRetryAttempts) {
          break;
        }
        await sleep(authRetryDelayMs);
        if (generation !== myGeneration) {
          // A stop() (or another start()) ran while we were retrying auth
          // resolution — abandon this attempt, see the generation check below.
          return;
        }
      }
      if (!userId) {
        throw new Error("createSyncDb.start() requires an authenticated user");
      }
      if (generation !== myGeneration) {
        // A stop() (or another start()) ran while awaiting the auth
        // provider — that operation now owns the lifecycle; abandon this one
        // rather than initializing state a newer generation doesn't expect.
        return;
      }
      simulatedOffline = false;
      setAuthPaused(false);
      // Re-open the cross-window debug bridge a previous stop()/signOut() closed.
      attachDebugBridge();
      await createAndStartPersister(userId);
      if (generation !== myGeneration) {
        return;
      }
      const {userChanged} = await runUserCheck(userId);
      if (generation !== myGeneration) {
        return;
      }
      if (userChanged) {
        // 9.4: a different user's data was just wiped — invalidate any live
        // connection authenticated as that user (and its deltas) before the
        // connect below re-handshakes as the new one.
        connectionEpoch += 1;
        transport.disconnect();
        setConnected(false);
      }

      // C2: migrate any legacy snapshot:{collection} cursors before the first discovery
      // so the per-stream bootstrap path starts from a clean cursor set. This is a cheap,
      // idempotent fast-path — Phase E's schema-version wipe (runUserCheck ->
      // wipeAndRebootstrap) already re-bootstraps any store still on v1, so in practice no
      // v2 store carries legacy `snapshot:` cursors. Kept because it costs one table scan
      // and lets a v2-with-legacy-cursors store (which should not exist) recover without a
      // full wipe; after the first run there are no `snapshot:` keys left, so it no-ops.
      migrateLegacySnapshotCursors();

      // A1: startup crash recovery, before the first replayOutbox() — repair
      // any outbox rows stranded mid-lifecycle by a prior crash/reload (inFlight
      // never resolved, acked-with-still-pending entity, conflicted with no
      // conflict row written).
      const recovery = outbox.recoverStartupState({userId});
      // Clear husk conflict rows a pre-fix build left behind (see
      // pruneGhostConflicts) before recovery's counts are reported, so a store
      // carrying them recovers without a wipe.
      const prunedConflicts = pruneGhostConflicts({store});
      debugLog?.record({
        detail: {...recovery, prunedConflicts},
        direction: "system",
        label: `startup recovery (${recovery.recoveredInFlight.length} inFlight, ${recovery.releasedEntities.length} released, ${recovery.clearedOrphanPendings.length} orphan pendings cleared, ${recovery.repairedConflicts.length} conflicts repaired, ${prunedConflicts.length} husk conflicts pruned)`,
        type: "reconcile",
      });

      bindDeltaHandler();
      unsubscribers.push((): void => {
        unbindDeltaHandler?.();
        unbindDeltaHandler = undefined;
      });
      unsubscribers.push(transport.onStatusChange(handleStatusChange));
      const unsubscribeSubscribed = transport.onSubscribed?.((subscribed) => {
        void catchUpSubscribedStreams(subscribed).catch(warn("subscribe catch-up failed"));
      });
      if (unsubscribeSubscribed) {
        unsubscribers.push(unsubscribeSubscribed);
      }
      unsubscribers.push(config.authProvider.onAuthChange(handleAuthChange));

      try {
        await transport.connect();
      } catch (error) {
        // Local-first: start succeeds offline; reconnection/status events pick
        // up syncing when connectivity returns.
        warn("transport connect failed; starting offline")(error);
      }
      if (generation !== myGeneration) {
        return;
      }
      subscribeConfiguredCollections();
      // C2: run an initial stream discovery + per-stream bootstrap on start (not only via
      // the reconnect status event) so a client that starts offline-then-online, or with a
      // warm socket, still backfills newly-joined streams and drains legacy cursors.
      void reconcile().catch(warn("startup reconcile failed"));
      // Drop persisted membership of windows nobody has shown for a while (rows stay).
      queryWindows.pruneStale();
      startReconcileTimer();
      isStarted = true;
      void replayOutbox().catch(warn("startup replay failed"));
    });

  const stop = async (): Promise<void> =>
    withLifecycle(async (): Promise<void> => {
      generation += 1;
      isStarted = false;
      closeDebugBridge();
      stopReconcileTimer();
      simulatedOffline = false;
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
      unsubscribers = [];
      transport.disconnect();
      setConnected(false);
      queryWindows.reset();
      coordinator.dispose(currentUserId ? {userId: currentUserId} : undefined);
      // Capture the persister into a local BEFORE the awaits below: this is
      // the exact fix for the original bug (a later start() calling
      // createAndStartPersister() reassigns the module-level `persister`
      // binding, so re-reading it after the await would destroy the NEW
      // user's persister instead of this stop()'s). The mutex already
      // prevents that interleaving, but capturing the local costs nothing and
      // remains correct even if that invariant is ever relaxed.
      const persisterToStop = persister;
      persister = undefined;
      currentUserId = undefined;
      if (persisterToStop) {
        // Flush any pending autosave so a clean stop never loses local writes.
        await persisterToStop.save();
        clearPendingDurableConflicts();
        await persisterToStop.destroy();
      }
    });

  const goOffline = (): void => {
    if (simulatedOffline) {
      return;
    }
    simulatedOffline = true;
    stopReconcileTimer();
    transport.disconnect();
    // The transport's own status event may arrive asynchronously; report the
    // disconnect now so status consumers (and the debug log) see it immediately.
    setConnected(false);
  };

  const goOnline = async (): Promise<void> => {
    if (!simulatedOffline) {
      return;
    }
    simulatedOffline = false;
    try {
      await transport.connect();
    } catch (error) {
      // Local-first: goOnline never throws; the transport's background
      // reconnection surfaces a later success through onStatusChange.
      warn("transport reconnect failed; still offline")(error);
    }
    // The (re)connect status event triggers reconcile + outbox replay via
    // handleStatusChange, and the transport re-subscribes its collections.
    startReconcileTimer();
  };

  const mutate = ({
    collection,
    operation,
    id,
    data,
    maxAttempts,
  }: MutateArgs): {
    mutationId: string;
    id: string;
  } => {
    if (!currentUserId) {
      throw new Error("mutate() requires start() to have resolved an authenticated user");
    }
    if (operation !== "create" && !id) {
      throw new Error(`mutate() requires an id for ${operation}`);
    }
    const mutationId = generateMutationId();
    const entityId = id ?? generateMutationId();
    const existing = store.getEntity<Record<string, unknown> | null>({collection, id: entityId});

    if (operation === "delete") {
      // Deleting an id the local store has never seen would write a tombstone for a
      // row that never existed and queue a mutation the server is certain to reject
      // (404 → terminal validation nack), leaving a phantom behind. Nothing the UI
      // renders can be in that state, so this is a caller bug worth surfacing.
      if (!existing) {
        throw new Error(
          `mutate() cannot delete ${collection}/${entityId}: no such entity in the local store`
        );
      }
      // One write, not two: upsertEntity flips `deleted` and stamps `deletedAt` on the
      // transition exactly like softDeleteEntity, and also records the pending
      // mutation id that protects the row from inbound deltas.
      store.upsertEntity({
        collection,
        data: existing.data ?? null,
        deleted: true,
        id: entityId,
        pendingMutationId: mutationId,
      });
    } else {
      const mergedData =
        operation === "update" && existing && typeof existing.data === "object" && existing.data
          ? {...existing.data, ...data}
          : (data ?? {});
      store.upsertEntity({
        collection,
        data: mergedData,
        id: entityId,
        pendingMutationId: mutationId,
      });
    }

    outbox.enqueue({
      args: data ?? {},
      baseVersion: existing?.seq,
      collection,
      entityId,
      ...(maxAttempts !== undefined ? {maxAttempts} : {}),
      mutationId,
      ...(windowCollectionSet.has(collection) ? {mutationMode: "adminWindow" as const} : {}),
      operation,
      userId: currentUserId,
    });
    debugLog?.record({
      collection,
      detail: {baseVersion: existing?.seq, data},
      direction: "local",
      entityId,
      label: `${operation} ${collection}/${entityId}`,
      mutationId,
      operation,
      type: "mutate",
    });
    void replayOutbox().catch(warn("post-mutate replay failed"));
    return {id: entityId, mutationId};
  };

  const resolveConflict = ({
    mutationId,
    strategy,
  }: {
    mutationId: string;
    strategy: ConflictResolutionStrategy;
  }): void => {
    const conflict = getConflict({mutationId, store});
    const didAddPendingConflict = Boolean(conflict);
    if (conflict) {
      pendingDurableConflicts.set(mutationId, conflict.collection);
    }
    try {
      applyConflictResolution({mutationId, outbox, store, strategy});
    } catch (error) {
      if (didAddPendingConflict) {
        pendingDurableConflicts.delete(mutationId);
      }
      throw error;
    }
    // Conflict resolution is a user-confirmed durability boundary. The web
    // persister normally trails writes by 500ms; bypass that debounce now and
    // keep status conflicted until the write succeeds so reload waits on it.
    // Native and custom persisters fall back to TinyBase's immediate save().
    const resolutionGeneration = generation;
    const resolutionPersister = persister;
    const persistenceFlush = resolutionPersister
      ? (resolutionPersister.flush?.bind(resolutionPersister) ??
        resolutionPersister.save.bind(resolutionPersister))
      : undefined;
    if (persistenceFlush) {
      void persistenceFlush()
        .then(() => {
          if (generation !== resolutionGeneration || persister !== resolutionPersister) {
            return;
          }
          pendingDurableConflicts.delete(mutationId);
          notifyStatusChange();
        })
        .catch((error: unknown) => {
          if (generation !== resolutionGeneration || persister !== resolutionPersister) {
            return;
          }
          persistenceMode = "error";
          warn("post-resolve persistence flush failed")(error);
          notifyStatusChange();
        });
    } else {
      pendingDurableConflicts.delete(mutationId);
    }
    debugLog?.record({
      detail: {strategy},
      direction: "local",
      label: `resolve conflict (${strategy})`,
      mutationId,
      type: "resolve",
    });
    // keepMine re-enqueues the mutation with a fresh baseVersion — drain it now
    // rather than waiting for the next mutate/reconnect/periodic trigger.
    void replayOutbox().catch(warn("post-resolve replay failed"));
  };

  const retryFailed = ({entityId}: {entityId: string}): void => {
    coordinator.retryFailed({entityId});
    debugLog?.record({
      detail: {entityId},
      direction: "local",
      label: `retry failed (${entityId})`,
      type: "resolve",
    });
    void replayOutbox().catch(warn("post-retryFailed replay failed"));
  };

  /**
   * Attribute the queued/failed/conflict totals to the collections they came
   * from so apps can surface one notification per collection. Collections with
   * nothing outstanding are omitted.
   */
  const buildCollectionStatuses = ({
    conflicts,
  }: {
    conflicts: SyncConflict[];
  }): Record<string, SyncCollectionStatus> => {
    const outboxCounts = currentUserId
      ? outbox.countsByCollection({statuses: ["queued", "failed"], userId: currentUserId})
      : {};
    const statuses: Record<string, SyncCollectionStatus> = {};
    const forCollection = (collection: string): SyncCollectionStatus => {
      const existing = statuses[collection];
      if (existing) {
        return existing;
      }
      const created: SyncCollectionStatus = {conflictCount: 0, failedCount: 0, queuedCount: 0};
      statuses[collection] = created;
      return created;
    };
    for (const [collection, counts] of Object.entries(outboxCounts)) {
      const entry = forCollection(collection);
      entry.queuedCount = counts.queued ?? 0;
      entry.failedCount = counts.failed ?? 0;
    }
    for (const conflict of conflicts) {
      forCollection(conflict.collection).conflictCount += 1;
    }
    for (const collection of pendingDurableConflicts.values()) {
      forCollection(collection).conflictCount += 1;
    }
    return statuses;
  };

  const hydrateWindow = async ({
    collection,
    ids,
    restRows,
  }: {
    collection: string;
    ids: string[];
    restRows?: Record<string, unknown>;
  }): Promise<HydrateWindowEntitiesResult> => {
    if (!httpChannel) {
      throw new Error("hydrateWindow requires an HTTP channel");
    }
    return hydrateWindowEntities({
      channel: httpChannel,
      collection,
      ids,
      restRows,
      store,
    });
  };

  const getSyncStatus = (): SyncStatus => {
    const drainProgress = currentUserId
      ? coordinator.getDrainProgress({userId: currentUserId})
      : {draining: false, sentThisDrain: 0, totalThisDrain: 0};
    const conflicts = listConflicts({store});
    return {
      blockedEntities: currentUserId
        ? coordinator.getBlockedEntities({userId: currentUserId}).length
        : 0,
      collections: buildCollectionStatuses({conflicts}),
      conflictCount: conflicts.length + pendingDurableConflicts.size,
      draining: drainProgress.draining,
      failedCount: currentUserId
        ? outbox.countByStatus({status: "failed", userId: currentUserId})
        : 0,
      isOnline: connected,
      isSyncing: syncingCount > 0,
      ...(authPaused ? {paused: "auth" as const} : {}),
      persistence: persistenceMode,
      queuedCount: currentUserId ? outbox.listQueued({userId: currentUserId}).length : 0,
      sentThisDrain: drainProgress.sentThisDrain,
      streams: getAllCursors({store}),
      totalThisDrain: drainProgress.totalThisDrain,
    };
  };

  const onStatusChange = (callback: () => void): (() => void) => {
    statusListeners.add(callback);
    return () => {
      statusListeners.delete(callback);
    };
  };

  /**
   * E1: a sign-out mutates the same shared state as start()/stop()/
   * handleAuthChange (`currentUserId`, the persister, coordinator state), so it
   * queues on the same lifecycle mutex and bumps the generation — an in-flight
   * reconcile/replay from the signed-out session sees itself superseded and
   * stands down instead of writing into a store that no longer has an owner.
   */
  const signOut = async (): Promise<void> =>
    withLifecycle(async (): Promise<void> => {
      generation += 1;
      isStarted = false;
      closeDebugBridge();
      const userId = currentUserId;
      stopReconcileTimer();
      simulatedOffline = false;
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
      unsubscribers = [];
      connectionEpoch += 1;
      transport.disconnect();
      setConnected(false);
      setAuthPaused(false);
      currentUserId = undefined;
      // Capture and clear the persister before awaiting, exactly as stop() does:
      // it is destroyed below (or by the wipe), so leaving the module-level
      // binding pointing at it would hand a later start() a dead persister.
      const persisterToStop = persister;
      persister = undefined;
      if (userId && config.wipeOnSignOut) {
        coordinator.dispose({userId});
        // E3(f): the strongest wipe case must also drop the cached derived
        // encryption key — the same rationale as the different-user wipe.
        await wipeLocalData({
          databaseNames: [config.name],
          keyCacheDbNames: [DEFAULT_KEY_CACHE_DB_NAME],
          persister: persisterToStop,
          store,
        });
        clearPendingDurableConflicts();
        lastSeqJumpReconcileAt.clear();
        queryWindows.reset();
        return;
      }
      coordinator.dispose(userId ? {userId} : undefined);
      if (persisterToStop) {
        // Flush any pending autosave so a sign-out without a wipe never loses
        // local writes (they belong to the user who may sign back in).
        await persisterToStop.save();
        clearPendingDurableConflicts();
        await persisterToStop.destroy();
      }
    });

  const client: SyncDb = {
    debug: debugLog,
    forceResync,
    getSyncStatus,
    goOffline,
    goOnline,
    hydrateWindow,
    mutate,
    onStatusChange,
    outbox,
    queryWindows,
    reconcile,
    replayOutbox,
    resolveConflict,
    retryFailed,
    signOut,
    start,
    stop,
    store,
  };
  if (debugLog) {
    registerSyncDbDevtools({client, name: config.name});
  }
  return client;
};
