import {afterEach, beforeAll, beforeEach, describe, expect, it, mock, spyOn} from "bun:test";
import type express from "express";
import {DateTime, Duration} from "luxon";
import supertest from "supertest";

import {resetAuditRecorderForTests} from "../audit/record";
import type {BetterAuthConfig} from "../betterAuth";
import type {BetterAuthApp} from "../betterAuthApp";
import {logger} from "../logger";
import {
  access,
  betterAuthCollection,
  betterAuthIdFor,
  buildApp,
  resetAccountSecurityState,
  resetTokenFrom,
  SecurityUser,
  securityUserModel,
  selfSecurityEventsFor,
  signInWithPassword,
  signUp,
} from "../tests/accountSecurityTestApp";
import {
  API_ORIGIN,
  PASSWORD,
  setCookies,
  stubGoogleIdTokenOptions,
  totpCode,
  totpSecretFromURI,
} from "../tests/betterAuthStubs";
import {createSoftwareAuthenticator} from "../tests/softwareAuthenticator";
import {
  clearSecurityActionListenersForTests,
  recordSecurityAction,
  SECURITY_ACTIONS,
  type SecurityActionEvent,
  type SecurityActionId,
} from "./securityEvents";
import {
  createSecurityNotificationListener,
  DEFAULT_SECURITY_MAIL_TEMPLATES,
  flushSecurityNotificationsForTests,
  renderSecurityMail,
  SECURITY_MAIL_TEMPLATE_IDS,
  SECURITY_NOTIFICATION_TEMPLATES,
  type SecurityNotificationsOptions,
} from "./securityNotifications";

const PUBLIC_APP_URL = "https://app.example.com";

const NEW_PASSWORD = "new-password-654321";

interface Mail {
  html?: string;
  subject: string;
  text: string;
  to: string;
}

const SECURITY_SUBJECTS = new Set(
  Object.values(DEFAULT_SECURITY_MAIL_TEMPLATES).map((template) => template.subject)
);

interface MailingApp {
  app: express.Application;
  betterAuthApp: BetterAuthApp;
  sent: Mail[];
}

/** An app with a capturing mailer and `publicAppUrl`, plus the given overrides. */
const buildMailingApp = ({
  config = {},
  notifications,
  sendMail,
}: {
  config?: Partial<BetterAuthConfig>;
  notifications?: SecurityNotificationsOptions;
  sendMail?: (message: Mail) => Promise<void>;
} = {}): MailingApp => {
  const sent: Mail[] = [];
  const {app, betterAuthApp} = buildApp({
    config: {
      publicAppUrl: PUBLIC_APP_URL,
      sendMail:
        sendMail ??
        (async (message): Promise<void> => {
          sent.push(message);
        }),
      ...config,
    },
    security: notifications ? {notifications} : {},
  });
  return {app, betterAuthApp, sent};
};

/** The security notifications delivered so far (not reset or verification mail). */
const notificationsIn = async (sent: Mail[], to?: string): Promise<Mail[]> => {
  await flushSecurityNotificationsForTests();
  return sent.filter(
    (mail) => SECURITY_SUBJECTS.has(mail.subject) && (to === undefined || mail.to === to)
  );
};

/** Waits for pending notifications from setup, then forgets every mail sent so far. */
const clearMail = async (sent: Mail[]): Promise<void> => {
  await flushSecurityNotificationsForTests();
  sent.length = 0;
};

const expectOneNotification = async (sent: Mail[], to: string, subject: string): Promise<Mail> => {
  const all = await notificationsIn(sent);
  expect(all.map((mail) => ({subject: mail.subject, to: mail.to}))).toEqual([{subject, to}]);
  return all[0];
};

/** The self-service action ids recorded for the user, sorted. */
const selfActionsOf = async (userId: string): Promise<string[]> =>
  (await selfSecurityEventsFor(userId))
    .map((event) => (event.after as {securityAction: string}).securityAction)
    .sort();

const runAction = (
  app: express.Application,
  token: string,
  method: "delete" | "post",
  path: string
): supertest.Test => supertest(app)[method](path).set("authorization", `Bearer ${token}`).send({});

const betterAuthContext = async (
  betterAuthApp: BetterAuthApp
): Promise<Awaited<ReturnType<BetterAuthApp["ensureAuth"]>["$context"]>> =>
  betterAuthApp.ensureAuth().$context;

/** Turns on 2FA through the user's own session; returns the new session token and secret. */
const enableTwoFactor = async (
  app: express.Application,
  token: string
): Promise<{secret: Buffer; token: string}> => {
  const bearer = `Bearer ${token}`;
  const enable = await supertest(app)
    .post("/api/auth/two-factor/enable")
    .set("authorization", bearer)
    .send({password: PASSWORD});
  expect(enable.status).toBe(200);
  const secret = totpSecretFromURI(enable.body.totpURI as string);
  const verify = await supertest(app)
    .post("/api/auth/two-factor/verify-totp")
    .set("authorization", bearer)
    .send({code: totpCode(secret)});
  expect(verify.status).toBe(200);
  // Enrolment replaces the session; the bearer plugin hands back the new token.
  return {secret, token: String(verify.headers["set-auth-token"] ?? "")};
};

const addPasskeyRow = async (betterAuthApp: BetterAuthApp, userId: string): Promise<string> => {
  const context = await betterAuthContext(betterAuthApp);
  const row = await context.adapter.create<Record<string, unknown>, {id: string}>({
    data: {
      backedUp: false,
      counter: 0,
      credentialID: `credential-${userId}`,
      deviceType: "singleDevice",
      name: "Laptop",
      publicKey: `public-key-${userId}`,
      userId: await betterAuthIdFor(userId),
    },
    model: "passkey",
  });
  return String(row.id);
};

