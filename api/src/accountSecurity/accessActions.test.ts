import {afterEach, beforeAll, beforeEach, describe, expect, it} from "bun:test";
import express from "express";
import {DateTime} from "luxon";
import mongoose from "mongoose";
import passportLocalMongoose from "passport-local-mongoose";
import supertest from "supertest";

import {resetAuditRecorderForTests} from "../audit/record";
import type {User, UserModel} from "../auth";
import type {BetterAuthApp} from "../betterAuthApp";
import {apiErrorMiddleware} from "../errors";
import {type AuthenticatableSocket, createBetterAuthValidator} from "../realtime/socketAuth";
import {type RequestCredential, runWithRequestContext} from "../requestContext";
import {
  access,
  betterAuthCollection,
  betterAuthIdFor,
  buildApp,
  captureMail,
  getSummary,
  resetAccountSecurityState,
  resetTokenFrom,
  SecurityUser,
  securityEventsFor,
  securityUserModel,
  signInWithPassword,
  signUp,
} from "../tests/accountSecurityTestApp";
import {PASSWORD, uniqueEmail} from "../tests/betterAuthStubs";
import {AccountSecurityApp} from "./accountSecurityApp";
import {createAccountSecurityService} from "./accountSecurityService";
import {clearSecurityActionListenersForTests} from "./securityEvents";

const NEW_PASSWORD = "new-password-654321";

const PUBLIC_APP_URL = "https://app.example.com";

const runAction = (
  app: express.Application,
  token: string,
  userId: string,
  action: string
): supertest.Test =>
  supertest(app)
    .post(`/users/${userId}/security/${action}`)
    .set("authorization", `Bearer ${token}`)
    .send({});

const getMe = (app: express.Application, token: string): supertest.Test =>
  supertest(app).get("/auth/me").set("authorization", `Bearer ${token}`);

const actionIdsOf = (res: supertest.Response): string[] =>
  (res.body.data.actions as {id: string}[]).map((action) => action.id);

/** Runs RealtimeApp's Better Auth handshake validator on a stub socket. */
const validateSocket = async (
  betterAuthApp: BetterAuthApp,
  token: string
): Promise<AuthenticatableSocket> => {
  const socket = {handshake: {auth: {token}}} as unknown as AuthenticatableSocket;
  await createBetterAuthValidator({auth: betterAuthApp.ensureAuth(), userModel: securityUserModel})(
    socket
  );
  return socket;
};

interface PlainUserFields {
  admin?: boolean;
  betterAuthId?: string;
  email: string;
  name?: string;
}

/** An app User model with neither `disabled` nor `tokenEpoch`. */
const PlainUser = ((): mongoose.Model<PlainUserFields> => {
  if (mongoose.models.AccountSecurityPlainUser) {
    return mongoose.models.AccountSecurityPlainUser as mongoose.Model<PlainUserFields>;
  }
  const schema = new mongoose.Schema<PlainUserFields>({
    admin: {default: false, description: "Whether the user is an admin", type: Boolean},
    betterAuthId: {description: "Linked Better Auth user id", index: true, type: String},
    email: {description: "Email address", required: true, type: String},
    name: {description: "Display name", type: String},
  });
  schema.plugin(
    passportLocalMongoose as unknown as (
      target: mongoose.Schema,
      options?: Record<string, unknown>
    ) => void,
    {usernameField: "email"}
  );
  return mongoose.model<PlainUserFields>("AccountSecurityPlainUser", schema);
})();

/** A legacy app User with a JWT (passport) password. */
const registerWithPassword = async (email: string): Promise<string> => {
  const user = await (
    SecurityUser as unknown as {
      register: (user: unknown, password: string) => Promise<{_id: unknown}>;
    }
  ).register(new SecurityUser({email, name: "Has Password"}), PASSWORD);
  return String(user._id);
};

