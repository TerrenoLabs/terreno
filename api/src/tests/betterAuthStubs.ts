/**
 * In-process Better Auth provider stubs shared by the Better Auth feature and linking tests, so
 * full sign-in, callback, and ID-token flows run without a network provider.
 */

import {expect} from "bun:test";
import {randomUUID} from "node:crypto";
import type {BetterAuthPlugin} from "better-auth";
import {genericOAuth} from "better-auth/plugins";
import type express from "express";
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
