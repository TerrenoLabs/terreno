import {beforeEach, describe, it, spyOn} from "bun:test";
import {type APIError, isAPIError, logger} from "@terreno/api";
import {setupDb} from "@terreno/api/testing";
import {assert} from "chai";
import {DateTime} from "luxon";
import mongoose from "mongoose";
import {CommsService} from "./commsService";
import {CommsMessage} from "./models/commsMessage";
import {PushToken} from "./models/pushToken";
import type {
  CheckVerificationOptions,
  CommsHookContext,
  MailMessage,
  MailProvider,
  PushMessage,
  PushProvider,
  SendResult,
  SmsProvider,
  StartVerificationOptions,
  VerificationProvider,
} from "./types";

const captureError = async (operation: () => Promise<unknown>): Promise<unknown> => {
  try {
    await operation();
    return undefined;
  } catch (error: unknown) {
    return error;
  }
};

describe("CommsService", () => {
  beforeEach(async (): Promise<void> => {
    await setupDb();
    await Promise.all([CommsMessage.deleteMany({}), PushToken.deleteMany({})]);
  });

  it("delegates every configured channel and records each attempt", async (): Promise<void> => {
    const userId = new mongoose.Types.ObjectId();
    await PushToken.upsert(
      {token: "ExponentPushToken[test]"},
      {
        active: true,
        lastSeenAt: DateTime.utc().toJSDate(),
        platform: "ios",
        userId,
      }
    );

    let deliveredMail: MailMessage | undefined;
    const mail: MailProvider = {
      id: "memory-mail",
      sendMail: async (message: MailMessage): Promise<SendResult> => {
        deliveredMail = message;
        return {accepted: true, providerMessageId: "mail-1"};
      },
    };
    const sms: SmsProvider = {
      id: "memory-sms",
      sendSms: async (): Promise<SendResult> => ({
        accepted: true,
        providerMessageId: "sms-1",
      }),
    };
    const push: PushProvider = {
      id: "memory-push",
      sendPush: async (message: PushMessage): Promise<SendResult[]> =>
        message.tokens.map((_token, index) => ({
          accepted: true,
          providerMessageId: `push-${index}`,
        })),
    };
    const verification: VerificationProvider = {
      checkVerification: async (): Promise<{valid: boolean}> => ({valid: true}),
      id: "memory-verification",
      startVerification: async (): Promise<SendResult> => ({
        accepted: true,
        providerMessageId: "verification-1",
      }),
    };
    const service = new CommsService({
      defaultFrom: "sender@example.com",
      mail,
      push,
      sms,
      verification,
    });

    const mailResult = await service.sendMail({subject: "Welcome", to: "person@example.com"});
    const smsResult = await service.sendSms({body: "Hello", to: "+15555550100"});
    const pushResults = await service.sendPushToUser({body: "Hello", title: "Title", userId});
    const startResult = await service.startVerification({
      channel: "sms",
      to: "+15555550100",
    });
    const checkResult = await service.checkVerification({
      code: "123456",
      to: "+15555550100",
    });

    assert.equal(deliveredMail?.from, "sender@example.com");
    assert.isTrue(mailResult.accepted);
    assert.isTrue(smsResult.accepted);
    assert.lengthOf(pushResults, 1);
    assert.isTrue(startResult.accepted);
    assert.isTrue(checkResult.valid);
    assert.equal(await CommsMessage.countDocuments(), 5);
    assert.equal(await CommsMessage.countDocuments({to: "[redacted]"}), 5);
    assert.equal(
      await CommsMessage.countDocuments({
        channel: "mail",
        provider: "memory-mail",
        providerMessageId: "mail-1",
        status: "sent",
      }),
      1
    );
    assert.equal(
      await CommsMessage.countDocuments({
        channel: "sms",
        provider: "memory-sms",
        providerMessageId: "sms-1",
        status: "sent",
      }),
      1
    );
    assert.equal(
      await CommsMessage.countDocuments({
        channel: "push",
        provider: "memory-push",
        providerMessageId: "push-0",
        status: "sent",
      }),
      1
    );
    assert.equal(
      await CommsMessage.countDocuments({
        channel: "verification",
        provider: "memory-verification",
        status: "sent",
      }),
      2
    );
  });

  it("supports starting and checking both SMS and email verification", async (): Promise<void> => {
    const started: StartVerificationOptions[] = [];
    const checked: CheckVerificationOptions[] = [];
    const verification: VerificationProvider = {
      checkVerification: async (options): Promise<{valid: boolean}> => {
        checked.push(options);
        return {valid: true};
      },
      id: "multi-channel-verification",
      startVerification: async (options): Promise<SendResult> => {
        started.push(options);
        return {accepted: true};
      },
    };
    const service = new CommsService({verification});

    const smsStart = await service.startVerification({
      channel: "sms",
      to: "+15555550100",
    });
    const emailStart = await service.startVerification({
      channel: "email",
      to: "person@example.com",
    });
    const smsCheck = await service.checkVerification({
      code: "123456",
      to: "+15555550100",
    });
    const emailCheck = await service.checkVerification({
      code: "654321",
      to: "person@example.com",
    });

    assert.isTrue(smsStart.accepted);
    assert.isTrue(emailStart.accepted);
    assert.isTrue(smsCheck.valid);
    assert.isTrue(emailCheck.valid);
    assert.deepEqual(started, [
      {channel: "sms", to: "+15555550100"},
      {channel: "email", to: "person@example.com"},
    ]);
    assert.deepEqual(checked, [
      {code: "123456", to: "+15555550100"},
      {code: "654321", to: "person@example.com"},
    ]);
    assert.equal(
      await CommsMessage.countDocuments({
        channel: "verification",
        provider: "multi-channel-verification",
        status: "sent",
        to: "[redacted]",
      }),
      4
    );
    assert.equal(await CommsMessage.countDocuments({to: "+15555550100"}), 0);
    assert.equal(await CommsMessage.countDocuments({to: "person@example.com"}), 0);
    assert.equal(await CommsMessage.countDocuments({"metadata.verificationChannel": "sms"}), 1);
    assert.equal(await CommsMessage.countDocuments({"metadata.verificationChannel": "email"}), 1);
    const serializedAuditRows = JSON.stringify(
      await CommsMessage.find({provider: "multi-channel-verification"})
    );
    for (const sensitiveValue of ["+15555550100", "person@example.com", "123456", "654321"]) {
      assert.notInclude(serializedAuditRows, sensitiveValue);
    }
  });

  it("uses console providers for every unconfigured channel outside production", async (): Promise<void> => {
    const userId = new mongoose.Types.ObjectId();
    await PushToken.upsert(
      {token: "ExponentPushToken[console]"},
      {
        active: true,
        lastSeenAt: DateTime.utc().toJSDate(),
        platform: "ios",
        userId,
      }
    );
    const service = new CommsService();

    assert.isTrue(
      (await service.sendMail({subject: "Welcome", to: "person@example.com"})).accepted
    );
    assert.isTrue((await service.sendSms({body: "Hello", to: "+15555550100"})).accepted);
    assert.isTrue(
      (await service.sendPushToUser({body: "Hello", title: "Title", userId}))[0]?.accepted
    );
    assert.isTrue(
      (
        await service.startVerification({
          channel: "sms",
          to: "+15555550100",
        })
      ).accepted
    );
    assert.isTrue(
      (
        await service.checkVerification({
          code: "123456",
          to: "+15555550100",
        })
      ).valid
    );
    assert.isTrue(
      (
        await service.startVerification({
          channel: "email",
          to: "person@example.com",
        })
      ).accepted
    );
    assert.isTrue(
      (
        await service.checkVerification({
          code: "654321",
          to: "person@example.com",
        })
      ).valid
    );
    assert.equal(await CommsMessage.countDocuments(), 7);
    assert.equal(await CommsMessage.countDocuments({provider: "console", to: "[redacted]"}), 7);
    assert.equal(await CommsMessage.countDocuments({to: "person@example.com"}), 0);
  });

  it("throws a 501 APIError for every unconfigured channel in production", async (): Promise<void> => {
    process.env.NODE_ENV = "production";
    const service = new CommsService();
    const userId = new mongoose.Types.ObjectId();
    const operations = [
      (): Promise<unknown> => service.sendMail({subject: "Welcome", to: "person@example.com"}),
      (): Promise<unknown> => service.sendSms({body: "Hello", to: "+15555550100"}),
      (): Promise<unknown> => service.sendPushToUser({body: "Hello", title: "Title", userId}),
      (): Promise<unknown> => service.startVerification({channel: "sms", to: "+15555550100"}),
      (): Promise<unknown> => service.checkVerification({code: "123456", to: "+15555550100"}),
      (): Promise<unknown> =>
        service.startVerification({channel: "email", to: "person@example.com"}),
      (): Promise<unknown> => service.checkVerification({code: "654321", to: "person@example.com"}),
    ];

    for (const operation of operations) {
      const error = await captureError(operation);
      assert.isTrue(isAPIError(error));
      assert.equal((error as APIError).status, 501);
      assert.equal((error as APIError).title, "Comms channel not configured");
    }
    assert.equal(await CommsMessage.countDocuments(), 0);
  });

  it("records failed rows when configured providers throw", async (): Promise<void> => {
    const userId = new mongoose.Types.ObjectId();
    await PushToken.upsert(
      {token: "ExponentPushToken[throw]"},
      {
        active: true,
        lastSeenAt: DateTime.utc().toJSDate(),
        platform: "ios",
        userId,
      }
    );
    const throwProviderError = async (): Promise<never> => {
      throw new Error("Provider unavailable");
    };
    const service = new CommsService({
      mail: {id: "throw-mail", sendMail: throwProviderError},
      push: {id: "throw-push", sendPush: throwProviderError},
      sms: {id: "throw-sms", sendSms: throwProviderError},
      verification: {
        checkVerification: throwProviderError,
        id: "throw-verification",
        startVerification: throwProviderError,
      },
    });
    const mailResult = await service.sendMail({subject: "Welcome", to: "person@example.com"});
    const smsResult = await service.sendSms({body: "Hello", to: "+15555550100"});
    const pushResults = await service.sendPushToUser({body: "Hello", title: "Title", userId});
    const smsStart = await service.startVerification({channel: "sms", to: "+15555550100"});
    const smsCheck = await service.checkVerification({code: "654321", to: "+15555550100"});
    const emailStart = await service.startVerification({
      channel: "email",
      to: "person@example.com",
    });
    const emailCheck = await service.checkVerification({
      code: "123456",
      to: "person@example.com",
    });

    assert.isFalse(mailResult.accepted);
    assert.equal(mailResult.error, "Provider unavailable");
    assert.equal(mailResult.errorClass, "transient");
    assert.equal(mailResult.errorCode, "provider-throw");
    assert.isFalse(smsResult.accepted);
    assert.equal(smsResult.errorClass, "transient");
    assert.isFalse(pushResults[0]?.accepted);
    assert.isFalse(smsStart.accepted);
    assert.isFalse(smsCheck.valid);
    assert.isFalse(emailStart.accepted);
    assert.isFalse(emailCheck.valid);

    assert.equal(await CommsMessage.countDocuments({status: "failed"}), 7);
    assert.equal(await CommsMessage.countDocuments({to: "[redacted]"}), 7);
    assert.equal(
      await CommsMessage.countDocuments({
        channel: "mail",
        error: "Provider unavailable",
        errorClass: "transient",
        provider: "throw-mail",
        status: "failed",
      }),
      1
    );
    assert.equal(
      await CommsMessage.countDocuments({
        channel: "verification",
        error: "Provider unavailable",
        errorClass: "transient",
        "metadata.verificationChannel": "sms",
        provider: "throw-verification",
        status: "failed",
      }),
      1
    );
    assert.equal(
      await CommsMessage.countDocuments({
        channel: "sms",
        error: "Provider unavailable",
        errorClass: "transient",
        provider: "throw-sms",
        status: "failed",
      }),
      1
    );
    assert.equal(
      await CommsMessage.countDocuments({
        channel: "push",
        error: "Provider unavailable",
        errorClass: "transient",
        provider: "throw-push",
        status: "failed",
      }),
      1
    );
    assert.equal(
      await CommsMessage.countDocuments({
        channel: "verification",
        error: "Provider unavailable",
        errorClass: "transient",
        "metadata.verificationChannel": "email",
        provider: "throw-verification",
        status: "failed",
      }),
      1
    );
    assert.equal(
      await CommsMessage.countDocuments({
        channel: "verification",
        error: "Provider unavailable",
        errorClass: "transient",
        "metadata.verificationChannel": {$exists: false},
        provider: "throw-verification",
        status: "failed",
      }),
      2
    );
    assert.equal(await CommsMessage.countDocuments({to: "+15555550100"}), 0);
    assert.equal(await CommsMessage.countDocuments({to: "person@example.com"}), 0);
  });

  it("stores no payload for mail marked sensitive, on the first attempt or the retry", async (): Promise<void> => {
    let calls = 0;
    const mail: MailProvider = {
      id: "flaky-mail",
      sendMail: async (): Promise<SendResult> => {
        calls += 1;
        return calls === 1 ? {accepted: false, errorClass: "transient"} : {accepted: true};
      },
    };
    const service = new CommsService({mail});

    await service.sendMail({
      sensitive: true,
      subject: "Reset",
      text: "token=abc",
      to: "a@example.com",
    });
    await service.sendMail(
      {subject: "Verify", text: "token=def", to: "b@example.com"},
      {sensitive: true}
    );

    const rows = await CommsMessage.find({channel: "mail"});
    assert.lengthOf(rows, 2);
    for (const row of rows) {
      assert.isUndefined(row.payload);
      assert.isUndefined(row.payloadExpiresAt);
    }
  });

  it("skips push for a soft-deleted user from the configured user model", async (): Promise<void> => {
    const userId = new mongoose.Types.ObjectId();
    await PushToken.upsert(
      {token: "ExponentPushToken[soft-deleted]"},
      {active: true, lastSeenAt: DateTime.utc().toJSDate(), platform: "ios", userId}
    );
    const sent: string[][] = [];
    const push: PushProvider = {
      id: "soft-deleted",
      sendPush: async (message): Promise<SendResult[]> => {
        sent.push(message.tokens);
        return [{accepted: true}];
      },
    };
    const service = new CommsService({
      push,
      userModel: {findById: async (): Promise<unknown> => ({_id: userId, deleted: true})},
    });
    service.setUserModel({findById: async (): Promise<unknown> => ({_id: userId})});

    const results = await service.sendPushToUser({body: "Hello", title: "Title", userId});

    assert.lengthOf(results, 0);
    assert.lengthOf(sent, 0);
    assert.isFalse(
      (await PushToken.findExactlyOne({token: "ExponentPushToken[soft-deleted]"})).active
    );
  });

  it("logs missing push results as temporary failures without pruning tokens", async (): Promise<void> => {
    const userId = new mongoose.Types.ObjectId();
    const tokens = await Promise.all(
      ["first", "second"].map(
        async (suffix): Promise<Awaited<ReturnType<typeof PushToken.upsert>>> =>
          PushToken.upsert(
            {token: `ExponentPushToken[${suffix}]`},
            {
              active: true,
              lastSeenAt: DateTime.utc().toJSDate(),
              platform: "ios",
              userId,
            }
          )
      )
    );
    const push: PushProvider = {
      id: "short-results",
      sendPush: async (): Promise<SendResult[]> => [{accepted: true}],
    };

    const results = await new CommsService({push}).sendPushToUser({
      body: "Hello",
      title: "Title",
      userId,
    });

    assert.lengthOf(results, 2);
    assert.isTrue(results[0]?.accepted);
    assert.isFalse(results[1]?.accepted);
    assert.equal(await CommsMessage.countDocuments({status: "sent"}), 1);
    assert.equal(await CommsMessage.countDocuments({status: "failed"}), 1);
    for (const token of tokens) {
      const updated = await PushToken.findExactlyOne({_id: token._id});
      assert.isTrue(updated.active);
    }
  });

  it("ignores provider push results that do not correspond to a token", async (): Promise<void> => {
    const userId = new mongoose.Types.ObjectId();
    await PushToken.upsert(
      {token: "ExponentPushToken[single]"},
      {
        active: true,
        lastSeenAt: DateTime.utc().toJSDate(),
        platform: "ios",
        userId,
      }
    );
    const push: PushProvider = {
      id: "extra-results",
      sendPush: async (): Promise<SendResult[]> => [
        {accepted: true, providerMessageId: "expected"},
        {accepted: false, isPermanentFailure: true, providerMessageId: "extra"},
      ],
    };

    const results = await new CommsService({push}).sendPushToUser({
      body: "Hello",
      title: "Title",
      userId,
    });

    assert.lengthOf(results, 1);
    assert.equal(results[0]?.providerMessageId, "expected");
    assert.equal(await CommsMessage.countDocuments(), 1);
    assert.equal(await CommsMessage.countDocuments({providerMessageId: "extra"}), 0);
  });

  it("keeps tokens active after explicit non-permanent provider failures", async (): Promise<void> => {
    const userId = new mongoose.Types.ObjectId();
    const token = await PushToken.upsert(
      {token: "ExponentPushToken[temporary]"},
      {
        active: true,
        lastSeenAt: DateTime.utc().toJSDate(),
        platform: "ios",
        userId,
      }
    );
    const push: PushProvider = {
      id: "temporary-failure",
      sendPush: async (): Promise<SendResult[]> => [
        {accepted: false, error: "Rate limited", isPermanentFailure: false},
      ],
    };

    await new CommsService({push}).sendPushToUser({body: "Hello", title: "Title", userId});

    const updated = await PushToken.findExactlyOne({_id: token._id});
    assert.isTrue(updated.active);
  });

  it("records an invalid verification check as failed", async (): Promise<void> => {
    const verification: VerificationProvider = {
      checkVerification: async ({code}): Promise<{error?: string; valid: boolean}> =>
        code === "missing-reason"
          ? {valid: false}
          : {
              error: "Verification expired",
              valid: false,
            },
      id: "memory-verification",
      startVerification: async (): Promise<SendResult> => ({accepted: true}),
    };

    const service = new CommsService({verification});
    const emailResult = await service.checkVerification({
      code: "wrong-code",
      to: "person@example.com",
    });
    const smsResult = await service.checkVerification({
      code: "wrong-code",
      to: "+15555550100",
    });
    const fallbackResult = await service.checkVerification({
      code: "missing-reason",
      to: "fallback@example.com",
    });

    assert.isFalse(emailResult.valid);
    assert.equal(emailResult.error, "Verification expired");
    assert.isFalse(smsResult.valid);
    assert.equal(smsResult.error, "Verification expired");
    assert.isFalse(fallbackResult.valid);
    assert.isUndefined(fallbackResult.error);
    assert.equal(
      await CommsMessage.countDocuments({
        channel: "verification",
        error: "Verification expired",
        status: "failed",
        to: "[redacted]",
      }),
      2
    );
    assert.equal(
      await CommsMessage.countDocuments({
        channel: "verification",
        error: "Verification check failed",
        status: "failed",
        to: "[redacted]",
      }),
      1
    );
    assert.equal(await CommsMessage.countDocuments({to: "person@example.com"}), 0);
    assert.equal(await CommsMessage.countDocuments({to: "+15555550100"}), 0);
    const serializedAuditRows = JSON.stringify(
      await CommsMessage.find({channel: "verification", status: "failed"})
    );
    for (const sensitiveValue of ["wrong-code", "missing-reason", "fallback@example.com"]) {
      assert.notInclude(serializedAuditRows, sensitiveValue);
    }
  });

  it("invokes onSend and onError hooks for every channel", async (): Promise<void> => {
    const userId = new mongoose.Types.ObjectId();
    await PushToken.upsert(
      {token: "ExponentPushToken[hooks]"},
      {
        active: true,
        lastSeenAt: DateTime.utc().toJSDate(),
        platform: "ios",
        userId,
      }
    );

    const onSendChannels: string[] = [];
    const onErrorChannels: string[] = [];
    const service = new CommsService({
      mail: {
        id: "hook-mail",
        sendMail: async (): Promise<SendResult> => ({accepted: true}),
      },
      onError: async (context): Promise<void> => {
        onErrorChannels.push(context.channel);
      },
      onSend: async (context): Promise<void> => {
        onSendChannels.push(context.channel);
      },
      push: {
        id: "hook-push",
        sendPush: async (): Promise<SendResult[]> => [{accepted: true}],
      },
      sms: {
        id: "hook-sms",
        sendSms: async (): Promise<SendResult> => ({accepted: true}),
      },
      verification: {
        checkVerification: async (): Promise<{valid: boolean}> => ({error: "bad", valid: false}),
        id: "hook-verification",
        startVerification: async (): Promise<SendResult> => ({accepted: true}),
      },
    });

    await service.sendMail({subject: "Welcome", to: "person@example.com"});
    await service.sendSms({body: "Hello", to: "+15555550100"});
    await service.sendPushToUser({body: "Hello", title: "Title", userId});
    await service.startVerification({channel: "sms", to: "+15555550100"});
    await service.checkVerification({code: "123456", to: "+15555550100"});

    assert.deepEqual(onSendChannels, ["mail", "sms", "push", "verification"]);
    assert.deepEqual(onErrorChannels, ["verification"]);
  });

  it("invokes onError once when push provider throws for multiple tokens", async (): Promise<void> => {
    const userId = new mongoose.Types.ObjectId();
    await PushToken.upsert(
      {token: "ExponentPushToken[hooks-a]"},
      {
        active: true,
        lastSeenAt: DateTime.utc().toJSDate(),
        platform: "ios",
        userId,
      }
    );
    await PushToken.upsert(
      {token: "ExponentPushToken[hooks-b]"},
      {
        active: true,
        lastSeenAt: DateTime.utc().toJSDate(),
        platform: "ios",
        userId,
      }
    );

    let onErrorCount = 0;
    const service = new CommsService({
      onError: async (): Promise<void> => {
        onErrorCount += 1;
      },
      push: {
        id: "throw-push",
        sendPush: async (): Promise<never> => {
          throw new Error("Provider unavailable");
        },
      },
    });

    const results = await service.sendPushToUser({body: "Hello", title: "Title", userId});
    assert.lengthOf(results, 2);
    assert.isFalse(results[0]?.accepted);
    assert.equal(onErrorCount, 2);
    assert.equal(
      await CommsMessage.countDocuments({
        channel: "push",
        error: "Provider unavailable",
        errorClass: "transient",
        provider: "throw-push",
        status: "failed",
      }),
      2
    );
  });

  it("deactivates push tokens after permanent provider failures", async (): Promise<void> => {
    const userId = new mongoose.Types.ObjectId();
    const token = await PushToken.upsert(
      {token: "ExponentPushToken[dead]"},
      {
        active: true,
        lastSeenAt: DateTime.utc().toJSDate(),
        platform: "ios",
        userId,
      }
    );
    const push: PushProvider = {
      id: "memory-push",
      sendPush: async (): Promise<SendResult[]> => [
        {accepted: false, error: "DeviceNotRegistered", isPermanentFailure: true},
      ],
    };

    await new CommsService({push}).sendPushToUser({body: "Hello", title: "Title", userId});

    const updated = await PushToken.findExactlyOne({_id: token._id});
    assert.isFalse(updated.active);
  });

  it("cancels a send from beforeSend without calling the provider", async (): Promise<void> => {
    let sendCount = 0;
    const service = new CommsService({
      beforeSend: async (): Promise<{cancel: boolean}> => ({cancel: true}),
      mail: {
        id: "cancel-mail",
        sendMail: async (): Promise<SendResult> => {
          sendCount += 1;
          return {accepted: true};
        },
      },
    });

    const result = await service.sendMail({subject: "Welcome", to: "person@example.com"});

    assert.equal(sendCount, 0);
    assert.isFalse(result.accepted);
    assert.equal(result.errorCode, "before-send-cancel");
    assert.equal(await CommsMessage.countDocuments({status: "cancelled"}), 1);
    const row = await CommsMessage.findExactlyOne({status: "cancelled"});
    assert.equal(row.attemptCount, 1);
    assert.equal((row.payload as {to?: string}).to, "person@example.com");
    assert.equal(result.loggedMessageId, String(row._id));
  });

  it("passes the send option userId to mail and SMS beforeSend hooks", async (): Promise<void> => {
    const seenUserIds: Array<string | undefined> = [];
    const mailUserId = new mongoose.Types.ObjectId();
    const smsUserId = new mongoose.Types.ObjectId();
    const service = new CommsService({
      beforeSend: async (context): Promise<undefined> => {
        seenUserIds.push(context.userId);
        return undefined;
      },
      mail: {
        id: "user-aware-mail",
        sendMail: async (): Promise<SendResult> => ({accepted: true}),
      },
      sms: {
        id: "user-aware-sms",
        sendSms: async (): Promise<SendResult> => ({accepted: true}),
      },
    });

    await service.sendMail({subject: "Welcome", to: "person@example.com"}, {userId: mailUserId});
    await service.sendSms({body: "Hello", to: "+15555550100"}, {userId: smsUserId});

    assert.deepEqual(seenUserIds, [String(mailUserId), String(smsUserId)]);
    const mailLog = await CommsMessage.findExactlyOne({channel: "mail"});
    const smsLog = await CommsMessage.findExactlyOne({channel: "sms"});
    assert.equal(String(mailLog.userId), String(mailUserId));
    assert.equal(String(smsLog.userId), String(smsUserId));
  });

  it("preserves the original userId when retrying mail", async (): Promise<void> => {
    const userId = new mongoose.Types.ObjectId();
    const seenUserIds: Array<string | undefined> = [];
    const service = new CommsService({
      beforeSend: async (context): Promise<undefined> => {
        seenUserIds.push(context.userId);
        return undefined;
      },
      mail: {
        id: "retry-user-aware-mail",
        sendMail: async (): Promise<SendResult> => ({accepted: true}),
      },
    });
    const original = await CommsMessage.create({
      channel: "mail",
      payload: {subject: "Retry me", to: "person@example.com"},
      payloadExpiresAt: DateTime.utc().plus({days: 1}).toJSDate(),
      provider: "retry-user-aware-mail",
      status: "failed",
      subject: "Retry me",
      to: "person@example.com",
      userId,
    });

    await service.retryMessage({messageId: String(original._id)});

    assert.deepEqual(seenUserIds, [String(userId)]);
    const retried = await CommsMessage.findExactlyOne({retriedFromId: original._id});
    assert.equal(String(retried.userId), String(userId));
  });

  it("attaches loggedMessageId when beforeSend cancels a push send", async (): Promise<void> => {
    const userId = new mongoose.Types.ObjectId();
    await PushToken.upsert(
      {token: "ExponentPushToken[cancel]"},
      {
        active: true,
        lastSeenAt: DateTime.utc().toJSDate(),
        platform: "ios",
        userId,
      }
    );
    let sendCount = 0;
    const service = new CommsService({
      beforeSend: async (): Promise<{cancel: boolean}> => ({cancel: true}),
      push: {
        id: "cancel-push",
        sendPush: async (): Promise<SendResult[]> => {
          sendCount += 1;
          return [{accepted: true}];
        },
      },
    });

    const results = await service.sendPushToUser({body: "Hello", title: "Title", userId});

    assert.equal(sendCount, 0);
    assert.equal(results.length, 1);
    assert.isFalse(results[0]?.accepted);
    const row = await CommsMessage.findExactlyOne({channel: "push", status: "cancelled"});
    assert.equal(results[0]?.loggedMessageId, String(row._id));
  });

  it("lets beforeSend replace the outbound message", async (): Promise<void> => {
    let delivered: MailMessage | undefined;
    const service = new CommsService({
      beforeSend: async (context) => ({
        message: {
          ...(context.message as MailMessage),
          subject: "Quiet hours rewrite",
          text: "rewritten",
        },
      }),
      mail: {
        id: "mutate-mail",
        sendMail: async (message: MailMessage): Promise<SendResult> => {
          delivered = message;
          return {accepted: true};
        },
      },
    });

    await service.sendMail({subject: "Welcome", text: "original", to: "person@example.com"});

    assert.equal(delivered?.subject, "Quiet hours rewrite");
    assert.equal(delivered?.text, "rewritten");
    const row = await CommsMessage.findExactlyOne({channel: "mail"});
    assert.equal((row.payload as {subject?: string}).subject, "Quiet hours rewrite");
  });

  it("reapplies defaultFrom after beforeSend replaces the mail message", async (): Promise<void> => {
    let delivered: MailMessage | undefined;
    const service = new CommsService({
      beforeSend: async (): Promise<{message: MailMessage}> => ({
        message: {subject: "Quiet hours rewrite", text: "rewritten", to: "person@example.com"},
      }),
      defaultFrom: "sender@example.com",
      mail: {
        id: "default-from-mail",
        sendMail: async (message: MailMessage): Promise<SendResult> => {
          delivered = message;
          return {accepted: true};
        },
      },
    });

    await service.sendMail({subject: "Welcome", to: "person@example.com"});

    assert.equal(delivered?.from, "sender@example.com");
    assert.equal(delivered?.subject, "Quiet hours rewrite");
  });

  it("retries only transient failures and records per-attempt error data", async (): Promise<void> => {
    const calls: string[] = [];
    const retryAttempts: number[] = [];
    const service = new CommsService({
      mail: {
        id: "retry-mail",
        sendMail: async (): Promise<SendResult> => {
          calls.push("mail");
          if (calls.length === 1) {
            return {
              accepted: false,
              error: "Too many requests",
              errorClass: "transient",
              errorCode: "429",
            };
          }
          return {accepted: true, providerMessageId: "mail-2"};
        },
      },
      onRetry: async (context, result): Promise<void> => {
        retryAttempts.push(context.attempt);
        assert.equal(result.errorClass, "transient");
        assert.equal(context.isRetry, true);
      },
      sms: {
        id: "permanent-sms",
        sendSms: async (): Promise<SendResult> => ({
          accepted: false,
          error: "Blocked",
          errorClass: "permanent",
          errorCode: "21610",
        }),
      },
    });

    const mailResult = await service.sendMail({subject: "Welcome", to: "person@example.com"});
    const smsResult = await service.sendSms({body: "Hello", to: "+15555550100"});

    assert.isTrue(mailResult.accepted);
    assert.deepEqual(retryAttempts, [2]);
    assert.equal(calls.length, 2);
    assert.isFalse(smsResult.accepted);
    assert.equal(smsResult.errorClass, "permanent");
    const mailRow = await CommsMessage.findExactlyOne({channel: "mail"});
    assert.equal(mailRow.attemptCount, 2);
    assert.equal(mailRow.attempts[0]?.errorClass, "transient");
    assert.equal(mailRow.attempts[0]?.errorCode, "429");
    assert.equal(mailRow.attempts[1]?.providerMessageId, "mail-2");
    const smsRow = await CommsMessage.findExactlyOne({channel: "sms"});
    assert.equal(smsRow.attemptCount, 1);
    assert.equal(smsRow.errorCode, "21610");
    assert.equal(smsRow.errorClass, "permanent");
  });

  it("does not retry config or unclassified failures", async (): Promise<void> => {
    let configCalls = 0;
    let unclassifiedCalls = 0;
    const retryAttempts: number[] = [];
    const service = new CommsService({
      mail: {
        id: "config-mail",
        sendMail: async (): Promise<SendResult> => {
          configCalls += 1;
          return {accepted: false, error: "Bad key", errorClass: "config", errorCode: "401"};
        },
      },
      onRetry: async (_context, _result): Promise<void> => {
        retryAttempts.push(1);
      },
      sms: {
        id: "unclassified-sms",
        sendSms: async (): Promise<SendResult> => {
          unclassifiedCalls += 1;
          return {accepted: false, error: "Unknown"};
        },
      },
    });

    await service.sendMail({subject: "Welcome", to: "person@example.com"});
    await service.sendSms({body: "Hello", to: "+15555550100"});

    assert.equal(configCalls, 1);
    assert.equal(unclassifiedCalls, 1);
    assert.lengthOf(retryAttempts, 0);
  });

  it("records throwing lifecycle hooks without changing the send outcome", async (): Promise<void> => {
    const errorSpy = spyOn(logger, "error");
    try {
      const service = new CommsService({
        beforeSend: async (): Promise<void> => {
          throw new Error("beforeSend boom for person@example.com key=sg.secret");
        },
        mail: {
          id: "hook-throw-mail",
          sendMail: async (): Promise<SendResult> => ({accepted: true, providerMessageId: "ok"}),
        },
        onDeliveryEvent: async (): Promise<void> => {
          throw new Error("onDeliveryEvent boom");
        },
        onError: async (): Promise<void> => {
          throw new Error("onError boom");
        },
        onOptOut: async (): Promise<void> => {
          throw new Error("onOptOut boom");
        },
        onRetry: async (): Promise<void> => {
          throw new Error("onRetry boom");
        },
        onSend: async (): Promise<void> => {
          throw new Error("onSend boom");
        },
        sms: {
          id: "hook-throw-sms",
          sendSms: async (): Promise<SendResult> => ({
            accepted: false,
            error: "rate limited",
            errorClass: "transient",
            errorCode: "429",
          }),
        },
      });

      const mailResult = await service.sendMail({subject: "Welcome", to: "person@example.com"});
      const smsResult = await service.sendSms({body: "Hello", to: "+15555550100"});
      await service.recordDeliveryEvent({
        channel: "mail",
        providerMessageId: "unrelated-delivery",
        status: "delivered",
      });
      await service.recordOptOut({
        channel: "sms",
        provider: "hook-throw-sms",
        reason: "sms-stop",
        to: "+15555550100",
      });

      assert.isTrue(mailResult.accepted);
      assert.isFalse(smsResult.accepted);
      const mailRow = await CommsMessage.findExactlyOne({channel: "mail"});
      assert.equal(mailRow.status, "sent");
      assert.deepEqual(mailRow.metadata?.hookErrors, {
        beforeSend: ["hook-threw"],
        onSend: ["hook-threw"],
      });
      assert.notInclude(JSON.stringify(mailRow.metadata), "person@example.com");
      assert.notInclude(JSON.stringify(mailRow.metadata), "sg.secret");
      const smsRow = await CommsMessage.findExactlyOne({channel: "sms"});
      assert.equal(smsRow.attemptCount, 2);
      assert.deepEqual(smsRow.metadata?.hookErrors, {
        beforeSend: ["hook-threw"],
        onError: ["hook-threw"],
        onRetry: ["hook-threw"],
      });
      assert.isTrue(errorSpy.mock.calls.some((call) => String(call[0]).includes("beforeSend")));
      assert.isTrue(errorSpy.mock.calls.some((call) => String(call[0]).includes("onSend")));
      assert.isTrue(errorSpy.mock.calls.some((call) => String(call[0]).includes("onRetry")));
      assert.isTrue(errorSpy.mock.calls.some((call) => String(call[0]).includes("onError")));
      assert.isTrue(
        errorSpy.mock.calls.some((call) => String(call[0]).includes("onDeliveryEvent"))
      );
      assert.isTrue(errorSpy.mock.calls.some((call) => String(call[0]).includes("onOptOut")));
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("retains a redacted payload and clears it after retainPayloadDays", async (): Promise<void> => {
    const service = new CommsService({
      mail: {
        id: "payload-mail",
        sendMail: async (): Promise<SendResult> => ({accepted: true}),
      },
      redactPayload: (_context, payload): unknown => ({
        ...(payload as Record<string, unknown>),
        text: "[redacted-body]",
      }),
      retainPayloadDays: 30,
    });

    await service.sendMail({
      subject: "Welcome",
      text: "secret body",
      to: "person@example.com",
    });
    const row = await CommsMessage.findExactlyOne({channel: "mail"});
    assert.equal((row.payload as {text?: string}).text, "[redacted-body]");
    assert.equal((row.payload as {subject?: string}).subject, "Welcome");
    assert.isDefined(row.payloadExpiresAt);

    row.payloadExpiresAt = DateTime.utc().minus({days: 1}).toJSDate();
    await row.save();
    assert.equal(await service.clearExpiredPayloads(), 1);
    const cleared = await CommsMessage.findExactlyOne({channel: "mail"});
    assert.isUndefined(cleared.payload);
    assert.isUndefined(cleared.payloadExpiresAt);
    assert.equal(cleared.status, "sent");
  });

  it("stores no payload when retainPayloadDays is 0", async (): Promise<void> => {
    const service = new CommsService({
      mail: {
        id: "no-payload-mail",
        sendMail: async (): Promise<SendResult> => ({accepted: true}),
      },
      retainPayloadDays: 0,
    });

    await service.sendMail({subject: "Welcome", text: "secret", to: "person@example.com"});
    const row = await CommsMessage.findExactlyOne({channel: "mail"});
    assert.isUndefined(row.payload);
    assert.isUndefined(row.payloadExpiresAt);
  });

  it("retries only transient push tokens and deactivates permanent errorClass failures", async (): Promise<void> => {
    const userId = new mongoose.Types.ObjectId();
    const transientToken = await PushToken.upsert(
      {token: "ExponentPushToken[transient]"},
      {
        active: true,
        lastSeenAt: DateTime.utc().toJSDate(),
        platform: "ios",
        userId,
      }
    );
    const permanentToken = await PushToken.upsert(
      {token: "ExponentPushToken[permanent]"},
      {
        active: true,
        lastSeenAt: DateTime.utc().toJSDate(),
        platform: "android",
        userId,
      }
    );
    const retryTokens: string[] = [];
    const service = new CommsService({
      push: {
        id: "mixed-push",
        sendPush: async (message: PushMessage): Promise<SendResult[]> => {
          if (message.tokens.length === 1) {
            retryTokens.push(...message.tokens);
            return [{accepted: true, providerMessageId: "retry-ok"}];
          }
          return message.tokens.map((token) =>
            token.includes("permanent")
              ? {accepted: false, error: "Unregistered", errorClass: "permanent" as const}
              : {accepted: false, error: "Timeout", errorClass: "transient" as const}
          );
        },
      },
    });

    const results = await service.sendPushToUser({body: "Hello", title: "Title", userId});

    assert.equal(results.filter((result) => result.accepted).length, 1);
    assert.equal(results.filter((result) => !result.accepted).length, 1);
    assert.deepEqual(retryTokens, ["ExponentPushToken[transient]"]);
    const updatedTransient = await PushToken.findExactlyOne({_id: transientToken._id});
    const updatedPermanent = await PushToken.findExactlyOne({_id: permanentToken._id});
    assert.isTrue(updatedTransient.active);
    assert.isFalse(updatedPermanent.active);
    const retriedRow = await CommsMessage.findExactlyOne({providerMessageId: "retry-ok"});
    assert.equal(retriedRow.attemptCount, 2);
  });

  it("maps push provider results by token after beforeSend reorders the batch", async (): Promise<void> => {
    const userId = new mongoose.Types.ObjectId();
    await PushToken.upsert(
      {token: "ExponentPushToken[first]"},
      {
        active: true,
        lastSeenAt: DateTime.utc().toJSDate(),
        platform: "ios",
        userId,
      }
    );
    await PushToken.upsert(
      {token: "ExponentPushToken[second]"},
      {
        active: true,
        lastSeenAt: DateTime.utc().toJSDate(),
        platform: "android",
        userId,
      }
    );
    let sentTokens: string[] = [];
    const service = new CommsService({
      beforeSend: async (context) => {
        const message = context.message as PushMessage;
        sentTokens = [...message.tokens].reverse();
        return {
          message: {
            ...message,
            tokens: sentTokens,
          },
        };
      },
      push: {
        id: "reorder-push",
        sendPush: async (message: PushMessage): Promise<SendResult[]> =>
          message.tokens.map((_token, index) =>
            index === 0
              ? {accepted: false, error: "Unregistered", errorClass: "permanent" as const}
              : {accepted: true, providerMessageId: "second-ok"}
          ),
      },
      redactRecipients: false,
    });

    await service.sendPushToUser({body: "Hello", title: "Title", userId});

    const sentFirst = sentTokens[0] as string;
    const sentSecond = sentTokens[1] as string;
    const deactivated = await PushToken.findExactlyOne({token: sentFirst});
    const stillActive = await PushToken.findExactlyOne({token: sentSecond});
    assert.isFalse(deactivated.active);
    assert.isTrue(stillActive.active);
    const failedRow = await CommsMessage.findExactlyOne({to: sentFirst});
    const sentRow = await CommsMessage.findExactlyOne({to: sentSecond});
    assert.equal(failedRow.errorClass, "permanent");
    assert.equal(sentRow.status, "sent");
  });

  it("gives each push token its own outcome hook context", async (): Promise<void> => {
    const userId = new mongoose.Types.ObjectId();
    await PushToken.upsert(
      {token: "ExponentPushToken[keep]"},
      {
        active: true,
        lastSeenAt: DateTime.utc().toJSDate(),
        platform: "ios",
        userId,
      }
    );
    await PushToken.upsert(
      {token: "ExponentPushToken[retry]"},
      {
        active: true,
        lastSeenAt: DateTime.utc().toJSDate(),
        platform: "android",
        userId,
      }
    );
    const onSendCalls: Array<{
      attempt: number;
      isRetry: boolean;
      messageId?: string;
    }> = [];
    const service = new CommsService({
      onSend: async (context: CommsHookContext): Promise<void> => {
        onSendCalls.push({
          attempt: context.attempt,
          isRetry: context.isRetry,
          messageId: context.messageId,
        });
      },
      push: {
        id: "context-push",
        sendPush: async (message: PushMessage): Promise<SendResult[]> => {
          if (message.tokens.length === 1) {
            return [{accepted: true, providerMessageId: "retry-ok"}];
          }
          return message.tokens.map((token) =>
            token.includes("retry")
              ? {accepted: false, error: "Timeout", errorClass: "transient" as const}
              : {accepted: true, providerMessageId: "keep-ok"}
          );
        },
      },
      redactRecipients: false,
    });

    await service.sendPushToUser({body: "Hello", title: "Title", userId});

    const keepRow = await CommsMessage.findExactlyOne({to: "ExponentPushToken[keep]"});
    const retryRow = await CommsMessage.findExactlyOne({to: "ExponentPushToken[retry]"});
    const keepCall = onSendCalls.find((call) => call.messageId === String(keepRow._id));
    const retryCall = onSendCalls.find((call) => call.messageId === String(retryRow._id));
    assert.deepEqual(keepCall, {
      attempt: 1,
      isRetry: false,
      messageId: String(keepRow._id),
    });
    assert.deepEqual(retryCall, {
      attempt: 2,
      isRetry: true,
      messageId: String(retryRow._id),
    });
  });

  it("retains mail and verification payloads in the IP shape", async (): Promise<void> => {
    const service = new CommsService({
      mail: {
        id: "shape-mail",
        sendMail: async (): Promise<SendResult> => ({accepted: true}),
      },
      sms: {
        id: "shape-sms",
        sendSms: async (): Promise<SendResult> => ({accepted: true}),
      },
      verification: {
        checkVerification: async (): Promise<{valid: boolean}> => ({valid: true}),
        id: "shape-verification",
        startVerification: async (): Promise<SendResult> => ({accepted: true}),
      },
    });

    await service.sendMail({
      dynamicTemplateData: {name: "Ada"},
      from: "sender@example.com",
      html: "<p>Hi</p>",
      replyTo: "reply@example.com",
      subject: "Welcome",
      templateId: "d-welcome",
      text: "Hi",
      to: "person@example.com",
    });
    await service.sendSms({body: "Hello", to: "+15555550100"});
    await service.startVerification({channel: "sms", to: "+15555550100"});
    await service.checkVerification({code: "123456", to: "+15555550100"});

    const mailRow = await CommsMessage.findExactlyOne({channel: "mail"});
    assert.deepEqual(mailRow.payload, {
      dynamicTemplateData: {name: "Ada"},
      from: "sender@example.com",
      html: "<p>Hi</p>",
      replyTo: "reply@example.com",
      subject: "Welcome",
      templateId: "d-welcome",
      text: "Hi",
      to: "person@example.com",
    });
    const smsRow = await CommsMessage.findExactlyOne({channel: "sms"});
    assert.deepEqual(smsRow.payload, {body: "Hello", to: "+15555550100"});
    const startRow = await CommsMessage.findExactlyOne({
      channel: "verification",
      "metadata.verificationChannel": "sms",
    });
    assert.deepEqual(startRow.payload, {channel: "sms"});
    const checkRow = await CommsMessage.findExactlyOne({
      channel: "verification",
      "metadata.verificationChannel": {$exists: false},
    });
    assert.isUndefined(checkRow.payload);
  });

  it("updates a delivery log row from recordDeliveryEvent", async (): Promise<void> => {
    const warnSpy = spyOn(logger, "warn");
    const service = new CommsService({
      mail: {
        id: "event-mail",
        sendMail: async (): Promise<SendResult> => ({
          accepted: true,
          providerMessageId: "mail-delivered",
        }),
      },
    });
    await service.sendMail({subject: "Welcome", to: "person@example.com"});
    await service.recordDeliveryEvent({
      channel: "mail",
      errorClass: "permanent",
      errorCode: "bounce-500",
      providerMessageId: "mail-delivered",
      status: "bounced",
    });
    await service.recordDeliveryEvent({
      channel: "mail",
      providerMessageId: "mail-delivered",
      status: "opened",
    });
    await service.recordDeliveryEvent({
      channel: "mail",
      errorClass: "transient",
      providerMessageId: "missing-delivery",
      status: "failed",
    });
    const row = await CommsMessage.findExactlyOne({providerMessageId: "mail-delivered"});
    assert.equal(row.status, "bounced");
    assert.equal(row.errorCode, "bounce-500");
    assert.equal(row.errorClass, "permanent");
    assert.isTrue(warnSpy.mock.calls.some((call) => String(call[0]).includes("missing-delivery")));
    warnSpy.mockRestore();
  });

  it("rethrows when applying a delivery event fails to save", async (): Promise<void> => {
    const warnSpy = spyOn(logger, "warn");
    const service = new CommsService({
      mail: {
        id: "event-mail-save-fail",
        sendMail: async (): Promise<SendResult> => ({
          accepted: true,
          providerMessageId: "mail-save-fail",
        }),
      },
    });
    await service.sendMail({subject: "Welcome", to: "person@example.com"});
    const saveSpy = spyOn(CommsMessage.prototype, "save").mockImplementation(
      async (): Promise<never> => {
        throw new Error("save failed");
      }
    );
    let threw = false;
    try {
      await service.recordDeliveryEvent({
        channel: "mail",
        providerMessageId: "mail-save-fail",
        status: "delivered",
      });
    } catch (error: unknown) {
      threw = error instanceof Error && error.message === "save failed";
    }
    saveSpy.mockRestore();
    assert.isTrue(threw);
    assert.isTrue(
      warnSpy.mock.calls.some((call) => String(call[0]).includes("Failed to apply delivery event"))
    );
    warnSpy.mockRestore();
  });

  it("retries startVerification once on transient failure and never retries checkVerification", async (): Promise<void> => {
    let startCalls = 0;
    let checkCalls = 0;
    const service = new CommsService({
      verification: {
        checkVerification: async (): Promise<{valid: boolean}> => {
          checkCalls += 1;
          return {error: "bad", valid: false};
        },
        id: "retry-verification",
        startVerification: async (): Promise<SendResult> => {
          startCalls += 1;
          return {
            accepted: false,
            error: "Timeout",
            errorClass: "transient",
            errorCode: "429",
          };
        },
      },
    });

    await service.startVerification({channel: "sms", to: "+15555550100"});
    await service.checkVerification({code: "123456", to: "+15555550100"});

    assert.equal(startCalls, 2);
    assert.equal(checkCalls, 1);
  });

  it("omits payload when redactPayload throws", async (): Promise<void> => {
    const service = new CommsService({
      mail: {
        id: "redact-throw-mail",
        sendMail: async (): Promise<SendResult> => ({accepted: true}),
      },
      redactPayload: (): unknown => {
        throw new Error("redact boom");
      },
    });

    const result = await service.sendMail({subject: "Welcome", to: "person@example.com"});
    assert.isTrue(result.accepted);
    const row = await CommsMessage.findExactlyOne({channel: "mail"});
    assert.isUndefined(row.payload);
    assert.deepEqual(row.metadata?.hookErrors, {redactPayload: ["hook-threw"]});
  });
});
