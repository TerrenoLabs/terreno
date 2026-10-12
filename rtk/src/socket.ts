import {useToast} from "@terreno/ui";
import {DateTime} from "luxon";
import {useCallback, useEffect, useRef, useState} from "react";
import {useSelector} from "react-redux";
import {io, type Socket} from "socket.io-client";
import {selectLastTokenRefreshTimestamp} from "./authSlice";
import {logAuth} from "./constants";
import {getFriendlyExpirationInfo, getTokenExpirationTimes, refreshAuthToken} from "./emptyApi";

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
  getAuthToken: () => Promise<string | null>;
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

export const useSocketConnection = ({
  baseUrl,
  onConnect,
  onDisconnect,
  onConnectError,
  onReconnectFailed,
  getAuthToken,
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
    const token = await getAuthToken();

    if (!token) {
      console.warn(
        "[SocketConnection] Attempting to connect socket, but getAuthToken returned no token."
      );
      // Don't capture this event because it's expected when the user is logged out.
      return;
    } else {
      logAuth("[SocketConnection] Token received from getAuthToken.");
    }

    if (socketRef.current) {
      const socketInstance = socketRef.current;
      // Enhanced logging for Option 1 (token status)
      logAuth(
        `[SocketConnection] Socket connecting ${token ? "with" : "without"} token. Current socket state: ${socketInstance.connected ? "connected" : "disconnected"}`
      );
      socketInstance.auth = {token: `Bearer ${token}`};
      socketInstance.connect();
    } else {
      logAuth("[SocketConnection] connectSocket skipped — socket not initialized yet.");
    }
  }, [getAuthToken]);

  // Extracted logic for checking token expiration, refreshing token, and handling related UI
  const checkAndRefreshTokenLogic = useCallback(
    async (context: "disconnect" | "connect_error"): Promise<void> => {
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
        }
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
      }
    },
    [shouldConnect, captureEvent, hideDisconnectedToast, toast, hideTokenErrorToast]
  );

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

    const handleConnect = (): void => {
      logAuth("[SocketConnection] Socket connected");
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
      const tokenInfo = await getFriendlyExpirationInfo();

      // Enhanced logging for Option 1 (disconnect reason)
      logAuth(
        `[SocketConnection] Socket disconnected, reason: ${reason}, token status: ${tokenInfo}`
      );
      setIsSocketConnected({
        isConnected: false,
        lastDisconnectedAt: DateTime.now().toISO(),
      });

      captureEvent?.("WebSocket Disconnection", {
        reason,
        time: DateTime.now().toISO(),
        tokenInfo,
      });

      // Check token status on disconnect
      await checkAndRefreshTokenLogic("disconnect");

      await onDisconnect?.();
    };

    const handleConnectError = async (connectionError: Error): Promise<void> => {
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

      // Check token status on connect_error
      await checkAndRefreshTokenLogic("connect_error");

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
  ]);

  return {isSocketConnected, socket};
};
