import {beforeEach, describe, expect, it} from "bun:test";
import {createRequire} from "node:module";

import {type ExpoMockClient, registerExpoPushMock} from "./expoPush";

const expoPush = registerExpoPushMock();

interface ExpoClass {
  isExpoPushToken: (token: unknown) => boolean;
  new (options?: {accessToken?: string}): ExpoMockClient;
}

describe("registerExpoPushMock", () => {
  beforeEach((): void => {
    expoPush.reset();
  });

  it("serves Expo from require and import with a static token check", async (): Promise<void> => {
    const {Expo} = createRequire(import.meta.url)("expo-server-sdk") as {Expo: ExpoClass};
    const esm = (await import("expo-server-sdk")) as unknown as {default: ExpoClass};

    expect(new Expo({accessToken: "t"})).toBe(expoPush.client);
    expect(new esm.default()).toBe(expoPush.client);
    expect(expoPush.Expo).toHaveBeenCalledWith({accessToken: "t"});
    expect(Expo.isExpoPushToken("ExponentPushToken[abc]")).toBe(true);
    expect(Expo.isExpoPushToken("ExpoPushToken[abc]")).toBe(true);
    expect(Expo.isExpoPushToken("a1b2c3d4-e5f6-a7b8-c9d0-e1f2a3b4c5d6")).toBe(true);
    expect(Expo.isExpoPushToken("not-a-token")).toBe(false);
    expect(Expo.isExpoPushToken(42)).toBe(false);
  });

  it("chunks, sends one ticket per recipient, and reports ok receipts", async (): Promise<void> => {
    const messages = Array.from({length: 101}, (_, index) => ({
      body: `m${index}`,
      to: `ExponentPushToken[${index}]`,
    }));
    const chunks = expoPush.client.chunkPushNotifications(messages);
    expect(chunks.map((part) => part.length)).toEqual([100, 1]);
    expect(
      expoPush.client.chunkPushNotificationReceiptIds(Array.from({length: 301}, String))
    ).toHaveLength(2);

    const tickets = await expoPush.client.sendPushNotificationsAsync([
      {body: "solo", to: "ExponentPushToken[a]"},
      {body: "group", to: ["ExponentPushToken[b]", "ExponentPushToken[c]"]},
    ]);
    expect(tickets).toEqual([
      {id: "mock-ticket-1", status: "ok"},
      {id: "mock-ticket-2", status: "ok"},
      {id: "mock-ticket-3", status: "ok"},
    ]);
    expect(expoPush.getSentMessages().map((message) => message.body)).toEqual(["solo", "group"]);

    const receipts = await expoPush.client.getPushNotificationReceiptsAsync(["mock-ticket-1"]);
    expect(receipts).toEqual({"mock-ticket-1": {status: "ok"}});
  });

  it("reset restores defaults after an override", async (): Promise<void> => {
    expoPush.sendPushNotificationsAsync.mockResolvedValueOnce([
      {details: {error: "DeviceNotRegistered"}, message: "gone", status: "error"},
    ]);
    const [ticket] = await expoPush.client.sendPushNotificationsAsync([{to: "ExpoPushToken[x]"}]);
    expect(ticket?.status).toBe("error");

    expoPush.reset();

    expect(expoPush.getSentMessages()).toEqual([]);
    const [fresh] = await expoPush.client.sendPushNotificationsAsync([{to: "ExpoPushToken[x]"}]);
    expect(fresh).toEqual({id: "mock-ticket-1", status: "ok"});
    expect(expoPush.Expo.isExpoPushToken("ExpoPushToken[x]")).toBe(true);
  });
});
