/**
 * Shared setup for the AccountSecurityApp suites: a passport-backed test User model, RBAC
 * access, a TerrenoApp with BetterAuthApp + AuditApp + AccountSecurityApp, and request helpers.
 */

import {expect} from "bun:test";
import type express from "express";
import mongoose, {Schema} from "mongoose";
import passportLocalMongoose from "passport-local-mongoose";
import supertest from "supertest";

import {
  AccountSecurityApp,
  type AccountSecurityAppOptions,
} from "../accountSecurity/accountSecurityApp";
import {
  clearSecurityActionListenersForTests,
  SECURITY_ACTIONS,
} from "../accountSecurity/securityEvents";
import {AuditApp} from "../audit/auditApp";
import {createAuditEventModel} from "../audit/auditEventModel";
import {flushAuditRecorderForTests, resetAuditRecorderForTests} from "../audit/record";
import type {UserModel} from "../auth";
import type {BetterAuthConfig} from "../betterAuth";
import {BetterAuthApp} from "../betterAuthApp";
import type {AuthOptions} from "../expressServer";
import {clearMCPRegistry} from "../mcp/registry";
import {McpServiceToken} from "../models/mcpServiceToken";
import {createAccess} from "../rbac/access";
import {terrenoStatements} from "../rbac/statements";
import type {AnyTerrenoAccess} from "../rbac/types";
import {TerrenoApp, type TerrenoAppOptions} from "../terrenoApp";
import {API_ORIGIN, PASSWORD, SECRET, uniqueEmail} from "./betterAuthStubs";

interface SecurityUserFields {
  admin?: boolean;
  betterAuthId?: string;
  disabled?: boolean;
  email: string;
  name?: string;
  roles?: string[];
  tokenEpoch?: number;
}

// TerrenoApp's JWT setup needs passport-local-mongoose's createStrategy on the user model.
const getSecurityUserModel = (): mongoose.Model<SecurityUserFields> => {
  if (mongoose.models.AccountSecurityTestUser) {
    return mongoose.models.AccountSecurityTestUser as mongoose.Model<SecurityUserFields>;
  }
  const schema = new Schema<SecurityUserFields>({
    admin: {default: false, description: "Whether the user is an admin", type: Boolean},
    betterAuthId: {description: "Linked Better Auth user id", index: true, type: String},
    disabled: {default: false, description: "Whether the account is disabled", type: Boolean},
    email: {description: "Email address", required: true, type: String},
    name: {description: "Display name", type: String},
    roles: {default: [], description: "RBAC role names", type: [String]},
    tokenEpoch: {default: 0, description: "Bumped to invalidate JWT refresh tokens", type: Number},
  });
  schema.plugin(
    passportLocalMongoose as unknown as (target: Schema, options?: Record<string, unknown>) => void,
    {usernameField: "email"}
  );
  return mongoose.model<SecurityUserFields>("AccountSecurityTestUser", schema);
};

export const SecurityUser = getSecurityUserModel();
export const securityUserModel = SecurityUser as unknown as UserModel;
export const AuditEvent = createAuditEventModel(mongoose.connection);

export const access = createAccess({
  connection: mongoose.connection,
  organizations: true,
  statements: terrenoStatements,
  userModel: securityUserModel,
});

const baseConfig: BetterAuthConfig = {
  baseURL: API_ORIGIN,
  enabled: true,
  passkey: {origin: [API_ORIGIN], rpID: "localhost", rpName: "Terreno"},
  secret: SECRET,
  twoFactor: {issuer: "Terreno"},
};

/** The Better Auth config every security test app uses, plus `overrides`. */
export const testBetterAuthConfig = (
  overrides: Partial<BetterAuthConfig> = {}
): BetterAuthConfig => ({
  ...baseConfig,
  ...overrides,
});

interface BuildOptions {
  /** `false` builds without RBAC; an access instance replaces the shared {@link access}. */
  accessControl?: boolean | AnyTerrenoAccess;
  /** Pass `false` to build without AccountSecurityApp. */
  accountSecurity?: boolean;
  auditApp?: boolean;
  /** TerrenoApp `authOptions` for the legacy JWT routes (for example recovery mail). */
  authOptions?: AuthOptions;
  config?: Partial<BetterAuthConfig>;
  /** TerrenoApp `organizations`; set, the app is started (skipListen) so OrgsApp registers. */
  organizations?: TerrenoAppOptions["organizations"];
  security?: AccountSecurityAppOptions;
  /** Another app User model (needs passport-local-mongoose). Defaults to `SecurityUser`. */
  userModel?: UserModel;
}

interface SecurityTestApp {
  /** The registered AccountSecurityApp, unless built with `accountSecurity: false`. */
  accountSecurityApp?: AccountSecurityApp;
  app: express.Application;
  betterAuthApp: BetterAuthApp;
}

