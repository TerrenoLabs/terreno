import {beforeEach, describe, expect, it, mock} from "bun:test";
import type {AuthProvider} from "@terreno/syncdb";

interface MockTool {
  description?: string;
  inputSchema?: Record<string, unknown>;
  name: string;
}

interface MockTransport {
  options: {authProvider?: {token: () => Promise<string | undefined>}};
  url: URL;
}

let authToken: string | null = "test-token";
let connectError: unknown;
let connectGate: Promise<void> | undefined;
let listToolsError: unknown;
let availableTools: MockTool[] = [
  {description: "Reads todos", inputSchema: {type: "object"}, name: "read_todos"},
];
const transports: MockTransport[] = [];
const clients: MockClient[] = [];

class MockStreamableHTTPClientTransport {
  public readonly options: MockTransport["options"];
  public readonly url: URL;

  public constructor(url: URL, options: MockTransport["options"]) {
    this.options = options;
    this.url = url;
    transports.push(this);
  }
}

class MockClient {
  public readonly close = mock(async (): Promise<void> => {});
  public readonly connect = mock(async (_transport: MockStreamableHTTPClientTransport) => {
    if (connectError !== undefined) {
      throw connectError;
    }
    if (connectGate !== undefined) {
      await connectGate;
    }
  });
  public readonly listTools = mock(async (): Promise<{tools: MockTool[]}> => {
    if (listToolsError !== undefined) {
      throw listToolsError;
    }
    return {tools: availableTools};
  });

  public constructor() {
    clients.push(this);
  }
}

mock.module("@modelcontextprotocol/client", () => ({
  Client: MockClient,
  StreamableHTTPClientTransport: MockStreamableHTTPClientTransport,
}));
// Stand-in for the built-in JWT token source, which rtk uses when no source is registered. Its
// delegation to getAuthToken is tested in emptyApi.staggered.isolated.ts and tokenSource.test.ts.
const fakeJwtTokenSource: AuthProvider = {
  getToken: async (): Promise<string | null> => authToken,
  getUserId: async (): Promise<string | null> => "jwt-user",
  onAuthChange: (): (() => void) => (): void => {},
};
mock.module("../emptyApi", () => ({
  jwtTokenSource: fakeJwtTokenSource,
}));
mock.module("../constants", () => ({
  baseUrl: "https://api.example.com",
}));

const {act, renderHook, waitFor} = await import("@testing-library/react-native");
const {setTokenSource} = await import("../tokenSource");
const {useMCPTools} = await import("../useMCPTools");

const makeTokenSource = (token: string | null): AuthProvider & {token: string | null} => {
  const source = {
    getToken: mock(async (): Promise<string | null> => source.token),
    getUserId: async (): Promise<string | null> => "source-user",
    onAuthChange: (): (() => void) => (): void => {},
    token,
  };
  return source;
};

const flushPromises = async (): Promise<void> => {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
};

beforeEach(() => {
  authToken = "test-token";
  setTokenSource(undefined);
  connectError = undefined;
  connectGate = undefined;
  listToolsError = undefined;
  availableTools = [
    {description: "Reads todos", inputSchema: {type: "object"}, name: "read_todos"},
  ];
  transports.length = 0;
  clients.length = 0;
});

