/**
 * A minimal OIDC provider for Better Auth tests: discovery, an authorize step that approves at
 * once, a token endpoint, and userinfo. Like a real provider it requires PKCE (S256): each
 * authorize issues a fresh single-use code bound to its `code_challenge` and `redirect_uri`, and
 * the token endpoint refuses a `code_verifier` or `redirect_uri` that does not match.
 */
import {createHash, randomBytes} from "node:crypto";
import {once} from "node:events";
import type {Server} from "node:http";
import type {AddressInfo} from "node:net";
import express from "express";

const MOCK_ACCESS_TOKEN = "mock-access-token";

interface MockOidcUser {
  email: string;
  id: string;
  name: string;
}

export interface MockOidcProvider {
  close: () => Promise<void>;
  issuer: string;
  /** The user the next sign-in authenticates as. */
  setUser: (user: MockOidcUser) => void;
}

interface IssuedCode {
  codeChallenge: string;
  redirectURI: string;
}

const s256 = (verifier: string): string =>
  createHash("sha256").update(verifier).digest().toString("base64url");

export const startMockOidcProvider = async (): Promise<MockOidcProvider> => {
  let issuer = "";
  let user: MockOidcUser = {email: "oidc@example.com", id: "oidc-user", name: "OIDC User"};
  const app = express();
  app.use(express.urlencoded({extended: false}));
  app.get("/.well-known/openid-configuration", (_req, res) => {
    res.json({
      authorization_endpoint: `${issuer}/authorize`,
      issuer,
      response_types_supported: ["code"],
      token_endpoint: `${issuer}/token`,
      userinfo_endpoint: `${issuer}/userinfo`,
    });
  });
  const codes = new Map<string, IssuedCode>();
  app.get("/authorize", (req, res) => {
    const redirect = new URL(String(req.query.redirect_uri));
    if (
      req.query.code_challenge_method !== "S256" ||
      typeof req.query.code_challenge !== "string"
    ) {
      redirect.searchParams.set("error", "invalid_request");
      res.redirect(redirect.toString());
      return;
    }
    const code = randomBytes(16).toString("hex");
    codes.set(code, {
      codeChallenge: req.query.code_challenge,
      redirectURI: String(req.query.redirect_uri),
    });
    redirect.searchParams.set("code", code);
    redirect.searchParams.set("state", String(req.query.state));
    res.redirect(redirect.toString());
  });
  app.post("/token", (req, res) => {
    const issued = codes.get(String(req.body.code));
    // Codes are single use, whether or not the exchange succeeds.
    codes.delete(String(req.body.code));
    const isValid =
      issued !== undefined &&
      typeof req.body.code_verifier === "string" &&
      s256(req.body.code_verifier) === issued.codeChallenge &&
      req.body.redirect_uri === issued.redirectURI;
    if (!isValid) {
      res.status(400).json({error: "invalid_grant"});
      return;
    }
    res.json({access_token: MOCK_ACCESS_TOKEN, expires_in: 3600, token_type: "Bearer"});
  });
  app.get("/userinfo", (req, res) => {
    if (req.headers.authorization !== `Bearer ${MOCK_ACCESS_TOKEN}`) {
      res.status(401).json({error: "invalid_token"});
      return;
    }
    res.json({...user, email_verified: true, sub: user.id});
  });
  const server: Server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    close: async (): Promise<void> => {
      server.close();
      await once(server, "close");
    },
    issuer,
    setUser: (next: MockOidcUser): void => {
      user = next;
    },
  };
};
