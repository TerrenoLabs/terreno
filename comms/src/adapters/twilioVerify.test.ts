import {afterEach, describe, it} from "bun:test";
import {assert} from "chai";
import {evaluateRetryBlock} from "../commsRetry";
import {CommsService} from "../commsService";
import {CommsMessage} from "../models/commsMessage";
import {type TwilioVerifyClient, TwilioVerifyProvider} from "./twilioVerify";

interface VerifyStartCall {
  channel: string;
  to: string;
}

interface VerifyCheckCall {
  code: string;
  to: string;
}

const createMockClient = ({
  checkStatus,
  startError,
  startSid = "VE123",
  startStatus = "pending",
}: {
  checkStatus?: string;
  startError?: Error;
  startSid?: string;
  startStatus?: string;
} = {}): TwilioVerifyClient & {checkCalls: VerifyCheckCall[]; startCalls: VerifyStartCall[]} => {
  const checkCalls: VerifyCheckCall[] = [];
  const startCalls: VerifyStartCall[] = [];
  return {
    checkCalls,
    startCalls,
    verify: {
      v2: {
        services: () => ({
          verificationChecks: {
            create: async (params: VerifyCheckCall): Promise<{status: string}> => {
              checkCalls.push(params);
              return {status: checkStatus ?? "approved"};
            },
          },
          verifications: {
            create: async (params: VerifyStartCall): Promise<{sid: string; status: string}> => {
              startCalls.push(params);
              if (startError) {
                throw startError;
              }
              return {sid: startSid, status: startStatus};
            },
          },
        }),
      },
    },
  };
};

const providerOptions = (
  client: TwilioVerifyClient
): ConstructorParameters<typeof TwilioVerifyProvider>[0] => ({
  accountSid: "ACtest",
  authToken: "token",
  client,
  verifyServiceSid: "VAservice",
});

