import {afterEach, beforeAll, beforeEach, describe, expect, it, spyOn} from "bun:test";
import type express from "express";
import {DateTime} from "luxon";
import mongoose from "mongoose";
import supertest from "supertest";

import {resetAuditRecorderForTests} from "../audit/record";
import type {BetterAuthApp} from "../betterAuthApp";
import {logger} from "../logger";
import {
  access,
  betterAuthCollection,
  betterAuthIdFor,
  buildApp,
  getSummary,
  resetAccountSecurityState,
  SecurityUser,
  securityEventsFor,
  signInWithPassword,
  signUp,
} from "../tests/accountSecurityTestApp";
import {API_ORIGIN} from "../tests/betterAuthStubs";
import {clearSecurityActionListenersForTests} from "./securityEvents";

interface SentMail {
  subject: string;
  text: string;
  to: string;
}

const NEW_PASSWORD = "new-password-654321";

const removePasskey = (
  app: express.Application,
  token: string,
  userId: string,
  passkeyId: string
): supertest.Test =>
  supertest(app)
    .delete(`/users/${userId}/security/passkeys/${passkeyId}`)
    .set("authorization", `Bearer ${token}`);

const unlinkProvider = (
  app: express.Application,
  token: string,
  userId: string,
  providerId: string
): supertest.Test =>
  supertest(app)
    .delete(`/users/${userId}/security/accounts/${providerId}`)
    .set("authorization", `Bearer ${token}`);

const betterAuthContext = async (
  betterAuthApp: BetterAuthApp
): Promise<Awaited<ReturnType<BetterAuthApp["ensureAuth"]>["$context"]>> =>
  betterAuthApp.ensureAuth().$context;

/** Adds a passkey row for the app User and returns its Better Auth id. */
const addPasskey = async (
  betterAuthApp: BetterAuthApp,
  userId: string,
  name: string
): Promise<string> => {
  const context = await betterAuthContext(betterAuthApp);
  const row = await context.adapter.create<Record<string, unknown>, {id: string}>({
    data: {
      backedUp: false,
      counter: 0,
      credentialID: `credential-${name}`,
      deviceType: "singleDevice",
      name,
      publicKey: `public-key-${name}`,
      userId: await betterAuthIdFor(userId),
    },
    model: "passkey",
  });
  return String(row.id);
};

const linkProvider = async (
  betterAuthApp: BetterAuthApp,
  userId: string,
  providerId: string,
  accountId = `${providerId}-account`
): Promise<void> => {
  const context = await betterAuthContext(betterAuthApp);
  await context.internalAdapter.createAccount({
    accessToken: `${providerId}-access-token`,
    accountId,
    providerId,
    userId: await betterAuthIdFor(userId),
  });
};

/** Removes the user's password, so their only sign-in methods are the ones the test adds. */
const removePassword = async (betterAuthApp: BetterAuthApp, userId: string): Promise<void> => {
  const context = await betterAuthContext(betterAuthApp);
  await context.adapter.deleteMany({
    model: "account",
    where: [
      {field: "userId", value: await betterAuthIdFor(userId)},
      {field: "providerId", value: "credential"},
    ],
  });
};

const markEmailVerified = async (email: string): Promise<void> => {
  await betterAuthCollection("user").updateOne({email}, {$set: {emailVerified: true}});
};

const providerIdsOf = async (betterAuthApp: BetterAuthApp, userId: string): Promise<string[]> => {
  const context = await betterAuthContext(betterAuthApp);
  const accounts = await context.internalAdapter.findAccounts(await betterAuthIdFor(userId));
  return accounts.map((account) => account.providerId).sort();
};

const passkeyCount = async (betterAuthApp: BetterAuthApp, userId: string): Promise<number> => {
  const context = await betterAuthContext(betterAuthApp);
  const rows = await context.adapter.findMany({
    model: "passkey",
    where: [{field: "userId", value: await betterAuthIdFor(userId)}],
  });
  return rows.length;
};

const actionIdsOf = (res: supertest.Response): string[] =>
  (res.body.data.actions as {id: string}[]).map((action) => action.id);