export const buildApp = ({
  accessControl = true,
  accountSecurity = true,
  auditApp = true,
  authOptions,
  config = {},
  organizations,
  security = {},
  userModel = securityUserModel,
}: BuildOptions = {}): SecurityTestApp => {
  const betterAuthApp = new BetterAuthApp({
    config: {...baseConfig, ...config},
    userModel,
  });
  const terrenoApp = new TerrenoApp({
    ...(accessControl ? {accessControl: accessControl === true ? access : accessControl} : {}),
    ...(authOptions ? {authOptions} : {}),
    mcpServiceTokens: true,
    ...(organizations ? {organizations} : {}),
    skipListen: true,
    userModel,
  }).register(betterAuthApp);
  if (auditApp) {
    terrenoApp.register(new AuditApp());
  }
  const accountSecurityApp = accountSecurity ? new AccountSecurityApp(security) : undefined;
  if (accountSecurityApp) {
    terrenoApp.register(accountSecurityApp);
  }
  const app = organizations ? terrenoApp.start() : terrenoApp.build();
  return {accountSecurityApp, app, betterAuthApp};
};

/** A recovery mail captured by {@link captureMail}. */
export interface SentMail {
  subject: string;
  text: string;
  to: string;
}

/** A `sendMail` that keeps every message, plus the `publicAppUrl` recovery links need. */
export const captureMail = (): {
  config: Pick<BetterAuthConfig, "publicAppUrl" | "sendMail">;
  sent: SentMail[];
} => {
  const sent: SentMail[] = [];
  return {
    config: {
      publicAppUrl: "https://app.example.com",
      sendMail: async (message): Promise<void> => {
        sent.push(message);
      },
    },
    sent,
  };
};

/** The reset token in a recovery mail's `?token=` link. */
export const resetTokenFrom = (mail: SentMail): string => {
  const match = /[?&]token=([^&\s"]+)/.exec(mail.text);
  return decodeURIComponent(match?.[1] ?? "");
};

interface SignedUpUser {
  id: string;
  token: string;
}

export const appUserId = async (email: string): Promise<string> => {
  const user = await SecurityUser.findOne({email});
  if (!user) {
    throw new Error(`No app User for ${email}`);
  }
  return String(user._id);
};

export const signUp = async (
  app: express.Application,
  label: string,
  roles: string[] = []
): Promise<SignedUpUser & {email: string}> => {
  const email = uniqueEmail(label);
  const res = await supertest(app)
    .post("/api/auth/sign-up/email")
    .set("content-type", "application/json")
    .send({email, name: label, password: PASSWORD});
  expect(res.status).toBe(200);
  const id = await appUserId(email);
  if (roles.length > 0) {
    await SecurityUser.updateOne({_id: id}, {$set: {roles}});
  }
  return {email, id, token: res.body.token as string};
};

export const signInWithPassword = (app: express.Application, email: string): supertest.Test =>
  supertest(app)
    .post("/api/auth/sign-in/email")
    .set("content-type", "application/json")
    .send({email, password: PASSWORD});

export const getSummary = (
  app: express.Application,
  token: string,
  userId: string
): supertest.Test =>
  supertest(app).get(`/users/${userId}/security`).set("authorization", `Bearer ${token}`);

export const resetTwoFactor = (
  app: express.Application,
  token: string,
  userId: string
): supertest.Test =>
  supertest(app)
    .post(`/users/${userId}/security/reset-two-factor`)
    .set("authorization", `Bearer ${token}`)
    .send({});

const actionIdsWithOrigin = (origin: "admin" | "self"): string[] =>
  Object.entries(SECURITY_ACTIONS)
    .filter(([, definition]) => definition.origin === origin)
    .map(([id]) => id);

/**
 * The admin recovery events recorded for the user. Self-service events (such as the
 * `two-factor-enabled` a test's 2FA enrolment records) are left out; see
 * {@link selfSecurityEventsFor}.
 */
export const securityEventsFor = async (
  userId: string
): Promise<{actorId?: unknown; after?: unknown}[]> => {
  await flushAuditRecorderForTests();
  return AuditEvent.find({
    "after.securityAction": {$in: actionIdsWithOrigin("admin")},
    recordId: userId,
    source: "security",
  }).lean();
};

/** The self-service security events (`origin: "self"`) recorded for the user. */
export const selfSecurityEventsFor = async (
  userId: string
): Promise<{actorId?: unknown; after?: unknown}[]> => {
  await flushAuditRecorderForTests();
  return AuditEvent.find({
    "after.securityAction": {$in: actionIdsWithOrigin("self")},
    recordId: userId,
    source: "security",
  }).lean();
};

export const betterAuthCollection = (name: string): ReturnType<mongoose.mongo.Db["collection"]> => {
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error("The test database is not connected");
  }
  return db.collection(name);
};

export const betterAuthIdFor = async (userId: string): Promise<string> => {
  const user = await SecurityUser.findById(userId);
  return user?.betterAuthId ?? "";
};

/** Clears every collection the security suites write, plus in-process recorder state. */
export const resetAccountSecurityState = async (): Promise<void> => {
  clearMCPRegistry();
  clearSecurityActionListenersForTests();
  resetAuditRecorderForTests();
  await SecurityUser.deleteMany({});
  await AuditEvent.deleteMany({});
  await McpServiceToken.deleteMany({});
  for (const collection of ["user", "session", "account", "twoFactor", "passkey", "verification"]) {
    await betterAuthCollection(collection).deleteMany({});
  }
};
