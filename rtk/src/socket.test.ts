import {afterEach, beforeEach, describe, expect, it, mock, setSystemTime} from "bun:test";
import {configureStore} from "@reduxjs/toolkit";
import {act, renderHook, waitFor} from "@testing-library/react-native";
import {DateTime} from "luxon";
import React from "react";
import {Provider} from "react-redux";

interface ToastCall {
  options?: {onDismiss?: () => void; persistent?: boolean; variant?: string};
  title: string;
}

const toastState = {
  hidden: [] as string[],
  nextId: 0,
  shown: [] as ToastCall[],
};

const toast = {
  hide: (id: string): void => {
    toastState.hidden.push(id);
  },
  show: (title: string, options?: ToastCall["options"]): string => {
    toastState.shown.push({options, title});
    toastState.nextId += 1;
    return `toast-${toastState.nextId}`;
  },
};

mock.module("@terreno/ui", () => ({useToast: () => toast}));

// Mutable async storage so each test can control what the real token helpers in emptyApi read.
// It returns null by default, matching the preload mock for the rest of the package.
const storage = new Map<string, string>();

mock.module("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string): Promise<string | null> => storage.get(key) ?? null,
    removeItem: async (key: string): Promise<void> => {
      storage.delete(key);
    },
    setItem: async (key: string, value: string): Promise<void> => {
      storage.set(key, value);
    },
  },
}));

type SocketHandler = (...args: unknown[]) => unknown;

interface MockSocket {
  auth: unknown;
  connect: () => void;
  connectCount: number;
  connected: boolean;
  disconnect: () => void;
  handlers: Map<string, SocketHandler[]>;
  off: (event: string, handler: SocketHandler) => void;
  on: (event: string, handler: SocketHandler) => void;
  options: Record<string, unknown>;
  trigger: (event: string, ...args: unknown[]) => Promise<void>;
  url: string;
}

const sockets: MockSocket[] = [];

const createMockSocket = (url: string, options: Record<string, unknown>): MockSocket => {
  const socket: MockSocket = {
    auth: undefined,
    connect: (): void => {
      socket.connectCount += 1;
      socket.connected = true;
    },
    connectCount: 0,
    connected: false,
    disconnect: (): void => {
      socket.connected = false;
    },
    handlers: new Map<string, SocketHandler[]>(),
    off: (event, handler): void => {
      socket.handlers.set(
        event,
        (socket.handlers.get(event) ?? []).filter((h) => h !== handler)
      );
    },
    on: (event, handler): void => {
      socket.handlers.set(event, [...(socket.handlers.get(event) ?? []), handler]);
    },
    options,
    trigger: async (event, ...args): Promise<void> => {
      for (const handler of socket.handlers.get(event) ?? []) {
        await handler(...args);
      }
    },
    url,
  };
  return socket;
};

mock.module("socket.io-client", () => ({
  io: (url: string, options: Record<string, unknown>): MockSocket => {
    const socket = createMockSocket(url, options);
    sockets.push(socket);
    return socket;
  },
}));

const realEmptyApi = await import("./emptyApi");
const tokenHelperState: {
  authRemainingSecs?: number;
  refreshError?: Error;
  refreshRemainingSecs?: number;
} = {};

mock.module("./emptyApi", () => ({
  ...realEmptyApi,
  getFriendlyExpirationInfo: async (): Promise<string> => "Auth token expires soon",
  getTokenExpirationTimes: async (): Promise<{
    authRemainingSecs?: number;
    refreshRemainingSecs?: number;
  }> => ({
    authRemainingSecs: tokenHelperState.authRemainingSecs,
    refreshRemainingSecs: tokenHelperState.refreshRemainingSecs,
  }),
  refreshAuthToken: async (): Promise<void> => {
    if (tokenHelperState.refreshError) {
      throw tokenHelperState.refreshError;
    }
  },
}));

const {useSocketConnection} = await import("./socket");

interface AuthTestState {
  lastTokenRefreshTimestamp: number | null;
}

const createStore = () =>
  configureStore({
    reducer: {
      auth: (
        state: AuthTestState = {lastTokenRefreshTimestamp: null},
        action: {payload?: number; type: string}
      ): AuthTestState =>
        action.type === "test/tokenRefreshed"
          ? {lastTokenRefreshTimestamp: action.payload ?? null}
          : state,
    },
  });

const createWrapper = (store: ReturnType<typeof createStore>) => {
  const Wrapper: React.FC<{children: React.ReactNode}> = ({children}) =>
    React.createElement(Provider, {children, store});
  return Wrapper;
};

