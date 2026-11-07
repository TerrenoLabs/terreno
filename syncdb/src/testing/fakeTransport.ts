/**
 * In-memory {@link SyncTransport} double for tests and load harnesses. Published
 * from the `@terreno/syncdb/testing` subpath so the main entry stays free of test
 * doubles.
 */

import {
  isReservedSocketEvent,
  type SendMutationBatchResult,
  type SendMutationResult,
  type SocketEventHandler,
  type SyncTransport,
  type TransportStatus,
} from "../sync/transport";
import type {
  SyncAck,
  SyncDelta,
  SyncMutateBatchRequest,
  SyncMutateRequest,
  SyncNack,
  SyncSubscribed,
} from "../types";

/** Computes the reply for a sent mutation (may reject to simulate transport failure). */
export type FakeMutationResponder = (
  request: SyncMutateRequest
) => SendMutationResult | Promise<SendMutationResult>;

/** Computes the reply for a sent batch (may reject to simulate transport failure). */
export type FakeBatchResponder = (
  request: SyncMutateBatchRequest
) => SendMutationBatchResult | Promise<SendMutationBatchResult>;

/** Test-facing controls layered on top of the {@link SyncTransport} contract. */
export interface FakeTransport extends SyncTransport {
  /** Every mutation sent through the transport, in order. */
  readonly sentMutations: SyncMutateRequest[];
  /** Every batch sent through the transport (as arrays of mutationIds), in order. */
  readonly sentBatches: string[][];
  /** Distinct collections subscribed so far (union across subscribe calls). */
  readonly subscribedCollections: string[];
  /** Deliver a server delta to all onDelta listeners. */
  deliverDelta: (delta: SyncDelta) => void;
  /** Deliver an app-level server event (e.g. `featureFlagsChanged`) to onEvent listeners. */
  emitEvent: (event: string, ...args: unknown[]) => void;
  /** Number of onEvent listeners currently bound to `event`. */
  eventListenerCount: (event: string) => number;
  /** Deliver a `sync:subscribed` confirmation to all onSubscribed listeners. */
  confirmSubscribed: (subscribed: SyncSubscribed) => void;
  /** Simulate a connect/disconnect; notifies status listeners on change. */
  setConnected: (connected: boolean) => void;
  /**
   * Simulate the D1 server-side session re-validation sweep disconnecting this
   * socket: a disconnect tagged `authExpired: true`, mirroring the real socket
   * transport's `sync:auth-expired` + `disconnect` sequence.
   */
  disconnectWithAuthExpired: () => void;
  /** Queue an ack for the next sendMutation (mutationId/id filled from the request). */
  respondWithAck: (overrides?: Partial<SyncAck>) => void;
  /** Queue a nack for the next sendMutation (mutationId filled from the request). */
  respondWithNack: (nack: Partial<SyncNack> & Pick<SyncNack, "code">) => void;
  /** Queue a one-shot responder for the next sendMutation (may throw/reject). */
  respondWith: (responder: FakeMutationResponder) => void;
  /** Replace the fallback responder used when the queue is empty (undefined = auto-ack). */
  setDefaultResponder: (responder?: FakeMutationResponder) => void;
  /**
   * Replace the batch responder (undefined = auto-ack every mutation in the
   * batch with monotonically increasing seqs, sharing the same counter as
   * single-send auto-ack). Set to a responder returning `{type:
   * "unsupported"}` to simulate an old server without batch support.
   */
  setBatchResponder: (responder?: FakeBatchResponder) => void;
  /** Queue a one-shot responder for the next sendMutationBatch call only. */
  respondBatchWith: (responder: FakeBatchResponder) => void;
}

/**
 * In-memory transport double for unit tests: records sent mutations and
 * subscriptions, lets tests deliver deltas and flip connectivity, and answers
 * `sendMutation` from a one-shot responder queue (falling back to a default
 * responder that acks every mutation with a monotonically increasing seq).
 */