/** A build with a capturing mailer and `publicAppUrl`, so reset mail can be sent. */
const buildMailingApp = (
  sendMail?: (message: SentMail) => Promise<void>
): ReturnType<typeof buildApp> & {sent: SentMail[]} => {
  const sent: SentMail[] = [];
  const built = buildApp({
    config: {
      publicAppUrl: "https://app.example.com",
      sendMail:
        sendMail ??
        (async (message): Promise<void> => {
          sent.push(message);
        }),
    },
  });
  return {...built, sent};
};

const resetMailsIn = (sent: SentMail[]): SentMail[] =>
  sent.filter((mail) => mail.subject === "Reset your password");

type DeleteMany = (args: {
  model: string;
  where: {field: string; value: unknown}[];
}) => Promise<number>;

/**
 * Makes the next Better Auth `deleteMany` on `model` run `concurrently` first, as if another
 * recovery request removed something between this request's count and its delete.
 */
const interleaveNextDelete = async (
  betterAuthApp: BetterAuthApp,
  model: string,
  concurrently: (deleteMany: DeleteMany) => Promise<unknown>
): Promise<void> => {
  const context = await betterAuthContext(betterAuthApp);
  const adapter = context.adapter as unknown as {deleteMany: DeleteMany};
  const original = adapter.deleteMany.bind(adapter);
  const spy = spyOn(adapter, "deleteMany");
  spy.mockImplementation(async (args) => {
    if (args.model !== model) {
      return original(args);
    }
    spy.mockRestore();
    await concurrently(original);
    return original(args);
  });
};

