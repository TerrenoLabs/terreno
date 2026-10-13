import {afterEach, describe, expect, it} from "bun:test";

import {createLocalObservabilityPlugin} from "./local/localPlugin";
import {ObservabilityApp, resetObservabilityApp} from "./observabilityApp";
import {buildPlaygroundAiStatus} from "./status";

describe("buildPlaygroundAiStatus", () => {
  afterEach(() => {
    resetObservabilityApp();
  });

  it("prefers a configured server aiService", () => {
    const app = new ObservabilityApp({
      aiService: {} as never,
      plugins: [createLocalObservabilityPlugin()],
      requestAiServiceFactory: () => undefined,
    });

    expect(buildPlaygroundAiStatus(app)).toEqual({source: "server"});
  });

  it("reports request-key when only requestAiServiceFactory is configured", () => {
    const app = new ObservabilityApp({
      plugins: [createLocalObservabilityPlugin()],
      requestAiServiceFactory: () => undefined,
    });

    expect(buildPlaygroundAiStatus(app)).toEqual({source: "request-key"});
  });

  it("reports unavailable when neither AI path is configured", () => {
    const app = new ObservabilityApp({
      plugins: [createLocalObservabilityPlugin()],
    });

    expect(buildPlaygroundAiStatus(app)).toEqual({source: "unavailable"});
  });
});
