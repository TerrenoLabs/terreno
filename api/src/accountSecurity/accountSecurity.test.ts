import {afterEach, beforeAll, beforeEach, describe, expect, it, spyOn} from "bun:test";
import express from "express";
import mongoose from "mongoose";
import supertest from "supertest";

import {AuditApp} from "../audit/auditApp";
import {resetAuditRecorderForTests} from "../audit/record";
import {apiErrorMiddleware, NotFoundError} from "../errors";
import {logger} from "../logger";
import {McpServiceToken} from "../models/mcpServiceToken";
import {type RequestCredential, runWithRequestContext} from "../requestContext";
import {
  AuditEvent,
  access,
  appUserId,
  betterAuthCollection,
  betterAuthIdFor,
  buildApp,
  getSummary,
  resetAccountSecurityState,
  resetTwoFactor,
  SecurityUser,
  securityEventsFor,
  securityUserModel,
  signInWithPassword,
  signUp,
} from "../tests/accountSecurityTestApp";
import {
  enrollTwoFactor,
  PASSWORD,
  setCookies,
  totpCode,
  uniqueEmail,
} from "../tests/betterAuthStubs";
import {AccountSecurityApp, resetTwoFactorAction} from "./accountSecurityApp";
import {
  type AccountSecuritySummary,
  storesTrustDeviceIdentifiersPlain,
} from "./accountSecurityService";
import {
  clearSecurityActionListenersForTests,
  onSecurityAction,
  recordSecurityAction,
  type SecurityActionEvent,
} from "./securityEvents";

/**
 * Signs in with the password and answers the 2FA challenge with "trust this device", returning
 * the signed trust cookie the browser would keep.
 */
const trustDevice = async (
  app: express.Application,
  email: string,
  secret: Buffer
): Promise<string> => {
  const signIn = await signInWithPassword(app, email);
  expect(signIn.body.twoFactorRedirect).toBe(true);
  const verify = await supertest(app)
    .post("/api/auth/two-factor/verify-totp")
    .set("content-type", "application/json")
    .set(
      "cookie",
      setCookies(signIn)
        .map((cookie) => cookie.split(";")[0])
        .join("; ")
    )
    .send({code: totpCode(secret), trustDevice: true});
  expect(verify.status).toBe(200);
  const trustCookie = setCookies(verify).find((cookie) => cookie.includes("trust_device="));
  expect(trustCookie).toBeTruthy();
  return (trustCookie ?? "").split(";")[0];
};

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

