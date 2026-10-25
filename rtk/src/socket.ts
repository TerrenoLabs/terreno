import type {AuthProvider} from "@terreno/syncdb";
import {useToast} from "@terreno/ui";
import {DateTime} from "luxon";
import {useCallback, useEffect, useRef, useState} from "react";
import {useSelector} from "react-redux";
import {io, type Socket} from "socket.io-client";
import {selectLastTokenRefreshTimestamp} from "./authSlice";
import {logAuth, logSocket} from "./constants";
import {
  getFriendlyExpirationInfo,
  getTokenExpirationTimes,
  isJwtTokenSource,
  jwtTokenSource,
  refreshAuthToken,
} from "./emptyApi";
import {getTokenSource} from "./tokenSource";

export interface SocketConnection {
  isConnected: boolean;
  lastDisconnectedAt: string | null;
}

export interface UseSocketConnectionOptions {
  baseUrl: string;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onConnectError?: (error: Error) => void;
  onReconnectFailed?: () => void;
  /**
   * Reads the token for the handshake. When passed, the hook keeps its legacy behavior: it
   * reads the token once per `connectSocket` call, sends it as a static `auth` payload, and
   * refreshes the JWT when it is near expiry. Omit it to use a token source instead (see
   * `tokenSource`).
   */
  getAuthToken?: () => Promise<string | null>;
  /**
   * Token source the hook reads when `getAuthToken` is omitted. Defaults to the source
   * registered with `setTokenSource`, else the built-in JWT source. The handshake re-reads
   * `getToken()` on every connect and reconnect. On an auth `connect_error` the hook calls
   * `refresh()` once and reconnects; a second auth failure before a successful connect stops
   * reconnecting and calls `onConnectError`. When `onAuthChange` fires with a different token, it
   * drops a live connection and reconnects with the new token; with no token it disconnects.
   * Pass a stable reference (not a new object per render) so the hook does not re-subscribe.
   */
  tokenSource?: AuthProvider;
  shouldConnect: boolean;
  captureEvent?: (eventName: string, data: Record<string, unknown>) => void;
  /**
   * Socket.io transports, in order. Defaults to polling then websocket. Pass `["websocket"]`
   * for hosts without session affinity, such as Vercel Functions, where a polling request
   * can land on a different instance than the one holding the session.
   */
  transports?: string[];
}

const DEFAULT_TRANSPORTS = ["polling", "websocket"];

/** How the JWT expiry check ended: it refreshed, its refresh failed, or nothing was due. */
type ExpiryCheckResult = "refreshed" | "failed" | "skipped";

/** Refresh state for consecutive auth failures; a successful connect starts a new episode. */
interface AuthFailureEpisode {
  hasRefreshed: boolean;
  isRefreshing: boolean;
  isStopped: boolean;
}

const newAuthFailureEpisode = (): AuthFailureEpisode => ({
  hasRefreshed: false,
  isRefreshing: false,
  isStopped: false,
});

/** True when the server's socket auth middleware rejected the handshake. */
const isAuthConnectError = (error: Error): boolean => {
  const data = (error as Error & {data?: unknown}).data;
  return (
    typeof data === "object" &&
    data !== null &&
    (data as {type?: unknown}).type === "UnauthorizedError"
  );
};

