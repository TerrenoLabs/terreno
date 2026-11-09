import type express from "express";
import supertest from "supertest";
import type TestAgent from "supertest/lib/agent";

export interface AuthWithTokenOptions {
  /** Access token to send, usually minted with `@terreno/api`'s `generateTokens(user, authOptions)`. */
  token: string | null | undefined;
  /** Extra headers set on every request, e.g. `{"app-version": "1.10.0"}`. */
  headers?: Record<string, string>;
}

/**
 * Returns a supertest agent that sends `Authorization: Bearer <token>` on every request.
 *
 * Pair it with a token minted directly from the user to skip `POST /auth/login`, whose password
 * hashing costs ~200ms per call. Keep `authAsUser` for tests that exercise the login flow itself.
 *
 * ```ts
 * const {token} = await generateTokens(user, authOptions);
 * const agent = await authWithToken(app, {token});
 * ```
 */
export const authWithToken = async (
  app: express.Application,
  {token, headers = {}}: AuthWithTokenOptions
): Promise<TestAgent> => {
  if (!token) {
    throw new Error(
      "authWithToken: token is empty; check that the user exists and TOKEN_SECRET is set"
    );
  }
  const agent = supertest.agent(app);
  await agent.set("authorization", `Bearer ${token}`);
  for (const [key, value] of Object.entries(headers)) {
    await agent.set(key, value);
  }
  return agent;
};
