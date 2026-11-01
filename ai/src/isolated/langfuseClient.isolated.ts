import {beforeAll, beforeEach, describe, expect, it, mock} from "bun:test";

const shutdownMock = mock(async () => {});
class FakeLangfuseClient {
  constructor(public opts: {baseUrl?: string; publicKey: string; secretKey: string}) {}
  async shutdown(): Promise<void> {
    return shutdownMock();
  }
}

mock.module("@langfuse/client", () => ({
  LangfuseClient: FakeLangfuseClient,
}));

let getLangfuseClient: typeof import("../langfuseClient.js").getLangfuseClient;
let initLangfuseClient: typeof import("../langfuseClient.js").initLangfuseClient;
let isLangfuseInitialized: typeof import("../langfuseClient.js").isLangfuseInitialized;
let shutdownLangfuseClient: typeof import("../langfuseClient.js").shutdownLangfuseClient;
beforeAll(async () => {
  ({getLangfuseClient, initLangfuseClient, isLangfuseInitialized, shutdownLangfuseClient} =
    await import("../langfuseClient.js"));
});

describe("langfuseClient", () => {
  beforeEach(async () => {
    await shutdownLangfuseClient();
  });

  it("throws when accessing client before initialization", () => {
    expect(() => getLangfuseClient()).toThrow(/not initialized/);
    expect(isLangfuseInitialized()).toBe(false);
  });

  it("initializes a client with defaults", () => {
    const client = initLangfuseClient({
      publicKey: "pk",
      secretKey: "sk",
    });
    expect((client as unknown as FakeLangfuseClient).opts.baseUrl).toBe(
      "https://cloud.langfuse.com"
    );
    expect(isLangfuseInitialized()).toBe(true);
    expect(getLangfuseClient()).toBe(client);
  });

  it("respects a custom baseUrl", () => {
    const client = initLangfuseClient({
      baseUrl: "https://lf.example.com",
      publicKey: "pk",
      secretKey: "sk",
    });
    expect((client as unknown as FakeLangfuseClient).opts.baseUrl).toBe("https://lf.example.com");
  });

  it("shuts down the client", async () => {
    initLangfuseClient({publicKey: "pk", secretKey: "sk"});
    await shutdownLangfuseClient();
    expect(shutdownMock).toHaveBeenCalled();
    expect(isLangfuseInitialized()).toBe(false);
  });

  it("no-ops shutdown when no client is initialized", async () => {
    await shutdownLangfuseClient();
    expect(isLangfuseInitialized()).toBe(false);
  });
});