export const useSocketConnection = ({
  baseUrl,
  onConnect,
  onDisconnect,
  onConnectError,
  onReconnectFailed,
  getAuthToken,
  tokenSource,
  shouldConnect, // Whether we have a logged in user.
  captureEvent,
  transports = DEFAULT_TRANSPORTS,
}: UseSocketConnectionOptions): {
  socket: Socket | null;
  isSocketConnected: SocketConnection;
} => {
  const toast = useToast();
  const socketRef = useRef<Socket | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const isConnectedRef = useRef<SocketConnection>(undefined);
  const [isSocketConnected, setIsSocketConnected] = useState<SocketConnection>({
    isConnected: socket?.connected ?? false,
    lastDisconnectedAt: null,
  });
  const disconnectedToastId = useRef<string | null>(null);
  const tokenErrorToastId = useRef<string | null>(null);
  const authFailureEpisodeRef = useRef<AuthFailureEpisode>(newAuthFailureEpisode());

  // Without a getAuthToken getter the hook reads a token source, and the JWT expiry check only
  // applies while that source is the JWT one.
  const usesTokenSource = !getAuthToken;
  const source = usesTokenSource
    ? (tokenSource ?? getTokenSource() ?? jwtTokenSource)
    : jwtTokenSource;
  // The token the last token-source handshake sent, so an auth change that leaves it unchanged
  // keeps a live connection.
  const lastHandshakeTokenRef = useRef<string | null>(null);
  // Set while the hook drops a live connection to rotate its token, so that planned disconnect
  // is not captured as an outage.
  const isRotatingTokenRef = useRef(false);
  // Set from the moment a token-source handshake sends CONNECT until it connects, fails, or the
  // hook drops it. socket.io-client's connect() re-sends CONNECT while the manager is open, so an
  // auth change in that window waits in deferredAuthChangeRef until the handshake settles.
  const isHandshakingRef = useRef(false);
  const deferredAuthChangeRef = useRef<(() => void) | null>(null);
  const runsJwtExpiryCheck = !usesTokenSource || isJwtTokenSource(source);

  // Keep ref updated with latest socket connection state
  useEffect(() => {
    isConnectedRef.current = isSocketConnected;
  }, [isSocketConnected]);

  // Compare by value so a caller passing a fresh array each render keeps the same socket.
  const transportsKey = transports.join(",");

  // Initialize socket connection
  useEffect(() => {
    const socketIo = io(baseUrl, {
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      // The default starts with polling so dev server restarts don't fail the initial
      // websocket-only handshake; Socket.io upgrades to websocket once connected.
      transports: transportsKey.split(","),
    });

    socketRef.current = socketIo;
    authFailureEpisodeRef.current = newAuthFailureEpisode();
    isHandshakingRef.current = false;
    deferredAuthChangeRef.current = null;
    setSocket(socketIo);

    return (): void => {
      socketIo.disconnect();
      socketRef.current = null;
    };
  }, [baseUrl, transportsKey]);

  const hideDisconnectedToast = useCallback((): void => {
    if (disconnectedToastId.current) {
      toast.hide(disconnectedToastId.current);
      disconnectedToastId.current = null;
    }
  }, [toast]);

  const hideTokenErrorToast = useCallback((): void => {
    if (tokenErrorToastId.current) {
      toast.hide(tokenErrorToastId.current);
      tokenErrorToastId.current = null;
    }
  }, [toast]);

  // Connect the socket with the current auth token
  const connectSocket = useCallback(async (): Promise<void> => {
    if (!getAuthToken && authFailureEpisodeRef.current.isStopped) {
      logSocket(
        undefined,
        "[SocketConnection] connectSocket skipped — auth failed and the token could not be refreshed."
      );
      return;
    }

    const token = getAuthToken ? await getAuthToken() : await source.getToken();

    if (!token) {
      console.warn(
        `[SocketConnection] Attempting to connect socket, but ${getAuthToken ? "getAuthToken" : "the token source"} returned no token.`
      );
      // Don't capture this event because it's expected when the user is logged out.
      return;
    } else {
      logAuth(
        `[SocketConnection] Token received from ${getAuthToken ? "getAuthToken" : "the token source"}.`
      );
    }

    if (socketRef.current) {
      const socketInstance = socketRef.current;
      // Enhanced logging for Option 1 (token status)
      logAuth(
        `[SocketConnection] Socket connecting ${token ? "with" : "without"} token. Current socket state: ${socketInstance.connected ? "connected" : "disconnected"}`
      );
      if (getAuthToken) {
        socketInstance.auth = {token: `Bearer ${token}`};
      } else {
        // socket.io-client calls this on every handshake, including its own reconnects, so each
        // attempt carries the source's current token.
        socketInstance.auth = (sendAuth: (data: object) => void): void => {
          isHandshakingRef.current = true;
          source.getToken().then(
            (currentToken) => {
              lastHandshakeTokenRef.current = currentToken;
              sendAuth(currentToken ? {token: `Bearer ${currentToken}`} : {});
            },
            () => {
              lastHandshakeTokenRef.current = null;
              sendAuth({});
            }
          );
        };
      }
      socketInstance.connect();
    } else {
      logAuth("[SocketConnection] connectSocket skipped — socket not initialized yet.");
    }
  }, [getAuthToken, source]);

  // Extracted logic for checking token expiration, refreshing token, and handling related UI
  const checkAndRefreshTokenLogic = useCallback(
    async (context: "disconnect" | "connect_error"): Promise<ExpiryCheckResult> => {
      let authRemainingSecs: number | undefined;
      let refreshRemainingSecs: number | undefined;
      try {
        const expirationTimes = await getTokenExpirationTimes();
        authRemainingSecs = expirationTimes.authRemainingSecs;
        refreshRemainingSecs = expirationTimes.refreshRemainingSecs;
        logAuth(
          `[SocketConnection] Token status on ${context}: authRemainingSecs: ${authRemainingSecs}, refreshRemainingSecs: ${refreshRemainingSecs}`
        );
        if (
          (authRemainingSecs !== undefined && authRemainingSecs < 60) ||
          (refreshRemainingSecs !== undefined && refreshRemainingSecs < 60)
        ) {
          logAuth(
            `[SocketConnection] Auth or refresh token nearing expiration or expired on ${context}, attempting refresh.`
          );
          await refreshAuthToken();
          // Attempt to reconnect after token refresh
          const socketInstance = socketRef.current;
          if (shouldConnect && socketInstance && !socketInstance.connected) {
            logAuth(
              `[SocketConnection] Attempting to reconnect socket after token refresh due to ${context}.`
            );
            socketInstance.connect();
          }
          return "refreshed";
        }
        return "skipped";
      } catch (error) {
        const socketError = error as Error;
        console.error(
          `[SocketConnection] Error checking/refreshing token on ${context}:`,
          socketError
        );
        if (refreshRemainingSecs !== undefined && refreshRemainingSecs > 0) {
          const tokenInfo = await getFriendlyExpirationInfo();
          // Only capture this event if the refresh token is still valid,
          // otherwise it's expected it will fail.
          captureEvent?.(
            `WebSocket Token Check/Refresh Error on ${context === "disconnect" ? "Disconnect" : "ConnectError"}`,
            {
              authRemainingSecs,
              error: socketError.message,
              refreshRemainingSecs,
              time: DateTime.now().toISO(),
              tokenInfo,
            }
          );
        }
        hideDisconnectedToast();
        if (!tokenErrorToastId.current) {
          tokenErrorToastId.current = toast.show(
            "Error refreshing token. Please log out and log back in if reconnections fail. Your work may not be saved if you continue.",
            {
              onDismiss: (): void => hideTokenErrorToast(),
              persistent: true,
              variant: "error",
            }
          );
        }
        return "failed";
      }
    },
    [shouldConnect, captureEvent, hideDisconnectedToast, toast, hideTokenErrorToast]
  );

  // The one refresh of an auth-failure episode: the JWT expiry check on the JWT source, else the
  // source's refresh(), then a reconnect with the refreshed token.
  const refreshForEpisode = useCallback(
    async (episode: AuthFailureEpisode, stop: (reason: string) => void): Promise<void> => {
      // On the JWT source the expiry check runs as it always has; when it refreshes (and
      // reconnects) or fails, that is this episode's refresh.
      const expiryCheck: ExpiryCheckResult = runsJwtExpiryCheck
        ? await checkAndRefreshTokenLogic("connect_error")
        : "skipped";
      if (expiryCheck === "refreshed") {
        return;
      }
      if (expiryCheck === "failed") {
        stop("the token refresh failed.");
        return;
      }

      let isRefreshed = false;
      try {
        isRefreshed = source.refresh ? await source.refresh() : false;
      } catch (error) {
        logSocket(
          undefined,
          `[SocketConnection] Token source refresh threw: ${(error as Error).message}`
        );
      }
      if (!isRefreshed) {
        stop("the token source could not refresh the token.");
        return;
      }
      if (shouldConnect && !episode.isStopped) {
        logSocket(undefined, "[SocketConnection] Reconnecting after a token source refresh.");
        await connectSocket();
      }
    },
    [checkAndRefreshTokenLogic, connectSocket, runsJwtExpiryCheck, shouldConnect, source]
  );

  // Refresh once per auth-failure episode; a second failure before a successful connect stops
  // reconnecting so a server that keeps rejecting the token is not hammered.
  const handleAuthFailure = useCallback(
    async (connectionError: Error): Promise<void> => {
      const episode = authFailureEpisodeRef.current;
      const stop = (reason: string): void => {
        episode.isStopped = true;
        console.warn(`[SocketConnection] Not reconnecting: ${reason}`);
        onConnectError?.(connectionError);
      };

      // A handshake that started before the in-flight refresh finished carried the old token;
      // the refresh decides this episode.
      if (episode.isRefreshing) {
        return;
      }
      if (episode.hasRefreshed) {
        stop("the server rejected the refreshed token.");
        return;
      }
      episode.hasRefreshed = true;
      episode.isRefreshing = true;
      try {
        await refreshForEpisode(episode, stop);
      } finally {
        episode.isRefreshing = false;
      }
    },
    [onConnectError, refreshForEpisode]
  );

  // Reconnect with the source's new token whenever it reports an auth change
  useEffect(() => {
    if (!usesTokenSource || !shouldConnect) {
      return;
    }
    const handleAuthChange = async (): Promise<void> => {
      let token: string | null = null;
      try {
        token = await source.getToken();
      } catch {
        token = null;
      }
      const socketInstance = socketRef.current;
      if (!socketInstance) {
        return;
      }
      // The in-flight handshake reads the source's token itself; connecting now would send a
      // second CONNECT. Check again once it settles, in case it carried the old token.
      if (isHandshakingRef.current) {
        deferredAuthChangeRef.current = (): void => {
          void handleAuthChange();
        };
        return;
      }
      // Sources such as betterAuthAdapter emit on subscribe and on unrelated session reads; a
      // live connection that already carries this token stays up.
      if (socketInstance.connected && token && token === lastHandshakeTokenRef.current) {
        return;
      }
      if (socketInstance.connected) {
        logSocket(undefined, "[SocketConnection] Auth changed, reconnecting with the new token.");
        isRotatingTokenRef.current = true;
        socketInstance.disconnect();
      }
      if (!token) {
        return;
      }
      authFailureEpisodeRef.current.isStopped = false;
      await connectSocket();
    };
    const unsubscribe = source.onAuthChange((): void => {
      void handleAuthChange();
    });
    return (): void => {
      unsubscribe();
      deferredAuthChangeRef.current = null;
    };
  }, [connectSocket, shouldConnect, source, usesTokenSource]);

  // Use Redux state for token refresh signal
  const lastTokenRefreshTimestamp = useSelector(selectLastTokenRefreshTimestamp);
  const previousTokenRefreshTimestampRef = useRef<number | null>(null);

  // Effect to handle token refresh events from Redux state
  useEffect(() => {
    if (
      lastTokenRefreshTimestamp &&
      lastTokenRefreshTimestamp !== previousTokenRefreshTimestampRef.current
    ) {
      if (tokenErrorToastId.current) {
        logAuth(
          "[SocketConnection] Token refresh detected via Redux state, dismissing error toast and attempting reconnect."
        );
        hideTokenErrorToast();
      }
      if (shouldConnect && !socket?.connected) {
        logAuth(
          "[SocketConnection] Attempting to connect socket after token refresh detected via Redux state."
        );
        void connectSocket();
      }
    }
    previousTokenRefreshTimestampRef.current = lastTokenRefreshTimestamp;
  }, [lastTokenRefreshTimestamp, socket, shouldConnect, connectSocket, hideTokenErrorToast]);

  // Connect/disconnect socket based on shouldConnect flag (waits until socket is initialized)
  useEffect(() => {
    if (!socket) {
      return;
    }

    if (shouldConnect) {
      if (!isSocketConnected.isConnected) {
        logAuth(
          `[SocketConnection] Attempting to connect socket because shouldConnect is true and socket is not connected.`
        );
        void connectSocket();
      } else {
        logAuth(
          `[SocketConnection] Socket is already connected and shouldConnect is true. No action needed.`
        );
      }
    } else {
      logAuth(`[SocketConnection] Disconnecting socket because shouldConnect is false.`);
      authFailureEpisodeRef.current = newAuthFailureEpisode();
      // disconnect() on an unanswered handshake emits nothing, so clear it here.
      isHandshakingRef.current = false;
      socket?.disconnect();
      if (isSocketConnected.isConnected) {
        setIsSocketConnected({
          isConnected: false,
          lastDisconnectedAt: null,
        });
      }
    }
  }, [connectSocket, shouldConnect, isSocketConnected, socket]);

  // Show toast when disconnected
  useEffect(() => {
    if (!shouldConnect) {
      return;
    }

    const checkShowToast = async (): Promise<void> => {
      // if there is an error toast, don't show the disconnect toast
      if (tokenErrorToastId.current) {
        return;
      }
      const shouldShowDisconnectToast =
        !isConnectedRef.current?.isConnected &&
        isConnectedRef.current?.lastDisconnectedAt &&
        DateTime.now().diff(DateTime.fromISO(isConnectedRef.current.lastDisconnectedAt), "seconds")
          .seconds > 9;

      if (shouldShowDisconnectToast && !disconnectedToastId.current) {
        disconnectedToastId.current = toast.show(
          "You have been disconnected. Attempting to reconnect...",
          {
            onDismiss: (): void => hideDisconnectedToast(),
            persistent: true,
          }
        );
      } else if (!shouldShowDisconnectToast && disconnectedToastId.current) {
        // If we should no longer show the toast but it is still showing, hide it
        hideDisconnectedToast();
      }
    };

    let intervalId: ReturnType<typeof setInterval> | null = null;

    // Check every second if we've reconnected
    const startCheckingConnection = (): void => {
      if (!isConnectedRef.current?.isConnected && !intervalId) {
        intervalId = setInterval(async () => {
          await checkShowToast();
          if (isConnectedRef.current?.isConnected && intervalId) {
            clearInterval(intervalId);
            intervalId = null;
          }
        }, 1000);
      }
    };

    startCheckingConnection();

    return (): void => {
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [hideDisconnectedToast, shouldConnect, toast]);

  // Set up basic socket event listeners
  useEffect(() => {
    if (!socket) return;

    // The handshake is over; run an auth change that arrived while it was in flight. Returns
    // whether one ran.
    const settleHandshake = (): boolean => {
      isHandshakingRef.current = false;
      const deferredAuthChange = deferredAuthChangeRef.current;
      deferredAuthChangeRef.current = null;
      deferredAuthChange?.();
      return Boolean(deferredAuthChange);
    };

    const handleConnect = (): void => {
      logAuth("[SocketConnection] Socket connected");
      settleHandshake();
      authFailureEpisodeRef.current = newAuthFailureEpisode();
      hideDisconnectedToast();
      hideTokenErrorToast();

      // don't show toast if was disconnected and now connected within 10 seconds
      if (
        isSocketConnected.lastDisconnectedAt &&
        DateTime.now().diff(DateTime.fromISO(isSocketConnected.lastDisconnectedAt), "seconds")
          .seconds > 10
      ) {
        toast.show("You have been reconnected.");
      }

      setIsSocketConnected({
        isConnected: true,
        lastDisconnectedAt: null,
      });

      onConnect?.();
    };

    const handleDisconnect = async (reason: Socket.DisconnectReason): Promise<void> => {
      // A planned token rotation is not an outage worth reporting. Read the flag before any
      // await so it belongs to this disconnect.
      const isRotating = isRotatingTokenRef.current;
      isRotatingTokenRef.current = false;
      settleHandshake();
      const tokenInfo = await getFriendlyExpirationInfo();

      // Enhanced logging for Option 1 (disconnect reason)
      logAuth(
        `[SocketConnection] Socket disconnected, reason: ${reason}, token status: ${tokenInfo}`
      );
      setIsSocketConnected({
        isConnected: false,
        lastDisconnectedAt: DateTime.now().toISO(),
      });

      if (!isRotating) {
        captureEvent?.("WebSocket Disconnection", {
          reason,
          time: DateTime.now().toISO(),
          tokenInfo,
        });
      }

      // Check token status on disconnect
      if (runsJwtExpiryCheck) {
        await checkAndRefreshTokenLogic("disconnect");
      }

      await onDisconnect?.();
    };

    const handleConnectError = async (connectionError: Error): Promise<void> => {
      const didRunDeferredAuthChange = settleHandshake();
      const tokenInfo = await getFriendlyExpirationInfo();
      const browserOffline = typeof navigator !== "undefined" && !navigator.onLine;

      if (browserOffline) {
        logAuth(
          `[SocketConnection] Socket connection skipped while offline: ${connectionError.message}`
        );
        return;
      }

      console.error(
        "[SocketConnection] Socket connection error:",
        connectionError,
        "Token status:",
        tokenInfo
      );
      captureEvent?.("WebSocket Connection Error", {
        error: connectionError.message,
        time: DateTime.now().toISO(),
        tokenInfo,
      });

      if (usesTokenSource && isAuthConnectError(connectionError)) {
        // The rejected handshake carried the token from before the auth change, which is already
        // reconnecting with the new one; a refresh now would send a second CONNECT.
        if (didRunDeferredAuthChange) {
          return;
        }
        await handleAuthFailure(connectionError);
        return;
      }

      // Check token status on connect_error
      if (runsJwtExpiryCheck) {
        await checkAndRefreshTokenLogic("connect_error");
      }

      onConnectError?.(connectionError);
    };

    const handleReconnectFailed = async (): Promise<void> => {
      const tokenInfo = await getFriendlyExpirationInfo();

      console.error(
        "[SocketConnection] Socket reconnection failed after exhausting reconnection attempts.",
        "Token status:",
        tokenInfo
      );
      captureEvent?.("WebSocket Reconnect Failed", {
        time: DateTime.now().toISO(),
        tokenInfo,
      });

      // Force a new connection attempt
      isHandshakingRef.current = false;
      socket.disconnect();
      setTimeout(() => {
        // Check shouldConnect and if still disconnected using the ref for the most current state
        if (shouldConnect && isConnectedRef.current && !isConnectedRef.current.isConnected) {
          logAuth(
            "[SocketConnection] Attempting to force a new connection after reconnect_failed event."
          );
          void connectSocket();
        } else if (!shouldConnect) {
          logAuth(
            "[SocketConnection] Not attempting to reconnect after reconnect_failed because shouldConnect is false."
          );
        } else if (isConnectedRef.current?.isConnected) {
          logAuth(
            "[SocketConnection] Not attempting to reconnect after reconnect_failed because socket is now connected."
          );
        }
      }, 2000);
      onReconnectFailed?.();
    };

    // Attach event listeners
    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("connect_error", handleConnectError);
    socket.on("reconnect_failed", handleReconnectFailed);

    return (): void => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("connect_error", handleConnectError);
      socket.off("reconnect_failed", handleReconnectFailed);
    };
  }, [
    socket,
    hideDisconnectedToast,
    isSocketConnected.lastDisconnectedAt,
    captureEvent,
    onConnect,
    onDisconnect,
    onConnectError,
    onReconnectFailed,
    shouldConnect,
    connectSocket,
    toast,
    hideTokenErrorToast,
    checkAndRefreshTokenLogic,
    handleAuthFailure,
    runsJwtExpiryCheck,
    usesTokenSource,
  ]);

  return {isSocketConnected, socket};
};
