import type express from "express";
import supertest from "supertest";
import type TestAgent from "supertest/lib/agent";

import {createLoopbackServer} from "./testRequest";

export interface AuthUserCredentials {
  email: string;
  password: string;
  headers?: Record<string, string>;
}

export interface AuthAsUserOptions {
  loginPath?: string;
  tokenPath?: string;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

/**
 * Logs in via POST /auth/login (by default) and returns a supertest agent with Bearer auth.
 */
export const authAsUser = async (
  app: express.Application,
  credentials: AuthUserCredentials,
  options: AuthAsUserOptions = {}
): Promise<TestAgent> => {
  const loginPath = options.loginPath ?? "/auth/login";
  const tokenPath = options.tokenPath ?? "data.token";
  const timeoutMs = options.timeoutMs ?? 5000;

  const agent = supertest.agent(createLoopbackServer(app));
  const request = agent.post(loginPath).send({
    email: credentials.email,
    password: credentials.password,
  });

  if (timeoutMs > 0) {
    request.timeout(timeoutMs);
  }

  const res = await request.expect(200);
  const token = tokenPath.split(".").reduce<unknown>((value, key) => {
    if (value && typeof value === "object" && key in (value as Record<string, unknown>)) {
      return (value as Record<string, unknown>)[key];
    }
    return undefined;
  }, res.body);

  if (typeof token !== "string" || !token) {
    throw new Error(`authAsUser: expected string token at response path "${tokenPath}"`);
  }

  const headers = {...options.headers, ...credentials.headers};
  await agent.set("authorization", `Bearer ${token}`);
  for (const [key, value] of Object.entries(headers)) {
    await agent.set(key, value);
  }

  return agent;
};
