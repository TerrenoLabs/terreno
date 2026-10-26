import {type Mock, mock} from "bun:test";

import {createMockGroup} from "./mockGroup";

export interface TwilioMessageCreateParams {
  body?: string;
  from?: string;
  messagingServiceSid?: string;
  statusCallback?: string;
  to: string;
  [key: string]: unknown;
}

export interface TwilioMockMessage {
  body?: string;
  from?: string;
  sid: string;
  status: string;
  to: string;
}

export interface TwilioMockVerification {
  channel: string;
  sid: string;
  status: string;
  to: string;
}

export interface TwilioMockVerificationCheck {
  status: string;
  to: string;
  valid: boolean;
}

export interface TwilioMockVerifyService {
  verificationChecks: {
    create: TwilioMock["verificationChecksCreate"];
  };
  verifications: {
    create: TwilioMock["verificationsCreate"];
  };
}

export interface TwilioMockClient {
  messages: {create: TwilioMock["messagesCreate"]};
  verify: {v2: {services: TwilioMock["verifyServices"]}};
}

export interface TwilioMock {
  /** `twilio(accountSid, authToken)`; also `new Twilio(...)`. Returns the shared `client`. */
  twilio: Mock<(accountSid?: string, authToken?: string) => TwilioMockClient>;
  client: TwilioMockClient;
  /** `client.messages.create` — resolves `{sid: "SMmock…", status: "queued"}`. */
  messagesCreate: Mock<(params: TwilioMessageCreateParams) => Promise<TwilioMockMessage>>;
  /** `client.verify.v2.services(serviceSid)`. */
  verifyServices: Mock<(serviceSid: string) => TwilioMockVerifyService>;
  /** `services(sid).verifications.create` — resolves `status: "pending"`. */
  verificationsCreate: Mock<
    (params: {channel: string; to: string}) => Promise<TwilioMockVerification>
  >;
  /** `services(sid).verificationChecks.create` — approves every code by default. */
  verificationChecksCreate: Mock<
    (params: {code: string; to: string}) => Promise<TwilioMockVerificationCheck>
  >;
  /** Clears calls, overrides, and the sid counter. */
  reset: () => void;
}

const padSid = (prefix: string, count: number): string =>
  `${prefix}mock${String(count).padStart(28, "0")}`;

/**
 * Registers `mock.module("twilio", ...)`. The module is the callable factory, so both
 * `require("twilio")(sid, token)` and `import twilio from "twilio"` work. `twilio` does not need
 * to be installed.
 */
export const registerTwilioMock = (): TwilioMock => {
  const group = createMockGroup();
  let sidCount = 0;
  const nextSid = (prefix: string): string => {
    sidCount += 1;
    return padSid(prefix, sidCount);
  };

  const messagesCreate = group.fn(
    async (params: TwilioMessageCreateParams): Promise<TwilioMockMessage> => ({
      body: params.body,
      from: params.from,
      sid: nextSid("SM"),
      status: "queued",
      to: params.to,
    })
  );
  const verificationsCreate = group.fn(
    async (params: {channel: string; to: string}): Promise<TwilioMockVerification> => ({
      channel: params.channel,
      sid: nextSid("VE"),
      status: "pending",
      to: params.to,
    })
  );
  const verificationChecksCreate = group.fn(
    async (params: {code: string; to: string}): Promise<TwilioMockVerificationCheck> => ({
      status: "approved",
      to: params.to,
      valid: true,
    })
  );
  const service: TwilioMockVerifyService = {
    verificationChecks: {create: verificationChecksCreate},
    verifications: {create: verificationsCreate},
  };
  const verifyServices = group.fn((_serviceSid: string): TwilioMockVerifyService => service);
  const client: TwilioMockClient = {
    messages: {create: messagesCreate},
    verify: {v2: {services: verifyServices}},
  };
  const twilio = group.fn((_accountSid?: string, _authToken?: string): TwilioMockClient => client);

  const reset = (): void => {
    group.reset();
    sidCount = 0;
  };

  const twilioModule = Object.assign(
    (accountSid?: string, authToken?: string): TwilioMockClient => twilio(accountSid, authToken),
    {Twilio: twilio}
  );
  // `__esModule` makes Bun's `require` return the callable itself rather than a namespace.
  mock.module("twilio", () =>
    Object.assign(twilioModule, {__esModule: true, default: twilioModule})
  );

  return {
    client,
    messagesCreate,
    reset,
    twilio,
    verificationChecksCreate,
    verificationsCreate,
    verifyServices,
  };
};
