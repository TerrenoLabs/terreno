import {type Mock, mock} from "bun:test";

import {createMockGroup} from "./mockGroup";

export interface ExpoMockPushMessage {
  body?: string;
  data?: Record<string, unknown>;
  title?: string;
  to: string | string[];
  [key: string]: unknown;
}

export interface ExpoMockPushTicket {
  details?: Record<string, unknown>;
  id?: string;
  message?: string;
  status: "ok" | "error";
}

export interface ExpoMockPushReceipt {
  details?: Record<string, unknown>;
  message?: string;
  status: "ok" | "error";
}

export interface ExpoMockClient {
  chunkPushNotificationReceiptIds: ExpoPushMock["chunkPushNotificationReceiptIds"];
  chunkPushNotifications: ExpoPushMock["chunkPushNotifications"];
  getPushNotificationReceiptsAsync: ExpoPushMock["getPushNotificationReceiptsAsync"];
  sendPushNotificationsAsync: ExpoPushMock["sendPushNotificationsAsync"];
}

export interface ExpoPushMock {
  /** `new Expo(options)` — every instance is the shared `client`. Has static `isExpoPushToken`. */
  Expo: Mock<(options?: {accessToken?: string}) => ExpoMockClient> & {
    isExpoPushToken: ExpoPushMock["isExpoPushToken"];
  };
  client: ExpoMockClient;
  /** Accepts `ExponentPushToken[...]`, `ExpoPushToken[...]`, and bare UUID device ids. */
  isExpoPushToken: Mock<(token: unknown) => boolean>;
  /** Splits into chunks of 100 messages, Expo's per-request limit. */
  chunkPushNotifications: Mock<(messages: ExpoMockPushMessage[]) => ExpoMockPushMessage[][]>;
  /** Splits into chunks of 300 ids, Expo's per-request limit. */
  chunkPushNotificationReceiptIds: Mock<(receiptIds: string[]) => string[][]>;
  /** Resolves one `{status: "ok", id}` ticket per recipient. */
  sendPushNotificationsAsync: Mock<
    (messages: ExpoMockPushMessage[]) => Promise<ExpoMockPushTicket[]>
  >;
  /** Resolves `{status: "ok"}` for every requested receipt id. */
  getPushNotificationReceiptsAsync: Mock<
    (receiptIds: string[]) => Promise<Record<string, ExpoMockPushReceipt>>
  >;
  /** Every message passed to `sendPushNotificationsAsync`, in order. */
  getSentMessages: () => ExpoMockPushMessage[];
  /** Clears calls, overrides, and the ticket counter. */
  reset: () => void;
}

const EXPO_TOKEN_PATTERN = /^Expo(nent)?PushToken\[.+\]$/;
const UUID_PATTERN = /^[a-z\d]{8}-[a-z\d]{4}-[a-z\d]{4}-[a-z\d]{4}-[a-z\d]{12}$/i;

const chunk = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
};

/**
 * Registers `mock.module("expo-server-sdk", ...)` exporting `Expo` (named and default).
 * `expo-server-sdk` does not need to be installed.
 */
export const registerExpoPushMock = (): ExpoPushMock => {
  const group = createMockGroup();
  let ticketCount = 0;

  const isExpoPushToken = group.fn(
    (token: unknown): boolean =>
      typeof token === "string" && (EXPO_TOKEN_PATTERN.test(token) || UUID_PATTERN.test(token))
  );
  const chunkPushNotifications = group.fn(
    (messages: ExpoMockPushMessage[]): ExpoMockPushMessage[][] => chunk(messages, 100)
  );
  const chunkPushNotificationReceiptIds = group.fn((receiptIds: string[]): string[][] =>
    chunk(receiptIds, 300)
  );
  const sendPushNotificationsAsync = group.fn(
    async (messages: ExpoMockPushMessage[]): Promise<ExpoMockPushTicket[]> =>
      messages
        .flatMap((message) => (Array.isArray(message.to) ? message.to : [message.to]))
        .map((): ExpoMockPushTicket => {
          ticketCount += 1;
          return {id: `mock-ticket-${ticketCount}`, status: "ok"};
        })
  );
  const getPushNotificationReceiptsAsync = group.fn(
    async (receiptIds: string[]): Promise<Record<string, ExpoMockPushReceipt>> =>
      Object.fromEntries(receiptIds.map((id) => [id, {status: "ok" as const}]))
  );

  const client: ExpoMockClient = {
    chunkPushNotificationReceiptIds,
    chunkPushNotifications,
    getPushNotificationReceiptsAsync,
    sendPushNotificationsAsync,
  };
  const Expo = Object.assign(
    group.fn((_options?: {accessToken?: string}): ExpoMockClient => client),
    {isExpoPushToken}
  );

  const getSentMessages = (): ExpoMockPushMessage[] =>
    sendPushNotificationsAsync.mock.calls.flatMap(([messages]) => messages);

  const reset = (): void => {
    group.reset();
    ticketCount = 0;
  };

  mock.module("expo-server-sdk", () => ({default: Expo, Expo}));

  return {
    chunkPushNotificationReceiptIds,
    chunkPushNotifications,
    client,
    Expo,
    getPushNotificationReceiptsAsync,
    getSentMessages,
    isExpoPushToken,
    reset,
    sendPushNotificationsAsync,
  };
};
