import {describe, expect, it} from "bun:test";
import express from "express";
import supertest from "supertest";

import type {McpOAuthGrant} from "../index";
import {
  buildAuthorizationServerMetadata,
  type McpOAuthOptions,
  resolveMcpOAuthOption,
  sendProtocolJson,
} from "./oauthMetadata";

const baseOptions: McpOAuthOptions = {
  consentUrl: "https://app.example.com/oauth/consent",
  enabled: true,
  issuer: "https://api.example.com",
};

// Takes `unknown` so the validation cases can pass invalid grants past the type checker.
const withGrants = (grants: unknown, extra: Record<string, unknown> = {}): McpOAuthOptions =>
  ({...baseOptions, ...extra, grants}) as McpOAuthOptions;

const READ_GRANT: McpOAuthGrant = {
  access: "read",
  description: "See your records. It cannot change anything.",
  label: "Read your data",
  scope: "mcp:read",
};
const WRITE_GRANT: McpOAuthGrant = {
  access: "write",
  description: "Create, update, and delete records for you.",
  label: "Change your data",
  scope: "mcp:write",
};

describe("sendProtocolJson", () => {
  it("serializes reflected input as JSON with a JSON content type", async () => {
    const app = express();
    app.get("/echo", (req, res) => {
      sendProtocolJson(res, 400, {error: "invalid_request", error_description: req.query.value});
    });

    const payload = "<script>alert(1)</script>";
    const res = await supertest(app).get("/echo").query({value: payload}).expect(400);
    expect(res.headers["content-type"]).toBe("application/json; charset=utf-8");
    expect(res.text).toBe(JSON.stringify({error: "invalid_request", error_description: payload}));
  });
});

describe("resolveMcpOAuthOption grants", () => {
  it('resolves "readOnly" to the read preset', () => {
    const resolved = resolveMcpOAuthOption(withGrants("readOnly"));

    expect(resolved?.scopesSupported).toEqual(["mcp:read"]);
    expect(resolved?.grants).toEqual([READ_GRANT]);
  });

  it('resolves "readWrite" to read then write, in that order', () => {
    const resolved = resolveMcpOAuthOption(withGrants("readWrite"));

    expect(resolved?.scopesSupported).toEqual(["mcp:read", "mcp:write"]);
    expect(resolved?.grants).toEqual([READ_GRANT, WRITE_GRANT]);
  });

  it("keeps a custom grant as given and derives scopesSupported from it", () => {
    const custom: McpOAuthGrant[] = [{access: "write", label: "Todos", scope: "todos"}];
    const resolved = resolveMcpOAuthOption(withGrants(custom));

    expect(resolved?.scopesSupported).toEqual(["todos"]);
    expect(resolved?.grants).toEqual(custom);
  });

  it("advertises preset scopes in the authorization-server metadata", () => {
    const readOnly = resolveMcpOAuthOption(withGrants("readOnly"));
    const readWrite = resolveMcpOAuthOption(withGrants("readWrite"));
    if (!(readOnly && readWrite)) {
      throw new Error("expected resolved options");
    }

    expect(buildAuthorizationServerMetadata(readOnly).scopes_supported).toEqual(["mcp:read"]);
    expect(buildAuthorizationServerMetadata(readWrite).scopes_supported).toEqual([
      "mcp:read",
      "mcp:write",
    ]);
  });

  it("leaves grants undefined and scopesSupported as [mcp] when neither is set", () => {
    const resolved = resolveMcpOAuthOption(baseOptions);

    expect(resolved?.scopesSupported).toEqual(["mcp"]);
    expect(resolved).toHaveProperty("grants", undefined);
  });

  it("keeps an explicit scopesSupported when grants is unset", () => {
    const resolved = resolveMcpOAuthOption({...baseOptions, scopesSupported: ["a", "b"]});

    expect(resolved?.scopesSupported).toEqual(["a", "b"]);
    expect(resolved).toHaveProperty("grants", undefined);
  });

  it("throws when both grants and scopesSupported are set", () => {
    // The per-occurrence text lives in `detail`; `title` (and so `message`) stays a stable summary.
    let caught: unknown;
    try {
      resolveMcpOAuthOption(withGrants("readOnly", {scopesSupported: ["mcp"]}));
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      detail: "mcpOAuth: set grants or scopesSupported, not both",
      title: "MCP OAuth is misconfigured",
    });
  });

  it("throws for an empty grants list", () => {
    expect(() => resolveMcpOAuthOption(withGrants([]))).toThrow();
  });

  it("throws for a duplicate scope", () => {
    const dup = [
      {access: "read", label: "A", scope: "todos"},
      {access: "write", label: "B", scope: "todos"},
    ];

    expect(() => resolveMcpOAuthOption(withGrants(dup))).toThrow();
  });

  it("throws for a scope containing a space", () => {
    expect(() =>
      resolveMcpOAuthOption(withGrants([{access: "read", label: "A", scope: "to dos"}]))
    ).toThrow();
  });

  it("throws for an unknown preset string", () => {
    expect(() => resolveMcpOAuthOption(withGrants("admin"))).toThrow();
  });

  it("throws for an invalid access level", () => {
    expect(() =>
      resolveMcpOAuthOption(withGrants([{access: "admin", label: "A", scope: "todos"}]))
    ).toThrow();
  });
});
