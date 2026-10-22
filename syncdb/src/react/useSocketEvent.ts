import {useEffect, useRef} from "react";

import type {SyncDb} from "../client";
import type {SocketEventHandler} from "../sync/transport";
import {useOptionalSyncDbClient} from "./provider";

/** Anything that can bind a socket event listener; a `SyncDb` client qualifies. */
export type SocketEventSource = Pick<SyncDb, "onSocketEvent">;

export interface UseSocketEventOptions {
  /**
   * Event source. Omitted: the client from `SyncDbProvider` (throws when none is
   * mounted). `null`: listen to nothing (for example before login).
   */
  client?: SocketEventSource | null;
  /** Set `false` to unbind without changing hook order. Default `true`. */
  enabled?: boolean;
}

/**
 * Listen for an app-level server event on the syncdb socket while mounted. The
 * handler may change every render; the latest one is always called, and the
 * listener is rebound only when the event, client, or `enabled` changes.
 *
 * @example
 * ```tsx
 * useSocketEvent("announcementPublished", (payload) => {
 *   console.info("announcement", payload);
 * });
 * ```
 */
export const useSocketEvent = (
  event: string,
  handler: SocketEventHandler,
  options: UseSocketEventOptions = {}
): void => {
  const contextClient = useOptionalSyncDbClient();
  const hasOverride = "client" in options;
  const client = hasOverride ? (options.client ?? null) : contextClient;
  if (!hasOverride && !contextClient) {
    throw new Error(
      "useSocketEvent must be used within a <SyncDbProvider client={...}> or be given `client`."
    );
  }
  const enabled = options.enabled ?? true;
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  // Bind one listener per (client, event); it forwards to the latest handler so
  // callers do not need to memoize it.
  useEffect((): (() => void) | undefined => {
    if (!client || !enabled) {
      return undefined;
    }
    return client.onSocketEvent(event, (...args: unknown[]): void => {
      handlerRef.current(...args);
    });
  }, [client, enabled, event]);
};