const base32Secret = (totpURI: string): Buffer => {
  let bits = "";
  const encoded = new URL(totpURI).searchParams.get("secret") ?? "";
  for (const char of encoded.replace(/=+$/, "").toUpperCase()) {
    bits += BASE32_ALPHABET.indexOf(char).toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
};

/** Turns 2FA on again for a user who already has an account, as their own security screen does. */
const reEnrollTwoFactor = async (app: express.Application, email: string): Promise<Buffer> => {
  const signIn = await signInWithPassword(app, email);
  expect(signIn.status).toBe(200);
  const bearer = `Bearer ${signIn.body.token}`;
  const enable = await supertest(app)
    .post("/api/auth/two-factor/enable")
    .set("authorization", bearer)
    .set("content-type", "application/json")
    .send({password: PASSWORD});
  expect(enable.status).toBe(200);
  const secret = base32Secret(enable.body.totpURI as string);
  const confirm = await supertest(app)
    .post("/api/auth/two-factor/verify-totp")
    .set("authorization", bearer)
    .set("content-type", "application/json")
    .send({code: totpCode(secret)});
  expect(confirm.status).toBe(200);
  return secret;
};

interface CustomHostOptions {
  actorId: string;
  authorizeTargetId: string;
  credential?: RequestCredential | "service-account";
  security: AccountSecurityApp;
}

/** Mounts the security routes under /custom on a bare host with an org authorizer. */
const buildCustomHost = ({
  actorId,
  authorizeTargetId,
  credential = "jwt",
  security,
}: CustomHostOptions): express.Application => {
  const router = express.Router();
  security.mountSecurityRoutes(router, async ({req, targetUserId}) => {
    if (targetUserId !== authorizeTargetId) {
      throw new NotFoundError("Member not found");
    }
    return {actor: req.user as never, org: {id: "org-1", name: "Org One"}};
  });
  const host = express();
  host.use(express.json());
  host.use((req, _res, next) => {
    (req as {user?: unknown}).user = {_id: actorId, id: actorId};
    runWithRequestContext({credential: credential as RequestCredential}, () => next());
  });
  host.use("/custom", router);
  host.use(apiErrorMiddleware);
  return host;
};

describe("AccountSecurityApp", () => {
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

  describe("platform routes", () => {
    it("an operator reads the summary and resets 2FA, and the user then signs in without a challenge", async () => {
      const {app} = buildApp();
      const operator = await signUp(app, "operator", ["operator"]);
      const targetEmail = uniqueEmail("target");
      const {enrollment, token: targetToken} = await enrollTwoFactor(app, targetEmail);
      const targetId = await appUserId(targetEmail);

      const before = await getSummary(app, operator.token, targetId);
      expect(before.status).toBe(200);
      const summary = before.body.data as AccountSecuritySummary;
      expect(summary.userId).toBe(targetId);
      expect(summary.betterAuthLinked).toBe(true);
      expect(summary.password).toBe(true);
      expect(summary.providers).toEqual([]);
      expect(summary.twoFactor).toEqual({backupCodesRemaining: 10, enabled: true});
      expect(summary.sessions.active).toBeGreaterThanOrEqual(1);
      expect(summary.lastSignIn.at).toBeTruthy();
      expect(summary.disabled).toBe(false);
      expect(summary.actions).toEqual([
        {destructive: true, id: "reset-two-factor", label: "Reset two-factor"},
        {destructive: true, id: "revoke-sessions", label: "Sign out everywhere"},
        {destructive: false, id: "send-password-reset", label: "Send password reset"},
        {destructive: true, id: "disable", label: "Disable account"},
      ]);

      // The summary never carries the TOTP secret, backup codes, or session tokens.
      const body = JSON.stringify(before.body);
      const totpSecret = new URL(enrollment.totpURI).searchParams.get("secret") ?? "";
      expect(body).not.toContain(totpSecret);
      for (const code of enrollment.backupCodes) {
        expect(body).not.toContain(code);
      }
      expect(body).not.toContain(targetToken);
      expect(body).not.toContain(operator.token);

      const challenged = await signInWithPassword(app, targetEmail);
      expect(challenged.body.twoFactorRedirect).toBe(true);

      const reset = await resetTwoFactor(app, operator.token, targetId);
      expect(reset.status).toBe(200);
      expect(reset.body.data).toEqual({action: "reset-two-factor", changed: true});

      const signIn = await signInWithPassword(app, targetEmail);
      expect(signIn.status).toBe(200);
      expect(signIn.body.twoFactorRedirect).toBeUndefined();
      expect(signIn.body.token).toBeTruthy();

      const after = await getSummary(app, operator.token, targetId);
      expect(after.body.data.twoFactor).toEqual({backupCodesRemaining: null, enabled: false});
      expect(after.body.data.actions.map((action: {id: string}) => action.id)).toEqual([
        "revoke-sessions",
        "send-password-reset",
        "disable",
      ]);
      const twoFactorRows = await mongoose.connection.db
        ?.collection("twoFactor")
        .countDocuments({});
      expect(twoFactorRows).toBe(0);
    });

    it("each reset writes one security AuditEvent naming the actor and target", async () => {
      const {app} = buildApp();
      const operator = await signUp(app, "operator-audit", ["operator"]);
      const targetEmail = uniqueEmail("audit-target");
      await enrollTwoFactor(app, targetEmail);
      const targetId = await appUserId(targetEmail);

      const reset = await resetTwoFactor(app, operator.token, targetId);
      expect(reset.status).toBe(200);

      const securityEvents = await securityEventsFor(targetId);
      expect(securityEvents).toHaveLength(1);
      expect(securityEvents[0]).toMatchObject({
        after: {securityAction: "reset-two-factor"},
        modelName: "User",
        operation: "update",
        recordId: targetId,
        source: "security",
        verb: "updated",
      });
      expect(String(securityEvents[0].actorId)).toBe(operator.id);
    });

    it("resetting when 2FA is already off is a 200 no-op that is not audited", async () => {
      const {app} = buildApp();
      const operator = await signUp(app, "operator-noop", ["operator"]);
      const target = await signUp(app, "no-two-factor");
      const events: SecurityActionEvent[] = [];
      onSecurityAction((event) => {
        events.push(event);
      });

      const reset = await resetTwoFactor(app, operator.token, target.id);

      expect(reset.status).toBe(200);
      expect(reset.body.data).toEqual({action: "reset-two-factor", changed: false});
      expect(await securityEventsFor(target.id)).toHaveLength(0);
      expect(events).toHaveLength(0);
    });

    it("tells listeners about each recorded action", async () => {
      const {app} = buildApp();
      const operator = await signUp(app, "operator-listen", ["operator"]);
      const targetEmail = uniqueEmail("listen-target");
      await enrollTwoFactor(app, targetEmail);
      const targetId = await appUserId(targetEmail);
      const events: SecurityActionEvent[] = [];
      onSecurityAction((event) => {
        events.push(event);
      });

      await resetTwoFactor(app, operator.token, targetId).expect(200);

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        action: "reset-two-factor",
        actor: {id: operator.id},
        origin: "admin",
        target: {id: targetId},
      });
      expect(events[0].occurredAt).toBeTruthy();
    });

    it("lists passkey names and linked providers without their credentials", async () => {
      const {app, betterAuthApp} = buildApp();
      const operator = await signUp(app, "operator-passkeys", ["operator"]);
      const target = await signUp(app, "passkey-owner");
      const user = await SecurityUser.findById(target.id);
      const context = await betterAuthApp.ensureAuth().$context;
      await context.adapter.create({
        data: {
          backedUp: false,
          counter: 0,
          createdAt: new Date("2026-01-02T03:04:05.000Z"),
          credentialID: "credential-id-secret",
          deviceType: "singleDevice",
          name: "Work laptop",
          publicKey: "public-key-material",
          userId: user?.betterAuthId ?? "",
        },
        model: "passkey",
      });
      await context.adapter.create({
        data: {
          backedUp: true,
          counter: 0,
          credentialID: "second-credential-id",
          deviceType: "multiDevice",
          publicKey: "second-public-key",
          userId: user?.betterAuthId ?? "",
        },
        model: "passkey",
      });
      // A user whose sessions have all been removed has no last sign-in time.
      await context.internalAdapter.deleteUserSessions(user?.betterAuthId ?? "");
      await context.internalAdapter.createAccount({
        accessToken: "github-access-token",
        accountId: "github-account-1",
        providerId: "github",
        refreshToken: "github-refresh-token",
        userId: user?.betterAuthId ?? "",
      });

      const res = await getSummary(app, operator.token, target.id);

      expect(res.status).toBe(200);
      expect(res.body.data.passkeys.count).toBe(2);
      const items = res.body.data.passkeys.items as {
        createdAt: string | null;
        id: string;
        name: string | null;
      }[];
      const laptop = items.find((item) => item.name === "Work laptop");
      expect(laptop?.createdAt).toBe("2026-01-02T03:04:05.000Z");
      expect(laptop?.id).toBeTruthy();
      const unnamed = items.find((item) => item.name === null);
      expect(unnamed?.createdAt).toBeNull();
      expect(res.body.data.sessions).toEqual({active: 0});
      expect(res.body.data.lastSignIn.at).toBeNull();
      expect(res.body.data.providers).toHaveLength(1);
      expect(res.body.data.providers[0].providerId).toBe("github");
      const body = JSON.stringify(res.body);
      for (const secret of [
        "credential-id-secret",
        "public-key-material",
        "second-credential-id",
        "second-public-key",
        "github-access-token",
        "github-refresh-token",
        "github-account-1",
      ]) {
        expect(body).not.toContain(secret);
      }
    });

    it("reports empty values for a legacy user with no Better Auth link", async () => {
      const {app} = buildApp();
      const operator = await signUp(app, "operator-legacy", ["operator"]);
      const legacy = await SecurityUser.create({
        disabled: true,
        email: uniqueEmail("legacy"),
        name: "Legacy",
      });

      const res = await getSummary(app, operator.token, String(legacy._id));

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        // issue-sign-in-link also applies, but an operator lacks user:issueSignInLink.
        actions: [{destructive: false, id: "enable", label: "Enable account"}],
        betterAuthLinked: false,
        disabled: true,
        emailVerified: false,
        lastSignIn: {at: null, method: null},
        legacyPassword: false,
        passkeys: {count: 0, items: []},
        password: false,
        providers: [],
        sessions: {active: 0},
        twoFactor: {backupCodesRemaining: null, enabled: false},
        userId: String(legacy._id),
      });

      const reset = await resetTwoFactor(app, operator.token, String(legacy._id));
      expect(reset.status).toBe(200);
      expect(reset.body.data.changed).toBe(false);
    });

    it("treats a betterAuthId whose Better Auth user is gone like a legacy user", async () => {
      const {app} = buildApp();
      const operator = await signUp(app, "operator-dangling", ["operator"]);
      const dangling = await SecurityUser.create({
        betterAuthId: "missing-better-auth-user",
        email: uniqueEmail("dangling"),
      });
      const id = String(dangling._id);

      const summary = await getSummary(app, operator.token, id);
      expect(summary.status).toBe(200);
      expect(summary.body.data.betterAuthLinked).toBe(false);

      const reset = await resetTwoFactor(app, operator.token, id);
      expect(reset.status).toBe(200);
      expect(reset.body.data.changed).toBe(false);
    });

    it("reports backup codes as unknown when Better Auth cannot read them", async () => {
      const {app} = buildApp();
      const operator = await signUp(app, "operator-codes", ["operator"]);
      const targetEmail = uniqueEmail("codes-target");
      await enrollTwoFactor(app, targetEmail);
      const targetId = await appUserId(targetEmail);
      await mongoose.connection.db
        ?.collection("twoFactor")
        .updateMany({}, {$set: {backupCodes: "not-encrypted-codes"}});

      const res = await getSummary(app, operator.token, targetId);

      expect(res.status).toBe(200);
      expect(res.body.data.twoFactor).toEqual({backupCodesRemaining: null, enabled: true});
    });

    it("forgets trusted devices, so a trusted browser is challenged after the user re-enrolls", async () => {
      const {app} = buildApp();
      const operator = await signUp(app, "operator-trust", ["operator"]);
      const targetEmail = uniqueEmail("trusted-target");
      const {secret} = await enrollTwoFactor(app, targetEmail);
      const targetId = await appUserId(targetEmail);
      const betterAuthId = await betterAuthIdFor(targetId);
      const trustCookie = await trustDevice(app, targetEmail, secret);
      // The trusted browser skips the challenge before the reset.
      const trusted = await signInWithPassword(app, targetEmail).set("cookie", trustCookie);
      expect(trusted.body.twoFactorRedirect).toBeUndefined();
      const trustRows = (): Promise<number> =>
        betterAuthCollection("verification").countDocuments({
          identifier: {$regex: "^trust-device-"},
          value: betterAuthId,
        });
      expect(await trustRows()).toBe(1);

      const reset = await resetTwoFactor(app, operator.token, targetId);
      expect(reset.status).toBe(200);
      expect(reset.body.data.changed).toBe(true);
      expect(await trustRows()).toBe(0);

      await reEnrollTwoFactor(app, targetEmail);
      const challenged = await signInWithPassword(app, targetEmail).set("cookie", trustCookie);
      expect(challenged.status).toBe(200);
      expect(challenged.body.twoFactorRedirect).toBe(true);
    });

    it("forgets trusted devices when Better Auth hashes verification identifiers", async () => {
      const {app} = buildApp({config: {options: {verification: {storeIdentifier: "hashed"}}}});
      const operator = await signUp(app, "operator-hashed", ["operator"]);
      const targetEmail = uniqueEmail("hashed-target");
      const {secret} = await enrollTwoFactor(app, targetEmail);
      const targetId = await appUserId(targetEmail);
      const betterAuthId = await betterAuthIdFor(targetId);
      await trustDevice(app, targetEmail, secret);
      const rowsFor = (): Promise<number> =>
        betterAuthCollection("verification").countDocuments({value: betterAuthId});
      expect(await rowsFor()).toBeGreaterThan(0);

      const reset = await resetTwoFactor(app, operator.token, targetId);

      expect(reset.status).toBe(200);
      expect(await rowsFor()).toBe(0);
    });

    it("leaves another enrolled user's 2FA alone", async () => {
      const {app} = buildApp();
      const operator = await signUp(app, "operator-other", ["operator"]);
      const targetEmail = uniqueEmail("reset-target");
      const bystanderEmail = uniqueEmail("bystander");
      await enrollTwoFactor(app, targetEmail);
      await enrollTwoFactor(app, bystanderEmail);
      const targetId = await appUserId(targetEmail);
      const bystanderBetterAuthId = await betterAuthIdFor(await appUserId(bystanderEmail));

      const reset = await resetTwoFactor(app, operator.token, targetId);
      expect(reset.status).toBe(200);

      const twoFactorRows = betterAuthCollection("twoFactor");
      expect(await twoFactorRows.countDocuments({})).toBe(1);
      const remaining = await twoFactorRows.findOne({});
      expect(String(remaining?.userId)).toBe(bystanderBetterAuthId);
      const bystanderSignIn = await signInWithPassword(app, bystanderEmail);
      expect(bystanderSignIn.body.twoFactorRedirect).toBe(true);
    });

    it("clears a half-finished enrollment (secret stored, 2FA not yet on)", async () => {
      const {app} = buildApp();
      const operator = await signUp(app, "operator-half", ["operator"]);
      const target = await signUp(app, "half-enrolled");
      const enable = await supertest(app)
        .post("/api/auth/two-factor/enable")
        .set("authorization", `Bearer ${target.token}`)
        .set("content-type", "application/json")
        .send({password: PASSWORD});
      expect(enable.status).toBe(200);
      const twoFactorRows = betterAuthCollection("twoFactor");
      expect(await twoFactorRows.countDocuments({})).toBe(1);
      const betterAuthUser = await betterAuthCollection("user").findOne({email: target.email});
      expect(betterAuthUser?.twoFactorEnabled).toBe(false);

      const reset = await resetTwoFactor(app, operator.token, target.id);

      expect(reset.status).toBe(200);
      expect(reset.body.data.changed).toBe(true);
      expect(await securityEventsFor(target.id)).toHaveLength(1);
      expect(await twoFactorRows.countDocuments({})).toBe(0);
    });

    it("reports the stored last sign-in method", async () => {
      const {app} = buildApp({config: {lastLoginMethod: true}});
      const operator = await signUp(app, "operator-method", ["operator"]);
      const target = await signUp(app, "method-target");

      const res = await getSummary(app, operator.token, target.id);

      expect(res.body.data.lastSignIn.method).toBe("email");
    });

    it("answers 404 for an unknown user and for an id that is not an ObjectId", async () => {
      const {app} = buildApp();
      const operator = await signUp(app, "operator-404", ["operator"]);

      const unknown = await getSummary(
        app,
        operator.token,
        new mongoose.Types.ObjectId().toString()
      );
      expect(unknown.status).toBe(404);
      expect(unknown.body.title).toBe("User not found");

      const malformed = await resetTwoFactor(app, operator.token, "not-an-id");
      expect(malformed.status).toBe(404);
    });

    it("answers 404 for reset when two-factor is not enabled on the server", async () => {
      const {app} = buildApp({config: {passkey: undefined, twoFactor: undefined}});
      const operator = await signUp(app, "operator-no-2fa", ["operator"]);
      const target = await signUp(app, "target-no-2fa");

      const summary = await getSummary(app, operator.token, target.id);
      expect(summary.status).toBe(200);
      expect(summary.body.data.actions.map((action: {id: string}) => action.id)).toEqual([
        "revoke-sessions",
        "send-password-reset",
        "disable",
      ]);
      expect(summary.body.data.passkeys).toEqual({count: 0, items: []});

      const reset = await resetTwoFactor(app, operator.token, target.id);
      expect(reset.status).toBe(404);
      expect(reset.body.title).toBe("Security action not available");
    });
  });

  describe("authorization", () => {
    it("refuses a member with 403", async () => {
      const {app} = buildApp();
      const member = await signUp(app, "member");
      const target = await signUp(app, "member-target");

      const summary = await getSummary(app, member.token, target.id);
      expect(summary.status).toBe(403);
      const reset = await resetTwoFactor(app, member.token, target.id);
      expect(reset.status).toBe(403);
      expect(await securityEventsFor(target.id)).toHaveLength(0);
    });

    it("refuses a member before revealing whether the target exists", async () => {
      const {app} = buildApp();
      const member = await signUp(app, "member-probe");

      const res = await getSummary(app, member.token, new mongoose.Types.ObjectId().toString());

      expect(res.status).toBe(403);
    });

    it("refuses an unauthenticated request with 401", async () => {
      const {app} = buildApp();
      const target = await signUp(app, "anon-target");

      const res = await supertest(app).get(`/users/${target.id}/security`);

      expect(res.status).toBe(401);
    });

    it("refuses an operator's MCP service token with 403", async () => {
      const {app} = buildApp();
      const operator = await signUp(app, "operator-mcp", ["operator"]);
      const target = await signUp(app, "mcp-target");
      const issued = await McpServiceToken.issueFor(
        {_id: new mongoose.Types.ObjectId(operator.id)},
        {name: "Agent"}
      );

      const summary = await getSummary(app, issued.token, target.id);
      expect(summary.status).toBe(403);
      expect(summary.body.title).toBe("Account security requires your own session");
      const reset = await resetTwoFactor(app, issued.token, target.id);
      expect(reset.status).toBe(403);
    });

    it("refuses an MCP OAuth access token with 403", async () => {
      const {app} = buildApp();
      const target = await signUp(app, "oauth-target");

      const res = await getSummary(app, "mcpat_not-a-real-token", target.id);

      expect(res.status).toBe(403);
    });

    it("refuses an actor acting on themselves", async () => {
      const {app} = buildApp();
      const operator = await signUp(app, "operator-self", ["operator"]);

      const summary = await getSummary(app, operator.token, operator.id);
      expect(summary.status).toBe(403);
      expect(summary.body.title).toBe("Use your own security settings to change your account");
      const reset = await resetTwoFactor(app, operator.token, operator.id);
      expect(reset.status).toBe(403);
    });

    it("refuses an operator acting on a superadmin, and allows a superadmin", async () => {
      const {app} = buildApp();
      const operator = await signUp(app, "operator-up", ["operator"]);
      const superadmin = await signUp(app, "superadmin-target", ["superadmin"]);
      const otherSuperadmin = await signUp(app, "superadmin-actor", ["superadmin"]);

      const refused = await resetTwoFactor(app, operator.token, superadmin.id);
      expect(refused.status).toBe(403);
      expect(refused.body.title).toBe("Target holds permissions you lack");
      expect((await getSummary(app, operator.token, superadmin.id)).status).toBe(403);
      expect((await getSummary(app, otherSuperadmin.token, superadmin.id)).status).toBe(200);
      expect((await getSummary(app, superadmin.token, operator.id)).status).toBe(200);
    });

    it("refuses a target holding any permission the actor lacks", async () => {
      const {app} = buildApp();
      const operator = await signUp(app, "operator-reach", ["operator"]);
      const peer = await signUp(app, "operator-peer", ["operator"]);
      const roleAdmin = await signUp(app, "rbac-admin", ["admin"]);

      const res = await getSummary(app, operator.token, roleAdmin.id);
      expect(res.status).toBe(403);
      expect(res.body.title).toBe("Target holds permissions you lack");
      expect(res.body.detail).toContain("adminAnnouncement:read");
      expect((await getSummary(app, operator.token, peer.id)).status).toBe(200);
    });

    it("refuses a non-admin acting on an admin: true user", async () => {
      const {app} = buildApp();
      const operator = await signUp(app, "operator-legacy-admin", ["operator"]);
      const legacyAdmin = await signUp(app, "legacy-admin");
      await SecurityUser.updateOne({_id: legacyAdmin.id}, {$set: {admin: true}});

      const res = await getSummary(app, operator.token, legacyAdmin.id);

      expect(res.status).toBe(403);
      expect(res.body.title).toBe("Target holds permissions you lack");
    });

    it("refuses a request whose credential is not the user's own session", async () => {
      const {app} = buildApp();
      const target = await signUp(app, "credential-target");
      const actor = await signUp(app, "credential-actor");
      for (const credential of ["service-account", "mcp-service-token", "oauth"] as const) {
        const host = buildCustomHost({
          actorId: actor.id,
          authorizeTargetId: target.id,
          credential,
          security: new AccountSecurityApp({audit: false, userModel: securityUserModel}),
        });
        const res = await supertest(host).get(`/custom/${target.id}/security`);
        expect(res.status).toBe(403);
        expect(res.body.title).toBe("Account security requires your own session");
      }
    });

    it("grants superadmin through the wildcard role", async () => {
      const {app} = buildApp();
      const superadmin = await signUp(app, "superadmin", ["superadmin"]);
      const target = await signUp(app, "superadmin-target");

      const res = await getSummary(app, superadmin.token, target.id);

      expect(res.status).toBe(200);
    });

    it("without RBAC, requires admin: true", async () => {
      const {app} = buildApp({accessControl: false});
      const member = await signUp(app, "plain-member");
      const admin = await signUp(app, "plain-admin");
      await SecurityUser.updateOne({_id: admin.id}, {$set: {admin: true}});

      expect((await getSummary(app, member.token, admin.id)).status).toBe(403);
      expect((await getSummary(app, admin.token, member.id)).status).toBe(200);
    });

    it("mounts the same handlers under another prefix with a custom authorizer", async () => {
      const {app} = buildApp();
      const target = await signUp(app, "custom-target");
      const actor = await signUp(app, "custom-actor");
      const warn = spyOn(logger, "warn");
      const security = new AccountSecurityApp({audit: false, userModel: securityUserModel});
      const host = buildCustomHost({
        actorId: actor.id,
        authorizeTargetId: target.id,
        security,
      });

      const allowed = await supertest(host).get(`/custom/${target.id}/security`);
      expect(allowed.status).toBe(200);
      expect(allowed.body.data.betterAuthLinked).toBe(false);
      expect(security.getActions().map((action) => action.id)).toEqual([
        "reset-two-factor",
        "remove-passkey",
        "unlink-provider",
        "revoke-sessions",
        "send-password-reset",
        "disable",
        "enable",
        "suspend-membership",
        "issue-sign-in-link",
      ]);
      await supertest(host).get(`/custom/${target.id}/security`).expect(200);
      const noBetterAuthWarnings = warn.mock.calls.filter((call) =>
        String(call[0]).includes("AccountSecurityApp found no Better Auth instance")
      );
      warn.mockRestore();
      expect(noBetterAuthWarnings).toHaveLength(1);

      const refused = await supertest(host).get(`/custom/${actor.id}/security`);
      expect(refused.status).toBe(404);
      expect(refused.body.title).toBe("Member not found");
    });

    it("records the authorizer's org on a reset under another prefix", async () => {
      const {app, betterAuthApp} = buildApp();
      const actor = await signUp(app, "org-admin");
      const targetEmail = uniqueEmail("org-member");
      await enrollTwoFactor(app, targetEmail);
      const targetId = await appUserId(targetEmail);
      const security = new AccountSecurityApp({
        getBetterAuth: () => betterAuthApp.ensureAuth(),
        userModel: securityUserModel,
      });
      const host = buildCustomHost({actorId: actor.id, authorizeTargetId: targetId, security});

      const reset = await supertest(host)
        .post(`/custom/${targetId}/security/reset-two-factor`)
        .send({});

      expect(reset.status).toBe(200);
      expect(reset.body.data.changed).toBe(true);
      const events = await securityEventsFor(targetId);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        after: {organizationId: "org-1", securityAction: "reset-two-factor"},
        organizationId: "org-1",
      });
    });

    it("merges an action's audit fields into the AuditEvent", async () => {
      const {app} = buildApp({
        security: {
          actions: [
            {
              id: "password-changed",
              isApplicable: () => true,
              isSupported: () => true,
              method: "delete",
              path: "/audit-details/:itemId",
              run: async ({req}) => ({
                audit: {itemId: req.params.itemId, securityAction: "spoofed"},
                changed: true,
                data: {itemId: req.params.itemId},
              }),
            },
          ],
        },
      });
      const operator = await signUp(app, "operator-details", ["operator"]);
      const target = await signUp(app, "details-target");

      const summary = await getSummary(app, operator.token, target.id);
      expect(summary.status).toBe(200);
      expect(summary.body.data.actions.map((action: {id: string}) => action.id)).toContain(
        "password-changed"
      );
      const res = await supertest(app)
        .delete(`/users/${target.id}/security/audit-details/pk-123`)
        .set("authorization", `Bearer ${operator.token}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({
        action: "password-changed",
        changed: true,
        itemId: "pk-123",
      });
      const events = await securityEventsFor(target.id);
      expect(events).toHaveLength(1);
      expect(events[0].after).toEqual({itemId: "pk-123", securityAction: "password-changed"});
    });
  });

  describe("startup", () => {
    it("throws when AuditApp is not registered", () => {
      expect(() => buildApp({auditApp: false})).toThrow("AccountSecurityApp requires AuditApp");
    });

    it("boots without AuditApp when audit: false is passed, and records nothing", async () => {
      const {app} = buildApp({auditApp: false, security: {audit: false}});
      const operator = await signUp(app, "operator-unaudited", ["operator"]);
      const targetEmail = uniqueEmail("unaudited-target");
      await enrollTwoFactor(app, targetEmail);
      const targetId = await appUserId(targetEmail);

      const reset = await resetTwoFactor(app, operator.token, targetId);

      expect(reset.status).toBe(200);
      expect(reset.body.data.changed).toBe(true);
      expect(await securityEventsFor(targetId)).toHaveLength(0);
    });

    it("throws when a custom action reuses an action id", () => {
      expect(
        () =>
          new AccountSecurityApp({
            actions: [{...resetTwoFactorAction, path: "/another-reset"}],
            audit: false,
          })
      ).toThrow("Duplicate security action id");
    });

    it("throws without a user model", () => {
      const security = new AccountSecurityApp({audit: false});
      expect(() => security.register(express())).toThrow("AccountSecurityApp requires a userModel");
    });
  });
});

describe("storesTrustDeviceIdentifiersPlain", () => {
  it("matches Better Auth's verification identifier storage rules", () => {
    expect(storesTrustDeviceIdentifiersPlain(undefined)).toBe(true);
    expect(storesTrustDeviceIdentifiersPlain("plain")).toBe(true);
    expect(storesTrustDeviceIdentifiersPlain("hashed")).toBe(false);
    expect(storesTrustDeviceIdentifiersPlain({default: "hashed"})).toBe(false);
    expect(storesTrustDeviceIdentifiersPlain({default: "plain"})).toBe(true);
    expect(
      storesTrustDeviceIdentifiersPlain({default: "hashed", overrides: {"trust-device-": "plain"}})
    ).toBe(true);
    expect(
      storesTrustDeviceIdentifiersPlain({default: "plain", overrides: {trust: "hashed"}})
    ).toBe(false);
    expect(
      storesTrustDeviceIdentifiersPlain({default: "plain", overrides: {"reset-password": "hashed"}})
    ).toBe(true);
  });
});

describe("recordSecurityAction", () => {
  beforeEach(async () => {
    clearSecurityActionListenersForTests();
    resetAuditRecorderForTests();
    await AuditEvent.deleteMany({});
  });

  afterEach(() => {
    resetAuditRecorderForTests();
    clearSecurityActionListenersForTests();
  });

  it("records the org on the event and keeps going when a listener fails", async () => {
    new AuditApp().register(express());
    const received: SecurityActionEvent[] = [];
    onSecurityAction(() => {
      throw new Error("listener exploded");
    });
    onSecurityAction(async () => {
      throw new Error("async listener exploded");
    });
    const unsubscribe = onSecurityAction((event) => {
      received.push(event);
    });
    const actorId = new mongoose.Types.ObjectId().toString();
    const targetId = new mongoose.Types.ObjectId().toString();

    await recordSecurityAction({
      action: "two-factor-enabled",
      actor: {id: actorId},
      org: {id: "org-7", name: "Org Seven"},
      target: {id: targetId},
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({org: {id: "org-7"}, origin: "self"});
    const event = await AuditEvent.findOne({recordId: targetId}).lean();
    expect(event).toMatchObject({
      after: {organizationId: "org-7", securityAction: "two-factor-enabled"},
      organizationId: "org-7",
      source: "security",
    });

    unsubscribe();
    await recordSecurityAction({action: "password-changed", target: {id: targetId}});
    expect(received).toHaveLength(1);
  });
});
