import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {createHash} from "node:crypto";
import {once} from "node:events";
import {createServer, type Server} from "node:http";
import type {AddressInfo} from "node:net";
import {DateTime} from "luxon";
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

// The native run (maestro/native-social-login.yaml) serves the provider beside a Playwright run,
// on another port, with an issuer and callback a device can reach through `adb reverse`.
describe("mock OIDC provider served with env overrides", () => {
  const ISSUER_HOST = "localhost";
  const NATIVE_REDIRECT_URI = "http://localhost:4000/api/auth/callback/mock-oidc";
  let child: ReturnType<typeof Bun.spawn>;
  let port: number;
  let issuer: string;

  const freePort = async (): Promise<number> => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1");
    await once(probe, "listening");
    const {port: found} = probe.address() as AddressInfo;
    probe.close();
    await once(probe, "close");
    return found;
  };

  beforeAll(async () => {
    port = await freePort();
    issuer = `http://${ISSUER_HOST}:${port}`;
    child = Bun.spawn(["bun", "e2e/helpers/mockOidcProvider.ts"], {
      cwd: `${import.meta.dir}/..`,
      env: {
        ...process.env,
        MOCK_OIDC_ISSUER: issuer,
        MOCK_OIDC_PORT: String(port),
        MOCK_OIDC_REDIRECT_URI: NATIVE_REDIRECT_URI,
        MOCK_OIDC_SERVE: "true",
      },
      stderr: "inherit",
      stdout: "ignore",
    });
    const deadline = DateTime.now().plus({seconds: 4});
    while (DateTime.now() < deadline) {
      const ready = await fetch(`http://127.0.0.1:${port}/.well-known/openid-configuration`).catch(
        () => null
      );
      if (ready?.ok) {
        return;
      }
      await Bun.sleep(50);
    }
    throw new Error("mock OIDC provider did not start");
  });

  afterAll(async () => {
    child.kill();
    await child.exited;
  });

  it("listens on MOCK_OIDC_PORT and advertises MOCK_OIDC_ISSUER", async () => {
    const discovery = await fetch(`http://127.0.0.1:${port}/.well-known/openid-configuration`);
    const body = (await discovery.json()) as Record<string, string>;
    expect(body.issuer).toBe(issuer);
    expect(body.authorization_endpoint).toBe(`${issuer}/authorize`);
    expect(body.token_endpoint).toBe(`${issuer}/token`);
  });

  it("accepts only MOCK_OIDC_REDIRECT_URI", async () => {
    const authorize = (redirectUri: string): Promise<Response> => {
      const url = new URL(`http://127.0.0.1:${port}/authorize`);
      url.search = new URLSearchParams({
        client_id: CLIENT_ID,
        code_challenge: createHash("sha256").update(CODE_VERIFIER).digest("base64url"),
        code_challenge_method: "S256",
        redirect_uri: redirectUri,
        response_type: "code",
        state: "native-state",
      }).toString();
      return fetch(url, {redirect: "manual"});
    };
    const approved = await authorize(NATIVE_REDIRECT_URI);
    expect(approved.status).toBe(302);
    const redirect = new URL(approved.headers.get("location") ?? "");
    expect(`${redirect.origin}${redirect.pathname}`).toBe(NATIVE_REDIRECT_URI);

    expect((await authorize(REDIRECT_URI)).status).toBe(400);
  });
});
