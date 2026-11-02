import {createHash, randomBytes} from "node:crypto";
import {type APIRequestContext, expect, test} from "@playwright/test";
import {DateTime} from "luxon";

/**
 * MCP OAuth consent through the admin SPA. Needs the example-backend running with
 * ADMIN_SPA_ENABLED=true, AUTH_PROVIDER=better-auth, MCP_OAUTH_ENABLED=true, and
 * PUBLIC_API_URL equal to the Playwright baseURL.
 */

const REDIRECT_URI = "http://127.0.0.1:9/callback";
const ARTIFACTS_DIR = process.env.ADMIN_SPA_E2E_ARTIFACTS_DIR;

interface PendingRequest {
  consentPath: string;
  state: string;
}

const base64Url = (buffer: Buffer): string =>
  buffer.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");

const signUpUser = async (
  request: APIRequestContext
): Promise<{email: string; password: string}> => {
  const email = `consent-${DateTime.now().toMillis()}@example.com`;
  const password = "consent-e2e-password";
  const res = await request.post("/api/auth/sign-up/email", {
    data: {email, name: "Consent E2E", password},
  });
  expect(res.ok()).toBeTruthy();
  return {email, password};
};

// Register a public client and start the authorization-code flow, as Claude.ai would.
const startAuthorization = async (request: APIRequestContext): Promise<PendingRequest> => {
  const register = await request.post("/oauth/register", {
    data: {client_name: "E2E Connector", redirect_uris: [REDIRECT_URI]},
  });
  expect(register.status()).toBe(201);
  const {client_id: clientId} = (await register.json()) as {client_id: string};

  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  const state = base64Url(randomBytes(8));
  const params = new URLSearchParams({
    client_id: clientId,
    code_challenge: challenge,
    code_challenge_method: "S256",
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    state,
  });
  const authorize = await request.get(`/oauth/authorize?${params.toString()}`, {maxRedirects: 0});
  expect(authorize.status()).toBe(302);
  const location = new URL(authorize.headers().location);
  expect(location.pathname).toBe("/console/oauth/consent");
  return {consentPath: `${location.pathname}${location.search}`, state};
};

test.describe("admin SPA MCP OAuth consent", () => {
  // Skip, rather than fail, against a backend started without MCP_OAUTH_ENABLED.
  test.beforeAll(async ({playwright}) => {
    const api = await playwright.request.newContext({baseURL: test.info().project.use.baseURL});
    const metadata = await api.get("/.well-known/oauth-authorization-server");
    await api.dispose();
    test.skip(metadata.status() === 404, "Backend runs without MCP_OAUTH_ENABLED=true");
  });

  test("a signed-out non-admin signs in, approves, and is sent back with a code", async ({
    page,
    playwright,
  }) => {
    const api = await playwright.request.newContext({baseURL: test.info().project.use.baseURL});
    const user = await signUpUser(api);
    const pending = await startAuthorization(api);
    await api.dispose();

    await page.goto(pending.consentPath);
    await page.getByTestId("admin-spa-login-email").waitFor({state: "visible", timeout: 30_000});
    expect(page.url()).toContain("returnTo=");
    await page.getByTestId("admin-spa-login-email").fill(user.email);
    await page.getByTestId("admin-spa-login-password").fill(user.password);
    await page.getByTestId("admin-spa-login-submit").click();

    await page
      .getByTestId("admin-spa-oauth-consent-screen")
      .waitFor({state: "visible", timeout: 30_000});

    // A cross-site approve that carries the session cookie must not decide the request.
    const requestId = new URL(pending.consentPath, "http://localhost").searchParams.get("request");
    const forged = await page.request.post(`/oauth/authorize/${requestId}/approve`, {
      headers: {origin: "https://evil.example"},
    });
    expect([401, 403]).toContain(forged.status());
    await expect(page.getByTestId("admin-spa-oauth-consent-client-name")).toContainText(
      "E2E Connector"
    );
    await expect(page.getByTestId("admin-spa-oauth-consent-redirect-host")).toContainText(
      "127.0.0.1"
    );
    await expect(page.getByTestId("admin-spa-oauth-consent-user-email")).toContainText(user.email);
    if (ARTIFACTS_DIR) {
      await page.screenshot({fullPage: true, path: `${ARTIFACTS_DIR}/mcp-oauth-consent.png`});
    }

    const callback = page.waitForRequest((request) => request.url().startsWith(REDIRECT_URI));
    await page.getByTestId("admin-spa-oauth-consent-approve-button").click();
    const redirected = new URL((await callback).url());
    expect(redirected.searchParams.get("code")).toBeTruthy();
    expect(redirected.searchParams.get("state")).toBe(pending.state);

    // The request is spent: opening it again (in a new tab, since this one is navigating to the
    // unreachable callback) shows the already-decided state.
    const again = await page.context().newPage();
    await again.goto(pending.consentPath);
    await again
      .getByTestId("admin-spa-oauth-consent-decided")
      .waitFor({state: "visible", timeout: 30_000});
    if (ARTIFACTS_DIR) {
      await again.screenshot({path: `${ARTIFACTS_DIR}/mcp-oauth-consent-decided.png`});
    }
  });

  test("a deny sends the client back with access_denied", async ({page, playwright}) => {
    const api = await playwright.request.newContext({baseURL: test.info().project.use.baseURL});
    const user = await signUpUser(api);
    const pending = await startAuthorization(api);
    await api.dispose();

    await page.goto(pending.consentPath);
    await page.getByTestId("admin-spa-login-email").waitFor({state: "visible", timeout: 30_000});
    await page.getByTestId("admin-spa-login-email").fill(user.email);
    await page.getByTestId("admin-spa-login-password").fill(user.password);
    await page.getByTestId("admin-spa-login-submit").click();
    await page
      .getByTestId("admin-spa-oauth-consent-deny-button")
      .waitFor({state: "visible", timeout: 30_000});

    const callback = page.waitForRequest((request) => request.url().startsWith(REDIRECT_URI));
    await page.getByTestId("admin-spa-oauth-consent-deny-button").click();
    const redirected = new URL((await callback).url());
    expect(redirected.searchParams.get("error")).toBe("access_denied");
    expect(redirected.searchParams.get("code")).toBeNull();
  });
});
