import {afterEach, beforeEach, describe, expect, it, mock, setSystemTime} from "bun:test";
import type {AuthProvider} from "@terreno/syncdb";
import {DateTime} from "luxon";

// ---------------------------------------------------------------------------
// Controllable state that tests tweak between runs
// ---------------------------------------------------------------------------
let authToken: string | null = "auth-token";
const getAuthToken = mock(async (): Promise<string | null> => authToken);

let expirationTimes: {authRemainingSecs?: number; refreshRemainingSecs?: number} = {
  authRemainingSecs: 3600,
  refreshRemainingSecs: 7200,
};
let expirationThrows = false;
const mockGetTokenExpirationTimes = mock(
  async (): Promise<{authRemainingSecs?: number; refreshRemainingSecs?: number}> => {
    if (expirationThrows) {
      throw new Error("expiration lookup failed");
    }
    return expirationTimes;
  }
);
let refreshThrows = false;
const mockRefreshAuthToken = mock(async (): Promise<void> => {
  if (refreshThrows) {
    throw new Error("refresh failed");
  }
});
const mockGetFriendlyExpirationInfo = mock(async (): Promise<string> => "friendly-token-info");

// Stand-in for the built-in JWT token source, which rtk uses when no source is registered.
let jwtToken: string | null = "jwt-token";
const jwtAuthListeners = new Set<() => void>();
const fakeJwtTokenSource: AuthProvider = {
  getToken: async (): Promise<string | null> => jwtToken,
  getUserId: async (): Promise<string | null> => "jwt-user",
  onAuthChange: (callback: () => void): (() => void) => {
    jwtAuthListeners.add(callback);
    return (): void => {
      jwtAuthListeners.delete(callback);
    };
  },
  refresh: async (): Promise<boolean> => true,
};

mock.module("../emptyApi", () => ({
  getFriendlyExpirationInfo: mockGetFriendlyExpirationInfo,
  getTokenExpirationTimes: mockGetTokenExpirationTimes,
  isJwtTokenSource: (source: AuthProvider | undefined): boolean =>
    !source || source === fakeJwtTokenSource,
  jwtTokenSource: fakeJwtTokenSource,
  refreshAuthToken: mockRefreshAuthToken,
}));

// Toast mock
let toastIdCounter = 0;
const mockToastShow = mock(
  (_message: string, _opts?: unknown): string => `toast-${++toastIdCounter}`
);
const mockToastHide = mock((_id: string): void => {});
mock.module("@terreno/ui", () => ({
  useToast: () => ({hide: mockToastHide, show: mockToastShow}),
}));

// react-redux useSelector returns the controllable timestamp
let reduxTimestamp: number | null = null;
mock.module("react-redux", () => ({
  useSelector: (): number | null => reduxTimestamp,
}));

// socket.io-client mock
interface MockSocket {
  auth: unknown;
  connected: boolean;
  handlers: Record<string, (arg?: unknown) => unknown>;
  connect: ReturnType<typeof mock>;
  disconnect: ReturnType<typeof mock>;
  off: ReturnType<typeof mock>;
  on: ReturnType<typeof mock>;
}

let currentSocket: MockSocket;

const makeSocket = (): MockSocket => {
  const socket = {
    auth: undefined as unknown,
    connected: false,
    handlers: {} as Record<string, (arg?: unknown) => unknown>,
  } as MockSocket;
  socket.on = mock((event: string, handler: (arg?: unknown) => unknown): MockSocket => {
    socket.handlers[event] = handler;
    return socket;
  });
  socket.off = mock((event: string): MockSocket => {
    delete socket.handlers[event];
    return socket;
  });
  socket.connect = mock((): MockSocket => socket);
  socket.disconnect = mock((): MockSocket => {
    socket.connected = false;
    return socket;
  });
  return socket;
};

const mockIo = mock((): MockSocket => {
  currentSocket = makeSocket();
  return currentSocket;
});
mock.module("socket.io-client", () => ({io: mockIo}));

// ---------------------------------------------------------------------------
// Timer mocks (bun has no fake timers) — capture callbacks to invoke manually
// ---------------------------------------------------------------------------
const originalSetInterval = globalThis.setInterval;
const originalClearInterval = globalThis.clearInterval;
const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;

let intervalCallbacks: Array<() => void | Promise<void>> = [];
let timeoutCallbacks: Array<() => void> = [];
let idCounter = 0;

// ---------------------------------------------------------------------------
// Deferred imports (after mocks are installed)
// ---------------------------------------------------------------------------
const {act, renderHook, waitFor} = await import("@testing-library/react-native");
const {useSocketConnection} = await import("../socket");
const {setTokenSource} = await import("../tokenSource");

const flushPromises = (): Promise<void> => new Promise((r) => originalSetTimeout(r, 0));

const emit = async (event: string, arg?: unknown): Promise<void> => {
  await act(async () => {
    if (event === "connect") {
      currentSocket.connected = true;
    } else if (event === "disconnect") {
      currentSocket.connected = false;
    }
    await currentSocket.handlers[event]?.(arg);
    await flushPromises();
  });
};