/** A legacy app User with no Better Auth link and no password, like a GitHub-JWT user. */
const createLegacyUser = async (label: string): Promise<{email: string; id: string}> => {
  const email = uniqueEmail(label);
  const user = await SecurityUser.create({email, name: label});
  return {email, id: String(user._id)};
};

const signInWithNewPassword = (app: express.Application, email: string): supertest.Test =>
  supertest(app)
    .post("/api/auth/sign-in/email")
    .set("content-type", "application/json")
    .send({email, password: NEW_PASSWORD});

const resetPassword = (app: express.Application, token: string): supertest.Test =>
  supertest(app)
    .post("/api/auth/reset-password")
    .set("content-type", "application/json")
    .send({newPassword: NEW_PASSWORD, token});

const tokenFromUrl = (url: string): string => new URL(url).searchParams.get("token") ?? "";

describe("access recovery actions", () => {
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

  describe("revoke-sessions", () => {
    it("deletes every session, so the old bearer gets 401, and bumps tokenEpoch", async () => {
      const {app} = buildApp();
      const operator = await signUp(app, "operator-revoke", ["operator"]);
      const target = await signUp(app, "revoke-target");
      const second = await signInWithPassword(app, target.email);
      expect(second.status).toBe(200);
      expect((await getMe(app, target.token)).status).toBe(200);
      const summary = await getSummary(app, operator.token, target.id);
      expect(summary.body.data.sessions.active).toBe(2);
      expect(actionIdsOf(summary)).toContain("revoke-sessions");

      const res = await runAction(app, operator.token, target.id, "revoke-sessions");

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        action: "revoke-sessions",
        changed: true,
        jwtRefreshRevoked: true,
        revokedCount: 2,
      });
      expect((await getMe(app, target.token)).status).toBe(401);
      expect((await getMe(app, second.body.token)).status).toBe(401);
      expect(
        await betterAuthCollection("session").countDocuments({
          userId: await betterAuthIdFor(target.id),
        })
      ).toBe(0);
      expect((await SecurityUser.findById(target.id))?.tokenEpoch).toBe(1);
      const events = await securityEventsFor(target.id);
      expect(events).toHaveLength(1);
      expect(events[0].after).toEqual({
        jwtRefreshRevoked: true,
        revokedCount: 2,
        securityAction: "revoke-sessions",
      });
      const after = await getSummary(app, operator.token, target.id);
      expect(after.body.data.sessions.active).toBe(0);
      expect(actionIdsOf(after)).not.toContain("revoke-sessions");
      // The user can sign in again.
      expect((await signInWithPassword(app, target.email)).status).toBe(200);
    });

    it("makes a legacy JWT refresh token fail", async () => {
      const {app} = buildApp();
      const operator = await signUp(app, "operator-revoke-jwt", ["operator"]);
      const email = uniqueEmail("revoke-jwt");
      const userId = await registerWithPassword(email);
      const login = await supertest(app).post("/auth/login").send({email, password: PASSWORD});
      expect(login.status).toBe(200);
      const refreshToken = login.body.data.refreshToken as string;

      const res = await runAction(app, operator.token, userId, "revoke-sessions");

      expect(res.status).toBe(200);
      expect(res.body.data.jwtRefreshRevoked).toBe(true);
      const refresh = await supertest(app).post("/auth/refresh_token").send({refreshToken});
      expect(refresh.status).toBe(401);
    });

    it("bumps tokenEpoch for a user with no Better Auth sessions", async () => {
      const {app} = buildApp();
      const operator = await signUp(app, "operator-revoke-legacy", ["operator"]);
      const legacy = await createLegacyUser("revoke-legacy");

      const res = await runAction(app, operator.token, legacy.id, "revoke-sessions");

      expect(res.status).toBe(200);
      expect(res.body.data.revokedCount).toBe(0);
      expect(res.body.data.changed).toBe(true);
      expect((await SecurityUser.findById(legacy.id))?.tokenEpoch).toBe(1);
    });
  });

  describe("send-password-reset", () => {
    it("mails a reset link that sets a new password", async () => {
      const mail = captureMail();
      const {app} = buildApp({config: mail.config});
      const operator = await signUp(app, "operator-send-reset", ["operator"]);
      const target = await signUp(app, "send-reset-target");
      mail.sent.length = 0;

      const res = await runAction(app, operator.token, target.id, "send-password-reset");

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({action: "send-password-reset", changed: true, sent: true});
      expect(mail.sent.map((sent) => [sent.to, sent.subject])).toEqual([
        [target.email, "Reset your password"],
      ]);
      expect(mail.sent[0].text).toContain(`${PUBLIC_APP_URL}/resetPassword?token=`);
      const events = await securityEventsFor(target.id);
      expect(events.map((event) => event.after)).toEqual([{securityAction: "send-password-reset"}]);

      expect((await resetPassword(app, resetTokenFrom(mail.sent[0]))).status).toBe(200);
      expect((await signInWithNewPassword(app, target.email)).status).toBe(200);
    });

    it("answers 501 when publicAppUrl is unset", async () => {
      const mail = captureMail();
      const {app} = buildApp({config: {sendMail: mail.config.sendMail}});
      const operator = await signUp(app, "operator-no-url", ["operator"]);
      const target = await signUp(app, "no-url-target");
      mail.sent.length = 0;

      const res = await runAction(app, operator.token, target.id, "send-password-reset");

      expect(res.status).toBe(501);
      expect(res.body.title).toBe("publicAppUrl is required to send recovery mail");
      expect(mail.sent).toHaveLength(0);
      expect(await securityEventsFor(target.id)).toHaveLength(0);
    });

    it("answers 501 when sendMail is unset", async () => {
      const {app} = buildApp();
      const operator = await signUp(app, "operator-no-mail", ["operator"]);
      const target = await signUp(app, "no-mail-target");

      const res = await runAction(app, operator.token, target.id, "send-password-reset");

      expect(res.status).toBe(501);
      expect(res.body.title).toBe("Password reset email is not configured");
    });

    it("refuses a user with no Better Auth account with 409", async () => {
      const mail = captureMail();
      const {app} = buildApp({config: mail.config});
      const operator = await signUp(app, "operator-reset-legacy", ["operator"]);
      const legacy = await createLegacyUser("reset-legacy");

      const res = await runAction(app, operator.token, legacy.id, "send-password-reset");

      expect(res.status).toBe(409);
      expect(res.body.title).toBe("User has no Better Auth account");
      expect(await securityEventsFor(legacy.id)).toHaveLength(0);
    });
  });

  describe("disable and enable", () => {
    it("disable refuses REST and the socket handshake; enable lets the user back in", async () => {
      const {app, betterAuthApp} = buildApp();
      const operator = await signUp(app, "operator-disable", ["operator"]);
      const target = await signUp(app, "disable-target");
      expect((await validateSocket(betterAuthApp, target.token)).decodedToken?.id).toBe(target.id);
      expect(actionIdsOf(await getSummary(app, operator.token, target.id))).toContain("disable");

      const disabled = await runAction(app, operator.token, target.id, "disable");

      expect(disabled.status).toBe(200);
      expect(disabled.body.data).toEqual({
        action: "disable",
        changed: true,
        jwtRefreshRevoked: true,
        revokedCount: 1,
      });
      expect((await SecurityUser.findById(target.id))?.disabled).toBe(true);
      expect((await getMe(app, target.token)).status).toBe(401);
      // A fresh Better Auth session for the disabled user authenticates nothing.
      const signIn = await signInWithPassword(app, target.email);
      expect(signIn.status).toBe(200);
      const freshToken = signIn.body.token as string;
      expect((await getMe(app, freshToken)).status).toBe(401);
      await expect(validateSocket(betterAuthApp, freshToken)).rejects.toThrow(
        "Unauthorized: user is disabled"
      );
      const summary = await getSummary(app, operator.token, target.id);
      expect(summary.body.data.disabled).toBe(true);
      expect(actionIdsOf(summary)).toContain("enable");
      expect(actionIdsOf(summary)).not.toContain("disable");

      const again = await runAction(app, operator.token, target.id, "disable");
      expect(again.body.data.changed).toBe(false);

      const enabled = await runAction(app, operator.token, target.id, "enable");

      expect(enabled.status).toBe(200);
      expect(enabled.body.data).toEqual({action: "enable", changed: true});
      const back = await signInWithPassword(app, target.email);
      expect(back.status).toBe(200);
      expect((await getMe(app, back.body.token)).status).toBe(200);
      expect((await validateSocket(betterAuthApp, back.body.token)).decodedToken?.id).toBe(
        target.id
      );
      const events = await securityEventsFor(target.id);
      expect(events.map((event) => event.after)).toEqual([
        {jwtRefreshRevoked: true, revokedCount: 1, securityAction: "disable"},
        {securityAction: "enable"},
      ]);
    });

    it("enable on an enabled user changes nothing and records nothing", async () => {
      const {app} = buildApp();
      const operator = await signUp(app, "operator-enable-noop", ["operator"]);
      const target = await signUp(app, "enable-noop-target");

      const res = await runAction(app, operator.token, target.id, "enable");

      expect(res.status).toBe(200);
      expect(res.body.data.changed).toBe(false);
      expect(await securityEventsFor(target.id)).toHaveLength(0);
    });
  });

  describe("issue-sign-in-link", () => {
    it("links a legacy user, and the link sets a password once for the same app User", async () => {
      const {app, betterAuthApp} = buildApp({config: {publicAppUrl: PUBLIC_APP_URL}});
      const operator = await signUp(app, "superadmin-link", ["superadmin"]);
      const legacy = await createLegacyUser("link-legacy");
      const usersBefore = await SecurityUser.countDocuments({});
      const summary = await getSummary(app, operator.token, legacy.id);
      expect(summary.body.data.legacyPassword).toBe(false);
      expect(actionIdsOf(summary)).toContain("issue-sign-in-link");

      const res = await runAction(app, operator.token, legacy.id, "issue-sign-in-link");

      expect(res.status).toBe(200);
      expect(res.body.data.action).toBe("issue-sign-in-link");
      const url = res.body.data.url as string;
      expect(url.startsWith(`${PUBLIC_APP_URL}/resetPassword?token=`)).toBe(true);
      expect(DateTime.fromISO(res.body.data.expiresAt) > DateTime.now()).toBe(true);
      const betterAuthId = await betterAuthIdFor(legacy.id);
      expect(betterAuthId).not.toBe("");
      const context = await betterAuthApp.ensureAuth().$context;
      const betterAuthUser = await context.internalAdapter.findUserById(betterAuthId);
      expect(betterAuthUser?.email).toBe(legacy.email.toLowerCase());
      expect(betterAuthUser?.emailVerified).toBe(false);
      const events = await securityEventsFor(legacy.id);
      expect(events).toHaveLength(1);
      expect(JSON.stringify(events[0].after)).not.toContain(tokenFromUrl(url));
      expect(events[0].after).toEqual({
        betterAuthId,
        expiresAt: res.body.data.expiresAt,
        securityAction: "issue-sign-in-link",
      });

      expect((await resetPassword(app, tokenFromUrl(url))).status).toBe(200);
      const signIn = await signInWithNewPassword(app, legacy.email);
      expect(signIn.status).toBe(200);
      const me = await getMe(app, signIn.body.token);
      expect(me.status).toBe(200);
      expect(String(me.body.data._id ?? me.body.data.id)).toBe(legacy.id);
      expect(await SecurityUser.countDocuments({})).toBe(usersBefore);

      const reuse = await resetPassword(app, tokenFromUrl(url));
      expect(reuse.status).toBe(400);
      const linkedSummary = await getSummary(app, operator.token, legacy.id);
      expect(actionIdsOf(linkedSummary)).not.toContain("issue-sign-in-link");
      const second = await runAction(app, operator.token, legacy.id, "issue-sign-in-link");
      expect(second.status).toBe(409);
      expect(second.body.title).toBe("User already has a Better Auth account");
    });

    it("refuses a user who already has a Better Auth account", async () => {
      const {app} = buildApp({config: {publicAppUrl: PUBLIC_APP_URL}});
      const operator = await signUp(app, "superadmin-link-linked", ["superadmin"]);
      const target = await signUp(app, "link-linked");

      const res = await runAction(app, operator.token, target.id, "issue-sign-in-link");

      expect(res.status).toBe(409);
      expect(res.body.title).toBe("User already has a Better Auth account");
      expect(await securityEventsFor(target.id)).toHaveLength(0);
    });

    it("refuses a legacy user who has a password", async () => {
      const {app} = buildApp({config: {publicAppUrl: PUBLIC_APP_URL}});
      const operator = await signUp(app, "superadmin-link-password", ["superadmin"]);
      const id = await registerWithPassword(uniqueEmail("link-password"));
      const summary = await getSummary(app, operator.token, id);
      expect(summary.body.data.legacyPassword).toBe(true);
      expect(actionIdsOf(summary)).not.toContain("issue-sign-in-link");

      const res = await runAction(app, operator.token, id, "issue-sign-in-link");

      expect(res.status).toBe(409);
      expect(res.body.title).toBe("User already has a password");
      expect(await betterAuthIdFor(id)).toBe("");
    });

    it("refuses when another Better Auth user already has the email", async () => {
      const {app, betterAuthApp} = buildApp({config: {publicAppUrl: PUBLIC_APP_URL}});
      const operator = await signUp(app, "superadmin-link-taken", ["superadmin"]);
      const legacy = await createLegacyUser("link-taken");
      const context = await betterAuthApp.ensureAuth().$context;
      await context.adapter.create({
        data: {email: legacy.email.toLowerCase(), emailVerified: false, name: "Other"},
        model: "user",
      });

      const res = await runAction(app, operator.token, legacy.id, "issue-sign-in-link");

      expect(res.status).toBe(409);
      expect(res.body.title).toBe("Email already belongs to another sign-in account");
      expect(await betterAuthIdFor(legacy.id)).toBe("");
    });

    it("refuses a user with no email", async () => {
      const {app} = buildApp({config: {publicAppUrl: PUBLIC_APP_URL}});
      const operator = await signUp(app, "superadmin-link-no-email", ["superadmin"]);
      const legacy = await createLegacyUser("link-no-email");
      await SecurityUser.collection.updateOne(
        {_id: (await SecurityUser.findById(legacy.id))?._id},
        {$set: {email: ""}}
      );

      const res = await runAction(app, operator.token, legacy.id, "issue-sign-in-link");

      expect(res.status).toBe(409);
      expect(res.body.title).toBe("User has no email");
    });

    it("relinks a user whose Better Auth user is gone", async () => {
      const {app} = buildApp({config: {publicAppUrl: PUBLIC_APP_URL}});
      const operator = await signUp(app, "superadmin-link-dangling", ["superadmin"]);
      const legacy = await createLegacyUser("link-dangling");
      await SecurityUser.updateOne({_id: legacy.id}, {$set: {betterAuthId: "gone"}});

      const res = await runAction(app, operator.token, legacy.id, "issue-sign-in-link");

      expect(res.status).toBe(200);
      const betterAuthId = await betterAuthIdFor(legacy.id);
      expect(betterAuthId).not.toBe("gone");
      expect(betterAuthId).not.toBe("");
    });

    it("answers 501 when publicAppUrl is unset and creates nothing", async () => {
      const {app} = buildApp();
      const operator = await signUp(app, "superadmin-link-no-url", ["superadmin"]);
      const legacy = await createLegacyUser("link-no-url");

      const res = await runAction(app, operator.token, legacy.id, "issue-sign-in-link");

      expect(res.status).toBe(501);
      expect(res.body.title).toBe("Sign-in links are not configured");
      expect(await betterAuthCollection("user").countDocuments({email: legacy.email})).toBe(0);
    });

    it("uses AccountSecurityApp's own publicAppUrl over the Better Auth config", async () => {
      const {app} = buildApp({security: {publicAppUrl: "https://admin.example.com/"}});
      const operator = await signUp(app, "superadmin-link-own-url", ["superadmin"]);
      const legacy = await createLegacyUser("link-own-url");

      const res = await runAction(app, operator.token, legacy.id, "issue-sign-in-link");

      expect(res.status).toBe(200);
      expect(res.body.data.url.startsWith("https://admin.example.com/resetPassword?token=")).toBe(
        true
      );
    });

    it("needs user:issueSignInLink: an operator gets 403 and does not see it", async () => {
      const {app} = buildApp({config: {publicAppUrl: PUBLIC_APP_URL}});
      const operator = await signUp(app, "operator-link-denied", ["operator"]);
      const legacy = await createLegacyUser("link-denied");

      const summary = await getSummary(app, operator.token, legacy.id);
      expect(actionIdsOf(summary)).toEqual(["disable"]);
      const res = await runAction(app, operator.token, legacy.id, "issue-sign-in-link");

      expect(res.status).toBe(403);
      expect(res.body.title).toBe("Access denied");
      expect(await betterAuthIdFor(legacy.id)).toBe("");
      expect(await securityEventsFor(legacy.id)).toHaveLength(0);
    });

    it("without RBAC, an admin may issue a link", async () => {
      const {app} = buildApp({accessControl: false, config: {publicAppUrl: PUBLIC_APP_URL}});
      const admin = await signUp(app, "admin-link");
      await SecurityUser.updateOne({_id: admin.id}, {$set: {admin: true}});
      const legacy = await createLegacyUser("admin-link-target");

      const res = await runAction(app, admin.token, legacy.id, "issue-sign-in-link");

      expect(res.status).toBe(200);
      expect(await betterAuthIdFor(legacy.id)).not.toBe("");
    });

    it("reissues an expired link that was never used, for the same Better Auth user", async () => {
      const {app} = buildApp({config: {publicAppUrl: PUBLIC_APP_URL}});
      const superadmin = await signUp(app, "superadmin-reissue", ["superadmin"]);
      const legacy = await createLegacyUser("reissue-target");
      const first = await runAction(app, superadmin.token, legacy.id, "issue-sign-in-link");
      expect(first.status).toBe(200);
      const betterAuthId = await betterAuthIdFor(legacy.id);
      await betterAuthCollection("verification").updateMany(
        {value: betterAuthId},
        {$set: {expiresAt: DateTime.now().minus({minutes: 1}).toJSDate()}}
      );
      expect((await resetPassword(app, tokenFromUrl(first.body.data.url))).status).toBe(400);
      const summary = await getSummary(app, superadmin.token, legacy.id);
      expect(actionIdsOf(summary)).toContain("issue-sign-in-link");

      const second = await runAction(app, superadmin.token, legacy.id, "issue-sign-in-link");

      expect(second.status).toBe(200);
      expect(tokenFromUrl(second.body.data.url)).not.toBe(tokenFromUrl(first.body.data.url));
      expect(await betterAuthIdFor(legacy.id)).toBe(betterAuthId);
      expect(await betterAuthCollection("user").countDocuments({email: legacy.email})).toBe(1);
      expect(await betterAuthCollection("verification").countDocuments({value: betterAuthId})).toBe(
        1
      );
      expect((await resetPassword(app, tokenFromUrl(second.body.data.url))).status).toBe(200);
      const signIn = await signInWithNewPassword(app, legacy.email);
      expect(signIn.status).toBe(200);
      const me = await getMe(app, signIn.body.token);
      expect(String(me.body.data._id ?? me.body.data.id)).toBe(legacy.id);
      const events = await securityEventsFor(legacy.id);
      expect(events).toHaveLength(2);

      // Once the link is used the account is live: no further links.
      const third = await runAction(app, superadmin.token, legacy.id, "issue-sign-in-link");
      expect(third.status).toBe(409);
      expect(third.body.title).toBe("User already has a Better Auth account");
    });

    it("does not reissue for a linked user whose email is verified", async () => {
      const {app} = buildApp({config: {publicAppUrl: PUBLIC_APP_URL}});
      const superadmin = await signUp(app, "superadmin-reissue-verified", ["superadmin"]);
      const legacy = await createLegacyUser("reissue-verified");
      await runAction(app, superadmin.token, legacy.id, "issue-sign-in-link").expect(200);
      await betterAuthCollection("user").updateOne(
        {email: legacy.email},
        {$set: {emailVerified: true}}
      );

      const res = await runAction(app, superadmin.token, legacy.id, "issue-sign-in-link");

      expect(res.status).toBe(409);
      expect(res.body.title).toBe("User already has a Better Auth account");
    });

    it("rolls back the Better Auth user when the User was linked concurrently", async () => {
      const {betterAuthApp} = buildApp({config: {publicAppUrl: PUBLIC_APP_URL}});
      const legacy = await createLegacyUser("concurrent-link");
      const staleTarget = await SecurityUser.findById(legacy.id);
      // Another request links the User after this one loaded it.
      await SecurityUser.updateOne({_id: legacy.id}, {$set: {betterAuthId: "linked-elsewhere"}});
      const service = createAccountSecurityService({
        getAuth: () => betterAuthApp.ensureAuth(),
        getPublicAppUrl: () => PUBLIC_APP_URL,
        getUserModel: () => securityUserModel,
      });

      const result = await service.issueSignInLink(staleTarget as unknown as User);

      expect(result).toEqual({issued: false, reason: "linked"});
      expect(await betterAuthCollection("user").countDocuments({email: legacy.email})).toBe(0);
      expect(await betterAuthIdFor(legacy.id)).toBe("linked-elsewhere");
    });

    it("is left out of mounts that do not include platform-only actions", async () => {
      const {app, betterAuthApp} = buildApp({config: {publicAppUrl: PUBLIC_APP_URL}});
      const actor = await signUp(app, "custom-link-actor");
      const legacy = await createLegacyUser("custom-link-target");
      const security = new AccountSecurityApp({
        audit: false,
        getBetterAuth: () => betterAuthApp.ensureAuth(),
        publicAppUrl: PUBLIC_APP_URL,
        userModel: securityUserModel,
      });
      const router = express.Router();
      security.mountSecurityRoutes(router, async ({req}) => ({
        actor: req.user as never,
        org: {id: "org-1"},
      }));
      const host = express();
      host.use(express.json());
      host.use((req, _res, next) => {
        (req as {user?: unknown}).user = {_id: actor.id, id: actor.id};
        runWithRequestContext({credential: "jwt" as RequestCredential}, () => next());
      });
      host.use("/orgs/org-1/members", router);
      host.use(apiErrorMiddleware);

      const summary = await supertest(host).get(`/orgs/org-1/members/${legacy.id}/security`);
      expect(summary.status).toBe(200);
      expect(actionIdsOf(summary)).toEqual([]);
      for (const action of ["issue-sign-in-link", "disable", "enable"]) {
        const res = await supertest(host)
          .post(`/orgs/org-1/members/${legacy.id}/security/${action}`)
          .send({});
        expect([action, res.status]).toEqual([action, 404]);
      }
      expect(await betterAuthIdFor(legacy.id)).toBe("");
      expect((await SecurityUser.findById(legacy.id))?.disabled).toBe(false);
    });
  });

  describe("a User model without disabled or tokenEpoch", () => {
    beforeEach(async () => {
      await PlainUser.deleteMany({});
    });

    it("offers no disable/enable and revokes nothing for a user with no sessions", async () => {
      const {app} = buildApp({
        accessControl: false,
        userModel: PlainUser as unknown as UserModel,
      });
      const adminEmail = uniqueEmail("plain-admin");
      const signUpRes = await supertest(app)
        .post("/api/auth/sign-up/email")
        .set("content-type", "application/json")
        .send({email: adminEmail, name: "Plain Admin", password: PASSWORD});
      expect(signUpRes.status).toBe(200);
      await PlainUser.updateOne({email: adminEmail}, {$set: {admin: true}});
      const target = await PlainUser.create({email: uniqueEmail("plain-target"), name: "Plain"});
      const targetId = String(target._id);

      const summary = await getSummary(app, signUpRes.body.token, targetId);
      expect(summary.status).toBe(200);
      expect(actionIdsOf(summary)).toEqual(["issue-sign-in-link"]);
      for (const action of ["disable", "enable"]) {
        const res = await runAction(app, signUpRes.body.token, targetId, action);
        expect([action, res.status, res.body.title]).toEqual([
          action,
          404,
          "Security action not available",
        ]);
      }
      const revoke = await runAction(app, signUpRes.body.token, targetId, "revoke-sessions");
      expect(revoke.status).toBe(200);
      expect(revoke.body.data).toEqual({
        action: "revoke-sessions",
        changed: false,
        jwtRefreshRevoked: false,
        revokedCount: 0,
      });
    });
  });

  describe("authorization", () => {
    const ACTIONS = [
      "revoke-sessions",
      "send-password-reset",
      "disable",
      "enable",
      "issue-sign-in-link",
    ];

    it("refuses a member with 403 on every access action", async () => {
      const mail = captureMail();
      const {app} = buildApp({config: mail.config});
      const member = await signUp(app, "member-access");
      const target = await signUp(app, "member-access-target");

      for (const action of ACTIONS) {
        const res = await runAction(app, member.token, target.id, action);
        expect([action, res.status]).toEqual([action, 403]);
      }
      expect((await getMe(app, target.token)).status).toBe(200);
      expect((await SecurityUser.findById(target.id))?.disabled).toBe(false);
      expect(await securityEventsFor(target.id)).toHaveLength(0);
    });

    it("refuses an operator acting on a superadmin or on themselves", async () => {
      const mail = captureMail();
      const {app} = buildApp({config: mail.config});
      const operator = await signUp(app, "operator-access-reach", ["operator"]);
      const superadmin = await signUp(app, "superadmin-access", ["superadmin"]);

      for (const action of ACTIONS) {
        const onSuperadmin = await runAction(app, operator.token, superadmin.id, action);
        expect([action, onSuperadmin.status, onSuperadmin.body.title]).toEqual([
          action,
          403,
          "Target holds permissions you lack",
        ]);
        const onSelf = await runAction(app, operator.token, operator.id, action);
        expect([action, onSelf.status]).toEqual([action, 403]);
      }
      expect((await getMe(app, superadmin.token)).status).toBe(200);
      expect(await securityEventsFor(superadmin.id)).toHaveLength(0);
    });

    it("refuses an unauthenticated caller with 401", async () => {
      const {app} = buildApp();
      const target = await signUp(app, "anon-access-target");

      for (const action of ACTIONS) {
        const res = await supertest(app).post(`/users/${target.id}/security/${action}`).send({});
        expect([action, res.status]).toEqual([action, 401]);
      }
    });
  });
});