/**
 * The token helpers in emptyApi only read from async storage in a browser environment, so the
 * tests that exercise the token refresh paths need a `window` global while they run.
 */
const withWindow = async (run: () => Promise<void>): Promise<void> => {
  const global = globalThis as {window?: unknown};
  global.window = globalThis;
  try {
    await run();
  } finally {
    Reflect.deleteProperty(global, "window");
  }
};

const renderSocket = (
  overrides: Partial<Parameters<typeof useSocketConnection>[0]> = {},
  store = createStore()
) => {
  const options = {
    baseUrl: "https://example.com",
    getAuthToken: async (): Promise<string | null> => "auth-token",
    shouldConnect: true,
    ...overrides,
  };
  const rendered = renderHook(() => useSocketConnection(options), {
    wrapper: createWrapper(store),
  });
  return {...rendered, store};
};

const lastSocket = (): MockSocket => {
  const socket = sockets[sockets.length - 1];
  if (!socket) {
    throw new Error("No socket was created");
  }
  return socket;
};

const setOnline = (onLine: boolean): void => {
  Object.defineProperty(globalThis, "navigator", {configurable: true, value: {onLine}});
};

describe("useSocketConnection", () => {
  const originalNavigator = globalThis.navigator;

  beforeEach(() => {
    setSystemTime();
    setOnline(true);
    sockets.length = 0;
    storage.clear();
    toastState.hidden = [];
    toastState.shown = [];
    toastState.nextId = 0;
    tokenHelperState.authRemainingSecs = undefined;
    tokenHelperState.refreshError = undefined;
    tokenHelperState.refreshRemainingSecs = undefined;
  });

  afterEach(() => {
    setSystemTime();
    storage.clear();
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: originalNavigator,
    });
  });

  it("uses only the transports the caller passes, for hosts without session affinity", async () => {
    renderSocket({transports: ["websocket"]});

    await waitFor(() => {
      expect(sockets).toHaveLength(1);
    });
    expect(lastSocket().options.transports).toEqual(["websocket"]);
  });

  it("keeps one socket when the caller passes an equal transports array each render", async () => {
    const {rerender} = renderHook(
      () =>
        useSocketConnection({
          baseUrl: "https://example.com",
          getAuthToken: async (): Promise<string | null> => "auth-token",
          shouldConnect: false,
          transports: ["websocket"],
        }),
      {wrapper: createWrapper(createStore())}
    );
    await waitFor(() => {
      expect(sockets).toHaveLength(1);
    });
    rerender({});
    rerender({});
    expect(sockets).toHaveLength(1);
  });

  it("creates a socket that does not auto connect and connects it with the auth token", async () => {
    const {result} = renderSocket();

    await waitFor(() => {
      expect(sockets).toHaveLength(1);
    });
    expect(lastSocket().options.autoConnect).toBe(false);
    expect(lastSocket().options.transports).toEqual(["polling", "websocket"]);
    await waitFor(() => {
      expect(lastSocket().auth).toEqual({token: "Bearer auth-token"});
    });
    expect(lastSocket().connected).toBe(true);
    expect(result.current.socket).toBe(lastSocket() as never);
    expect(result.current.isSocketConnected.isConnected).toBe(false);
  });

  it("does not connect when getAuthToken returns no token", async () => {
    renderSocket({getAuthToken: async () => null});

    await waitFor(() => {
      expect(sockets).toHaveLength(1);
    });
    expect(lastSocket().auth).toBeUndefined();
    expect(lastSocket().connected).toBe(false);
  });

  it("disconnects and clears connected state when shouldConnect is false", async () => {
    const {rerender, result} = renderHook(
      ({shouldConnect}: {shouldConnect: boolean}) =>
        useSocketConnection({
          baseUrl: "https://example.com",
          getAuthToken: async () => "auth-token",
          shouldConnect,
        }),
      {initialProps: {shouldConnect: true}, wrapper: createWrapper(createStore())}
    );

    await act(async () => {
      await lastSocket().trigger("connect");
    });
    expect(result.current.isSocketConnected.isConnected).toBe(true);

    await act(async () => {
      rerender({shouldConnect: false});
    });
    expect(lastSocket().connected).toBe(false);
    expect(result.current.isSocketConnected.isConnected).toBe(false);
  });

  it("tears the socket down when the base url changes", async () => {
    const {rerender} = renderHook(
      ({baseUrl}: {baseUrl: string}) =>
        useSocketConnection({
          baseUrl,
          getAuthToken: async () => "auth-token",
          shouldConnect: true,
        }),
      {initialProps: {baseUrl: "https://example.com"}, wrapper: createWrapper(createStore())}
    );

    await waitFor(() => {
      expect(sockets).toHaveLength(1);
    });
    const first = lastSocket();

    await act(async () => {
      rerender({baseUrl: "https://other.example.com"});
    });

    expect(sockets).toHaveLength(2);
    expect(first.connected).toBe(false);
    expect(lastSocket().url).toBe("https://other.example.com");
  });

  it("calls onConnect and skips the reconnected toast on a fast reconnect", async () => {
    const onConnect = mock(() => {});
    const {result} = renderSocket({onConnect});

    await act(async () => {
      await lastSocket().trigger("connect");
    });

    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(result.current.isSocketConnected.isConnected).toBe(true);
    expect(toastState.shown).toHaveLength(0);
  });

  it("shows a reconnected toast when the outage lasted more than ten seconds", async () => {
    const {result} = renderSocket();

    await act(async () => {
      await lastSocket().trigger("disconnect", "transport close");
    });
    expect(result.current.isSocketConnected.lastDisconnectedAt).not.toBeNull();

    setSystemTime(DateTime.now().plus({seconds: 15}).toJSDate());
    await act(async () => {
      await lastSocket().trigger("connect");
    });

    expect(toastState.shown.map((t) => t.title)).toContain("You have been reconnected.");
  });

  it("captures the disconnect event and calls onDisconnect", async () => {
    const captureEvent = mock((_event: string, _data: Record<string, unknown>) => {});
    const onDisconnect = mock(() => {});
    renderSocket({captureEvent, onDisconnect});

    await act(async () => {
      await lastSocket().trigger("disconnect", "io server disconnect");
    });

    expect(captureEvent).toHaveBeenCalledTimes(1);
    expect(captureEvent.mock.calls[0][0]).toBe("WebSocket Disconnection");
    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });

  it("ignores connect errors while the browser is offline", async () => {
    const captureEvent = mock((_event: string, _data: Record<string, unknown>) => {});
    const onConnectError = mock(() => {});
    renderSocket({captureEvent, onConnectError});

    setOnline(false);
    await act(async () => {
      await lastSocket().trigger("connect_error", new Error("offline"));
    });

    expect(captureEvent).not.toHaveBeenCalled();
    expect(onConnectError).not.toHaveBeenCalled();
  });

  it("captures connect errors and calls onConnectError while online", async () => {
    const captureEvent = mock((_event: string, _data: Record<string, unknown>) => {});
    const onConnectError = mock(() => {});
    renderSocket({captureEvent, onConnectError});

    await act(async () => {
      await lastSocket().trigger("connect_error", new Error("handshake failed"));
    });

    expect(captureEvent.mock.calls.map((call) => call[0])).toContain("WebSocket Connection Error");
    expect(onConnectError).toHaveBeenCalledTimes(1);
  });

  it("shows a token error toast when refreshing the token fails", async () => {
    tokenHelperState.authRemainingSecs = 10;
    tokenHelperState.refreshError = new Error("Refresh request failed");
    tokenHelperState.refreshRemainingSecs = 3600;
    const captureEvent = mock((_event: string, _data: Record<string, unknown>) => {});

    await withWindow(async () => {
      renderSocket({captureEvent});
      await act(async () => {
        await lastSocket().trigger("disconnect", "transport error");
      });
      // While the token error toast is up, the disconnected toast poll stays quiet.
      await new Promise((resolve) => setTimeout(resolve, 1200));
    });

    expect(toastState.shown.map((t) => t.title.slice(0, 20))).not.toContain("You have been discon");
    const tokenErrorToast = toastState.shown.find((t) => t.title.startsWith("Error refreshing"));
    expect(tokenErrorToast).toBeDefined();
    expect(tokenErrorToast?.options?.persistent).toBe(true);
    expect(tokenErrorToast?.options?.variant).toBe("error");

    // Dismissing the toast clears it so it can be shown again later.
    act(() => {
      tokenErrorToast?.options?.onDismiss?.();
    });
    expect(toastState.hidden).toHaveLength(1);
  });

  it("captures the refresh failure when the refresh token is still valid", async () => {
    tokenHelperState.authRemainingSecs = 10;
    tokenHelperState.refreshError = new Error("Refresh request failed");
    tokenHelperState.refreshRemainingSecs = 3600;
    const captureEvent = mock((_event: string, _data: Record<string, unknown>) => {});

    await withWindow(async () => {
      renderSocket({captureEvent});
      await act(async () => {
        await lastSocket().trigger("connect_error", new Error("handshake failed"));
      });
      await waitFor(() => {
        expect(captureEvent.mock.calls.map((call) => call[0])).toContain(
          "WebSocket Token Check/Refresh Error on ConnectError"
        );
      });
    });
  });

  it("reconnects and dismisses the error toast when a token refresh is dispatched", async () => {
    tokenHelperState.authRemainingSecs = 10;
    tokenHelperState.refreshError = new Error("Refresh request failed");
    tokenHelperState.refreshRemainingSecs = 3600;
    const store = createStore();

    await withWindow(async () => {
      renderSocket({}, store);
      await act(async () => {
        await lastSocket().trigger("disconnect", "transport error");
      });
    });
    expect(toastState.shown.some((t) => t.title.startsWith("Error refreshing"))).toBe(true);

    const connectCountBefore = lastSocket().connectCount;
    lastSocket().disconnect();
    await act(async () => {
      store.dispatch({payload: Date.now(), type: "test/tokenRefreshed"});
    });

    expect(toastState.hidden).toHaveLength(1);
    await waitFor(() => {
      expect(lastSocket().connectCount).toBeGreaterThan(connectCountBefore);
    });
  });

  it("shows and hides the disconnected toast while reconnecting", async () => {
    const {result} = renderSocket();

    await act(async () => {
      await lastSocket().trigger("disconnect", "transport close");
    });

    // The toast only appears once the outage is older than nine seconds.
    setSystemTime(DateTime.now().plus({seconds: 12}).toJSDate());
    await waitFor(
      () => {
        expect(toastState.shown.some((t) => t.title.startsWith("You have been disconnected"))).toBe(
          true
        );
      },
      {timeout: 4000}
    );

    const disconnectedToast = toastState.shown.find((t) =>
      t.title.startsWith("You have been disconnected")
    );
    act(() => {
      disconnectedToast?.options?.onDismiss?.();
    });
    expect(toastState.hidden).toHaveLength(1);

    await act(async () => {
      await lastSocket().trigger("connect");
    });
    expect(result.current.isSocketConnected.isConnected).toBe(true);
  });

  it("forces a new connection after reconnect_failed", async () => {
    const captureEvent = mock((_event: string, _data: Record<string, unknown>) => {});
    const onReconnectFailed = mock(() => {});
    renderSocket({captureEvent, onReconnectFailed});

    await act(async () => {
      await lastSocket().trigger("reconnect_failed");
    });

    expect(captureEvent.mock.calls.map((call) => call[0])).toContain("WebSocket Reconnect Failed");
    expect(onReconnectFailed).toHaveBeenCalledTimes(1);
    // The forced reconnect is scheduled two seconds later.
    expect(lastSocket().connected).toBe(false);
    await waitFor(
      () => {
        expect(lastSocket().connectCount).toBeGreaterThan(1);
      },
      {timeout: 5000}
    );
  });

  it("does not force a reconnect after reconnect_failed when shouldConnect is false", async () => {
    renderSocket({getAuthToken: async () => "auth-token", shouldConnect: false});

    await act(async () => {
      await lastSocket().trigger("reconnect_failed");
    });

    await new Promise((resolve) => setTimeout(resolve, 2200));
    expect(lastSocket().connectCount).toBe(0);
  });

  it("reconnects the socket after a successful token refresh on disconnect", async () => {
    tokenHelperState.authRemainingSecs = 10;
    tokenHelperState.refreshRemainingSecs = 3600;

    await withWindow(async () => {
      renderSocket();
      await waitFor(() => {
        expect(sockets).toHaveLength(1);
      });
      lastSocket().disconnect();
      const connectCountBefore = lastSocket().connectCount;

      await act(async () => {
        await lastSocket().trigger("disconnect", "transport error");
      });

      expect(lastSocket().connectCount).toBeGreaterThan(connectCountBefore);
    });
    expect(toastState.shown.some((t) => t.title.startsWith("Error refreshing"))).toBe(false);
  });

  it("skips the forced reconnect when the socket was torn down before the timer fired", async () => {
    const {unmount} = renderSocket();

    await act(async () => {
      await lastSocket().trigger("reconnect_failed");
    });
    const connectCountAfterEvent = lastSocket().connectCount;
    unmount();

    await new Promise((resolve) => setTimeout(resolve, 2200));
    expect(lastSocket().connectCount).toBe(connectCountAfterEvent);
  });

  it("does not force a reconnect after reconnect_failed when the socket reconnected", async () => {
    renderSocket();

    await act(async () => {
      await lastSocket().trigger("reconnect_failed");
      await lastSocket().trigger("connect");
    });
    const connectCountAfterEvents = lastSocket().connectCount;

    await new Promise((resolve) => setTimeout(resolve, 2200));
    expect(lastSocket().connectCount).toBe(connectCountAfterEvents);
  });
});
