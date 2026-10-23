import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {createHash} from "node:crypto";
import {once} from "node:events";
import type {Server} from "node:http";
import type {AddressInfo} from "node:net";
import {
  MOCK_OIDC_IDENTITY_COOKIE,
  MOCK_OIDC_USER,
  type MockOidcIdentity,
  startMockOidcProvider,
} from "../e2e/helpers/mockOidcProvider";

// Matches the provider's single client and the cross-site run's callback.
const CLIENT_ID = "terreno-example-e2e";
const CLIENT_SECRET = "terreno-example-e2e-secret";
const REDIRECT_URI = "http://127.0.0.1:4000/api/auth/callback/mock-oidc";
const CODE_VERIFIER = "mock-oidc-unit-test-code-verifier-0123456789abcdef";

interface UserInfo {
  email: string;
  email_verified: boolean;
  id: string;
  name: string;
  sub: string;
}

interface SignInOptions {
  identity?: MockOidcIdentity;
  identityCookie?: string;
  loginHint?: string;
}

const encodeIdentity = (identity: MockOidcIdentity): string =>
  Buffer.from(JSON.stringify(identity), "utf8").toString("base64url");

describe("mock OIDC provider identity selection", () => {
  let server: Server;
  let origin: string;

  beforeAll(async () => {
    server = startMockOidcProvider({port: 0});
    if (!server.listening) {
      await once(server, "listening");
    }
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.close();
    await once(server, "close");
  });

  const authorize = async (options: SignInOptions): Promise<Response> => {
    const url = new URL(`${origin}/authorize`);
    url.search = new URLSearchParams({
      client_id: CLIENT_ID,
      code_challenge: createHash("sha256").update(CODE_VERIFIER).digest("base64url"),
      code_challenge_method: "S256",
      redirect_uri: REDIRECT_URI,
      response_type: "code",
      state: "unit-test-state",
      ...(options.loginHint ? {login_hint: options.loginHint} : {}),
    }).toString();
    const cookie =
      options.identityCookie ?? (options.identity ? encodeIdentity(options.identity) : undefined);
    return fetch(url, {
      headers: cookie ? {cookie: `other=1; ${MOCK_OIDC_IDENTITY_COOKIE}=${cookie}`} : {},
      redirect: "manual",
    });
  };

  // Runs authorize -> token -> userinfo, the way Better Auth's callback does.
  const signIn = async (options: SignInOptions): Promise<UserInfo> => {
    const approved = await authorize(options);
    expect(approved.status).toBe(302);
    const redirect = new URL(approved.headers.get("location") ?? "");
    expect(`${redirect.origin}${redirect.pathname}`).toBe(REDIRECT_URI);
    expect(redirect.searchParams.get("state")).toBe("unit-test-state");

    const token = await fetch(`${origin}/token`, {
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code: redirect.searchParams.get("code") ?? "",
        code_verifier: CODE_VERIFIER,
        grant_type: "authorization_code",
        redirect_uri: REDIRECT_URI,
      }),
      method: "POST",
    });
    expect(token.status).toBe(200);
    const {access_token: accessToken} = (await token.json()) as {access_token: string};

    const userinfo = await fetch(`${origin}/userinfo`, {
      headers: {authorization: `Bearer ${accessToken}`},
    });
    expect(userinfo.status).toBe(200);
    return (await userinfo.json()) as UserInfo;
  };

  it("signs in the identity named by the cookie, unverified when asked", async () => {
    const info = await signIn({
      identity: {email: "Unverified@Example.com", emailVerified: false, name: "Una"},
    });
    expect(info.email).toBe("unverified@example.com");
    expect(info.email_verified).toBe(false);
    expect(info.name).toBe("Una");
    expect(info.sub).toMatch(/^mock-oidc-[0-9a-f]{16}$/);
    expect(info.id).toBe(info.sub);

    // The subject is stable per email, so a second sign-in finds the same account.
    const again = await signIn({identity: {email: "unverified@example.com"}});
    expect(again.sub).toBe(info.sub);
    expect(again.email_verified).toBe(true);
  });

  it("uses an explicit subject from the cookie", async () => {
    const info = await signIn({identity: {email: "sub@example.com", sub: "fixed-subject"}});
    expect(info.sub).toBe("fixed-subject");
  });

  it("prefers the cookie over a login_hint", async () => {
    const info = await signIn({
      identity: {email: "cookie@example.com"},
      loginHint: "hint@example.com",
    });
    expect(info.email).toBe("cookie@example.com");
  });

  it("signs in the login_hint email, verified, without a cookie", async () => {
    const info = await signIn({loginHint: "hint@example.com"});
    expect(info.email).toBe("hint@example.com");
    expect(info.email_verified).toBe(true);
    expect(info.sub).toMatch(/^mock-oidc-[0-9a-f]{16}$/);
  });

  it("signs in the fixed test user with neither", async () => {
    const info = await signIn({});
    expect(info.email).toBe(MOCK_OIDC_USER.email);
    expect(info.email_verified).toBe(true);
    expect(info.sub).toBe(MOCK_OIDC_USER.sub);
  });

  it("refuses an identity it cannot read", async () => {
    expect((await authorize({identityCookie: "not-json"})).status).toBe(400);
    expect((await authorize({identity: {email: "no-at-sign"}})).status).toBe(400);
    expect((await authorize({loginHint: "no-at-sign"})).status).toBe(400);
  });
});