describe("useMCPTools", () => {
  it("loads and maps tools with an authentication provider", async () => {
    const {result} = renderHook(() => useMCPTools({baseURL: "https://tools.example.com"}));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.tools).toEqual(availableTools);
    expect(result.current.error).toBeNull();
    expect(transports[0]?.url.toString()).toBe("https://tools.example.com/mcp");
    await expect(transports[0]?.options.authProvider?.token()).resolves.toBe("test-token");
    expect(clients[0]?.close).toHaveBeenCalled();
  });

  it("omits the authentication provider when no token is available", async () => {
    authToken = null;
    renderHook(() => useMCPTools());

    await waitFor(() => {
      expect(clients[0]?.close).toHaveBeenCalled();
    });

    expect(transports[0]?.options.authProvider).toBeUndefined();
  });

  it("reports Error messages and closes the client when connecting fails", async () => {
    connectError = new Error("connection failed");
    const {result} = renderHook(() => useMCPTools());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBe("connection failed");
    expect(result.current.tools).toEqual([]);
    expect(clients[0]?.close).toHaveBeenCalled();
  });

  it("reports Error messages when listing tools fails", async () => {
    listToolsError = new Error("tool listing failed");
    const {result} = renderHook(() => useMCPTools());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBe("tool listing failed");
    expect(clients[0]?.close).toHaveBeenCalled();
  });

  it("uses the fallback message for non-Error failures", async () => {
    listToolsError = {reason: "unavailable"};
    const {result} = renderHook(() => useMCPTools());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBe("Failed to fetch MCP tools");
    expect(clients[0]?.close).toHaveBeenCalled();
  });

  it("transitions through loading again when refetched", async () => {
    let resolveConnect: (() => void) | undefined;
    connectGate = new Promise<void>((resolve) => {
      resolveConnect = resolve;
    });

    const {result} = renderHook(() => useMCPTools());
    expect(result.current.isLoading).toBe(true);
    await flushPromises();
    expect(result.current.isLoading).toBe(true);

    resolveConnect?.();
    connectGate = undefined;
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    availableTools = [{name: "write_todos"}];
    await act(async () => {
      await result.current.refetch();
    });
    expect(result.current.tools).toEqual(availableTools);
  });

  it("reads the JWT on each token call instead of capturing it once", async () => {
    renderHook(() => useMCPTools());

    await waitFor(() => {
      expect(clients[0]?.close).toHaveBeenCalled();
    });

    authToken = "refreshed-token";
    await expect(transports[0]?.options.authProvider?.token()).resolves.toBe("refreshed-token");
    authToken = null;
    await expect(transports[0]?.options.authProvider?.token()).resolves.toBeUndefined();
  });

  describe("token source", () => {
    it("sends the registered source's current token, including after it changes", async () => {
      const source = makeTokenSource("source-token");
      setTokenSource(source);
      const {result} = renderHook(() => useMCPTools());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.tools).toEqual(availableTools);
      await expect(transports[0]?.options.authProvider?.token()).resolves.toBe("source-token");
      source.token = "rotated-token";
      await expect(transports[0]?.options.authProvider?.token()).resolves.toBe("rotated-token");
      // One read when the fetch starts, then a fresh read on every token() call.
      expect(source.getToken).toHaveBeenCalledTimes(3);
    });

    it("uses a source registered after the fetch started", async () => {
      renderHook(() => useMCPTools());

      await waitFor(() => {
        expect(clients[0]?.close).toHaveBeenCalled();
      });

      setTokenSource(makeTokenSource("late-token"));
      await expect(transports[0]?.options.authProvider?.token()).resolves.toBe("late-token");
    });

    it("prefers the tokenSource option over the registered source", async () => {
      setTokenSource(makeTokenSource("registered-token"));
      const override = makeTokenSource("override-token");
      renderHook(() => useMCPTools({tokenSource: override}));

      await waitFor(() => {
        expect(clients[0]?.close).toHaveBeenCalled();
      });

      await expect(transports[0]?.options.authProvider?.token()).resolves.toBe("override-token");
    });

    it("loads tools without an authentication provider when the source has no token", async () => {
      authToken = "jwt-token-that-must-not-be-sent";
      setTokenSource(makeTokenSource(null));
      const {result} = renderHook(() => useMCPTools());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(transports[0]?.options.authProvider).toBeUndefined();
      expect(result.current.tools).toEqual(availableTools);
    });

    it("sends no token once the source signs out after connecting", async () => {
      const source = makeTokenSource("source-token");
      setTokenSource(source);
      renderHook(() => useMCPTools());

      await waitFor(() => {
        expect(clients[0]?.close).toHaveBeenCalled();
      });

      source.token = null;
      await expect(transports[0]?.options.authProvider?.token()).resolves.toBeUndefined();
    });

    it("does not refetch when a new tokenSource object is passed on rerender", async () => {
      const {result, rerender} = renderHook(
        ({tokenSource}: {tokenSource: AuthProvider}) => useMCPTools({tokenSource}),
        {initialProps: {tokenSource: makeTokenSource("first-token")}}
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      const nextSource = makeTokenSource("second-token");
      rerender({tokenSource: nextSource});
      await flushPromises();

      expect(clients).toHaveLength(1);
      await expect(transports[0]?.options.authProvider?.token()).resolves.toBe("second-token");
    });
  });
});
