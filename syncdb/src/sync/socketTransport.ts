import {io, type Socket} from "socket.io-client";

import type {
  AuthProvider,
  SyncAck,
  SyncDelta,
  SyncMutateBatchRequest,
  SyncMutateRequest,
  SyncNack,
  SyncSubscribed,
} from "../types";
import {
  DEFAULT_MUTATION_TIMEOUT_MS,
  type SendMutationBatchResult,
  type SendMutationResult,
  type SyncTransport,
  type TransportStatus,
} from "./transport";

/**
 * Grace period to wait for EITHER a `sync:mutateBatch` ack callback OR the
 * `sync:batchReceived` receipt before treating the server as not supporting
 * the batch event at all. Socket.io silently drops emits to event names with
 * no registered handler — there is no error to catch, only silence — so this
 * must be much shorter than the full batch timeout or every batch send
 * against an old server would stall for that long. Once the receipt DOES
 * arrive within this window, the server is known to support batching (it's
 * just slow) and the client waits the full {@link batchTimeoutMs} instead of
 * falling back (FIX 5).
 */
const BATCH_UNSUPPORTED_GRACE_MS = 2_000;

/**
 * Compute the batch send timeout once a `sync:batchReceived` receipt has
 * confirmed the server is processing (as opposed to silent/unsupported): the
 * existing per-mutation timeout scaled by chunk size, so a large batch isn't
 * timed out prematurely just because it's slower than a single mutation
 * (FIX 5).
 */
const batchTimeoutMs = (mutationCount: number, perMutationTimeoutMs: number): number =>
  Math.max(perMutationTimeoutMs, mutationCount * 1_000);

export interface SocketTransportConfig {
  /** Server origin, e.g. "http://localhost:4000". */
  baseUrl: string;
  /** Token source; `getToken()` is called fresh on every connection attempt. */
  authProvider: Pick<AuthProvider, "getToken">;
  /** How long to wait for a mutation ack/nack before rejecting (default 15s). */
  timeoutMs?: number;
  /** Grace period before a batch send is treated as unsupported (default 2s). */
  batchUnsupportedGraceMs?: number;
  /**
   * Socket.io transports. Default polling then websocket so a restarting
   * dev server does not fail the first handshake.
   */
  transports?: string[];
  /** Selected organization id attached to mutate payloads when present. */
  organizationIdProvider?: () => string | undefined;
}