interface HookOptions {
  baseUrl: string;
  getAuthToken?: () => Promise<string | null>;
  tokenSource?: AuthProvider;
  shouldConnect: boolean;
  captureEvent?: (eventName: string, data: Record<string, unknown>) => void;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onConnectError?: (error: Error) => void;
  onReconnectFailed?: () => void;
}

const defaultOptions = (overrides: Partial<HookOptions> = {}): HookOptions => ({
  baseUrl: "https://example.com",
  getAuthToken,
  shouldConnect: true,
  ...overrides,
});

beforeEach(() => {
  authToken = "auth-token";
  jwtToken = "jwt-token";
  jwtAuthListeners.clear();
  setTokenSource(undefined);
  expirationTimes = {authRemainingSecs: 3600, refreshRemainingSecs: 7200};
  expirationThrows = false;
  refreshThrows = false;
  reduxTimestamp = null;
  toastIdCounter = 0;
  intervalCallbacks = [];
  timeoutCallbacks = [];
  idCounter = 0;

  getAuthToken.mockClear();
  mockGetTokenExpirationTimes.mockClear();
  mockRefreshAuthToken.mockClear();
  mockGetFriendlyExpirationInfo.mockClear();
  mockToastShow.mockClear();
  mockToastHide.mockClear();
  mockIo.mockClear();

  globalThis.setInterval = mock((cb: () => void | Promise<void>): number => {
    intervalCallbacks.push(cb);
    return ++idCounter;
  }) as unknown as typeof setInterval;
  globalThis.clearInterval = mock((): void => {}) as unknown as typeof clearInterval;
  globalThis.setTimeout = mock((cb: () => void): number => {
    timeoutCallbacks.push(cb);
    return ++idCounter;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = mock((): void => {}) as unknown as typeof clearTimeout;

  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {onLine: true},
    writable: true,
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {},
    writable: true,
  });
});

afterEach(() => {
  setTokenSource(undefined);
  globalThis.setInterval = originalSetInterval;
  globalThis.clearInterval = originalClearInterval;
  globalThis.setTimeout = originalSetTimeout;
  globalThis.clearTimeout = originalClearTimeout;
  setSystemTime();
});