/** Registers a passkey with a software authenticator through the user's own session. */
const registerPasskey = async (app: express.Application, token: string): Promise<string> => {
  const authenticator = createSoftwareAuthenticator({origin: API_ORIGIN, rpID: "localhost"});
  const options = await supertest(app)
    .get("/api/auth/passkey/generate-register-options")
    .set("authorization", `Bearer ${token}`);
  expect(options.status).toBe(200);
  const registered = await supertest(app)
    .post("/api/auth/passkey/verify-registration")
    .set("authorization", `Bearer ${token}`)
    .set(
      "cookie",
      setCookies(options)
        .map((cookie) => cookie.split(";")[0])
        .join("; ")
    )
    .send({name: "Laptop", response: authenticator.register(options.body)});
  expect(registered.status).toBe(200);
  return String(registered.body.id);
};

describe("security notification emails", () => {
  beforeAll(async () => {
    await access.roles.seedDefaults();
  });

  beforeEach(async () => {
    await resetAccountSecurityState();
  });

  afterEach(async () => {
    await flushSecurityNotificationsForTests();
    // Restores every logger spy, even when a test failed before its own cleanup.
    mock.restore();
    resetAuditRecorderForTests();
    clearSecurityActionListenersForTests();
  });

  describe("admin recovery actions", () => {
    it("resetting 2FA emails the target once, naming an administrator and not the operator", async () => {
      const {app, sent} = buildMailingApp();
      const operator = await signUp(app, "operator", ["operator"]);
      const target = await signUp(app, "target");
      await enableTwoFactor(app, target.token);
      await clearMail(sent);

      const res = await runAction(
        app,
        operator.token,
        "post",
        `/users/${target.id}/security/reset-two-factor`
      );

      expect(res.status).toBe(200);
      const mail = await expectOneNotification(
        sent,
        target.email,
        "Two-step verification was turned off"
      );
      expect(mail.text).toContain("An administrator turned off two-step verification");
      expect(mail.text).not.toContain(operator.email);
      expect(mail.text).not.toContain("operator");
      expect(mail.html).toContain("<p>An administrator turned off two-step verification");
      // The admin reset is not mistaken for the user turning 2FA off themselves.
      expect(await selfActionsOf(target.id)).toEqual(["two-factor-enabled"]);
    });

    it("removing a passkey emails the target once, without the passkey's name", async () => {
      const {app, betterAuthApp, sent} = buildMailingApp();
      const operator = await signUp(app, "operator", ["operator"]);
      const target = await signUp(app, "target");
      const passkeyId = await addPasskeyRow(betterAuthApp, target.id);
      await clearMail(sent);

      const res = await runAction(
        app,
        operator.token,
        "delete",
        `/users/${target.id}/security/passkeys/${passkeyId}`
      );

      expect(res.status).toBe(200);
      const mail = await expectOneNotification(
        sent,
        target.email,
        "A passkey was removed from your account"
      );
      expect(mail.text).toContain("An administrator removed a passkey");
      expect(mail.text).not.toContain("Laptop");
      expect(await selfActionsOf(target.id)).toEqual([]);
    });

    it("unlinking a provider emails the target once, naming the provider", async () => {
      const {app, betterAuthApp, sent} = buildMailingApp();
      const operator = await signUp(app, "operator", ["operator"]);
      const target = await signUp(app, "target");
      const context = await betterAuthContext(betterAuthApp);
      await context.internalAdapter.createAccount({
        accessToken: "google-access-token",
        accountId: "google-account",
        providerId: "google",
        userId: await betterAuthIdFor(target.id),
      });
      await clearMail(sent);

      const res = await runAction(
        app,
        operator.token,
        "delete",
        `/users/${target.id}/security/accounts/google`
      );

      expect(res.status).toBe(200);
      const mail = await expectOneNotification(
        sent,
        target.email,
        "A sign-in method was disconnected from your account"
      );
      expect(mail.text).toContain("An administrator disconnected Google from your account");
      expect(mail.text).not.toContain("google-access-token");
      // Only the test's own link setup; the admin unlink adds no self event.
      expect(await selfActionsOf(target.id)).toEqual(["provider-linked"]);
    });

    it("signing the target out everywhere emails them once", async () => {
      const {app, sent} = buildMailingApp();
      const operator = await signUp(app, "operator", ["operator"]);
      const target = await signUp(app, "target");
      await clearMail(sent);

      const res = await runAction(
        app,
        operator.token,
        "post",
        `/users/${target.id}/security/revoke-sessions`
      );

      expect(res.status).toBe(200);
      const mail = await expectOneNotification(
        sent,
        target.email,
        "You were signed out everywhere"
      );
      expect(mail.text).toContain("An administrator signed your account out of every device");
      expect(await selfActionsOf(target.id)).toEqual([]);
    });

    it("disabling and enabling the account each email the target once", async () => {
      const {app, sent} = buildMailingApp();
      const operator = await signUp(app, "operator", ["operator"]);
      const target = await signUp(app, "target");
      await clearMail(sent);

      const disable = await runAction(
        app,
        operator.token,
        "post",
        `/users/${target.id}/security/disable`
      );
      expect(disable.status).toBe(200);
      await expectOneNotification(sent, target.email, "Your account was disabled");
      await clearMail(sent);

      const enable = await runAction(
        app,
        operator.token,
        "post",
        `/users/${target.id}/security/enable`
      );
      expect(enable.status).toBe(200);
      const mail = await expectOneNotification(sent, target.email, "Your account was re-enabled");
      expect(mail.text).toContain("An administrator re-enabled your account");
      expect(await selfActionsOf(target.id)).toEqual([]);
    });

    it("sends only the reset email for send-password-reset, with no separate notification", async () => {
      const {app, sent} = buildMailingApp();
      const operator = await signUp(app, "operator", ["operator"]);
      const target = await signUp(app, "target");
      await clearMail(sent);

      const res = await runAction(
        app,
        operator.token,
        "post",
        `/users/${target.id}/security/send-password-reset`
      );

      expect(res.status).toBe(200);
      await flushSecurityNotificationsForTests();
      expect(sent.map((mail) => ({subject: mail.subject, to: mail.to}))).toEqual([
        {subject: "Reset your password", to: target.email},
      ]);
    });

    it("sends nothing for a no-op action, which is not recorded", async () => {
      const {app, sent} = buildMailingApp();
      const operator = await signUp(app, "operator", ["operator"]);
      const target = await signUp(app, "target");
      await clearMail(sent);

      const res = await runAction(
        app,
        operator.token,
        "post",
        `/users/${target.id}/security/enable`
      );

      expect(res.status).toBe(200);
      expect(res.body.data.changed).toBe(false);
      expect(await notificationsIn(sent)).toHaveLength(0);
    });
  });

  describe("self-service changes", () => {
    it("turning on 2FA emails the user once and records two-factor-enabled with the user as actor", async () => {
      const {app, sent} = buildMailingApp();
      const user = await signUp(app, "self-2fa");
      await clearMail(sent);

      await enableTwoFactor(app, user.token);

      const mail = await expectOneNotification(
        sent,
        user.email,
        "Two-step verification was turned on"
      );
      expect(mail.text).toContain("You turned on two-step verification");
      const events = await selfSecurityEventsFor(user.id);
      expect(events).toHaveLength(1);
      expect(String(events[0].actorId)).toBe(user.id);
      expect(events[0].after).toMatchObject({securityAction: "two-factor-enabled"});
    });

    it("does not record the 2FA step of a later sign-in", async () => {
      const {app, sent} = buildMailingApp();
      const user = await signUp(app, "self-2fa-sign-in");
      const {secret} = await enableTwoFactor(app, user.token);
      await clearMail(sent);

      const signIn = await signInWithPassword(app, user.email);
      expect(signIn.body.twoFactorRedirect).toBe(true);
      const verify = await supertest(app)
        .post("/api/auth/two-factor/verify-totp")
        .set(
          "cookie",
          setCookies(signIn)
            .map((cookie) => cookie.split(";")[0])
            .join("; ")
        )
        .send({code: totpCode(secret)});

      expect(verify.status).toBe(200);
      expect(await notificationsIn(sent)).toHaveLength(0);
      expect(await selfSecurityEventsFor(user.id)).toHaveLength(1);
    });

    it("turning off 2FA emails the user once", async () => {
      const {app, sent} = buildMailingApp();
      const user = await signUp(app, "self-2fa-off");
      const {token} = await enableTwoFactor(app, user.token);
      await clearMail(sent);

      const res = await supertest(app)
        .post("/api/auth/two-factor/disable")
        .set("authorization", `Bearer ${token}`)
        .send({password: PASSWORD});

      expect(res.status).toBe(200);
      const mail = await expectOneNotification(
        sent,
        user.email,
        "Two-step verification was turned off"
      );
      expect(mail.text).toContain("You turned off two-step verification");
    });

    it("adding and removing a passkey each email the user once", async () => {
      const {app, sent} = buildMailingApp();
      const user = await signUp(app, "self-passkey");
      await clearMail(sent);

      const passkeyId = await registerPasskey(app, user.token);
      await expectOneNotification(sent, user.email, "A passkey was added to your account");
      await clearMail(sent);

      const res = await supertest(app)
        .post("/api/auth/passkey/delete-passkey")
        .set("authorization", `Bearer ${user.token}`)
        .send({id: passkeyId});

      expect(res.status).toBe(200);
      const mail = await expectOneNotification(
        sent,
        user.email,
        "A passkey was removed from your account"
      );
      expect(mail.text).toContain("You removed a passkey");
      const actions = (await selfSecurityEventsFor(user.id)).map(
        (event) => (event.after as {securityAction: string}).securityAction
      );
      expect(actions.sort()).toEqual(["passkey-added", "passkey-removed"]);
    });

    it("linking and unlinking a provider each email the user once", async () => {
      const email = `linker-${Date.now()}@example.com`;
      const {app, betterAuthApp, sent} = buildMailingApp({
        config: {
          googleOAuth: {clientId: "google-client", clientSecret: "google-secret"},
          options: stubGoogleIdTokenOptions({email, emailVerified: true, id: "google-sub-1"}),
        },
      });
      const signUpRes = await supertest(app)
        .post("/api/auth/sign-up/email")
        .send({email, name: "Linker", password: PASSWORD});
      expect(signUpRes.status).toBe(200);
      const token = signUpRes.body.token as string;
      await clearMail(sent);

      const link = await supertest(app)
        .post("/api/auth/link-social")
        .set("authorization", `Bearer ${token}`)
        .send({idToken: {token: "stub-id-token"}, provider: "google"});
      expect(link.status).toBe(200);
      const linked = await expectOneNotification(
        sent,
        email,
        "A sign-in method was connected to your account"
      );
      expect(linked.text).toContain("You connected Google to your account");
      await clearMail(sent);

      const user = await SecurityUser.findOne({email});
      const context = await betterAuthContext(betterAuthApp);
      const accounts = await context.internalAdapter.findAccounts(String(user?.betterAuthId));
      const google = accounts.find((account) => account.providerId === "google");
      const unlink = await supertest(app)
        .post("/api/auth/unlink-account")
        .set("authorization", `Bearer ${token}`)
        .send({accountId: google?.id});

      expect(unlink.status).toBe(200);
      const unlinked = await expectOneNotification(
        sent,
        email,
        "A sign-in method was disconnected from your account"
      );
      expect(unlinked.text).toContain("You disconnected Google from your account");
    });

    it("detects turning 2FA off from the database, not a stale cookie-cached session", async () => {
      const {app, sent} = buildMailingApp();
      const user = await signUp(app, "stale-cache");
      // A cookie sign-in caches the session user (twoFactorEnabled: false) in a cookie.
      const signIn = await signInWithPassword(app, user.email);
      expect(signIn.status).toBe(200);
      const cookie = setCookies(signIn)
        .map((entry) => entry.split(";")[0])
        .join("; ");
      expect(cookie).toContain("session_data=");
      // 2FA is turned on elsewhere; the cached session still says it is off.
      await betterAuthCollection("user").updateOne(
        {email: user.email},
        {$set: {twoFactorEnabled: true}}
      );
      await clearMail(sent);

      const res = await supertest(app)
        .post("/api/auth/two-factor/disable")
        .set("cookie", cookie)
        .send({password: PASSWORD});

      expect(res.status).toBe(200);
      await expectOneNotification(sent, user.email, "Two-step verification was turned off");
      expect(await selfActionsOf(user.id)).toEqual(["two-factor-disabled"]);
    });

    it("sends nothing when /two-factor/disable changes nothing", async () => {
      const {app, sent} = buildMailingApp();
      const user = await signUp(app, "disable-noop");
      await clearMail(sent);

      const res = await supertest(app)
        .post("/api/auth/two-factor/disable")
        .set("authorization", `Bearer ${user.token}`)
        .send({password: PASSWORD});

      expect(res.status).toBe(200);
      expect(await notificationsIn(sent)).toHaveLength(0);
      expect(await selfActionsOf(user.id)).toEqual([]);
    });

    it("does not treat a first sign-in with Google as a link", async () => {
      const email = `google-first-${Date.now()}@example.com`;
      const {app, sent} = buildMailingApp({
        config: {
          googleOAuth: {clientId: "google-client", clientSecret: "google-secret"},
          options: stubGoogleIdTokenOptions({email, emailVerified: true, id: "google-sub-2"}),
        },
      });

      const signIn = await supertest(app)
        .post("/api/auth/sign-in/social")
        .send({idToken: {token: "stub-id-token"}, provider: "google"});

      expect(signIn.status).toBe(200);
      const user = await SecurityUser.findOne({email});
      expect(user).toBeTruthy();
      expect(await notificationsIn(sent)).toHaveLength(0);
      expect(await selfActionsOf(String(user?._id))).toEqual([]);
    });

    it("emails once when an email user's Google sign-in links Google implicitly", async () => {
      const email = `google-implicit-${Date.now()}@example.com`;
      const {app, sent} = buildMailingApp({
        config: {
          googleOAuth: {clientId: "google-client", clientSecret: "google-secret"},
          options: stubGoogleIdTokenOptions({email, emailVerified: true, id: "google-sub-3"}),
        },
      });
      const signUpRes = await supertest(app)
        .post("/api/auth/sign-up/email")
        .send({email, name: "Implicit", password: PASSWORD});
      expect(signUpRes.status).toBe(200);
      await betterAuthCollection("user").updateOne({email}, {$set: {emailVerified: true}});
      await clearMail(sent);

      const signIn = await supertest(app)
        .post("/api/auth/sign-in/social")
        .send({idToken: {token: "stub-id-token"}, provider: "google"});

      expect(signIn.status).toBe(200);
      const mail = await expectOneNotification(
        sent,
        email,
        "A sign-in method was connected to your account"
      );
      expect(mail.text).toContain("You connected Google to your account");
      const user = await SecurityUser.findOne({email});
      expect(await selfActionsOf(String(user?._id))).toEqual(["provider-linked"]);
    });

    it("does not treat a first sign-in method as a link", async () => {
      const {app, sent} = buildMailingApp();
      const user = await signUp(app, "first-method");

      expect(await notificationsIn(sent)).toHaveLength(0);
      expect(await selfSecurityEventsFor(user.id)).toHaveLength(0);
    });

    it("changing the password emails the user once; a failed change sends nothing", async () => {
      const {app, sent} = buildMailingApp();
      const user = await signUp(app, "self-password");
      await clearMail(sent);

      const wrong = await supertest(app)
        .post("/api/auth/change-password")
        .set("authorization", `Bearer ${user.token}`)
        .send({currentPassword: "not-the-password-1", newPassword: NEW_PASSWORD});
      expect(wrong.status).toBe(400);
      expect(await notificationsIn(sent)).toHaveLength(0);

      const res = await supertest(app)
        .post("/api/auth/change-password")
        .set("authorization", `Bearer ${user.token}`)
        .send({currentPassword: PASSWORD, newPassword: NEW_PASSWORD});

      expect(res.status).toBe(200);
      const mail = await expectOneNotification(sent, user.email, "Your password was changed");
      expect(mail.text).toContain("You changed the password for your account");
      expect(mail.text).not.toContain(NEW_PASSWORD);
    });

    it("completing a password reset emails the user once, without the token", async () => {
      const {app, sent} = buildMailingApp();
      const user = await signUp(app, "self-reset");
      await clearMail(sent);
      const request = await supertest(app)
        .post("/api/auth/request-password-reset")
        .send({email: user.email});
      expect(request.status).toBe(200);
      const resetToken = resetTokenFrom(
        sent.find((mail) => mail.subject === "Reset your password") as Mail
      );
      await clearMail(sent);

      const res = await supertest(app)
        .post("/api/auth/reset-password")
        .send({newPassword: NEW_PASSWORD, token: resetToken});

      expect(res.status).toBe(200);
      const mail = await expectOneNotification(sent, user.email, "Your password was reset");
      expect(mail.text).toContain("The password for your account was reset with a reset link");
      expect(mail.text).not.toMatch(/^You /);
      expect(mail.text).not.toContain(resetToken);
    });

    it("signing out other sessions emails the user once", async () => {
      const {app, sent} = buildMailingApp();
      const user = await signUp(app, "self-sessions");
      await signInWithPassword(app, user.email);
      await clearMail(sent);

      const res = await supertest(app)
        .post("/api/auth/revoke-other-sessions")
        .set("authorization", `Bearer ${user.token}`)
        .send({});

      expect(res.status).toBe(200);
      const mail = await expectOneNotification(
        sent,
        user.email,
        "Your other sessions were signed out"
      );
      expect(mail.text).toContain("You signed your account out of every other device");
    });
  });

  describe("every action", () => {
    // Written out by hand, so a new action fails here until someone decides what it emails.
    const EXPECTED_SUBJECTS: Record<SecurityActionId, string> = {
      disable: "Your account was disabled",
      enable: "Your account was re-enabled",
      "issue-sign-in-link": "A sign-in link was created for your account",
      "other-sessions-revoked": "Your other sessions were signed out",
      "passkey-added": "A passkey was added to your account",
      "passkey-removed": "A passkey was removed from your account",
      "password-changed": "Your password was changed",
      "password-reset": "Your password was reset",
      "provider-linked": "A sign-in method was connected to your account",
      "provider-unlinked": "A sign-in method was disconnected from your account",
      "remove-passkey": "A passkey was removed from your account",
      "reset-two-factor": "Two-step verification was turned off",
      "revoke-sessions": "You were signed out everywhere",
      "send-password-reset": "silent",
      "suspend-membership": "Your organization membership was suspended",
      "two-factor-disabled": "Two-step verification was turned off",
      "two-factor-enabled": "Two-step verification was turned on",
      "unlink-provider": "A sign-in method was disconnected from your account",
    };

    it("covers every security action", () => {
      expect(Object.keys(EXPECTED_SUBJECTS).sort()).toEqual(Object.keys(SECURITY_ACTIONS).sort());
      expect(Object.keys(SECURITY_NOTIFICATION_TEMPLATES).sort()).toEqual(
        Object.keys(SECURITY_ACTIONS).sort()
      );
    });

    it.each(Object.keys(SECURITY_ACTIONS) as SecurityActionId[])(
      "%s sends the expected email (or none) to the target",
      async (action) => {
        const expected = EXPECTED_SUBJECTS[action];
        expect(expected).toBeDefined();
        const {app, sent} = buildMailingApp();
        const target = await signUp(app, "every-action");
        await clearMail(sent);

        void recordSecurityAction({
          action,
          actor: {id: target.id},
          details: {providerId: "github"},
          target: {id: target.id},
        });

        if (expected === "silent") {
          expect(await notificationsIn(sent)).toHaveLength(0);
          return;
        }
        await expectOneNotification(sent, target.email, expected);
      }
    );

    it("tells the user an administrator created a sign-in link, without the link", async () => {
      const {app, sent} = buildMailingApp();
      const operator = await signUp(app, "operator");
      const target = await signUp(app, "link-target");
      await clearMail(sent);

      void recordSecurityAction({
        action: "issue-sign-in-link",
        actor: {id: operator.id},
        details: {expiresAt: "2026-10-30T00:00:00.000Z"},
        target: {id: target.id},
      });

      const mail = await expectOneNotification(
        sent,
        target.email,
        "A sign-in link was created for your account"
      );
      expect(mail.text).toContain("An administrator created a sign-in link for your account");
      expect(mail.text).not.toContain("token=");
      expect(mail.text).not.toContain("resetPassword");
    });
  });

  describe("org name", () => {
    const org = {id: "org-1", name: "Acme <Clinic>"};

    it("leaves the org name out by default", async () => {
      const {app, sent} = buildMailingApp();
      const operator = await signUp(app, "operator");
      const target = await signUp(app, "member");
      await clearMail(sent);

      void recordSecurityAction({
        action: "remove-passkey",
        actor: {id: operator.id},
        org,
        target: {id: target.id},
      });

      const mail = await expectOneNotification(
        sent,
        target.email,
        "A passkey was removed from your account"
      );
      expect(mail.text).toContain("An administrator removed a passkey from your account");
      expect(mail.text).not.toContain("Acme");
      expect(mail.html).not.toContain("Acme");
    });

    it("names the org with includeOrgName, HTML-escaped in the HTML body", async () => {
      const {app, sent} = buildMailingApp({notifications: {includeOrgName: true}});
      const operator = await signUp(app, "operator");
      const target = await signUp(app, "member");
      await clearMail(sent);

      void recordSecurityAction({
        action: "remove-passkey",
        actor: {id: operator.id},
        org,
        target: {id: target.id},
      });

      const mail = await expectOneNotification(
        sent,
        target.email,
        "A passkey was removed from your account"
      );
      expect(mail.text).toContain("An administrator at Acme <Clinic> removed a passkey");
      expect(mail.html).toContain("An administrator at Acme &lt;Clinic&gt; removed a passkey");
    });

    it("says which org suspended the membership only with includeOrgName", async () => {
      const named = buildMailingApp({notifications: {includeOrgName: true}});
      const target = await signUp(named.app, "suspended");
      await clearMail(named.sent);

      void recordSecurityAction({
        action: "suspend-membership",
        actor: {id: target.id},
        org: {id: "org-2", name: "Acme Clinic"},
        target: {id: target.id},
      });

      const mail = await expectOneNotification(
        named.sent,
        target.email,
        "Your organization membership was suspended"
      );
      expect(mail.text).toContain("An administrator suspended your membership in Acme Clinic");

      const unnamed = renderSecurityMail({
        data: {actor: "An administrator", orgReference: "an organization"},
        templateId: "securityMembershipSuspended",
      });
      expect(unnamed.text).toContain("suspended your membership in an organization");
    });

    it("never names an org on the user's own changes", async () => {
      const {app, sent} = buildMailingApp({notifications: {includeOrgName: true}});
      const user = await signUp(app, "self-org");
      await clearMail(sent);

      void recordSecurityAction({
        action: "password-changed",
        actor: {id: user.id},
        org,
        target: {id: user.id},
      });

      const mail = await expectOneNotification(sent, user.email, "Your password was changed");
      expect(mail.text).toContain("You changed the password");
      expect(mail.text).not.toContain("Acme");
    });
  });

  describe("delivery rules", () => {
    it("sends nothing, renders nothing, and logs no error when sendMail is unset", async () => {
      const errorSpy = spyOn(logger, "error");
      const render = mock(renderSecurityMail);
      const {app} = buildApp({security: {notifications: {render}}});
      const operator = await signUp(app, "operator", ["operator"]);
      const target = await signUp(app, "target");

      const res = await runAction(
        app,
        operator.token,
        "post",
        `/users/${target.id}/security/revoke-sessions`
      );

      expect(res.status).toBe(200);
      await flushSecurityNotificationsForTests();
      expect(render).not.toHaveBeenCalled();
      expect(
        errorSpy.mock.calls.filter((call) => String(call[0]).includes("Security notification"))
      ).toHaveLength(0);

      // The same action with a mailer renders and sends, so the check above is meaningful.
      const sendMail = mock(async (_message: Mail): Promise<void> => {});
      const mailing = buildApp({
        config: {sendMail},
        security: {notifications: {render}},
      });
      const operatorToken = (await signInWithPassword(mailing.app, operator.email)).body
        .token as string;
      await runAction(
        mailing.app,
        operatorToken,
        "post",
        `/users/${target.id}/security/revoke-sessions`
      );
      await flushSecurityNotificationsForTests();
      expect(render).toHaveBeenCalledTimes(1);
      expect(sendMail.mock.calls.map(([message]) => message.to)).toEqual([target.email]);
    });

    it("sends nothing with notifications.enabled false, leaving reset mail alone", async () => {
      const {app, sent} = buildMailingApp({notifications: {enabled: false}});
      const operator = await signUp(app, "operator", ["operator"]);
      const target = await signUp(app, "target");
      await clearMail(sent);

      await runAction(app, operator.token, "post", `/users/${target.id}/security/revoke-sessions`);
      await runAction(
        app,
        operator.token,
        "post",
        `/users/${target.id}/security/send-password-reset`
      );

      expect(await notificationsIn(sent)).toHaveLength(0);
      expect(sent.map((mail) => mail.subject)).toEqual(["Reset your password"]);
    });

    it("stops emailing after unsubscribeNotifications", async () => {
      const sent: Mail[] = [];
      const {accountSecurityApp, app} = buildApp({
        config: {
          publicAppUrl: PUBLIC_APP_URL,
          sendMail: async (message): Promise<void> => {
            sent.push(message);
          },
        },
      });
      const user = await signUp(app, "unsubscribed");
      await clearMail(sent);

      accountSecurityApp?.unsubscribeNotifications();
      void recordSecurityAction({
        action: "password-changed",
        actor: {id: user.id},
        target: {id: user.id},
      });

      expect(await notificationsIn(sent)).toHaveLength(0);
    });

    it("uses notifications.sendMail when it is set", async () => {
      const own: Mail[] = [];
      const {app, sent} = buildMailingApp({
        notifications: {
          sendMail: async (message): Promise<void> => {
            own.push(message);
          },
        },
      });
      const operator = await signUp(app, "operator", ["operator"]);
      const target = await signUp(app, "target");
      await clearMail(sent);

      await runAction(app, operator.token, "post", `/users/${target.id}/security/revoke-sessions`);

      expect(await notificationsIn(sent)).toHaveLength(0);
      expect((await notificationsIn(own)).map((mail) => mail.to)).toEqual([target.email]);
    });

    it("skips a user with no email", async () => {
      const {app, sent} = buildMailingApp();
      const operator = await signUp(app, "operator", ["operator"]);
      const target = await signUp(app, "target");
      await SecurityUser.collection.updateOne(
        {_id: (await SecurityUser.findById(target.id))?._id},
        {$set: {email: ""}}
      );
      await clearMail(sent);

      const res = await runAction(
        app,
        operator.token,
        "post",
        `/users/${target.id}/security/revoke-sessions`
      );

      expect(res.status).toBe(200);
      expect(await notificationsIn(sent)).toHaveLength(0);
    });

    it("logs a failed delivery without the address and still completes the action", async () => {
      const errorSpy = spyOn(logger, "error");
      let isFailing = false;
      const {app} = buildMailingApp({
        sendMail: async (): Promise<void> => {
          if (isFailing) {
            throw new Error("SMTP down");
          }
        },
      });
      const operator = await signUp(app, "operator", ["operator"]);
      const target = await signUp(app, "target");
      isFailing = true;

      const res = await runAction(
        app,
        operator.token,
        "post",
        `/users/${target.id}/security/revoke-sessions`
      );

      expect(res.status).toBe(200);
      await flushSecurityNotificationsForTests();
      const failures = errorSpy.mock.calls
        .map((call) => String(call[0]))
        .filter((message) => message.includes("Security notification failed"));
      expect(failures).toHaveLength(1);
      expect(failures[0]).toContain("action=revoke-sessions");
      expect(failures[0]).toContain(`userId=${target.id}`);
      expect(failures[0]).not.toContain(target.email);
    });

    it("points to publicAppUrl when set, and only to support without it", async () => {
      const withUrl = buildMailingApp();
      const user = await signUp(withUrl.app, "with-url");
      await clearMail(withUrl.sent);
      void recordSecurityAction({
        action: "password-changed",
        actor: {id: user.id},
        target: {id: user.id},
      });
      const linked = await expectOneNotification(
        withUrl.sent,
        user.email,
        "Your password was changed"
      );
      expect(linked.text).toContain(
        `contact support right away. You can review your account security at ${PUBLIC_APP_URL}.`
      );
      clearSecurityActionListenersForTests();

      const withoutUrl = buildMailingApp({config: {publicAppUrl: undefined}});
      await clearMail(withoutUrl.sent);
      void recordSecurityAction({
        action: "password-changed",
        actor: {id: user.id},
        target: {id: user.id},
      });
      const bare = await expectOneNotification(
        withoutUrl.sent,
        user.email,
        "Your password was changed"
      );
      expect(bare.text).toContain("If you did not expect this change, contact support right away.");
      expect(bare.text).not.toContain("http");
    });

    it("renders with notifications.render and authMailTemplates when the app opts in", async () => {
      const calls: string[] = [];
      const {app, sent} = buildMailingApp({
        config: {
          authMailTemplates: {
            securityPasswordChanged: {
              subject: "Custom: {{actor}} changed it",
              text: "{{occurredAt}}",
            },
          },
        },
        notifications: {
          render: (options) => {
            calls.push(options.templateId);
            const rendered = renderSecurityMail(options);
            return {...rendered, subject: `[App] ${rendered.subject}`};
          },
        },
      });
      const user = await signUp(app, "custom-render");
      await clearMail(sent);

      void recordSecurityAction({
        action: "password-changed",
        actor: {id: user.id},
        target: {id: user.id},
      });

      await flushSecurityNotificationsForTests();
      expect(calls).toEqual(["securityPasswordChanged"]);
      expect(sent.map((mail) => mail.subject)).toEqual(["[App] Custom: You changed it"]);
    });

    it("never passes security ids to an old-style BetterAuthConfig.renderAuthMail", async () => {
      const calls: string[] = [];
      const {app, sent} = buildMailingApp({
        config: {
          // Written for two ids: anything but resetPassword gets the verify mail.
          renderAuthMail: ({templateId, token}) => {
            calls.push(templateId);
            return templateId === "resetPassword"
              ? {subject: "Reset your password", text: `reset ${token}`}
              : {subject: "Verify your email", text: `verify ${token}`};
          },
        },
      });
      const user = await signUp(app, "old-renderer");
      await clearMail(sent);
      calls.length = 0;

      void recordSecurityAction({
        action: "password-changed",
        actor: {id: user.id},
        target: {id: user.id},
      });

      await expectOneNotification(sent, user.email, "Your password was changed");
      expect(calls).toEqual([]);
      expect(sent.map((mail) => mail.subject)).toEqual(["Your password was changed"]);
    });

    it("falls back to the built-in templates when notifications.render throws", async () => {
      const warnSpy = spyOn(logger, "warn");
      const {app, sent} = buildMailingApp({
        notifications: {
          render: () => {
            throw new Error("unknown template");
          },
        },
      });
      const user = await signUp(app, "throwing-render");
      await clearMail(sent);

      void recordSecurityAction({
        action: "password-changed",
        actor: {id: user.id},
        target: {id: user.id},
      });

      await expectOneNotification(sent, user.email, "Your password was changed");
      expect(warnSpy.mock.calls.some((call) => String(call[0]).includes("could not render"))).toBe(
        true
      );
    });

    it("emails once when two apps register AccountSecurityApp: the newest owns the emails", async () => {
      const first = buildMailingApp();
      const second = buildMailingApp();
      const user = await signUp(second.app, "two-apps");
      await clearMail(first.sent);
      await clearMail(second.sent);

      void recordSecurityAction({
        action: "password-changed",
        actor: {id: user.id},
        target: {id: user.id},
      });

      expect(await notificationsIn(first.sent)).toHaveLength(0);
      await expectOneNotification(second.sent, user.email, "Your password was changed");
    });

    it("collapses repeats of one change into one email per throttle window", async () => {
      const {app, sent} = buildMailingApp();
      const user = await signUp(app, "repeat-sessions");
      await clearMail(sent);

      for (let attempt = 0; attempt < 3; attempt += 1) {
        await signInWithPassword(app, user.email);
        const res = await supertest(app)
          .post("/api/auth/revoke-other-sessions")
          .set("authorization", `Bearer ${user.token}`)
          .send({});
        expect(res.status).toBe(200);
      }

      await expectOneNotification(sent, user.email, "Your other sessions were signed out");
      // Every change is still in the audit log.
      expect(await selfActionsOf(user.id)).toEqual([
        "other-sessions-revoked",
        "other-sessions-revoked",
        "other-sessions-revoked",
      ]);
    });

    it("never lets the user's own change swallow an administrator's email about the same thing", async () => {
      const {app, sent} = buildMailingApp();
      const operator = await signUp(app, "operator");
      const target = await signUp(app, "target");
      await clearMail(sent);

      void recordSecurityAction({
        action: "passkey-removed",
        actor: {id: target.id},
        target: {id: target.id},
      });
      void recordSecurityAction({
        action: "remove-passkey",
        actor: {id: operator.id},
        target: {id: target.id},
      });

      const mails = await notificationsIn(sent, target.email);
      expect(mails.map((mail) => mail.subject)).toEqual([
        "A passkey was removed from your account",
        "A passkey was removed from your account",
      ]);
      expect(mails.map((mail) => mail.text.split(" removed")[0]).sort()).toEqual([
        "An administrator",
        "You",
      ]);
    });

    it("emails once per org when admins of two orgs act on the same member", async () => {
      const {app, sent} = buildMailingApp();
      const operator = await signUp(app, "operator");
      const target = await signUp(app, "member");
      await clearMail(sent);

      for (const org of [{id: "org-a"}, {id: "org-b"}, {id: "org-a"}]) {
        void recordSecurityAction({
          action: "reset-two-factor",
          actor: {id: operator.id},
          org,
          target: {id: target.id},
        });
      }

      const mails = await notificationsIn(sent, target.email);
      expect(mails).toHaveLength(2);
      expect(mails.every((mail) => mail.text.startsWith("An administrator"))).toBe(true);
    });

    it("prunes throttle entries once their window has passed", async () => {
      const sentTo: string[] = [];
      let clock = DateTime.fromISO("2026-10-23T12:00:00Z").toMillis();
      const listener = createSecurityNotificationListener({
        getMailConfig: () => ({
          sendMail: async (message): Promise<void> => {
            sentTo.push(message.to);
          },
        }),
        getUserModel: () => securityUserModel,
        now: () => clock,
        throttleMinutes: 10,
      });
      const {app} = buildApp();
      const [first, second, third] = [
        await signUp(app, "prune-a"),
        await signUp(app, "prune-b"),
        await signUp(app, "prune-c"),
      ];
      const eventFor = (userId: string): SecurityActionEvent => ({
        action: "password-changed",
        actor: {id: userId},
        occurredAt: DateTime.fromMillis(clock).toISO() ?? "",
        origin: "self",
        target: {id: userId},
      });

      await listener(eventFor(first.id));
      clock += Duration.fromObject({minutes: 5}).toMillis();
      await listener(eventFor(second.id));
      await listener(eventFor(first.id));
      expect(listener.throttleEntryCount()).toBe(2);
      expect(sentTo).toEqual([first.email, second.email]);

      clock += Duration.fromObject({minutes: 6}).toMillis();
      await listener(eventFor(third.id));

      // The first user's entry (11 minutes old) is gone; the second's (6 minutes) stays.
      expect(listener.throttleEntryCount()).toBe(2);
      await listener(eventFor(first.id));
      expect(sentTo).toEqual([first.email, second.email, third.email, first.email]);
    });

    it("throttles per user and template, and throttleMinutes 0 sends every one", async () => {
      const throttled = buildMailingApp();
      const user = await signUp(throttled.app, "throttle-keys");
      const other = await signUp(throttled.app, "throttle-other");
      await clearMail(throttled.sent);
      for (const action of ["password-changed", "password-changed", "passkey-added"] as const) {
        void recordSecurityAction({action, actor: {id: user.id}, target: {id: user.id}});
      }
      void recordSecurityAction({
        action: "password-changed",
        actor: {id: other.id},
        target: {id: other.id},
      });
      expect(
        (await notificationsIn(throttled.sent)).map((mail) => `${mail.to} ${mail.subject}`).sort()
      ).toEqual(
        [
          `${other.email} Your password was changed`,
          `${user.email} A passkey was added to your account`,
          `${user.email} Your password was changed`,
        ].sort()
      );

      const unthrottled = buildMailingApp({notifications: {throttleMinutes: 0}});
      for (let attempt = 0; attempt < 2; attempt += 1) {
        void recordSecurityAction({
          action: "password-changed",
          actor: {id: user.id},
          target: {id: user.id},
        });
      }
      expect(await notificationsIn(unthrottled.sent)).toHaveLength(2);
    });
  });

  describe("templates", () => {
    it.each([...SECURITY_MAIL_TEMPLATE_IDS])("%s renders subject, text, and html", (templateId) => {
      const rendered = renderSecurityMail({
        data: {
          actor: "You",
          appUrl: PUBLIC_APP_URL,
          occurredAt: "October 23, 2026 at 14:05 UTC",
          orgClause: "",
          orgReference: "an organization",
          providerName: "Google",
          secureAccountLine: "If you did not expect this change, contact support right away.",
        },
        templateId,
      });
      expect(rendered.subject.length).toBeGreaterThan(0);
      expect(rendered.text).toContain("October 23, 2026 at 14:05 UTC");
      expect(rendered.text).toContain("contact support");
      expect(rendered.text).not.toContain("{{");
      expect(rendered.html).toContain("<p>");
      expect(rendered.html).not.toContain("{{");
    });
  });
});
