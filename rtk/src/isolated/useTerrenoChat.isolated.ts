import {beforeEach, describe, expect, it, mock} from "bun:test";
import type {UIMessage, UseChatHelpers} from "@ai-sdk/react";
import type {AuthProvider} from "@terreno/syncdb";

interface TransportOptions {
  api: string;
  headers: () => Promise<Record<string, string>>;
}

interface ChatOptions {
  id?: string;
  onError?: (error: Error) => void;
  transport: MockDefaultChatTransport;
}

let authToken: string | null = "test-token";
const transports: MockDefaultChatTransport[] = [];
const chatOptions: ChatOptions[] = [];

class MockDefaultChatTransport {
  public readonly options: TransportOptions;

  public constructor(options: TransportOptions) {
    this.options = options;
    transports.push(this);
  }
}

// Test double: only the fields the hook passes through are populated.
const chatResult = {messages: [], status: "ready"} as unknown as UseChatHelpers<UIMessage>;

mock.module("@ai-sdk/react", () => ({
  useChat: (options: ChatOptions) => {
    chatOptions.push(options);
    return chatResult;
  },
}));
mock.module("ai", () => ({
  DefaultChatTransport: MockDefaultChatTransport,
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

const {setTokenSource} = await import("../tokenSource");
const {useTerrenoChat} = await import("../useTerrenoChat");

const makeTokenSource = (token: string | null): AuthProvider & {token: string | null} => {
  const source = {
    getToken: mock(async (): Promise<string | null> => source.token),
    getUserId: async (): Promise<string | null> => "source-user",
    onAuthChange: (): (() => void) => (): void => {},
    token,
  };
  return source;
};

beforeEach(() => {
  authToken = "test-token";
  setTokenSource(undefined);
  transports.length = 0;
  chatOptions.length = 0;
});

describe("useTerrenoChat", () => {
  it("defaults to the resolved base url and chat path", () => {
    const result = useTerrenoChat();

    expect(transports[0]?.options.api).toBe("https://api.example.com/api/chat");
    expect(chatOptions[0]?.id).toBeUndefined();
    expect(chatOptions[0]?.onError).toBeUndefined();
    expect(result).toBe(chatResult);
  });

  it("uses the provided base url and api path", () => {
    useTerrenoChat({apiPath: "/chat/stream", baseURL: "https://chat.example.com"});

    expect(transports[0]?.options.api).toBe("https://chat.example.com/chat/stream");
  });

  it("forwards the chat id and error handler to useChat", () => {
    const onError = mock((_error: Error) => {});

    useTerrenoChat({id: "chat-1", onError});

    expect(chatOptions[0]?.id).toBe("chat-1");
    expect(chatOptions[0]?.onError).toBe(onError);
  });

  it("injects a bearer token header when a token is available", async () => {
    useTerrenoChat();

    await expect(transports[0]?.options.headers()).resolves.toEqual({
      Authorization: "Bearer test-token",
    });
  });

  it("omits the authorization header when no token is available", async () => {
    authToken = null;
    useTerrenoChat();

    await expect(transports[0]?.options.headers()).resolves.toEqual({});
  });

  describe("token source", () => {
    it("sends the registered source's token instead of the JWT", async () => {
      setTokenSource(makeTokenSource("source-token"));
      useTerrenoChat();

      await expect(transports[0]?.options.headers()).resolves.toEqual({
        Authorization: "Bearer source-token",
      });
    });

    it("omits the authorization header when the registered source has no token", async () => {
      setTokenSource(makeTokenSource(null));
      useTerrenoChat();

      await expect(transports[0]?.options.headers()).resolves.toEqual({});
    });

    it("prefers the tokenSource option over the registered source", async () => {
      setTokenSource(makeTokenSource("registered-token"));
      useTerrenoChat({tokenSource: makeTokenSource("option-token")});

      await expect(transports[0]?.options.headers()).resolves.toEqual({
        Authorization: "Bearer option-token",
      });
    });

    it("reads the source on every request", async () => {
      const source = makeTokenSource("first-token");
      setTokenSource(source);
      useTerrenoChat();
      const headers = transports[0]?.options.headers;

      await expect(headers?.()).resolves.toEqual({Authorization: "Bearer first-token"});
      source.token = "second-token";
      await expect(headers?.()).resolves.toEqual({Authorization: "Bearer second-token"});
      expect(source.getToken).toHaveBeenCalledTimes(2);
    });

    it("picks up a source registered after the hook rendered", async () => {
      useTerrenoChat();
      setTokenSource(makeTokenSource("late-token"));

      await expect(transports[0]?.options.headers()).resolves.toEqual({
        Authorization: "Bearer late-token",
      });
    });
  });
});