interface PendingMutation {
  resolve: (result: SendMutationResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Socket.io implementation of {@link SyncTransport}, speaking the server's
 * sync protocol (see @terreno/api `src/sync/socketHandlers.ts`):
 *
 * - client emits `sync:subscribe {collections}` and `sync:mutate <request>`;
 * - server replies with `sync:ack` / `sync:nack` events **and** a Socket.io
 *   ack callback carrying `{ack}` / `{nack}` — replies are correlated by
 *   `mutationId` and the first to arrive settles the pending promise;
 * - server replies to a subscribe with `sync:subscribed {collection, streams}` once
 *   the socket has actually joined the stream rooms, and pushes `sync:delta` events
 *   for those streams from then on.
 *
 * The handshake token is resolved via `authProvider.getToken()` inside the
 * Socket.io `auth` callback, which runs on **every** connection attempt — the
 * token is never cached, so session refreshes are picked up transparently on
 * reconnect. The raw provider token is sent with a `Bearer ` prefix (unless the
 * provider already included one): the server's legacy JWT socket validator
 * (`@thream/socketio-jwt` via @terreno/api `createSocketAuthMiddleware`)
 * requires that exact format, and the Better Auth validator strips an optional
 * prefix — so prefixing is correct for both. Reconnection is enabled; on every
 * (re)connect the transport re-emits `sync:subscribe` for all previously
 * subscribed collections because server-side subscription state is
 * per-connection.
 */
const withOrganizationId = <T extends object>(
  payload: T,
  organizationIdProvider?: () => string | undefined
): T & {organizationId?: string} => {
  const organizationId = organizationIdProvider?.()?.trim();
  if (!organizationId) {
    return payload;
  }
  return {...payload, organizationId};
};

export const createSocketTransport = ({
  baseUrl,
  authProvider,
  timeoutMs = DEFAULT_MUTATION_TIMEOUT_MS,
  batchUnsupportedGraceMs = BATCH_UNSUPPORTED_GRACE_MS,
  transports = ["polling", "websocket"],
  organizationIdProvider,
}: SocketTransportConfig): SyncTransport => {
  const deltaListeners = new Set<(delta: SyncDelta) => void>();
  const subscribedListeners = new Set<(subscribed: SyncSubscribed) => void>();
  const deltaBatchListeners = new Set<(deltas: SyncDelta[]) => void>();
  const statusListeners = new Set<(status: TransportStatus) => void>();
  const pending = new Map<string, PendingMutation>();
  const pendingBatches = new Map<
    string,
    {
      resolve: (result: SendMutationBatchResult) => void;
      reject: (error: Error) => void;
      /** Cleared once a `sync:batchReceived` receipt arrives (FIX 5). */
      graceTimer?: ReturnType<typeof setTimeout>;
      /** Armed once the receipt lands, replacing the grace timer (FIX 5). */
      fullTimer?: ReturnType<typeof setTimeout>;
      /** Removes this batch's `sync:batchReceived` listener (FIX 5). */
      offReceived: () => void;
    }
  >();
  let nextBatchId = 1;
  const subscribed = new Set<string>();
  const subscribeMode = new Map<string, "window">();
  const inboundDeltaBatches = new Map<(deltas: SyncDelta[]) => void, SyncDelta[]>();
  let isInboundDeltaBatchScheduled = false;

  const scheduleInboundDeltaBatchFlush = (): void => {
    if (isInboundDeltaBatchScheduled) {
      return;
    }
    isInboundDeltaBatchScheduled = true;
    // Socket.IO can deliver a high-volume stream in separate tasks. Deferring to
    // the next paint coalesces that stream into one store transaction, so React
    // does not render once per delta. Non-DOM environments retain microtask
    // semantics for SSR and transport tests.
    if (typeof globalThis.requestAnimationFrame === "function") {
      globalThis.requestAnimationFrame(flushInboundDeltaBatch);
      return;
    }
    queueMicrotask(flushInboundDeltaBatch);
  };

  const flushInboundDeltaBatch = (): void => {
    isInboundDeltaBatchScheduled = false;
    const batches = [...inboundDeltaBatches];
    inboundDeltaBatches.clear();
    for (const [listener, deltas] of batches) {
      listener(deltas);
    }
  };

  const socket: Socket = io(baseUrl, {
    auth: (callback) => {
      // Called per connection attempt; never cache the token across attempts.
      // The server's socket auth chain expects "Bearer <token>" (matching the
      // Authorization header format the HTTP channel sends).
      void authProvider.getToken().then(
        (token) =>
          callback(token ? {token: token.startsWith("Bearer ") ? token : `Bearer ${token}`} : {}),
        () => callback({})
      );
    },
    autoConnect: false,
    reconnection: true,
    // Start with polling so dev server restarts don't fail the initial
    // websocket-only handshake; Socket.io upgrades once connected.
    transports,
  });

  const settle = (mutationId: string, result: SendMutationResult): void => {
    const entry = pending.get(mutationId);
    if (!entry) {
      return;
    }
    pending.delete(mutationId);
    clearTimeout(entry.timer);
    entry.resolve(result);
  };

  const rejectAllPending = (reason: string): void => {
    for (const [mutationId, entry] of pending) {
      pending.delete(mutationId);
      clearTimeout(entry.timer);
      entry.reject(new Error(reason));
    }
    for (const [batchId, entry] of pendingBatches) {
      pendingBatches.delete(batchId);
      if (entry.graceTimer !== undefined) {
        clearTimeout(entry.graceTimer);
      }
      if (entry.fullTimer !== undefined) {
        clearTimeout(entry.fullTimer);
      }
      entry.offReceived();
      entry.reject(new Error(reason));
    }
  };

  const notifyStatus = (connected: boolean, authExpired?: boolean): void => {
    for (const listener of statusListeners) {
      listener(authExpired ? {authExpired: true, connected} : {connected});
    }
  };

  // D1: the server's session re-validation sweep emits `sync:auth-expired`
  // immediately before calling `socket.disconnect(true)` — this flag survives just
  // long enough for the subsequent `disconnect` handler to tag its status
  // notification, then resets so a later, unrelated disconnect isn't misattributed.
  let pendingAuthExpired = false;

  socket.on("sync:delta", (delta: SyncDelta) => {
    for (const listener of deltaListeners) {
      listener(delta);
    }
    if (deltaBatchListeners.size === 0) {
      return;
    }
    for (const listener of deltaBatchListeners) {
      const batch = inboundDeltaBatches.get(listener) ?? [];
      batch.push(delta);
      inboundDeltaBatches.set(listener, batch);
    }
    scheduleInboundDeltaBatchFlush();
  });
  socket.on(
    "sync:subscribed",
    (payload: {collection?: unknown; streams?: unknown; mode?: unknown}) => {
      if (typeof payload?.collection !== "string" || !Array.isArray(payload.streams)) {
        return;
      }
      const streams = payload.streams.filter(
        (stream: unknown): stream is string => typeof stream === "string"
      );
      const mode = payload.mode === "window" ? ("window" as const) : undefined;
      for (const listener of subscribedListeners) {
        listener({collection: payload.collection, streams, ...(mode ? {mode} : {})});
      }
    }
  );
  socket.on("sync:ack", (ack: SyncAck) => {
    settle(ack.mutationId, {ack, type: "ack"});
  });
  socket.on("sync:nack", (nack: SyncNack) => {
    settle(nack.mutationId, {nack, type: "nack"});
  });
  socket.on("sync:auth-expired", () => {
    pendingAuthExpired = true;
  });
  // D1: Socket.io's own automatic background reconnection (reconnection: true,
  // configured below) re-runs the handshake without going through this module's
  // connect() promise — so an auth rejection on a RECONNECT attempt (token expired
  // or session revoked while offline, discovered only when the client comes back)
  // must be observed here, not just on the initial connect(). Any auth-shaped
  // rejection (the server's auth middleware `next(error)`, matching the
  // `UnauthorizedError` data shape from @thream/socketio-jwt / socketAuth.ts) maps
  // into the same auth-pause path as an explicit sync:auth-expired disconnect.
  socket.on("connect_error", (error: Error & {data?: {type?: string}}) => {
    if (error?.data?.type === "UnauthorizedError") {
      notifyStatus(false, true);
    }
  });
  socket.on("connect", () => {
    // Server-side subscriptions are per-connection: re-subscribe on reconnect.
    if (subscribed.size > 0) {
      const windowed = [...subscribed].filter(
        (collection) => subscribeMode.get(collection) === "window"
      );
      const full = [...subscribed].filter(
        (collection) => subscribeMode.get(collection) !== "window"
      );
      if (full.length > 0) {
        socket.emit("sync:subscribe", {collections: full});
      }
      if (windowed.length > 0) {
        socket.emit("sync:subscribe", {collections: windowed, mode: "window"});
      }
    }
    notifyStatus(true);
  });
  socket.on("disconnect", () => {
    // Replies for in-flight mutations will never arrive on this connection;
    // reject now so the replay coordinator can requeue instead of waiting out
    // the full timeout.
    rejectAllPending("Socket disconnected before the mutation was acknowledged");
    const authExpired = pendingAuthExpired;
    pendingAuthExpired = false;
    notifyStatus(false, authExpired);
  });

  const connect = (): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      if (socket.connected) {
        resolve();
        return;
      }
      const cleanup = (): void => {
        socket.off("connect", onConnect);
        socket.off("connect_error", onConnectError);
      };
      const onConnect = (): void => {
        cleanup();
        resolve();
      };
      const onConnectError = (error: Error): void => {
        // Reject the initial connect() promise; background reconnection keeps
        // retrying and a later success surfaces through onStatusChange.
        cleanup();
        reject(error);
      };
      socket.once("connect", onConnect);
      socket.once("connect_error", onConnectError);
      socket.connect();
    });