describe("useSocketConnection", () => {
  it("initializes a socket and connects with the auth token when shouldConnect is true", async () => {
    const {result} = renderHook(() => useSocketConnection(defaultOptions()));
    await act(async () => {
      await flushPromises();
    });
    expect(mockIo).toHaveBeenCalledWith("https://example.com", expect.any(Object));
    expect(getAuthToken).toHaveBeenCalled();
    expect(currentSocket.connect).toHaveBeenCalled();
    expect(currentSocket.auth).toEqual({token: "Bearer auth-token"});
    expect(result.current.socket).toBeTruthy();
  });

  it("warns and skips connecting when getAuthToken returns no token", async () => {
    authToken = null;
    renderHook(() => useSocketConnection(defaultOptions()));
    await act(async () => {
      await flushPromises();
    });
    expect(currentSocket.connect).not.toHaveBeenCalled();
  });

  it("does not connect when shouldConnect is false", async () => {
    renderHook(() => useSocketConnection(defaultOptions({shouldConnect: false})));
    await act(async () => {
      await flushPromises();
    });
    expect(currentSocket.connect).not.toHaveBeenCalled();
    expect(currentSocket.disconnect).toHaveBeenCalled();
  });

  it("handles the connect event and invokes onConnect", async () => {
    const onConnect = mock(() => {});
    const {result} = renderHook(() => useSocketConnection(defaultOptions({onConnect})));
    await act(async () => {
      await flushPromises();
    });
    await emit("connect");
    expect(onConnect).toHaveBeenCalled();
    await waitFor(() => {
      expect(result.current.isSocketConnected.isConnected).toBe(true);
    });
  });

  it("shows a reconnected toast when reconnecting after more than 10 seconds", async () => {
    setSystemTime(DateTime.fromISO("2024-01-01T00:00:00Z").toJSDate());
    const {result} = renderHook(() => useSocketConnection(defaultOptions()));
    await act(async () => {
      await flushPromises();
    });
    await emit("connect");
    await emit("disconnect", "transport close");
    await waitFor(() => {
      expect(result.current.isSocketConnected.lastDisconnectedAt).not.toBeNull();
    });
    setSystemTime(DateTime.fromISO("2024-01-01T00:00:20Z").toJSDate());
    mockToastShow.mockClear();
    await emit("connect");
    expect(mockToastShow).toHaveBeenCalledWith("You have been reconnected.");
  });

  it("refreshes the token on disconnect when tokens are near expiration and reconnects", async () => {
    expirationTimes = {authRemainingSecs: 30, refreshRemainingSecs: 30};
    const onDisconnect = mock(() => {});
    renderHook(() => useSocketConnection(defaultOptions({onDisconnect})));
    await act(async () => {
      await flushPromises();
    });
    currentSocket.connect.mockClear();
    await emit("disconnect", "transport error");
    expect(mockRefreshAuthToken).toHaveBeenCalled();
    expect(currentSocket.connect).toHaveBeenCalled();
    expect(onDisconnect).toHaveBeenCalled();
  });

  it("shows an error toast when token expiration lookup fails on disconnect", async () => {
    expirationThrows = true;
    renderHook(() => useSocketConnection(defaultOptions()));
    await act(async () => {
      await flushPromises();
    });
    await emit("disconnect", "transport error");
    expect(mockToastShow).toHaveBeenCalledWith(
      expect.stringContaining("Error refreshing token"),
      expect.objectContaining({persistent: true, variant: "error"})
    );
  });

  it("captures an event when refresh fails but the refresh token is still valid", async () => {
    expirationTimes = {authRemainingSecs: 10, refreshRemainingSecs: 30};
    refreshThrows = true;
    const captureEvent = mock((_name: string, _data?: Record<string, unknown>) => {});
    renderHook(() => useSocketConnection(defaultOptions({captureEvent})));
    await act(async () => {
      await flushPromises();
    });
    await emit("disconnect", "transport error");
    expect(mockGetFriendlyExpirationInfo).toHaveBeenCalled();
    const captured = captureEvent.mock.calls.some(
      (call) => typeof call[0] === "string" && call[0].includes("Token Check/Refresh Error")
    );
    expect(captured).toBe(true);
  });

  it("skips connect_error handling while the browser is offline", async () => {
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {onLine: false},
      writable: true,
    });
    const onConnectError = mock(() => {});
    renderHook(() => useSocketConnection(defaultOptions({onConnectError})));
    await act(async () => {
      await flushPromises();
    });
    await emit("connect_error", new Error("boom"));
    expect(onConnectError).not.toHaveBeenCalled();
  });

  it("handles connect_error when online and invokes onConnectError", async () => {
    const captureEvent = mock((_name: string, _data?: Record<string, unknown>) => {});
    const onConnectError = mock(() => {});
    renderHook(() => useSocketConnection(defaultOptions({captureEvent, onConnectError})));
    await act(async () => {
      await flushPromises();
    });
    await emit("connect_error", new Error("kaboom"));
    expect(onConnectError).toHaveBeenCalled();
    const captured = captureEvent.mock.calls.some(
      (call) => call[0] === "WebSocket Connection Error"
    );
    expect(captured).toBe(true);
  });

  it("handles reconnect_failed, forcing a new connection attempt", async () => {
    const onReconnectFailed = mock(() => {});
    renderHook(() => useSocketConnection(defaultOptions({onReconnectFailed})));
    await act(async () => {
      await flushPromises();
    });
    currentSocket.connect.mockClear();
    await emit("reconnect_failed");
    expect(currentSocket.disconnect).toHaveBeenCalled();
    expect(onReconnectFailed).toHaveBeenCalled();
    // Run the deferred setTimeout callback that forces a reconnection.
    await act(async () => {
      timeoutCallbacks.forEach((cb) => {
        cb();
      });
      await flushPromises();
    });
    expect(currentSocket.connect).toHaveBeenCalled();
  });

  it("does not reconnect after reconnect_failed when shouldConnect is false", async () => {
    const {rerender} = renderHook((props: HookOptions) => useSocketConnection(props), {
      initialProps: defaultOptions(),
    });
    await act(async () => {
      await flushPromises();
    });
    // connect first so we have a live connection, then flip shouldConnect off
    await emit("connect");
    rerender(defaultOptions({shouldConnect: false}));
    await act(async () => {
      await flushPromises();
    });
    currentSocket.connect.mockClear();
    await emit("reconnect_failed");
    await act(async () => {
      timeoutCallbacks.forEach((cb) => {
        cb();
      });
      await flushPromises();
    });
    expect(currentSocket.connect).not.toHaveBeenCalled();
  });

  it("shows and hides the disconnected toast based on connection state", async () => {
    setSystemTime(DateTime.fromISO("2024-01-01T00:00:00Z").toJSDate());
    const {result} = renderHook(() => useSocketConnection(defaultOptions()));
    await act(async () => {
      await flushPromises();
    });
    await emit("connect");
    await emit("disconnect", "transport close");
    await waitFor(() => {
      expect(result.current.isSocketConnected.lastDisconnectedAt).not.toBeNull();
    });

    // More than 9 seconds since disconnect → the interval should show the toast.
    setSystemTime(DateTime.fromISO("2024-01-01T00:00:15Z").toJSDate());
    mockToastShow.mockClear();
    await act(async () => {
      await Promise.all(intervalCallbacks.map((cb) => cb()));
      await flushPromises();
    });
    expect(mockToastShow).toHaveBeenCalledWith(
      expect.stringContaining("You have been disconnected"),
      expect.objectContaining({persistent: true})
    );

    // Reconnect → the connect handler hides the disconnected toast.
    mockToastHide.mockClear();
    await emit("connect");
    expect(mockToastHide).toHaveBeenCalled();
  });

  it("reconnects when a redux token refresh timestamp changes", async () => {
    const {rerender} = renderHook((props: HookOptions) => useSocketConnection(props), {
      initialProps: defaultOptions(),
    });
    await act(async () => {
      await flushPromises();
    });
    getAuthToken.mockClear();
    reduxTimestamp = DateTime.now().toMillis();
    await act(async () => {
      rerender(defaultOptions());
      await flushPromises();
    });
    expect(getAuthToken).toHaveBeenCalled();
  });

  it("dismisses the socket on unmount", async () => {
    const {unmount} = renderHook(() => useSocketConnection(defaultOptions()));
    await act(async () => {
      await flushPromises();
    });
    const socket = currentSocket;
    unmount();
    expect(socket.disconnect).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Token source mode: no getAuthToken, the hook reads the registered (or passed) source
// ---------------------------------------------------------------------------
interface FakeTokenSource extends AuthProvider {
  fireAuthChange: () => void;
  listenerCount: () => number;
  refresh: ReturnType<typeof mock<() => Promise<boolean>>>;
  refreshResult: boolean;
  token: string | null;
}

const makeTokenSource = (token: string | null = "source-token"): FakeTokenSource => {
  const listeners = new Set<() => void>();
  const source = {
    fireAuthChange: (): void => {
      for (const listener of listeners) {
        listener();
      }
    },
    getToken: async (): Promise<string | null> => source.token,
    getUserId: async (): Promise<string | null> => "source-user",
    listenerCount: (): number => listeners.size,
    onAuthChange: (callback: () => void): (() => void) => {
      listeners.add(callback);
      return (): void => {
        listeners.delete(callback);
      };
    },
    refreshResult: true,
    token,
  } as FakeTokenSource;
  source.refresh = mock(async (): Promise<boolean> => source.refreshResult);
  return source;
};

// The error a socket.io client sees when the server's auth middleware rejects the handshake.
const makeAuthError = (): Error =>
  Object.assign(new Error("Unauthorized: Better Auth session is missing or invalid"), {
    data: {
      code: "invalid_token",
      message: "Unauthorized: Better Auth session is missing or invalid",
      type: "UnauthorizedError",
    },
  });

// Run the socket's auth option the way socket.io-client does on each handshake.
const handshakeAuth = async (): Promise<unknown> => {
  const auth = currentSocket.auth;
  if (typeof auth !== "function") {
    return auth;
  }
  return new Promise((resolve) => {
    (auth as (callback: (data: unknown) => void) => void)(resolve);
  });
};

const sourceOptions = (overrides: Partial<HookOptions> = {}): HookOptions => ({
  baseUrl: "https://example.com",
  shouldConnect: true,
  ...overrides,
});

const mountWithSource = async (
  overrides: Partial<HookOptions> = {}
): Promise<ReturnType<typeof renderHook<ReturnType<typeof useSocketConnection>, HookOptions>>> => {
  const rendered = renderHook((props: HookOptions) => useSocketConnection(props), {
    initialProps: sourceOptions(overrides),
  });
  await act(async () => {
    await flushPromises();
  });
  return rendered;
};

describe("useSocketConnection with a token source", () => {
  it("sends the registered source's token in every handshake and reconnects on auth change", async () => {
    const source = makeTokenSource("t1");
    setTokenSource(source);
    await mountWithSource();

    expect(currentSocket.connect).toHaveBeenCalledTimes(1);
    expect(await handshakeAuth()).toEqual({token: "Bearer t1"});

    source.token = "t2";
    await emit("connect");
    currentSocket.connect.mockClear();
    currentSocket.disconnect.mockClear();
    await act(async () => {
      source.fireAuthChange();
      await flushPromises();
    });

    expect(currentSocket.disconnect).toHaveBeenCalled();
    expect(currentSocket.connect).toHaveBeenCalled();
    expect(await handshakeAuth()).toEqual({token: "Bearer t2"});
    expect(getAuthToken).not.toHaveBeenCalled();
  });

  it("reads the token again on a reconnect without an auth change", async () => {
    const source = makeTokenSource("t1");
    setTokenSource(source);
    await mountWithSource();
    source.token = "t3";
    expect(await handshakeAuth()).toEqual({token: "Bearer t3"});
  });

  it("sends an empty handshake when the source has no token or fails at reconnect time", async () => {
    const source = makeTokenSource("t1");
    setTokenSource(source);
    await mountWithSource();
    source.token = null;
    expect(await handshakeAuth()).toEqual({});
    source.getToken = async (): Promise<string | null> => {
      throw new Error("storage blocked");
    };
    expect(await handshakeAuth()).toEqual({});
  });

  it("prefers the tokenSource option over the registered source", async () => {
    setTokenSource(makeTokenSource("registered"));
    const override = makeTokenSource("override");
    await mountWithSource({tokenSource: override});
    expect(await handshakeAuth()).toEqual({token: "Bearer override"});
  });

  it("does not connect when the source has no token", async () => {
    setTokenSource(makeTokenSource(null));
    await mountWithSource();
    expect(currentSocket.connect).not.toHaveBeenCalled();
  });

  it("refreshes once and stops when the server keeps rejecting the refreshed token", async () => {
    const source = makeTokenSource("t1");
    setTokenSource(source);
    const onConnectError = mock((_error: Error) => {});
    await mountWithSource({onConnectError});
    currentSocket.connect.mockClear();

    await emit("connect_error", makeAuthError());
    expect(source.refresh).toHaveBeenCalledTimes(1);
    expect(currentSocket.connect).toHaveBeenCalledTimes(1);
    expect(onConnectError).not.toHaveBeenCalled();

    await emit("connect_error", makeAuthError());
    expect(source.refresh).toHaveBeenCalledTimes(1);
    expect(currentSocket.connect).toHaveBeenCalledTimes(1);
    expect(onConnectError).toHaveBeenCalledTimes(1);

    // Stopped: the forced reconnect after reconnect_failed does not reconnect either.
    await emit("reconnect_failed");
    await act(async () => {
      timeoutCallbacks.forEach((cb) => {
        cb();
      });
      await flushPromises();
    });
    expect(currentSocket.connect).toHaveBeenCalledTimes(1);
  });

  it("starts a new failure episode after a successful connect", async () => {
    const source = makeTokenSource("t1");
    setTokenSource(source);
    await mountWithSource();

    await emit("connect_error", makeAuthError());
    expect(source.refresh).toHaveBeenCalledTimes(1);
    await emit("connect");
    await emit("connect_error", makeAuthError());
    expect(source.refresh).toHaveBeenCalledTimes(2);
  });

  it("stops and reports the error when refresh resolves false", async () => {
    const source = makeTokenSource("t1");
    source.refreshResult = false;
    setTokenSource(source);
    const onConnectError = mock((_error: Error) => {});
    await mountWithSource({onConnectError});
    currentSocket.connect.mockClear();

    await emit("connect_error", makeAuthError());
    expect(source.refresh).toHaveBeenCalledTimes(1);
    expect(currentSocket.connect).not.toHaveBeenCalled();
    expect(onConnectError).toHaveBeenCalledTimes(1);
  });

  it("stops and reports the error when refresh throws", async () => {
    const source = makeTokenSource("t1");
    source.refresh.mockImplementation(async (): Promise<boolean> => {
      throw new Error("refresh exploded");
    });
    setTokenSource(source);
    const onConnectError = mock((_error: Error) => {});
    await mountWithSource({onConnectError});
    currentSocket.connect.mockClear();

    await emit("connect_error", makeAuthError());
    expect(currentSocket.connect).not.toHaveBeenCalled();
    expect(onConnectError).toHaveBeenCalledTimes(1);
  });

  it("stops at the first auth failure when the source cannot refresh", async () => {
    const source = makeTokenSource("t1");
    const {refresh: _refresh, ...withoutRefresh} = source;
    setTokenSource(withoutRefresh);
    const onConnectError = mock((_error: Error) => {});
    await mountWithSource({onConnectError});
    currentSocket.connect.mockClear();

    await emit("connect_error", makeAuthError());
    expect(currentSocket.connect).not.toHaveBeenCalled();
    expect(onConnectError).toHaveBeenCalledTimes(1);
  });

  it("reconnects after a stop when the source reports an auth change", async () => {
    const source = makeTokenSource("t1");
    source.refreshResult = false;
    setTokenSource(source);
    await mountWithSource();
    await emit("connect_error", makeAuthError());
    currentSocket.connect.mockClear();

    source.token = "t2";
    await act(async () => {
      source.fireAuthChange();
      await flushPromises();
    });
    expect(currentSocket.connect).toHaveBeenCalledTimes(1);
    expect(await handshakeAuth()).toEqual({token: "Bearer t2"});
  });

  it("passes network errors to onConnectError without refreshing or the JWT expiry check", async () => {
    const source = makeTokenSource("t1");
    setTokenSource(source);
    const onConnectError = mock((_error: Error) => {});
    await mountWithSource({onConnectError});

    await emit("connect_error", new Error("xhr poll error"));
    expect(source.refresh).not.toHaveBeenCalled();
    expect(mockGetTokenExpirationTimes).not.toHaveBeenCalled();
    expect(onConnectError).toHaveBeenCalledTimes(1);

    await emit("disconnect", "transport close");
    expect(mockGetTokenExpirationTimes).not.toHaveBeenCalled();
  });

  it("ignores auth changes while shouldConnect is false and unsubscribes on unmount", async () => {
    const source = makeTokenSource("t1");
    setTokenSource(source);
    const {rerender, unmount} = await mountWithSource({shouldConnect: false});
    expect(source.listenerCount()).toBe(0);
    await act(async () => {
      source.fireAuthChange();
      await flushPromises();
    });
    expect(currentSocket.connect).not.toHaveBeenCalled();

    rerender(sourceOptions({shouldConnect: true}));
    await act(async () => {
      await flushPromises();
    });
    expect(source.listenerCount()).toBe(1);
    unmount();
    expect(source.listenerCount()).toBe(0);
  });

  it("uses the JWT source by default and keeps its expiry check", async () => {
    expirationTimes = {authRemainingSecs: 30, refreshRemainingSecs: 7200};
    await mountWithSource();
    expect(await handshakeAuth()).toEqual({token: "Bearer jwt-token"});

    await emit("disconnect", "transport close");
    expect(mockGetTokenExpirationTimes).toHaveBeenCalled();
    expect(mockRefreshAuthToken).toHaveBeenCalledTimes(1);
  });

  it("counts the JWT expiry check's refresh as the episode's refresh", async () => {
    expirationTimes = {authRemainingSecs: 30, refreshRemainingSecs: 7200};
    const onConnectError = mock((_error: Error) => {});
    await mountWithSource({onConnectError});

    await emit("connect_error", makeAuthError());
    expect(mockRefreshAuthToken).toHaveBeenCalledTimes(1);
    expect(onConnectError).not.toHaveBeenCalled();

    currentSocket.connect.mockClear();
    await emit("connect_error", makeAuthError());
    expect(mockRefreshAuthToken).toHaveBeenCalledTimes(1);
    expect(currentSocket.connect).not.toHaveBeenCalled();
    expect(onConnectError).toHaveBeenCalledTimes(1);
  });

  it("stops when the JWT expiry check's refresh fails on an auth error", async () => {
    expirationTimes = {authRemainingSecs: 30, refreshRemainingSecs: 7200};
    refreshThrows = true;
    const onConnectError = mock((_error: Error) => {});
    await mountWithSource({onConnectError});
    currentSocket.connect.mockClear();

    await emit("connect_error", makeAuthError());
    expect(currentSocket.connect).not.toHaveBeenCalled();
    expect(onConnectError).toHaveBeenCalledTimes(1);
  });

  it("keeps the static handshake payload and ignores token sources when getAuthToken is passed", async () => {
    const registered = makeTokenSource("ignored");
    setTokenSource(registered);
    await mountWithSource({getAuthToken});
    expect(getAuthToken).toHaveBeenCalled();
    expect(currentSocket.auth).toEqual({token: "Bearer auth-token"});
    expect(registered.listenerCount()).toBe(0);
    expect(jwtAuthListeners.size).toBe(0);
  });

  it("refreshes once and stops when the source's refresh also fires onAuthChange", async () => {
    const source = makeTokenSource("t1");
    source.refresh.mockImplementation(async (): Promise<boolean> => {
      source.token = "t2";
      source.fireAuthChange();
      return true;
    });
    setTokenSource(source);
    const onConnectError = mock((_error: Error) => {});
    await mountWithSource({onConnectError});
    expect(await handshakeAuth()).toEqual({token: "Bearer t1"});
    currentSocket.connect.mockClear();

    await emit("connect_error", makeAuthError());
    await emit("connect_error", makeAuthError());
    await emit("connect_error", makeAuthError());
    expect(source.refresh).toHaveBeenCalledTimes(1);
    expect(onConnectError).toHaveBeenCalledTimes(2);
    expect(currentSocket.connect.mock.calls.length).toBeLessThanOrEqual(2);
    expect(await handshakeAuth()).toEqual({token: "Bearer t2"});
  });

  it("lets an in-flight refresh decide the episode when another auth error arrives", async () => {
    const source = makeTokenSource("t1");
    let resolveRefresh: (value: boolean) => void = () => {};
    source.refresh.mockImplementation(
      (): Promise<boolean> =>
        new Promise((resolve) => {
          resolveRefresh = resolve;
        })
    );
    setTokenSource(source);
    const onConnectError = mock((_error: Error) => {});
    await mountWithSource({onConnectError});
    currentSocket.connect.mockClear();

    let firstError: Promise<unknown> = Promise.resolve();
    await act(async () => {
      firstError = Promise.resolve(currentSocket.handlers.connect_error?.(makeAuthError()));
      await flushPromises();
    });
    await emit("connect_error", makeAuthError());
    expect(onConnectError).not.toHaveBeenCalled();

    await act(async () => {
      resolveRefresh(true);
      await firstError;
      await flushPromises();
    });
    expect(source.refresh).toHaveBeenCalledTimes(1);
    expect(currentSocket.connect).toHaveBeenCalledTimes(1);
    expect(onConnectError).not.toHaveBeenCalled();
  });

  it("keeps a live connection when an auth change leaves the token unchanged", async () => {
    const source = makeTokenSource("t1");
    setTokenSource(source);
    await mountWithSource();
    await handshakeAuth();
    await emit("connect");
    currentSocket.connect.mockClear();
    currentSocket.disconnect.mockClear();

    await act(async () => {
      source.fireAuthChange();
      await flushPromises();
    });
    expect(currentSocket.disconnect).not.toHaveBeenCalled();
    expect(currentSocket.connect).not.toHaveBeenCalled();
  });

  it("waits for an in-flight handshake instead of connecting again on an auth change", async () => {
    const source = makeTokenSource("t1");
    setTokenSource(source);
    await mountWithSource();
    // The CONNECT packet carrying t1 is out; the server has not answered yet.
    expect(await handshakeAuth()).toEqual({token: "Bearer t1"});
    currentSocket.connect.mockClear();
    currentSocket.disconnect.mockClear();

    source.token = "t2";
    await act(async () => {
      source.fireAuthChange();
      await flushPromises();
    });
    expect(currentSocket.connect).not.toHaveBeenCalled();
    expect(currentSocket.disconnect).not.toHaveBeenCalled();

    // The handshake completed with the old token, so the deferred check rotates to the new one.
    await emit("connect");
    expect(currentSocket.disconnect).toHaveBeenCalledTimes(1);
    expect(currentSocket.connect).toHaveBeenCalledTimes(1);
    expect(await handshakeAuth()).toEqual({token: "Bearer t2"});
  });

  it("keeps the connection when the in-flight handshake already carried the current token", async () => {
    const source = makeTokenSource("t1");
    setTokenSource(source);
    await mountWithSource();
    await handshakeAuth();
    currentSocket.connect.mockClear();
    currentSocket.disconnect.mockClear();

    await act(async () => {
      source.fireAuthChange();
      await flushPromises();
    });
    await emit("connect");
    expect(currentSocket.connect).not.toHaveBeenCalled();
    expect(currentSocket.disconnect).not.toHaveBeenCalled();
  });

  it("retries a deferred auth change after the in-flight handshake fails", async () => {
    const source = makeTokenSource("t1");
    setTokenSource(source);
    await mountWithSource();
    await handshakeAuth();
    currentSocket.connect.mockClear();

    source.token = "t2";
    await act(async () => {
      source.fireAuthChange();
      await flushPromises();
    });
    expect(currentSocket.connect).not.toHaveBeenCalled();

    await emit("connect_error", new Error("xhr poll error"));
    expect(currentSocket.connect).toHaveBeenCalledTimes(1);
  });

  it("reconnects once, without a refresh, when the server rejects a handshake an auth change outdated", async () => {
    const source = makeTokenSource("t1");
    setTokenSource(source);
    const onConnectError = mock((_error: Error) => {});
    await mountWithSource({onConnectError});
    await handshakeAuth();
    currentSocket.connect.mockClear();

    source.token = "t2";
    await act(async () => {
      source.fireAuthChange();
      await flushPromises();
    });
    await emit("connect_error", makeAuthError());
    expect(source.refresh).not.toHaveBeenCalled();
    expect(currentSocket.connect).toHaveBeenCalledTimes(1);
    expect(onConnectError).not.toHaveBeenCalled();
    expect(await handshakeAuth()).toEqual({token: "Bearer t2"});
  });

  it("connects on an auth change after reconnect_failed drops an unanswered handshake", async () => {
    const source = makeTokenSource("t1");
    setTokenSource(source);
    await mountWithSource();
    await handshakeAuth();
    await emit("reconnect_failed");
    currentSocket.connect.mockClear();

    source.token = "t2";
    await act(async () => {
      source.fireAuthChange();
      await flushPromises();
    });
    expect(currentSocket.connect).toHaveBeenCalledTimes(1);
  });

  it("connects on an auth change on a socket recreated for a new baseUrl mid-handshake", async () => {
    const source = makeTokenSource("t1");
    setTokenSource(source);
    const {rerender} = await mountWithSource();
    await handshakeAuth();
    rerender(sourceOptions({baseUrl: "https://other.example.com"}));
    await act(async () => {
      await flushPromises();
    });
    currentSocket.connect.mockClear();

    source.token = "t2";
    await act(async () => {
      source.fireAuthChange();
      await flushPromises();
    });
    expect(currentSocket.connect).toHaveBeenCalledTimes(1);
  });

  it("connects on an auth change after shouldConnect drops an unanswered handshake", async () => {
    const source = makeTokenSource("t1");
    setTokenSource(source);
    const {rerender} = await mountWithSource();
    await handshakeAuth();
    rerender(sourceOptions({shouldConnect: false}));
    await act(async () => {
      await flushPromises();
    });
    rerender(sourceOptions({shouldConnect: true}));
    await act(async () => {
      await flushPromises();
    });
    currentSocket.connect.mockClear();

    source.token = "t2";
    await act(async () => {
      source.fireAuthChange();
      await flushPromises();
    });
    expect(currentSocket.connect).toHaveBeenCalledTimes(1);
  });

  it("disconnects without reconnecting when an auth change leaves no token", async () => {
    const source = makeTokenSource("t1");
    setTokenSource(source);
    await mountWithSource();
    await handshakeAuth();
    await emit("connect");
    currentSocket.connect.mockClear();
    currentSocket.disconnect.mockClear();

    source.token = null;
    await act(async () => {
      source.fireAuthChange();
      await flushPromises();
    });
    expect(currentSocket.disconnect).toHaveBeenCalled();
    expect(currentSocket.connect).not.toHaveBeenCalled();
  });

  it("does not report a token rotation as a disconnection", async () => {
    const source = makeTokenSource("t1");
    setTokenSource(source);
    const captureEvent = mock((_name: string, _data?: Record<string, unknown>) => {});
    await mountWithSource({captureEvent});
    await handshakeAuth();
    await emit("connect");

    // The mock socket's disconnect does not emit, so run the handler the way socket.io would.
    currentSocket.disconnect.mockImplementation((): MockSocket => {
      currentSocket.connected = false;
      void currentSocket.handlers.disconnect?.("io client disconnect");
      return currentSocket;
    });
    source.token = "t2";
    await act(async () => {
      source.fireAuthChange();
      await flushPromises();
    });
    expect(currentSocket.connect).toHaveBeenCalled();
    const names = captureEvent.mock.calls.map((call) => call[0]);
    expect(names).not.toContain("WebSocket Disconnection");

    await emit("disconnect", "transport close");
    expect(captureEvent.mock.calls.map((call) => call[0])).toContain("WebSocket Disconnection");
  });

  it("ignores an auth change that fires after the socket is torn down", async () => {
    const source = makeTokenSource("t1");
    setTokenSource(source);
    let listener: () => void = () => {};
    source.onAuthChange = (callback: () => void): (() => void) => {
      listener = callback;
      return (): void => {};
    };
    const {unmount} = await mountWithSource();
    const socket = currentSocket;
    unmount();
    socket.connect.mockClear();
    await act(async () => {
      listener();
      await flushPromises();
    });
    expect(socket.connect).not.toHaveBeenCalled();
  });

  it("treats a failing token read on auth change as signed out", async () => {
    const source = makeTokenSource("t1");
    setTokenSource(source);
    await mountWithSource();
    await handshakeAuth();
    await emit("connect");
    currentSocket.connect.mockClear();
    source.getToken = async (): Promise<string | null> => {
      throw new Error("storage blocked");
    };
    await act(async () => {
      source.fireAuthChange();
      await flushPromises();
    });
    expect(currentSocket.disconnect).toHaveBeenCalled();
    expect(currentSocket.connect).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Legacy getAuthToken paths not reached above (toasts, forced reconnect edges)
// ---------------------------------------------------------------------------
const runIntervals = async (): Promise<void> => {
  await act(async () => {
    await Promise.all(intervalCallbacks.map((cb) => cb()));
    await flushPromises();
  });
};

const runTimeouts = async (): Promise<void> => {
  await act(async () => {
    timeoutCallbacks.forEach((cb) => {
      cb();
    });
    await flushPromises();
  });
};

describe("useSocketConnection legacy edges", () => {
  it("keeps the disconnected toast quiet behind a token error toast and clears it on a redux refresh", async () => {
    expirationThrows = true;
    setSystemTime(DateTime.fromISO("2024-01-01T00:00:00Z").toJSDate());
    const {rerender} = renderHook((props: HookOptions) => useSocketConnection(props), {
      initialProps: defaultOptions(),
    });
    await act(async () => {
      await flushPromises();
    });
    await emit("disconnect", "transport error");
    setSystemTime(DateTime.fromISO("2024-01-01T00:00:15Z").toJSDate());
    mockToastShow.mockClear();
    await runIntervals();
    expect(mockToastShow).not.toHaveBeenCalled();

    mockToastHide.mockClear();
    reduxTimestamp = DateTime.now().toMillis();
    await act(async () => {
      rerender(defaultOptions());
      await flushPromises();
    });
    expect(mockToastHide).toHaveBeenCalled();
  });

  it("hides the disconnected toast once it should no longer show and stops polling on connect", async () => {
    setSystemTime(DateTime.fromISO("2024-01-01T00:00:00Z").toJSDate());
    renderHook(() => useSocketConnection(defaultOptions()));
    await act(async () => {
      await flushPromises();
    });
    await emit("connect");
    await emit("disconnect", "transport close");
    setSystemTime(DateTime.fromISO("2024-01-01T00:00:15Z").toJSDate());
    await runIntervals();
    expect(mockToastShow).toHaveBeenCalledWith(
      expect.stringContaining("You have been disconnected"),
      expect.objectContaining({persistent: true})
    );

    mockToastHide.mockClear();
    setSystemTime(DateTime.fromISO("2024-01-01T00:00:05Z").toJSDate());
    await runIntervals();
    expect(mockToastHide).toHaveBeenCalled();

    await emit("connect");
    await runIntervals();
    expect(globalThis.clearInterval).toHaveBeenCalled();
  });

  it("skips the forced reconnect when the socket reconnected before the timer fired", async () => {
    renderHook(() => useSocketConnection(defaultOptions()));
    await act(async () => {
      await flushPromises();
    });
    await emit("reconnect_failed");
    await emit("connect");
    currentSocket.connect.mockClear();
    await runTimeouts();
    expect(currentSocket.connect).not.toHaveBeenCalled();
  });

  it("skips connecting when the socket was torn down before the forced reconnect", async () => {
    const {unmount} = renderHook(() => useSocketConnection(defaultOptions()));
    await act(async () => {
      await flushPromises();
    });
    await emit("reconnect_failed");
    const socket = currentSocket;
    unmount();
    socket.connect.mockClear();
    await runTimeouts();
    expect(socket.connect).not.toHaveBeenCalled();
  });
});

describe("useSocketConnection toast dismissal", () => {
  const dismissToast = (prefix: string): void => {
    const call = mockToastShow.mock.calls.find(
      (args) => typeof args[0] === "string" && args[0].startsWith(prefix)
    );
    act(() => {
      (call?.[1] as {onDismiss?: () => void} | undefined)?.onDismiss?.();
    });
  };

  it("hides the token error and disconnected toasts when the user dismisses them", async () => {
    setSystemTime(DateTime.fromISO("2024-01-01T00:00:00Z").toJSDate());
    renderHook(() => useSocketConnection(defaultOptions()));
    await act(async () => {
      await flushPromises();
    });
    await emit("disconnect", "transport close");
    setSystemTime(DateTime.fromISO("2024-01-01T00:00:15Z").toJSDate());
    await runIntervals();
    mockToastHide.mockClear();
    dismissToast("You have been disconnected");
    expect(mockToastHide).toHaveBeenCalledTimes(1);

    expirationThrows = true;
    await emit("disconnect", "transport error");
    mockToastHide.mockClear();
    dismissToast("Error refreshing token");
    expect(mockToastHide).toHaveBeenCalledTimes(1);
  });
});