describe("TwilioVerifyProvider", () => {
  it("fails fast when verify service SID is missing", (): void => {
    Reflect.deleteProperty(process.env, "TWILIO_VERIFY_SERVICE_SID");
    assert.throws(
      (): TwilioVerifyProvider =>
        new TwilioVerifyProvider({
          accountSid: "ACtest",
          authToken: "token",
          client: createMockClient(),
        }),
      /TWILIO_VERIFY_SERVICE_SID/
    );
  });

  it("constructs without an injected client when the twilio peer is installed", (): void => {
    const provider = new TwilioVerifyProvider({
      accountSid: "ACtest",
      authToken: "token",
      verifyServiceSid: "VAservice",
    });
    assert.equal(provider.id, "twilio-verify");
  });

  it("starts SMS and email verifications on the configured service", async (): Promise<void> => {
    const client = createMockClient({startSid: "VEsms"});
    const provider = new TwilioVerifyProvider(providerOptions(client));

    const sms = await provider.startVerification({channel: "sms", to: "+14155552671"});
    const email = await provider.startVerification({
      channel: "email",
      to: "person@example.com",
    });

    assert.isTrue(sms.accepted);
    assert.equal(sms.providerMessageId, "VEsms");
    assert.isTrue(email.accepted);
    assert.deepEqual(
      client.startCalls.map((call) => call.channel),
      ["sms", "email"]
    );
  });

  it("returns valid true only for approved checks", async (): Promise<void> => {
    const approved = createMockClient({checkStatus: "approved"});
    const pending = createMockClient({checkStatus: "pending"});
    const expired = createMockClient({checkStatus: "expired"});
    const maxAttempts = createMockClient({checkStatus: "max_attempts_reached"});

    const approvedResult = await new TwilioVerifyProvider(
      providerOptions(approved)
    ).checkVerification({
      code: "123456",
      to: "+14155552671",
    });
    const pendingResult = await new TwilioVerifyProvider(
      providerOptions(pending)
    ).checkVerification({
      code: "123456",
      to: "+14155552671",
    });
    const expiredResult = await new TwilioVerifyProvider(
      providerOptions(expired)
    ).checkVerification({
      code: "123456",
      to: "+14155552671",
    });
    const maxResult = await new TwilioVerifyProvider(
      providerOptions(maxAttempts)
    ).checkVerification({
      code: "123456",
      to: "+14155552671",
    });

    assert.isTrue(approvedResult.valid);
    assert.isUndefined(approvedResult.error);
    assert.isFalse(pendingResult.valid);
    assert.equal(pendingResult.error, "pending");
    assert.isFalse(expiredResult.valid);
    assert.equal(expiredResult.error, "expired");
    assert.isFalse(maxResult.valid);
    assert.equal(maxResult.error, "max-attempts");
  });

  it("redacts destination and omits codes from verification log rows", async (): Promise<void> => {
    const client = createMockClient({startSid: "VElog"});
    const provider = new TwilioVerifyProvider(providerOptions(client));
    const service = new CommsService({verification: provider});

    const result = await service.startVerification({
      channel: "sms",
      to: "+14155552671",
    });
    await service.checkVerification({code: "999111", to: "+14155552671"});

    const startRow = await CommsMessage.findExactlyOne({_id: result.loggedMessageId});
    const checkRow = await CommsMessage.findExactlyOne({
      channel: "verification",
      providerMessageId: {$exists: false},
      status: "sent",
    });
    const serialized = JSON.stringify([startRow.toJSON(), checkRow.toJSON()]);
    assert.equal(startRow.to, "[redacted]");
    assert.equal(startRow.channel, "verification");
    assert.equal((startRow.metadata as {verificationChannel?: string}).verificationChannel, "sms");
    assert.include(String(startRow.metadata?.consoleUrl), "VAservice");
    assert.notInclude(serialized, "999111");
    assert.notInclude(serialized, "+14155552671");
  });

  it("classifies start failures and fires onError without retrying verification", async (): Promise<void> => {
    const startError = new Error("Authenticate") as Error & {code: number; status: number};
    startError.code = 20003;
    startError.status = 401;
    const client = createMockClient({startError});
    const provider = new TwilioVerifyProvider(providerOptions(client));
    const onErrorCalls: Array<{errorClass?: string; errorCode?: string}> = [];
    const service = new CommsService({
      onError: async (_context, sendResult): Promise<void> => {
        onErrorCalls.push(sendResult);
      },
      verification: provider,
    });

    const result = await service.startVerification({
      channel: "sms",
      to: "+14155552671",
    });
    const row = await CommsMessage.findExactlyOne({_id: result.loggedMessageId});
    const block = evaluateRetryBlock({
      isChannelConfigured: () => true,
      message: row,
    });

    assert.isFalse(result.accepted);
    assert.equal(result.errorClass, "config");
    assert.equal(result.errorCode, "20003");
    assert.equal(onErrorCalls.length, 1);
    assert.equal(onErrorCalls[0]?.errorClass, "config");
    assert.equal(block?.code, "comms-retry-not-retryable");
  });
  describe("credentials", () => {
    afterEach((): void => {
      Reflect.deleteProperty(process.env, "TWILIO_ACCOUNT_SID");
      Reflect.deleteProperty(process.env, "TWILIO_AUTH_TOKEN");
      Reflect.deleteProperty(process.env, "TWILIO_VERIFY_SERVICE_SID");
    });

    it("fails fast when the account SID or auth token is missing", (): void => {
      assert.throws(
        (): TwilioVerifyProvider => new TwilioVerifyProvider({client: createMockClient()}),
        /TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN/
      );
      assert.throws(
        (): TwilioVerifyProvider =>
          new TwilioVerifyProvider({accountSid: "ACtest", client: createMockClient()}),
        /TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN/
      );
    });

    it("reads credentials and the service SID from the environment", async (): Promise<void> => {
      process.env.TWILIO_ACCOUNT_SID = "ACenv";
      process.env.TWILIO_AUTH_TOKEN = "env-token";
      process.env.TWILIO_VERIFY_SERVICE_SID = "VAenv";
      const services: string[] = [];
      const client = createMockClient();
      const provider = new TwilioVerifyProvider({
        client: {
          verify: {
            v2: {
              services: (serviceSid: string) => {
                services.push(serviceSid);
                return client.verify.v2.services(serviceSid);
              },
            },
          },
        },
      });

      const result = await provider.startVerification({channel: "sms", to: "+14155552671"});

      assert.deepEqual(services, ["VAenv"]);
      assert.include(String(result.metadata?.consoleUrl), "/VAenv");
    });
  });

  describe("start failure classification", () => {
    const startWith = async (thrown: unknown) => {
      const client: TwilioVerifyClient = {
        verify: {
          v2: {
            services: () => ({
              verificationChecks: {
                create: async (): Promise<{status: string}> => ({status: "approved"}),
              },
              verifications: {
                create: async (): Promise<{sid: string; status: string}> => {
                  throw thrown;
                },
              },
            }),
          },
        },
      };
      return new TwilioVerifyProvider(providerOptions(client)).startVerification({
        channel: "sms",
        to: "+14155552671",
      });
    };

    const twilioError = (fields: {
      code?: number;
      message?: string;
      moreInfo?: string;
      status?: number;
    }): Error => Object.assign(new Error(fields.message ?? "Twilio failure"), fields);

    it("marks invalid-destination codes as permanent failures", async (): Promise<void> => {
      const result = await startWith(
        twilioError({
          code: 60200,
          message: "Invalid parameter",
          moreInfo: "https://www.twilio.com/docs/errors/60200",
          status: 400,
        })
      );

      assert.isFalse(result.accepted);
      assert.equal(result.errorClass, "permanent");
      assert.equal(result.errorCode, "60200");
      assert.isTrue(result.isPermanentFailure);
      assert.equal(result.error, "Invalid parameter");
      assert.deepEqual(result.metadata?.twilioError, {
        code: 60200,
        message: "Invalid parameter",
        moreInfo: "https://www.twilio.com/docs/errors/60200",
        status: 400,
      });
    });

    it("treats rate limits and Twilio server errors as transient", async (): Promise<void> => {
      const rateLimited = await startWith(twilioError({code: 20429, status: 429}));
      const throttled = await startWith(twilioError({code: 12345, status: 429}));
      const unavailable = await startWith(twilioError({status: 503}));
      const unknownCode = await startWith(twilioError({code: 99999, status: 400}));

      assert.deepEqual(
        [rateLimited, throttled, unavailable, unknownCode].map((result) => [
          result.errorClass,
          result.errorCode,
          result.isPermanentFailure,
        ]),
        [
          ["transient", "20429", false],
          ["transient", "12345", false],
          ["transient", "twilio-503", false],
          ["transient", "99999", false],
        ]
      );
    });

    it("falls back to a network failure when the error has no Twilio fields", async (): Promise<void> => {
      const blankMessage = await startWith(twilioError({message: ""}));
      const plainObject = await startWith({message: 42});
      const thrownString = await startWith("socket hang up");

      assert.equal(blankMessage.errorCode, "twilio-network");
      assert.equal(blankMessage.error, "");
      assert.equal(plainObject.errorCode, "twilio-network");
      assert.equal(plainObject.error, "Twilio Verify request failed");
      assert.deepEqual(plainObject.metadata?.twilioError, {
        message: "Twilio Verify request failed",
      });
      assert.equal(thrownString.errorClass, "transient");
      assert.equal(thrownString.errorCode, "twilio-network");
      assert.equal(thrownString.error, "Twilio Verify request failed");
      assert.deepEqual(thrownString.metadata?.twilioError, {error: "socket hang up"});
    });
  });

  it("reports a failed check as invalid with the Twilio message", async (): Promise<void> => {
    const client: TwilioVerifyClient = {
      verify: {
        v2: {
          services: () => ({
            verificationChecks: {
              create: async (): Promise<{status: string}> => {
                throw Object.assign(new Error("Verification not found"), {
                  code: 20404,
                  status: 404,
                });
              },
            },
            verifications: {
              create: async (): Promise<{sid: string; status: string}> => ({
                sid: "VE1",
                status: "pending",
              }),
            },
          }),
        },
      },
    };

    const result = await new TwilioVerifyProvider(providerOptions(client)).checkVerification({
      code: "000000",
      to: "+14155552671",
    });

    assert.deepEqual(result, {error: "Verification not found", valid: false});
  });
});
