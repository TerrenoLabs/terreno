import {beforeEach, describe, expect, it, mock} from "bun:test";
import type {AuthProvider} from "../types";

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

const authProvider = {
  getToken: async (): Promise<string | null> => authToken,
};

const {act, renderHook, waitFor} = await import("@testing-library/react-native");
const {useMCPTools} = await import("../app/mcpTools");
const {baseUrl} = await import("../config/baseUrl");

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
    const {result} = renderHook(() =>
      useMCPTools({authProvider, baseURL: "https://tools.example.com"})
    );

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
    renderHook(() => useMCPTools({authProvider}));

    await waitFor(() => {
      expect(clients[0]?.close).toHaveBeenCalled();
    });

    expect(transports[0]?.options.authProvider).toBeUndefined();
    expect(transports[0]?.url.toString()).toBe(new URL(`${baseUrl}/mcp`).toString());
  });

  it("reports Error messages and closes the client when connecting fails", async () => {
    connectError = new Error("connection failed");
    const {result} = renderHook(() => useMCPTools({authProvider}));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBe("connection failed");
    expect(result.current.tools).toEqual([]);
    expect(clients[0]?.close).toHaveBeenCalled();
  });

  it("reports Error messages when listing tools fails", async () => {
    listToolsError = new Error("tool listing failed");
    const {result} = renderHook(() => useMCPTools({authProvider}));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBe("tool listing failed");
    expect(clients[0]?.close).toHaveBeenCalled();
  });

  it("uses the fallback message for non-Error failures", async () => {
    listToolsError = {reason: "unavailable"};
    const {result} = renderHook(() => useMCPTools({authProvider}));

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

    const {result} = renderHook(() => useMCPTools({authProvider}));
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

  it("reads the current token from the shared auth provider on every fetch", async () => {
    authToken = "session-token-1";
    const {result} = renderHook(() => useMCPTools({authProvider}));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    await expect(transports[0]?.options.authProvider?.token()).resolves.toBe("session-token-1");

    authToken = "session-token-2";
    await act(async () => {
      await result.current.refetch();
    });
    await expect(transports[1]?.options.authProvider?.token()).resolves.toBe("session-token-2");
  });

  it("reads the token on each token call instead of capturing it once", async () => {
    const source = makeTokenSource("source-token");
    renderHook(() => useMCPTools({authProvider: source}));

    await waitFor(() => {
      expect(clients[0]?.close).toHaveBeenCalled();
    });

    await expect(transports[0]?.options.authProvider?.token()).resolves.toBe("source-token");
    source.token = "rotated-token";
    await expect(transports[0]?.options.authProvider?.token()).resolves.toBe("rotated-token");
    // One read when the fetch starts, then a fresh read on every token() call.
    expect(source.getToken).toHaveBeenCalledTimes(3);
  });

  it("loads tools without an authentication provider when there is no token", async () => {
    const {result} = renderHook(() => useMCPTools({authProvider: makeTokenSource(null)}));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(transports[0]?.options.authProvider).toBeUndefined();
    expect(result.current.tools).toEqual(availableTools);
  });

  it("sends no token once the provider signs out after connecting", async () => {
    const source = makeTokenSource("source-token");
    renderHook(() => useMCPTools({authProvider: source}));

    await waitFor(() => {
      expect(clients[0]?.close).toHaveBeenCalled();
    });

    source.token = null;
    await expect(transports[0]?.options.authProvider?.token()).resolves.toBeUndefined();
  });

  it("does not refetch when a new authProvider object is passed on rerender", async () => {
    const {result, rerender} = renderHook(
      ({provider}: {provider: AuthProvider}) => useMCPTools({authProvider: provider}),
      {initialProps: {provider: makeTokenSource("first-token")}}
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    rerender({provider: makeTokenSource("second-token")});
    await flushPromises();

    expect(clients).toHaveLength(1);
    await expect(transports[0]?.options.authProvider?.token()).resolves.toBe("second-token");
  });
});
