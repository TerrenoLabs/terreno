import {
  APIError,
  BetterAuthApp,
  logger,
  syncBetterAuthUser,
  type UserModel as TerrenoAuthUserModel,
} from "@terreno/api";
import express from "express";
import {DateTime} from "luxon";
import supertest from "supertest";

import {User} from "../models/user";
import {buildBetterAuthConfig} from "./betterAuthConfig";

export interface BetterAuthSeedUser {
  email: string;
  name: string;
  password: string;
}

const waitMs = (ms: number): Promise<void> => {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
};

const postBetterAuthEmailWithRetry = async (
  agent: ReturnType<typeof supertest>,
  path: "/api/auth/sign-up/email" | "/api/auth/sign-in/email",
  body: {email: string; name?: string; password: string}
): Promise<supertest.Response> => {
  const maxAttempts = 5;
  let delayMs = 250;
  let response = await agent.post(path).send(body);
  for (let attempt = 1; attempt < maxAttempts && response.status === 429; attempt += 1) {
    logger.warn(`Better Auth ${path} rate-limited for ${body.email}; retrying`);
    await waitMs(delayMs);
    delayMs *= 2;
    response = await agent.post(path).send(body);
  }
  return response;
};

/**
 * Seed a Better Auth user in-process (no running server required).
 * Creates the credential account, marks the Better Auth user's email verified (so account
 * linking treats it as the email's owner), and syncs the Mongoose User row. Seeding works under `AUTH_SIGN_UP=closed`
 * too: its private Better Auth instance always allows sign-up.
 */
export const seedBetterAuthUserInProcess = async (
  user: BetterAuthSeedUser
): Promise<{cookie: string; token: string}> => {
  const config = buildBetterAuthConfig();
  if (!config) {
    throw new APIError({
      status: 500,
      title: "seedBetterAuthUserInProcess requires AUTH_PROVIDER=better-auth",
    });
  }

  const app = express();
  app.use(express.json());
  const betterAuthApp = new BetterAuthApp({
    config: {
      ...config,
      disableRateLimit: true,
      signUp: {mode: "open"},
    },
    userModel: User as unknown as TerrenoAuthUserModel,
  });
  betterAuthApp.register(app);
  const agent = supertest(app);

  const signUpRes = await postBetterAuthEmailWithRetry(agent, "/api/auth/sign-up/email", {
    email: user.email,
    name: user.name,
    password: user.password,
  });

  let response = signUpRes;
  if (!signUpRes.ok) {
    response = await postBetterAuthEmailWithRetry(agent, "/api/auth/sign-in/email", {
      email: user.email,
      password: user.password,
    });
  }
  if (!response.ok) {
    throw new APIError({
      status: 500,
      title: `Better Auth seed failed for ${user.email}: ${response.status} ${response.text}`,
    });
  }

  const setCookie = response.headers["set-cookie"];
  const cookie = Array.isArray(setCookie)
    ? setCookie.map((value) => value.split(";")[0]).join("; ")
    : typeof setCookie === "string"
      ? setCookie.split(";")[0]
      : "";
  const body = response.body as {
    session?: {token?: string};
    token?: string;
    user?: {email: string; id: string; name: string | null};
  };
  const token = body.session?.token ?? body.token ?? "";
  if (!cookie && !token) {
    throw new APIError({
      status: 500,
      title: `Better Auth seed for ${user.email} succeeded but returned no session`,
    });
  }

  if (body.user) {
    const context = await betterAuthApp.ensureAuth().$context;
    await context.internalAdapter.updateUser(body.user.id, {emailVerified: true});
    // The seed owns this Better Auth account, so its email is trusted for linking a legacy user.
    await syncBetterAuthUser(
      User as unknown as TerrenoAuthUserModel,
      {
        createdAt: DateTime.now().toJSDate(),
        email: body.user.email,
        emailVerified: true,
        id: body.user.id,
        image: null,
        name: body.user.name,
        updatedAt: DateTime.now().toJSDate(),
      },
      undefined,
      {trustEmail: true}
    );
  }

  logger.info(`Seeded Better Auth user in-process: ${user.email}`);
  return {cookie, token};
};
