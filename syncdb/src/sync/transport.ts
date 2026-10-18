import type {
  SyncAck,
  SyncDelta,
  SyncMutateBatchRequest,
  SyncMutateRequest,
  SyncNack,
  SyncSubscribed,
} from "../types";

/** Default time to wait for a mutation ack/nack before rejecting. */
export const DEFAULT_MUTATION_TIMEOUT_MS = 15_000;

/** Default max mutations per batch send (server also enforces this cap). */
export const DEFAULT_BATCH_SIZE = 50;

/** The server's reply to a sent mutation: accepted (ack) or rejected (nack). */
export type SendMutationResult = {type: "ack"; ack: SyncAck} | {type: "nack"; nack: SyncNack};

/**
 * The server's reply to a batch send: a `results` array (see
 * `SyncMutateBatchResponse`), or `unsupported` when the transport/server has no
 * batch endpoint (HTTP 404, or a socket that never acks `sync:mutateBatch` within
 * the timeout — Socket.io silently drops emits to unregistered events). Callers
 * treat `unsupported` as a signal to set the per-connection `batchUnsupported`
 * flag and fall back to single-mutation sends, never as a transport failure.
 */
export type SendMutationBatchResult =
  | {type: "results"; results: ({type: "ack"; ack: SyncAck} | {type: "nack"; nack: SyncNack})[]}
  | {type: "unsupported"};

/** Transport connection status snapshot delivered to status listeners. */
export interface TransportStatus {
  connected: boolean;
  /**
   * D1: set when this disconnect was caused by the server's session re-validation
   * sweep (`sync:auth-expired`, emitted before `socket.disconnect(true)`) rather than
   * a generic network drop. The client maps this into the existing A4 auth-pause path
   * (INV-2 — no wipe, outbox intact) instead of treating it as a transient transport
   * blip eligible for unlimited-retry backoff.
   */
  authExpired?: boolean;
}

/**
 * Bidirectional sync channel between the local store and the server. The
 * Socket.io implementation (`createSocketTransport`) speaks the server's
 * `sync:*` event protocol; `createFakeTransport` provides a deterministic
 * in-memory double for tests.
 */
export interface SyncTransport {
  /** Open the connection; resolves once connected, rejects on the first failure. */
  connect: () => Promise<void>;
  /** Close the connection and reject any in-flight mutation sends. */
  disconnect: () => void;
  /** Subscribe to delta streams for the given collections (idempotent server-side). */
  subscribe: (collections: string[], options?: {mode?: "window"}) => void;
  /**
   * Send a mutation and resolve with the server's ack/nack, correlated by
   * `mutationId`. Rejects when no reply arrives within the transport's
   * configured timeout (default {@link DEFAULT_MUTATION_TIMEOUT_MS}) or when
   * the connection drops before the reply.
   */
  sendMutation: (request: SyncMutateRequest) => Promise<SendMutationResult>;
  /**
   * Send a batch of mutations (`sync:mutateBatch`) and resolve with either the
   * server's per-mutation results or `unsupported` (server has no batch handler —
   * Socket.io drops emits to unregistered events, so this resolves after a short
   * grace timeout rather than the full mutation timeout). Rejects on transport
   * failure exactly like `sendMutation` (timeout waiting for a KNOWN-supported
   * server, network error, disconnect).
   */
  sendMutationBatch?: (request: SyncMutateBatchRequest) => Promise<SendMutationBatchResult>;
  /** Subscribe to inbound `sync:delta` events. Returns an unsubscribe function. */
  onDelta: (callback: (delta: SyncDelta) => void) => () => void;
  /**
   * Subscribe to the server's `sync:subscribed` confirmations. Returns an unsubscribe
   * function. Optional so transports without a subscription handshake (HTTP-only
   * doubles) satisfy the contract; callers must treat its absence as "never confirmed".
   */
  onSubscribed?: (callback: (subscribed: SyncSubscribed) => void) => () => void;
  /**
   * Optional burst-aware inbound subscription. Transports that receive rapid
   * `sync:delta` events can deliver one arrival-ordered batch so the client
   * commits it atomically. `onDelta` remains the compatibility path.
   */
  onDeltaBatch?: (callback: (deltas: SyncDelta[]) => void) => () => void;
  /** Subscribe to connection status changes. Returns an unsubscribe function. */
  onStatusChange: (callback: (status: TransportStatus) => void) => () => void;
}
