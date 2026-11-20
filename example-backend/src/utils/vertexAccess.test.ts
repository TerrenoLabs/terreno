import {describe, expect, it} from "bun:test";
import type express from "express";

import {
  createVertexAccessCheck,
  DEFAULT_VERTEX_ALLOWED_DOMAINS,
  parseVertexAllowedDomains,
  readGoogleHostedDomain,
} from "./vertexAccess";

const base64url = (value: object): string =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

const idTokenWith = (claims: object): string =>
  `${base64url({alg: "RS256"})}.${base64url(claims)}.signature`;

interface FakeAccount {
  idToken?: string | null;
  providerId: string;
}

const buildCheck = (accounts: FakeAccount[], allowedDomains = ["flourish.health"]) =>
  createVertexAccessCheck({
    allowedDomains,
    getAuth: () => ({
      $context: Promise.resolve({
        internalAdapter: {findAccounts: async () => accounts},
      }),
    }),
  });

const requestFor = (user?: object): express.Request => ({user}) as unknown as express.Request;

describe("parseVertexAllowedDomains", () => {
  it("defaults to flourish.health when unset or blank", () => {
    expect(parseVertexAllowedDomains(undefined)).toEqual(DEFAULT_VERTEX_ALLOWED_DOMAINS);
    expect(parseVertexAllowedDomains(" , ")).toEqual(DEFAULT_VERTEX_ALLOWED_DOMAINS);
  });

  it("trims and lowercases a comma-separated list", () => {
    expect(parseVertexAllowedDomains(" Flourish.Health, example.com ")).toEqual([
      "flourish.health",
      "example.com",
    ]);
  });
});

describe("readGoogleHostedDomain", () => {
  it("reads and lowercases the hd claim", () => {
    expect(readGoogleHostedDomain(idTokenWith({hd: "Flourish.Health"}))).toBe("flourish.health");
  });

  it("returns undefined for personal accounts and malformed tokens", () => {
    expect(readGoogleHostedDomain(idTokenWith({email: "a@gmail.com"}))).toBeUndefined();
    expect(readGoogleHostedDomain("not-a-jwt")).toBeUndefined();
    expect(readGoogleHostedDomain("a.%%%.c")).toBeUndefined();
    expect(readGoogleHostedDomain(undefined)).toBeUndefined();
  });
});

describe("createVertexAccessCheck", () => {
  it("allows a Google Workspace account on an allowed domain", async () => {
    const check = buildCheck([
      {providerId: "credential"},
      {
        idToken: idTokenWith({email: "josh@flourish.health", hd: "flourish.health"}),
        providerId: "google",
      },
    ]);
    expect(await check(requestFor({betterAuthId: "ba-1"}))).toBe(true);
  });

  it("refuses a Google account whose email is on the domain but has no hd claim", async () => {
    const check = buildCheck([
      {idToken: idTokenWith({email: "someone@flourish.health"}), providerId: "google"},
    ]);
    expect(await check(requestFor({betterAuthId: "ba-1"}))).toBe(false);
  });

  it("refuses another Workspace domain, including a lookalike suffix", async () => {
    const check = buildCheck([
      {idToken: idTokenWith({hd: "evilflourish.health"}), providerId: "google"},
    ]);
    expect(await check(requestFor({betterAuthId: "ba-1"}))).toBe(false);
  });

  it("refuses users without a linked Google account", async () => {
    const check = buildCheck([{providerId: "credential"}, {providerId: "github"}]);
    expect(await check(requestFor({betterAuthId: "ba-1"}))).toBe(false);
  });

  it("refuses requests with no Better Auth user", async () => {
    const check = buildCheck([
      {idToken: idTokenWith({hd: "flourish.health"}), providerId: "google"},
    ]);
    expect(await check(requestFor())).toBe(false);
    expect(await check(requestFor({_id: "jwt-user"}))).toBe(false);
  });

  it("refuses when Better Auth is not configured or the lookup fails", async () => {
    const noAuth = createVertexAccessCheck({
      allowedDomains: ["flourish.health"],
      getAuth: () => undefined,
    });
    expect(await noAuth(requestFor({betterAuthId: "ba-1"}))).toBe(false);

    const failing = createVertexAccessCheck({
      allowedDomains: ["flourish.health"],
      getAuth: () => ({$context: Promise.reject(new Error("db down"))}),
    });
    expect(await failing(requestFor({betterAuthId: "ba-1"}))).toBe(false);
  });
});
