import {beforeAll, beforeEach, describe, expect, it, mock} from "bun:test";

interface FakeSdkOptions {
  serviceName?: string;
  spanProcessors?: unknown[];
}

const sdkStart = mock(() => {});
const sdkShutdown = mock(async () => {});
let lastSdkOptions: FakeSdkOptions | null = null;

class FakeNodeSDK {
  constructor(public opts: FakeSdkOptions) {
    lastSdkOptions = opts;
  }
  start() {
    sdkStart();
  }
  async shutdown() {
    await sdkShutdown();
  }
}

class FakeLangfuseSpanProcessor {
  constructor(public opts: Record<string, unknown>) {}
}

mock.module("@opentelemetry/sdk-node", () => ({NodeSDK: FakeNodeSDK}));
mock.module("@langfuse/otel", () => ({LangfuseSpanProcessor: FakeLangfuseSpanProcessor}));

let initTracing: typeof import("./langfuseTracing.js").initTracing;
let shutdownTracing: typeof import("./langfuseTracing.js").shutdownTracing;
beforeAll(async () => {
  ({initTracing, shutdownTracing} = await import("./langfuseTracing.js"));
});

describe("langfuseTracing", () => {
  beforeEach(async () => {
    await shutdownTracing();
    sdkStart.mockClear();
    sdkShutdown.mockClear();
    lastSdkOptions = null;
  });

  it("initializes a NodeSDK with default service name", () => {
    initTracing({publicKey: "pk", secretKey: "sk"});
    expect(sdkStart).toHaveBeenCalled();
    expect(lastSdkOptions?.serviceName).toBe("terreno-app");
    expect(lastSdkOptions?.spanProcessors).toHaveLength(1);
  });

  it("respects serviceName and baseUrl", () => {
    initTracing({
      baseUrl: "https://lf.example.com",
      publicKey: "pk",
      secretKey: "sk",
      serviceName: "my-service",
    });
    expect(lastSdkOptions?.serviceName).toBe("my-service");
  });

  it("shuts down the SDK", async () => {
    initTracing({publicKey: "pk", secretKey: "sk"});
    await shutdownTracing();
    expect(sdkShutdown).toHaveBeenCalled();
  });

  it("no-ops shutdown when not initialized", async () => {
    await shutdownTracing();
    expect(sdkShutdown).not.toHaveBeenCalled();
  });
});
