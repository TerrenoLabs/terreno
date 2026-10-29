/**
 * In-process Better Auth provider stubs shared by the Better Auth feature and linking tests, so
 * full sign-in, callback, and ID-token flows run without a network provider.
 */

import {expect} from "bun:test";
import {createHmac, randomUUID} from "node:crypto";
import type {BetterAuthPlugin} from "better-auth";
import {genericOAuth} from "better-auth/plugins";
import type express from "express";
import {DateTime} from "luxon";
import mongoose from "mongoose";
import supertest from "supertest";
import type {BetterAuthOptionsOverride} from "../betterAuth";
import {APIError} from "../errors";

export const API_ORIGIN = "http://localhost:3000";
export const SECRET = "test-secret-at-least-32-characters-long";
export const PASSWORD = "password-123456";
const STUB_PROVIDER = "stub-oidc";

/** The identity a stub provider reports for every sign-in. */
export interface StubIdentity {
  email: string;
  /** Whether the provider says it verified the email. Defaults to `true`. */
  emailVerified?: boolean;
  id: string;
}

export const uniqueEmail = (label: string): string => `${label}-${randomUUID()}@example.com`;

export const newStubIdentity = (label: string): StubIdentity => ({
  email: uniqueEmail(label),
  id: randomUUID(),
});

// A collection Better Auth owns on the default connection (`user`, `account`, `session`).
const betterAuthCollection = (name: string): ReturnType<mongoose.mongo.Db["collection"]> => {
  const db = mongoose.connection.db;
  if (!db) {
    throw new APIError({status: 500, title: "The test database is not connected"});
  }
  return db.collection(name);
};

/** Better Auth's `user` collection on the default connection. */
export const betterAuthUsers = (): ReturnType<mongoose.mongo.Db["collection"]> =>
  betterAuthCollection("user");

/** Better Auth's `account` collection (one row per sign-in method) on the default connection. */
export const betterAuthAccounts = (): ReturnType<mongoose.mongo.Db["collection"]> =>
  betterAuthCollection("account");

/**
 * A generic OAuth provider that answers the token exchange and userinfo in-process with
 * `identity`, so the full sign-in and callback flow runs without a network provider.
 */
export const stubOidcPlugin = (identity: StubIdentity): BetterAuthPlugin =>
  genericOAuth({
    config: [
      {
        authorizationUrl: "https://stub.example.com/authorize",
        clientId: "stub-client",
        clientSecret: "stub-secret",
        getToken: async () => ({accessToken: "stub-access-token", tokenType: "Bearer"}),
        getUserInfo: async () => ({
          email: identity.email,
          emailVerified: identity.emailVerified ?? true,
          id: identity.id,
          name: "Stub User",
        }),
        providerId: STUB_PROVIDER,
        tokenUrl: "https://stub.example.com/token",
      },
    ],
  }) as unknown as BetterAuthPlugin;

/**
 * Better Auth options that make the `google` provider accept any ID token and report
 * `identity`, for ID-token sign-in (`POST /sign-in/social` with `idToken`) and `/link-social`.
 * Pair with `googleOAuth` in the config so the provider exists.
 */
export const stubGoogleIdTokenOptions = (identity: StubIdentity): BetterAuthOptionsOverride => ({
  socialProviders: {
    google: {
      getUserInfo: async () => ({
        data: {sub: identity.id},
        user: {
          email: identity.email,
          emailVerified: identity.emailVerified ?? true,
          id: identity.id,
          name: "Google User",
        },
      }),
      verifyIdToken: async () => true,
    },
  },
});

export const setCookies = (res: supertest.Response): string[] =>
  (res.headers["set-cookie"] as unknown as string[] | undefined) ?? [];

export const cookieHeaderFrom = (res: supertest.Response): string =>
  setCookies(res)
    .map((cookie) => cookie.split(";")[0])
    .join("; ");

/** Starts a sign-in with the stub provider and completes its callback, returning the redirect. */
export const signInWithStub = async (
  app: express.Application,
  extra: {requestSignUp?: boolean} = {}
): Promise<URL> => {
  const start = await supertest(app)
    .post("/api/auth/sign-in/social")
    .set("content-type", "application/json")
    .send({callbackURL: `${API_ORIGIN}/done`, provider: STUB_PROVIDER, ...extra});
  expect(start.status).toBe(200);
  const state = new URL(start.body.url).searchParams.get("state");
  const callback = await supertest(app)
    .get(`/api/auth/callback/${STUB_PROVIDER}?code=stub-code&state=${state}`)
    .set("cookie", cookieHeaderFrom(start));
  expect(callback.status).toBe(302);
  return new URL(callback.headers.location, API_ORIGIN);
};

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

const base32Decode = (value: string): Buffer => {
  let bits = "";
  for (const char of value.replace(/=+$/, "").toUpperCase()) {
    bits += BASE32_ALPHABET.indexOf(char).toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
};

/** The current RFC 6238 code (SHA-1, 6 digits, 30-second steps) an authenticator app would show. */
export const totpCode = (secret: Buffer): string => {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(DateTime.now().toSeconds() / 30)));
  const digest = createHmac("sha1", secret).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(value).padStart(6, "0");
};

/** The TOTP secret in an `otpauth://` URI, as `/two-factor/enable` returns it. */
export const totpSecretFromURI = (totpURI: string): Buffer =>
  base32Decode(new URL(totpURI).searchParams.get("secret") ?? "");

export interface TwoFactorEnrollment {
  backupCodes: string[];
  totpURI: string;
}

/**
 * Signs up, enables two-factor, and confirms it with a TOTP code, as the Security screen does.
 * Returns the sign-up session token too.
 */
export const enrollTwoFactor = async (
  app: express.Application,
  email: string
): Promise<{enrollment: TwoFactorEnrollment; secret: Buffer; token: string}> => {
  const signUp = await supertest(app)
    .post("/api/auth/sign-up/email")
    .set("content-type", "application/json")
    .send({email, name: "Two Factor", password: PASSWORD});
  expect(signUp.status).toBe(200);
  const bearer = `Bearer ${signUp.body.token}`;
  const enable = await supertest(app)
    .post("/api/auth/two-factor/enable")
    .set("authorization", bearer)
    .set("content-type", "application/json")
    .send({password: PASSWORD});
  expect(enable.status).toBe(200);
  const enrollment = enable.body as TwoFactorEnrollment;
  const secret = totpSecretFromURI(enrollment.totpURI);
  const confirm = await supertest(app)
    .post("/api/auth/two-factor/verify-totp")
    .set("authorization", bearer)
    .set("content-type", "application/json")
    .send({code: totpCode(secret)});
  expect(confirm.status).toBe(200);
  return {enrollment, secret, token: signUp.body.token as string};
};
