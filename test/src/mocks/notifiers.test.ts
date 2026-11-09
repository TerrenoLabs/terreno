import {beforeEach, describe, expect, it} from "bun:test";

import {registerTerrenoNotifierMocks} from "./notifiers";

type Notifier = (...args: unknown[]) => Promise<void>;

interface ApiModule {
  APIError: unknown;
  sendToGoogleChat: Notifier;
  sendToSlack: Notifier;
  sendToZoom: Notifier;
}

// A variable specifier keeps @terreno/api a runtime-only lookup, matching the helper.
const API_MODULE = "@terreno/api";
const realApi = require(API_MODULE) as ApiModule;
const realSendToSlack = realApi.sendToSlack;
const notifiers = registerTerrenoNotifierMocks();

describe("registerTerrenoNotifierMocks", () => {
  beforeEach((): void => {
    notifiers.reset();
  });

  it("replaces the notifiers and keeps every other export", async (): Promise<void> => {
    const api = (await import(API_MODULE)) as ApiModule;

    expect(api.sendToSlack).toBe(notifiers.sendToSlack);
    expect(api.sendToSlack).not.toBe(realSendToSlack);
    expect(api.APIError).toBe(realApi.APIError);

    await api.sendToSlack("hello", {slackChannel: "ops"});
    await api.sendToZoom({body: "b", header: "h"}, {channel: "default"});
    await api.sendToGoogleChat("chat");

    expect(notifiers.sendToSlack).toHaveBeenCalledWith("hello", {slackChannel: "ops"});
    expect(notifiers.sendToZoom).toHaveBeenCalledTimes(1);
    expect(notifiers.sendToGoogleChat).toHaveBeenCalledWith("chat");
  });

  it("reset clears calls and overrides", async (): Promise<void> => {
    const api = require(API_MODULE) as ApiModule;
    notifiers.sendToSlack.mockRejectedValueOnce(new Error("slack down"));
    await expect(api.sendToSlack("x")).rejects.toThrow("slack down");

    notifiers.reset();

    expect(notifiers.sendToSlack).toHaveBeenCalledTimes(0);
    await expect(api.sendToSlack("y")).resolves.toBeUndefined();
  });
});
