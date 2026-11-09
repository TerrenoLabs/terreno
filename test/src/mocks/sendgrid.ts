import {type Mock, mock} from "bun:test";

import {createMockGroup} from "./mockGroup";

export interface SendGridMockResponse {
  body: unknown;
  headers: Record<string, string>;
  statusCode: number;
}

export type SendGridMockSendResult = [SendGridMockResponse, Record<string, never>];

export interface SendGridMock {
  /** `send(data)` resolves `[{statusCode: 202, headers: {"x-message-id": ...}}, {}]`. */
  send: Mock<(data: unknown, isMultiple?: boolean) => Promise<SendGridMockSendResult>>;
  setApiKey: Mock<(apiKey: string) => void>;
  /** Every message passed to `send`, flattened when `send` gets an array. */
  getSentMessages: () => Record<string, unknown>[];
  /** Clears calls, overrides, and the message-id counter. */
  reset: () => void;
}

/**
 * Registers `mock.module("@sendgrid/mail", ...)` with both the CommonJS shape (`send` /
 * `setApiKey` on the module, what `require` returns) and a `default` export (what
 * `import sgMail from "@sendgrid/mail"` reads). `@sendgrid/mail` does not need to be installed.
 */
export const registerSendGridMock = (): SendGridMock => {
  const group = createMockGroup();
  let messageCount = 0;

  const send = group.fn(async (_data: unknown, _isMultiple?: boolean) => {
    messageCount += 1;
    const result: SendGridMockSendResult = [
      {body: "", headers: {"x-message-id": `mock-sendgrid-${messageCount}`}, statusCode: 202},
      {},
    ];
    return result;
  });
  const setApiKey = group.fn((_apiKey: string): void => {});

  const getSentMessages = (): Record<string, unknown>[] =>
    send.mock.calls.flatMap(([data]) => (Array.isArray(data) ? data : [data])) as Record<
      string,
      unknown
    >[];

  const reset = (): void => {
    group.reset();
    messageCount = 0;
  };

  const mailService = {send, setApiKey};
  mock.module("@sendgrid/mail", () => ({...mailService, default: mailService}));

  return {getSentMessages, reset, send, setApiKey};
};