  const disconnect = (): void => {
    socket.disconnect();
    rejectAllPending("Transport disconnected");
  };

  const subscribe = (collections: string[], options?: {mode?: "window"}): void => {
    for (const collection of collections) {
      subscribed.add(collection);
      if (options?.mode === "window") {
        subscribeMode.set(collection, "window");
      } else {
        subscribeMode.delete(collection);
      }
    }
    // Only emit when connected; the connect handler (re)subscribes otherwise —
    // Socket.io would buffer a disconnected emit and duplicate the subscribe.
    if (socket.connected && collections.length > 0) {
      socket.emit(
        "sync:subscribe",
        options?.mode === "window" ? {collections, mode: "window"} : {collections}
      );
    }
  };

  const sendMutation = (request: SyncMutateRequest): Promise<SendMutationResult> =>
    new Promise<SendMutationResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(request.mutationId);
        reject(
          new Error(`Timed out after ${timeoutMs}ms waiting for ack/nack: ${request.mutationId}`)
        );
      }, timeoutMs);
      pending.set(request.mutationId, {reject, resolve, timer});
      // The server both emits sync:ack/sync:nack and invokes this Socket.io
      // ack callback; whichever arrives first settles (settle is idempotent).
      socket.emit(
        "sync:mutate",
        withOrganizationId(request, organizationIdProvider),
        (response: {ack?: SyncAck; nack?: SyncNack}) => {
          if (response?.ack) {
            settle(request.mutationId, {ack: response.ack, type: "ack"});
          } else if (response?.nack) {
            settle(request.mutationId, {nack: response.nack, type: "nack"});
          }
        }
      );
    });

  const sendMutationBatch = (
    request: {mutations: SyncMutateRequest[]} & SyncMutateBatchRequest
  ): Promise<SendMutationBatchResult> =>
    new Promise<SendMutationBatchResult>((resolve, reject) => {
      const batchId = String(nextBatchId++);

      // FIX 5: a server without a sync:mutateBatch handler never invokes the
      // ack callback NOR emits sync:batchReceived (Socket.io silently drops
      // emits to unregistered events) — a short grace timeout with NO
      // receipt landing is the ONLY signal for "unsupported". Once a
      // receipt (or the final ack callback, whichever arrives first) lands
      // within that window, the server is known to support batching and is
      // just slow — the full batch timeout (proportional to chunk size)
      // takes over instead of resolving `unsupported` prematurely.
      const cleanup = (): void => {
        pendingBatches.delete(batchId);
        socket.off("sync:batchReceived", onReceived);
      };
      const finish = (result: SendMutationBatchResult): void => {
        cleanup();
        resolve(result);
      };
      const armFullTimer = (): void => {
        const entry = pendingBatches.get(batchId);
        if (!entry || entry.fullTimer !== undefined) {
          return;
        }
        if (entry.graceTimer !== undefined) {
          clearTimeout(entry.graceTimer);
          entry.graceTimer = undefined;
        }
        entry.fullTimer = setTimeout(
          () => {
            // The server confirmed support (a receipt or ack landed) but never
            // finished within the scaled batch timeout — this is a genuine
            // transport failure (not "unsupported"), so reject: the
            // coordinator applies its unlimited-backoff transport-failure
            // path and resends the whole chunk (INV-3), rather than wrongly
            // downgrading a merely-slow-but-supported server to single-sends.
            cleanup();
            reject(
              new Error(`Timed out after the batch timeout waiting for batch ${batchId} to finish`)
            );
          },
          batchTimeoutMs(request.mutations.length, timeoutMs)
        );
      };
      const onReceived = ({batchId: receivedId}: {batchId?: string}): void => {
        if (receivedId === batchId) {
          armFullTimer();
        }
      };
      socket.on("sync:batchReceived", onReceived);

      const graceTimer = setTimeout(() => {
        finish({type: "unsupported"});
      }, batchUnsupportedGraceMs);
      // The pendingBatches entry MUST exist before the emit: on localhost the
      // server's immediate sync:batchReceived echo can round-trip fast enough
      // to race this same synchronous block, and armFullTimer/the ack
      // callback both look up this entry by batchId.
      pendingBatches.set(batchId, {
        graceTimer,
        offReceived: () => socket.off("sync:batchReceived", onReceived),
        reject,
        resolve,
      });

      socket.emit(
        "sync:mutateBatch",
        withOrganizationId({...request, batchId}, organizationIdProvider),
        (response: {
          results?: ({type: "ack"; ack: SyncAck} | {type: "nack"; nack: SyncNack})[];
        }) => {
          const entry = pendingBatches.get(batchId);
          if (!entry) {
            return;
          }
          if (entry.fullTimer !== undefined) {
            clearTimeout(entry.fullTimer);
          }
          if (Array.isArray(response?.results)) {
            finish({results: response.results, type: "results"});
          } else {
            finish({type: "unsupported"});
          }
        }
      );
    });

  return {
    connect,
    disconnect,
    onDelta: (callback: (delta: SyncDelta) => void): (() => void) => {
      deltaListeners.add(callback);
      return () => {
        deltaListeners.delete(callback);
      };
    },
    onDeltaBatch: (callback: (deltas: SyncDelta[]) => void): (() => void) => {
      deltaBatchListeners.add(callback);
      return () => {
        deltaBatchListeners.delete(callback);
        inboundDeltaBatches.delete(callback);
      };
    },
    onStatusChange: (callback: (status: TransportStatus) => void): (() => void) => {
      statusListeners.add(callback);
      return () => {
        statusListeners.delete(callback);
      };
    },
    onSubscribed: (callback: (subscribed: SyncSubscribed) => void): (() => void) => {
      subscribedListeners.add(callback);
      return () => {
        subscribedListeners.delete(callback);
      };
    },
    sendMutation,
    sendMutationBatch,
    subscribe,
  };
};
