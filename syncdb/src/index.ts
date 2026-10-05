/**
 * @terreno/syncdb — local-first data layer for Terreno apps.
 *
 * The on-device store (TinyBase MergeableStore) is the UI's source of truth:
 * reads come from the local store, writes apply optimistically to local state and a
 * durable outbox, and the server is asynchronous reconciliation over a websocket
 * delta protocol with HTTP snapshot catch-up. Supersedes @terreno/rtk for
 * data-synchronization concerns. See docs/implementationPlans/syncdb-local-first.md.
 *
 * This module is the package's public API: everything re-exported here is
 * semver-protected, and everything else under `src/` is an internal detail that may
 * change in a patch release. Deliberately absent are the pieces that let a host app
 * corrupt the store's invariants behind the client's back — cell-level cursor
 * mutators, outbox/conflict writers, raw row shapes, the IndexedDB helpers, and the
 * debug broadcast bridge. Reach for `client.store`/`client.outbox` (or the React
 * hooks) instead, and open an issue if something genuinely needs promoting.
 *
 * Two other entry points exist:
 * - `@terreno/syncdb/react` (src/react/index.ts) — React bindings. They live on
 *   their own subpath because react is an optional peer dependency and this entry
 *   must stay importable without it.
 * - `@terreno/syncdb/testing` (src/testing/index.ts) — test doubles such as
 *   `createFakeTransport`, kept out of production bundles.
 */

// --- Client ---------------------------------------------------------------

export {
  createSyncDb,
  DEFAULT_RECONCILE_INTERVAL_MS,
  DEFAULT_SEQ_JUMP_RECONCILE_MIN_INTERVAL_MS,
  DEFAULT_START_AUTH_RETRY_ATTEMPTS,
  DEFAULT_START_AUTH_RETRY_DELAY_MS,
  DEFAULT_TOMBSTONE_RETENTION_MS,
  type ForceResyncResult,
  type ForceResyncSkipReason,
  type MutateArgs,
  type SyncDb,
  type SyncDbConfig,
} from "./client";

// --- Protocol, status, and conflict types --------------------------------

export type {
  AuthProvider,
  ConflictResolutionStrategy,
  OutboxMutation,
  OutboxStatus,
  SyncAck,
  SyncCollectionStatus,
  SyncConflict,
  SyncDelta,
  SyncEntitiesResponse,
  SyncMutateBatchRequest,
  SyncMutateBatchResponse,
  SyncMutateBatchResult,
  SyncMutateRequest,
  SyncMutationOperation,
  SyncNack,
  SyncNackCode,
  SyncSnapshotEntity,
  SyncSnapshotResponse,
  SyncStatus,
  SyncStreamInfo,
  SyncSubscribed,
} from "./types";

// --- Queries and server windows ------------------------------------------
// `where`/`sort` share one syntax across local `useQuery`, server windows
// (`client.queryWindows` / `useWindowQuery`), and `modelRouter` list params.

export type {QuerySort} from "./query/localQuery";
export {
  DEFAULT_WINDOW_PAGE_SIZE,
  type QueryWindowState,
  type QueryWindows,
  type WindowFetchStatus,
  type WindowQuery,
} from "./query/queryWindows";
export type {SortDirection, SortSpec} from "./query/sort";
export {compileWhere, type WhereFilter, type WhereOperators} from "./query/where";

// --- Local store and outbox (read surface) -------------------------------
// `client.store` is typed as SyncStore and `client.outbox` as Outbox;
// OUTBOX_TABLE names the table to pass to `client.store.raw.getTable(...)` when
// inspecting queued mutations directly (what the example app's sync health UI
// does). Reading conflicts outside React goes through `listConflicts`; writing to
// any reserved table is the client's job alone.

export {listConflicts} from "./mutations/conflicts";
export {generateMutationId, type Outbox} from "./mutations/outbox";
export type {SyncStore} from "./storage/store";
export {OUTBOX_TABLE, type SyncEntity} from "./storage/types";
export {wipeLocalData} from "./storage/wipe";

// --- Auth -----------------------------------------------------------------

export {
  type BetterAuthAdapterOptions,
  betterAuthAdapter,
  DEFAULT_AUTH_POLL_INTERVAL_MS,
} from "./auth/betterAuthAdapter";
export {
  type BetterAuthReactClientLike,
  bridgeBetterAuthReactClient,
} from "./auth/betterAuthReactClient";
export type {
  BetterAuthClientLike,
  BetterAuthGetSessionResult,
  BetterAuthSessionAtomLike,
  BetterAuthSessionDataLike,
  BetterAuthSessionLike,
  BetterAuthUserLike,
} from "./auth/types";

// --- Encryption (web persistence) ----------------------------------------

export {
  AES_GCM_ENVELOPE_VERSION,
  createAesGcmCodec,
  PayloadIntegrityError,
  UnknownEnvelopeVersionError,
} from "./crypto/aesGcmCodec";
export {identityCodec} from "./crypto/identityCodec";
export {
  createKeyProviderCodec,
  createLocalKeyProvider,
  createServerKeyProvider,
  DEFAULT_KEY_CACHE_DB_NAME,
} from "./crypto/keyProviders";
export type {KeyProvider, PayloadCodec} from "./crypto/types";

// --- Persisters -----------------------------------------------------------

export {createDefaultPersisterFactory} from "./persisters/defaultPersisterFactory";
export {createEncryptedIndexedDbPersister} from "./persisters/encryptedIndexedDbPersister";
export {
  clearMemoryPersisterData,
  createMemoryPersister,
  memoryPersisterFactory,
} from "./persisters/memoryPersister";
export type {DefaultPersisterFactoryConfig, PersisterFactory} from "./persisters/types";

// --- Transports (only needed to override the defaults) -------------------

export {
  AuthRequiredError,
  createHttpChannel,
  type FetchLike,
  type FetchSnapshotPageArgs,
  type HttpChannel,
  type HttpChannelConfig,
  ListRequestError,
  QueryFieldNotAllowedError,
} from "./sync/httpChannel";
export {createSocketTransport, type SocketTransportConfig} from "./sync/socketTransport";
export {
  DEFAULT_BATCH_SIZE,
  DEFAULT_MUTATION_TIMEOUT_MS,
  type SendMutationBatchResult,
  type SendMutationResult,
  type SyncTransport,
  type TransportStatus,
} from "./sync/transport";
export type {ListResponse} from "./types";

// --- Debug log ------------------------------------------------------------
// Enabled with `SyncDbConfig.debug`, read through `client.debug` or the React
// `useSyncDebugLog()` hook. The cross-tab BroadcastChannel bridge is internal.

export type {
  SyncDebugDirection,
  SyncDebugEvent,
  SyncDebugEventType,
  SyncDebugLog,
  SyncDebugLogOptions,
  SyncDebugRecordInput,
  SyncDebugSnapshot,
  SyncDebugStats,
} from "./debug/debugLog";