const resetTokenFrom = (mail: SentMail): string => {
  const match = /[?&]token=([^&\s"]+)/.exec(mail.text);
  return decodeURIComponent(match?.[1] ?? "");
};

describe("credential recovery actions", () => {
  beforeAll(async () => {
    await access.roles.seedDefaults();
  });

  beforeEach(async () => {
    await resetAccountSecurityState();
  });

  afterEach(() => {
    resetAuditRecorderForTests();
    clearSecurityActionListenersForTests();
  });

  describe("remove passkey", () => {
    it("removes the passkey, so it is no longer listed, and audits which one", async () => {
      const {app, betterAuthApp} = buildApp();
      const operator = await signUp(app, "operator", ["operator"]);
      const target = await signUp(app, "passkey-target");
      const laptop = await addPasskey(betterAuthApp, target.id, "Work laptop");
      await addPasskey(betterAuthApp, target.id, "Phone");

      const res = await removePasskey(app, operator.token, target.id, laptop);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        action: "remove-passkey",
        changed: true,
        passkeyId: laptop,
        passwordResetSent: false,
      });
      const summary = await getSummary(app, operator.token, target.id);
      expect(summary.body.data.passkeys.count).toBe(1);
      expect(summary.body.data.passkeys.items.map((item: {name: string}) => item.name)).toEqual([
        "Phone",
      ]);
      const events = await securityEventsFor(target.id);
      expect(events).toHaveLength(1);
      expect(String(events[0].actorId)).toBe(operator.id);
      expect(events[0].after).toEqual({
        passkeyId: laptop,
        passkeyName: "Work laptop",
        passwordResetSent: false,
        securityAction: "remove-passkey",
      });
    });

    it("answers 404 for another user's passkey and leaves it in place", async () => {
      const {app, betterAuthApp} = buildApp();
      const operator = await signUp(app, "operator-other", ["operator"]);
      const target = await signUp(app, "passkey-target-other");
      const bystander = await signUp(app, "passkey-bystander");
      await addPasskey(betterAuthApp, target.id, "Target key");
      const bystanderKey = await addPasskey(betterAuthApp, bystander.id, "Bystander key");

      const res = await removePasskey(app, operator.token, target.id, bystanderKey);

      expect(res.status).toBe(404);
      expect(res.body.title).toBe("Passkey not found");
      expect(await passkeyCount(betterAuthApp, bystander.id)).toBe(1);
      expect(await passkeyCount(betterAuthApp, target.id)).toBe(1);
      expect(await securityEventsFor(target.id)).toHaveLength(0);
      expect(await securityEventsFor(bystander.id)).toHaveLength(0);
    });

    it("answers 404 for an unknown or malformed passkey id", async () => {
      const {app, betterAuthApp} = buildApp();
      const operator = await signUp(app, "operator-unknown", ["operator"]);
      const target = await signUp(app, "passkey-target-unknown");
      await addPasskey(betterAuthApp, target.id, "Only key");

      const unknown = await removePasskey(
        app,
        operator.token,
        target.id,
        new mongoose.Types.ObjectId().toString()
      );
      const malformed = await removePasskey(app, operator.token, target.id, "not-a-passkey-id");

      expect(unknown.status).toBe(404);
      expect(malformed.status).toBe(404);
      expect(await passkeyCount(betterAuthApp, target.id)).toBe(1);
    });

    it("answers 404 for a user with no Better Auth link", async () => {
      const {app} = buildApp();
      const operator = await signUp(app, "operator-legacy", ["operator"]);
      const legacy = await SecurityUser.create({email: "legacy-passkey@example.com"});

      const res = await removePasskey(app, operator.token, String(legacy._id), "pk-1");

      expect(res.status).toBe(404);
      expect(res.body.title).toBe("Passkey not found");
    });

    it("answers 404 when passkeys are not enabled on the server", async () => {
      const {app} = buildApp({config: {passkey: undefined}});
      const operator = await signUp(app, "operator-no-passkeys", ["operator"]);
      const target = await signUp(app, "passkey-target-off");

      const res = await removePasskey(app, operator.token, target.id, "pk-1");

      expect(res.status).toBe(404);
      expect(res.body.title).toBe("Security action not available");
    });
  });

  describe("remove passkey: last sign-in method", () => {
    it("refuses with 409 to remove the only passkey of a user whose email is unverified", async () => {
      const {app, betterAuthApp} = buildApp();
      const operator = await signUp(app, "operator-last-key", ["operator"]);
      const target = await signUp(app, "last-key");
      await removePassword(betterAuthApp, target.id);
      const key = await addPasskey(betterAuthApp, target.id, "Only key");

      const res = await removePasskey(app, operator.token, target.id, key);

      expect(res.status).toBe(409);
      expect(res.body.title).toBe("Cannot remove the last sign-in method");
      expect(await passkeyCount(betterAuthApp, target.id)).toBe(1);
      expect(await securityEventsFor(target.id)).toHaveLength(0);
    });

    it("removes the only passkey of a verified user after mailing a password reset", async () => {
      const {app, betterAuthApp, sent} = buildMailingApp();
      const operator = await signUp(app, "operator-key-reset", ["operator"]);
      const target = await signUp(app, "key-reset");
      await removePassword(betterAuthApp, target.id);
      await markEmailVerified(target.email);
      const key = await addPasskey(betterAuthApp, target.id, "Only key");

      const res = await removePasskey(app, operator.token, target.id, key);

      expect(res.status).toBe(200);
      expect(res.body.data.passwordResetSent).toBe(true);
      expect(await passkeyCount(betterAuthApp, target.id)).toBe(0);
      expect(resetMailsIn(sent).map((mail) => mail.to)).toEqual([target.email]);
      const events = await securityEventsFor(target.id);
      expect(events).toHaveLength(1);
      expect(events[0].after).toEqual({
        passkeyId: key,
        passkeyName: "Only key",
        passwordResetSent: true,
        securityAction: "remove-passkey",
      });
    });

    it("refuses with 409 when the only passkey would go but reset mail is not configured", async () => {
      const {app, betterAuthApp} = buildApp();
      const operator = await signUp(app, "operator-key-no-mail", ["operator"]);
      const target = await signUp(app, "key-no-mail");
      await removePassword(betterAuthApp, target.id);
      await markEmailVerified(target.email);
      const key = await addPasskey(betterAuthApp, target.id, "Only key");

      const res = await removePasskey(app, operator.token, target.id, key);

      expect(res.status).toBe(409);
      expect(res.body.title).toBe("Password reset email is not configured");
      expect(await passkeyCount(betterAuthApp, target.id)).toBe(1);
    });

    it("removes one of two passkeys without a reset, even with no password", async () => {
      const {app, betterAuthApp, sent} = buildMailingApp();
      const operator = await signUp(app, "operator-two-keys", ["operator"]);
      const target = await signUp(app, "two-keys");
      await removePassword(betterAuthApp, target.id);
      const key = await addPasskey(betterAuthApp, target.id, "First key");
      await addPasskey(betterAuthApp, target.id, "Second key");
      sent.length = 0;

      const res = await removePasskey(app, operator.token, target.id, key);

      expect(res.status).toBe(200);
      expect(res.body.data.passwordResetSent).toBe(false);
      expect(resetMailsIn(sent)).toHaveLength(0);
    });
  });

  describe("concurrent removals", () => {
    it("mails a reset when a concurrent removal took the user's other method", async () => {
      const {app, betterAuthApp, sent} = buildMailingApp();
      const operator = await signUp(app, "operator-race", ["operator"]);
      const target = await signUp(app, "race");
      await removePassword(betterAuthApp, target.id);
      await markEmailVerified(target.email);
      await linkProvider(betterAuthApp, target.id, "github");
      await linkProvider(betterAuthApp, target.id, "google");
      const betterAuthId = await betterAuthIdFor(target.id);
      sent.length = 0;
      await interleaveNextDelete(betterAuthApp, "account", (deleteMany) =>
        deleteMany({
          model: "account",
          where: [
            {field: "userId", value: betterAuthId},
            {field: "providerId", value: "google"},
          ],
        })
      );

      const res = await unlinkProvider(app, operator.token, target.id, "github");

      expect(res.status).toBe(200);
      expect(res.body.data.passwordResetSent).toBe(true);
      expect(await providerIdsOf(betterAuthApp, target.id)).toEqual([]);
      expect(resetMailsIn(sent).map((mail) => mail.to)).toEqual([target.email]);
      const events = await securityEventsFor(target.id);
      expect(events).toHaveLength(1);
      expect(events[0].after).toEqual({
        accountCount: 1,
        passwordResetSent: true,
        providerId: "github",
        securityAction: "unlink-provider",
      });
    });

    it("logs, and sends nothing, when the race leaves an unverified user with no method", async () => {
      const {app, betterAuthApp, sent} = buildMailingApp();
      const operator = await signUp(app, "operator-race-unverified", ["operator"]);
      const target = await signUp(app, "race-unverified");
      await removePassword(betterAuthApp, target.id);
      await linkProvider(betterAuthApp, target.id, "github");
      const key = await addPasskey(betterAuthApp, target.id, "Racing key");
      sent.length = 0;
      const errorSpy = spyOn(logger, "error");
      await interleaveNextDelete(betterAuthApp, "account", (deleteMany) =>
        deleteMany({model: "passkey", where: [{field: "id", value: key}]})
      );

      const res = await unlinkProvider(app, operator.token, target.id, "github");

      expect(res.status).toBe(200);
      expect(res.body.data.passwordResetSent).toBe(false);
      expect(resetMailsIn(sent)).toHaveLength(0);
      expect(
        errorSpy.mock.calls.some((call) => String(call[0]).includes("no sign-in method left"))
      ).toBe(true);
      errorSpy.mockRestore();
    });

    it("still answers 200 when the late reset mail fails, and reports it was not sent", async () => {
      const {app, betterAuthApp} = buildMailingApp(async (message): Promise<void> => {
        if (message.subject === "Reset your password") {
          throw new Error("SMTP is down");
        }
      });
      const operator = await signUp(app, "operator-race-smtp", ["operator"]);
      const target = await signUp(app, "race-smtp");
      await removePassword(betterAuthApp, target.id);
      await markEmailVerified(target.email);
      await linkProvider(betterAuthApp, target.id, "github");
      const key = await addPasskey(betterAuthApp, target.id, "Racing key");
      const betterAuthId = await betterAuthIdFor(target.id);
      const errorSpy = spyOn(logger, "error");
      await interleaveNextDelete(betterAuthApp, "passkey", (deleteMany) =>
        deleteMany({
          model: "account",
          where: [
            {field: "userId", value: betterAuthId},
            {field: "providerId", value: "github"},
          ],
        })
      );

      const res = await removePasskey(app, operator.token, target.id, key);

      expect(res.status).toBe(200);
      expect(res.body.data.passwordResetSent).toBe(false);
      expect(await passkeyCount(betterAuthApp, target.id)).toBe(0);
      expect(
        errorSpy.mock.calls.some((call) => String(call[0]).includes("Could not mail a password"))
      ).toBe(true);
      errorSpy.mockRestore();
    });

    it("audits the reset it mailed when a concurrent request unlinked the provider first", async () => {
      const {app, betterAuthApp, sent} = buildMailingApp();
      const operator = await signUp(app, "operator-race-404", ["operator"]);
      const target = await signUp(app, "race-404");
      await removePassword(betterAuthApp, target.id);
      await markEmailVerified(target.email);
      await linkProvider(betterAuthApp, target.id, "github");
      const betterAuthId = await betterAuthIdFor(target.id);
      sent.length = 0;
      await interleaveNextDelete(betterAuthApp, "account", (deleteMany) =>
        deleteMany({
          model: "account",
          where: [
            {field: "userId", value: betterAuthId},
            {field: "providerId", value: "github"},
          ],
        })
      );

      const res = await unlinkProvider(app, operator.token, target.id, "github");

      expect(res.status).toBe(404);
      expect(res.body.title).toBe("Provider not linked");
      expect(resetMailsIn(sent)).toHaveLength(1);
      const events = await securityEventsFor(target.id);
      expect(events).toHaveLength(1);
      expect(String(events[0].actorId)).toBe(operator.id);
      expect(events[0].after).toEqual({
        providerId: "github",
        reason: "last-sign-in-method",
        securityAction: "send-password-reset",
      });
    });

    it("audits the reset it mailed when a concurrent request removed the passkey first", async () => {
      const {app, betterAuthApp, sent} = buildMailingApp();
      const operator = await signUp(app, "operator-race-key-404", ["operator"]);
      const target = await signUp(app, "race-key-404");
      await removePassword(betterAuthApp, target.id);
      await markEmailVerified(target.email);
      const key = await addPasskey(betterAuthApp, target.id, "Only key");
      sent.length = 0;
      await interleaveNextDelete(betterAuthApp, "passkey", (deleteMany) =>
        deleteMany({model: "passkey", where: [{field: "id", value: key}]})
      );

      const res = await removePasskey(app, operator.token, target.id, key);

      expect(res.status).toBe(404);
      expect(resetMailsIn(sent)).toHaveLength(1);
      const events = await securityEventsFor(target.id);
      expect(events.map((event) => event.after)).toEqual([
        {passkeyId: key, reason: "last-sign-in-method", securityAction: "send-password-reset"},
      ]);
    });
  });

  describe("unlink provider", () => {
    it("removes the provider's account row, keeps the password, and audits the unlink", async () => {
      const {app, betterAuthApp} = buildApp();
      const operator = await signUp(app, "operator-unlink", ["operator"]);
      const target = await signUp(app, "unlink-target");
      await linkProvider(betterAuthApp, target.id, "github");

      const res = await unlinkProvider(app, operator.token, target.id, "github");

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        accountCount: 1,
        action: "unlink-provider",
        changed: true,
        passwordResetSent: false,
        providerId: "github",
      });
      expect(await providerIdsOf(betterAuthApp, target.id)).toEqual(["credential"]);
      const summary = await getSummary(app, operator.token, target.id);
      expect(summary.body.data.providers).toEqual([]);
      expect(summary.body.data.password).toBe(true);
      const events = await securityEventsFor(target.id);
      expect(events).toHaveLength(1);
      expect(String(events[0].actorId)).toBe(operator.id);
      expect(events[0].after).toEqual({
        accountCount: 1,
        passwordResetSent: false,
        providerId: "github",
        securityAction: "unlink-provider",
      });
    });

    it("removes every account the user has with that provider, and only that provider", async () => {
      const {app, betterAuthApp} = buildApp();
      const operator = await signUp(app, "operator-multi", ["operator"]);
      const target = await signUp(app, "unlink-multi");
      await linkProvider(betterAuthApp, target.id, "github", "github-one");
      await linkProvider(betterAuthApp, target.id, "github", "github-two");
      await linkProvider(betterAuthApp, target.id, "google");

      const res = await unlinkProvider(app, operator.token, target.id, "github");

      expect(res.status).toBe(200);
      expect(res.body.data.accountCount).toBe(2);
      expect(await providerIdsOf(betterAuthApp, target.id)).toEqual(["credential", "google"]);
    });

    it("never unlinks the password credential", async () => {
      const {app, betterAuthApp} = buildApp();
      const operator = await signUp(app, "operator-credential", ["operator"]);
      const target = await signUp(app, "unlink-credential");
      await linkProvider(betterAuthApp, target.id, "github");

      const res = await unlinkProvider(app, operator.token, target.id, "credential");

      expect(res.status).toBe(400);
      expect(res.body.title).toBe("The password cannot be unlinked");
      expect(await providerIdsOf(betterAuthApp, target.id)).toEqual(["credential", "github"]);
      expect(await securityEventsFor(target.id)).toHaveLength(0);
    });

    it("answers 404 for a provider the user has not linked, and for a legacy user", async () => {
      const {app} = buildApp();
      const operator = await signUp(app, "operator-not-linked", ["operator"]);
      const target = await signUp(app, "unlink-not-linked");
      const legacy = await SecurityUser.create({email: "legacy-unlink@example.com"});

      const notLinked = await unlinkProvider(app, operator.token, target.id, "github");
      const unlinkedLegacy = await unlinkProvider(
        app,
        operator.token,
        String(legacy._id),
        "github"
      );

      expect(notLinked.status).toBe(404);
      expect(notLinked.body.title).toBe("Provider not linked");
      expect(unlinkedLegacy.status).toBe(404);
    });

    it("refuses with 409 to remove the last sign-in method of a user whose email is unverified", async () => {
      const {app, betterAuthApp} = buildApp();
      const operator = await signUp(app, "operator-last", ["operator"]);
      const target = await signUp(app, "unlink-last");
      await linkProvider(betterAuthApp, target.id, "github");
      await removePassword(betterAuthApp, target.id);

      const res = await unlinkProvider(app, operator.token, target.id, "github");

      expect(res.status).toBe(409);
      expect(res.body.title).toBe("Cannot remove the last sign-in method");
      expect(await providerIdsOf(betterAuthApp, target.id)).toEqual(["github"]);
      expect(await securityEventsFor(target.id)).toHaveLength(0);
    });

    it("counts passkeys as a remaining sign-in method", async () => {
      const {app, betterAuthApp} = buildApp();
      const operator = await signUp(app, "operator-passkey-left", ["operator"]);
      const target = await signUp(app, "unlink-passkey-left");
      await linkProvider(betterAuthApp, target.id, "github");
      await removePassword(betterAuthApp, target.id);
      await addPasskey(betterAuthApp, target.id, "Security key");

      const res = await unlinkProvider(app, operator.token, target.id, "github");

      expect(res.status).toBe(200);
      expect(res.body.data.passwordResetSent).toBe(false);
      expect(await providerIdsOf(betterAuthApp, target.id)).toEqual([]);
    });

    it("does not count passkeys when the server no longer accepts them", async () => {
      const {app, betterAuthApp} = buildApp();
      const operator = await signUp(app, "operator-passkey-off", ["operator"]);
      const target = await signUp(app, "unlink-passkey-off");
      await linkProvider(betterAuthApp, target.id, "github");
      await removePassword(betterAuthApp, target.id);
      await addPasskey(betterAuthApp, target.id, "Orphaned key");
      const {app: passkeylessApp} = buildApp({config: {passkey: undefined}});

      const res = await unlinkProvider(passkeylessApp, operator.token, target.id, "github");

      expect(res.status).toBe(409);
      expect(res.body.title).toBe("Cannot remove the last sign-in method");
      expect(await providerIdsOf(betterAuthApp, target.id)).toEqual(["github"]);
    });

    it("unlinks the last method of a verified user and mails a password-reset link", async () => {
      const sent: SentMail[] = [];
      const {app, betterAuthApp} = buildApp({
        config: {
          publicAppUrl: "https://app.example.com",
          sendMail: async (message): Promise<void> => {
            sent.push(message);
          },
        },
      });
      const operator = await signUp(app, "operator-reset", ["operator"]);
      const target = await signUp(app, "unlink-reset");
      await linkProvider(betterAuthApp, target.id, "github");
      await removePassword(betterAuthApp, target.id);
      await markEmailVerified(target.email);
      sent.length = 0;

      const res = await unlinkProvider(app, operator.token, target.id, "github");

      expect(res.status).toBe(200);
      expect(res.body.data.passwordResetSent).toBe(true);
      expect(await providerIdsOf(betterAuthApp, target.id)).toEqual([]);
      const resetMails = sent.filter((mail) => mail.subject === "Reset your password");
      expect(resetMails).toHaveLength(1);
      expect(resetMails[0].to).toBe(target.email);
      expect(resetMails[0].text).toContain("https://app.example.com/resetPassword?token=");
      const events = await securityEventsFor(target.id);
      expect(events).toHaveLength(1);
      expect(events[0].after).toEqual({
        accountCount: 1,
        passwordResetSent: true,
        providerId: "github",
        securityAction: "unlink-provider",
      });

      // The link carries a token Better Auth's own /reset-password endpoint accepts.
      const context = await betterAuthContext(betterAuthApp);
      const verification = await context.internalAdapter.findVerificationValue(
        `reset-password:${resetTokenFrom(resetMails[0])}`
      );
      if (!verification) {
        throw new Error("The reset link has no verification row");
      }
      expect(verification.value).toBe(await betterAuthIdFor(target.id));
      expect(DateTime.fromJSDate(verification.expiresAt) > DateTime.now()).toBe(true);

      // The user follows the link, sets a password, and signs in with it. Terreno's password
      // reset hook reads the new password from the request, so the call carries one as HTTP would.
      const body = {newPassword: NEW_PASSWORD, token: resetTokenFrom(resetMails[0])};
      await betterAuthApp.ensureAuth().api.resetPassword({
        body,
        request: new Request(`${API_ORIGIN}/api/auth/reset-password`, {
          body: JSON.stringify(body),
          headers: {"content-type": "application/json"},
          method: "POST",
        }),
      });
      const signIn = await supertest(app)
        .post("/api/auth/sign-in/email")
        .set("content-type", "application/json")
        .send({email: target.email, password: NEW_PASSWORD});
      expect(signIn.status).toBe(200);
    });

    it("refuses with 409 when a verified user's last method would go but reset mail is not configured", async () => {
      const {app, betterAuthApp} = buildApp();
      const operator = await signUp(app, "operator-no-mail", ["operator"]);
      const target = await signUp(app, "unlink-no-mail");
      await linkProvider(betterAuthApp, target.id, "github");
      await removePassword(betterAuthApp, target.id);
      await markEmailVerified(target.email);

      const res = await unlinkProvider(app, operator.token, target.id, "github");

      expect(res.status).toBe(409);
      expect(res.body.title).toBe("Password reset email is not configured");
      expect(await providerIdsOf(betterAuthApp, target.id)).toEqual(["github"]);
      expect(await securityEventsFor(target.id)).toHaveLength(0);
    });

    it("keeps the provider when the reset mail cannot be built without publicAppUrl", async () => {
      const sent: SentMail[] = [];
      const {app, betterAuthApp} = buildApp({
        config: {
          sendMail: async (message): Promise<void> => {
            sent.push(message);
          },
        },
      });
      const operator = await signUp(app, "operator-no-url", ["operator"]);
      const target = await signUp(app, "unlink-no-url");
      await linkProvider(betterAuthApp, target.id, "github");
      await removePassword(betterAuthApp, target.id);
      await markEmailVerified(target.email);

      const res = await unlinkProvider(app, operator.token, target.id, "github");

      expect(res.status).toBe(501);
      expect(res.body.title).toBe("publicAppUrl is required to send recovery mail");
      expect(sent.filter((mail) => mail.subject === "Reset your password")).toHaveLength(0);
      expect(await providerIdsOf(betterAuthApp, target.id)).toEqual(["github"]);
      expect(await securityEventsFor(target.id)).toHaveLength(0);
    });
  });

  describe("summary actions", () => {
    it("lists both actions only when the user has passkeys and linked providers", async () => {
      const {app, betterAuthApp} = buildApp();
      const operator = await signUp(app, "operator-actions", ["operator"]);
      const target = await signUp(app, "actions-target");

      const before = await getSummary(app, operator.token, target.id);
      expect(actionIdsOf(before)).toEqual([]);

      await addPasskey(betterAuthApp, target.id, "Laptop");
      await linkProvider(betterAuthApp, target.id, "github");
      const after = await getSummary(app, operator.token, target.id);

      expect(actionIdsOf(after)).toEqual(["remove-passkey", "unlink-provider"]);
      expect(after.body.data.actions).toEqual([
        {destructive: true, id: "remove-passkey", label: "Remove passkey"},
        {destructive: true, id: "unlink-provider", label: "Unlink provider"},
      ]);
    });
  });

  describe("summary actions by state", () => {
    it("lists only remove-passkey for a user with a passkey and no provider", async () => {
      const {app, betterAuthApp} = buildApp();
      const operator = await signUp(app, "operator-only-key", ["operator"]);
      const target = await signUp(app, "only-key");
      await addPasskey(betterAuthApp, target.id, "Laptop");

      expect(actionIdsOf(await getSummary(app, operator.token, target.id))).toEqual([
        "remove-passkey",
      ]);
    });

    it("lists only unlink-provider for a user with a provider and no passkey", async () => {
      const {app, betterAuthApp} = buildApp();
      const operator = await signUp(app, "operator-only-provider", ["operator"]);
      const target = await signUp(app, "only-provider");
      await linkProvider(betterAuthApp, target.id, "github");

      expect(actionIdsOf(await getSummary(app, operator.token, target.id))).toEqual([
        "unlink-provider",
      ]);
    });

    it("leaves out remove-passkey when the server has passkeys off", async () => {
      const {app, betterAuthApp} = buildApp({config: {passkey: undefined}});
      const operator = await signUp(app, "operator-keys-off", ["operator"]);
      const target = await signUp(app, "keys-off");
      // A passkey stored while the feature was on; this server's adapter has no passkey model.
      const {betterAuthApp: passkeyApp} = buildApp();
      await addPasskey(passkeyApp, target.id, "Stored key");
      await linkProvider(betterAuthApp, target.id, "github");

      expect(actionIdsOf(await getSummary(app, operator.token, target.id))).toEqual([
        "unlink-provider",
      ]);
    });
  });

  describe("authorization", () => {
    it("refuses a member with 403 and changes nothing", async () => {
      const {app, betterAuthApp} = buildApp();
      const member = await signUp(app, "member");
      const target = await signUp(app, "member-target");
      const passkeyId = await addPasskey(betterAuthApp, target.id, "Laptop");
      await linkProvider(betterAuthApp, target.id, "github");

      expect((await removePasskey(app, member.token, target.id, passkeyId)).status).toBe(403);
      expect((await unlinkProvider(app, member.token, target.id, "github")).status).toBe(403);
      expect(await passkeyCount(betterAuthApp, target.id)).toBe(1);
      expect(await providerIdsOf(betterAuthApp, target.id)).toEqual(["credential", "github"]);
      expect(await securityEventsFor(target.id)).toHaveLength(0);
    });

    it("refuses an operator acting on a superadmin or on themselves", async () => {
      const {app, betterAuthApp} = buildApp();
      const operator = await signUp(app, "operator-reach", ["operator"]);
      const superadmin = await signUp(app, "superadmin-target", ["superadmin"]);
      const superadminKey = await addPasskey(betterAuthApp, superadmin.id, "Admin key");
      await linkProvider(betterAuthApp, superadmin.id, "github");
      const ownKey = await addPasskey(betterAuthApp, operator.id, "Own key");
      await linkProvider(betterAuthApp, operator.id, "github", "operator-github");

      const refused = [
        await removePasskey(app, operator.token, superadmin.id, superadminKey),
        await unlinkProvider(app, operator.token, superadmin.id, "github"),
        await removePasskey(app, operator.token, operator.id, ownKey),
        await unlinkProvider(app, operator.token, operator.id, "github"),
      ];

      expect(refused.map((res) => res.status)).toEqual([403, 403, 403, 403]);
      expect(await passkeyCount(betterAuthApp, superadmin.id)).toBe(1);
      expect(await passkeyCount(betterAuthApp, operator.id)).toBe(1);
      expect(await providerIdsOf(betterAuthApp, superadmin.id)).toEqual(["credential", "github"]);
      expect(await providerIdsOf(betterAuthApp, operator.id)).toEqual(["credential", "github"]);
    });

    it("still lets the user sign in with their password after an operator unlinks a provider", async () => {
      const {app, betterAuthApp} = buildApp();
      const operator = await signUp(app, "operator-signin", ["operator"]);
      const target = await signUp(app, "unlink-signin");
      await linkProvider(betterAuthApp, target.id, "github");

      await unlinkProvider(app, operator.token, target.id, "github").expect(200);

      expect((await signInWithPassword(app, target.email)).status).toBe(200);
    });
  });
});