export const createFakeTransport = (): FakeTransport => {
  const sentMutations: SyncMutateRequest[] = [];
  const sentBatches: string[][] = [];
  const subscribed = new Set<string>();
  const deltaListeners = new Set<(delta: SyncDelta) => void>();
  const subscribedListeners = new Set<(subscribed: SyncSubscribed) => void>();
  const statusListeners = new Set<(status: TransportStatus) => void>();
  const eventListeners = new Map<string, Set<SocketEventHandler>>();
  const responderQueue: FakeMutationResponder[] = [];
  let connected = false;
  let nextSeq = 0;

  const autoAck: FakeMutationResponder = (request) => {
    nextSeq += 1;
    return {
      ack: {id: request.id ?? `server-${nextSeq}`, mutationId: request.mutationId, seq: nextSeq},
      type: "ack",
    };
  };
  let defaultResponder: FakeMutationResponder = autoAck;

  const autoAckBatch: FakeBatchResponder = (request) => ({
    results: request.mutations.map((mutation) => {
      nextSeq += 1;
      return {
        ack: {
          id: mutation.id ?? `server-${nextSeq}`,
          mutationId: mutation.mutationId,
          seq: nextSeq,
        },
        type: "ack" as const,
      };
    }),
    type: "results",
  });
  let batchResponder: FakeBatchResponder = autoAckBatch;
  const batchResponderQueue: FakeBatchResponder[] = [];

  const setConnected = (value: boolean): void => {
    if (connected === value) {
      return;
    }
    connected = value;
    for (const listener of statusListeners) {
      listener({connected: value});
    }
  };

  return {
    confirmSubscribed: (subscribed: SyncSubscribed): void => {
      for (const listener of subscribedListeners) {
        listener(subscribed);
      }
    },
    connect: async (): Promise<void> => {
      setConnected(true);
    },
    deliverDelta: (delta: SyncDelta): void => {
      for (const listener of deltaListeners) {
        listener(delta);
      }
    },
    disconnect: (): void => {
      setConnected(false);
    },
    disconnectWithAuthExpired: (): void => {
      connected = false;
      for (const listener of statusListeners) {
        listener({authExpired: true, connected: false});
      }
    },
    emitEvent: (event: string, ...args: unknown[]): void => {
      for (const handler of [...(eventListeners.get(event) ?? [])]) {
        handler(...args);
      }
    },
    eventListenerCount: (event: string): number => eventListeners.get(event)?.size ?? 0,
    onDelta: (callback: (delta: SyncDelta) => void): (() => void) => {
      deltaListeners.add(callback);
      return () => {
        deltaListeners.delete(callback);
      };
    },
    onEvent: (event: string, handler: SocketEventHandler): (() => void) => {
      if (isReservedSocketEvent(event)) {
        throw new Error(`onSocketEvent: "${event}" is reserved by the sync protocol`);
      }
      // Wrap so the same handler can be registered twice and removed independently.
      const listener: SocketEventHandler = (...args) => {
        handler(...args);
      };
      const listeners = eventListeners.get(event) ?? new Set<SocketEventHandler>();
      listeners.add(listener);
      eventListeners.set(event, listeners);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          eventListeners.delete(event);
        }
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
    respondBatchWith: (responder: FakeBatchResponder): void => {
      batchResponderQueue.push(responder);
    },
    respondWith: (responder: FakeMutationResponder): void => {
      responderQueue.push(responder);
    },
    respondWithAck: (overrides?: Partial<SyncAck>): void => {
      responderQueue.push((request) => {
        nextSeq += 1;
        return {
          ack: {
            id: request.id ?? `server-${nextSeq}`,
            mutationId: request.mutationId,
            seq: nextSeq,
            ...overrides,
          },
          type: "ack",
        };
      });
    },
    respondWithNack: (nack: Partial<SyncNack> & Pick<SyncNack, "code">): void => {
      responderQueue.push((request) => ({
        nack: {mutationId: request.mutationId, ...nack},
        type: "nack",
      }));
    },
    sendMutation: async (request: SyncMutateRequest): Promise<SendMutationResult> => {
      sentMutations.push(request);
      const responder = responderQueue.shift() ?? defaultResponder;
      return responder(request);
    },
    sendMutationBatch: async (
      request: SyncMutateBatchRequest
    ): Promise<SendMutationBatchResult> => {
      sentBatches.push(request.mutations.map((mutation) => mutation.mutationId));
      const responder = batchResponderQueue.shift() ?? batchResponder;
      return responder(request);
    },
    sentBatches,
    sentMutations,
    setBatchResponder: (responder?: FakeBatchResponder): void => {
      batchResponder = responder ?? autoAckBatch;
    },
    setConnected,
    setDefaultResponder: (responder?: FakeMutationResponder): void => {
      defaultResponder = responder ?? autoAck;
    },
    subscribe: (collections: string[], _options?: {mode?: "window"}): void => {
      for (const collection of collections) {
        subscribed.add(collection);
      }
    },
    get subscribedCollections(): string[] {
      return [...subscribed];
    },
  };
};
