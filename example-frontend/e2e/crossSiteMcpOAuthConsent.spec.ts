/**
 * MCP OAuth consent reached through a social sign-in in Better Auth's web bearer mode.
 *
 * Runs in the cross-site run (playwright.config.ts CROSS_SITE_SPEC_FILES): the web app at
 * localhost:8082 calls the API at 127.0.0.1:4000, no API response keeps a cookie, and the mock
 * OIDC provider runs on 127.0.0.1:4555. The backend there runs with MCP_OAUTH_ENABLED=true and
 * MCP_OAUTH_CONSENT_URL=http://localhost:8082/oauth/consent. A signed-out user opens the consent
 * screen for an authorize request, signs in with the mock provider from the login screen it
 * shows, and the handoff has to return to /oauth/consent with the same request id.
 */
import {request} from "@playwright/test";
import {expect, test} from "./fixtures/test";
import {acceptPendingConsentForms} from "./helpers/consentForms";
import {
  BEARER_TOKEN_KEY,
  betterAuthSessionCookies,
  CROSS_SITE_API_URL,
  stripApiCookies,
} from "./helpers/crossSiteApi";
import {
  isOAuthDisabled,
  OAUTH_REDIRECT_URI,
  type PendingAuthorization,
  startAuthorization,
} from "./helpers/mcpOAuth";
import {setMockOidcIdentity} from "./helpers/mockOidcProvider";

test.describe("Cross-site MCP OAuth consent", () => {
  // The sign-in reloads the whole bundle on the return from the provider.
  test.slow();

  let pending: PendingAuthorization;

  // Skip, rather than fail, against a backend started without MCP_OAUTH_ENABLED.
  test.beforeAll(async ({playwright}) => {
    const api = await playwright.request.newContext();
    const disabled = await isOAuthDisabled(api);
    await api.dispose();
    test.skip(disabled, "Backend runs without MCP_OAUTH_ENABLED=true");
  });

  // Each test owns its client registration and authorization request.
  test.beforeEach(async ({context, playwright}) => {
    await stripApiCookies(context);
    const api = await playwright.request.newContext();
    pending = await startAuthorization(api);
    await api.dispose();
  });

  test("a signed-out user signs in with the mock provider and returns to the same consent request", async ({
    context,
    page,
  }, testInfo) => {
    const email = `mcp-consent-social-${Date.now()}-${testInfo.workerIndex}@example.com`;
    await setMockOidcIdentity(context, {email});

    // The unreachable client redirect is fulfilled in the browser; approving must reach it.
    let redirectedTo: URL | undefined;
    await page.route(`${OAUTH_REDIRECT_URI}**`, async (route) => {
      redirectedTo = new URL(route.request().url());
      await route.fulfill({body: "redirected", contentType: "text/plain", status: 200});
    });

    await page.goto(pending.consentPath);
    await page.getByTestId("login-screen").waitFor({state: "visible"});
    await page.getByTestId("login-screen-oauth-mock-oidc").click();

    // A fresh provider user has legal consent forms pending, which show before the card. Accept
    // them through the API with the stored bearer, then reopen the same request.
    await page
      .locator('[data-testid="oauth-consent-screen"], [data-testid="consent-form-footer"]')
      .first()
      .waitFor({state: "visible"});
    if (await page.getByTestId("consent-form-footer").isVisible()) {
      const bearer = await page.evaluate((key) => localStorage.getItem(key), BEARER_TOKEN_KEY);
      expect(bearer, "the sign-in stored a bearer token").toBeTruthy();
      const api = await request.newContext();
      try {
        await acceptPendingConsentForms(api, bearer ?? "", {apiUrl: CROSS_SITE_API_URL});
      } finally {
        await api.dispose();
      }
      await page.goto(pending.consentPath);
    }
    await page.getByTestId("oauth-consent-screen").waitFor({state: "visible"});

    const landed = new URL(page.url());
    expect(landed.pathname).toBe("/oauth/consent");
    expect(landed.searchParams.get("request"), "same authorize request").toBe(pending.requestId);
    expect(landed.hash, "the one-time token left the address bar").not.toContain("ott=");
    expect(landed.searchParams.has("handoff")).toBe(false);
    await expect(page.getByTestId("login-screen")).toHaveCount(0);

    // Signed in by the bearer alone, and the card is for this client.
    expect(await page.evaluate((key) => localStorage.getItem(key), BEARER_TOKEN_KEY)).toBeTruthy();
    expect(await betterAuthSessionCookies(context)).toEqual([]);
    await expect(page.getByTestId("oauth-consent-client-name")).toContainText("E2E Connector");

    await page.getByTestId("oauth-consent-approve-button").click();
    await expect.poll(() => redirectedTo?.searchParams.get("code")).toBeTruthy();
    expect(redirectedTo?.searchParams.get("state")).toBe(pending.state);
  });
});
