/**
 * Cross-site social sign-in in Better Auth's web bearer mode, with no session cookie.
 *
 * playwright.config.ts runs this spec in the cross-site run beside crossSiteBearer.spec.ts: the
 * web app at localhost:8082 calls the API at 127.0.0.1:4000 (a different site), the backend has
 * the OAuth handoff on, and the mock OIDC provider (helpers/mockOidcProvider.ts) runs on
 * 127.0.0.1:4555. The mock provider's button starts the sign-in with signInSocialWithHandoff,
 * the callback returns to /login with a one-time token in the fragment, and app/_layout.tsx
 * exchanges it for the bearer.
 *
 * Cookies: every fetch and XHR response from the API loses `set-cookie` (stripApiCookies), the
 * way Safari treats third-party cookies. The OAuth start and callback are top-level navigations
 * to the API, which are first-party there, so they keep the browser's own cookie handling: the
 * OAuth state cookie has to survive between them. The assertions prove the session is the bearer
 * alone: no Better Auth session cookie lands on any domain, even where cookies are allowed.
 */
import {type Page, request} from "@playwright/test";
import {expect, test} from "./fixtures/test";
import {acceptPendingConsentForms} from "./helpers/consentForms";
import {
  BEARER_TOKEN_KEY,
  betterAuthSessionCookies,
  CROSS_SITE_API_URL,
  stripApiCookies,
} from "./helpers/crossSiteApi";
import {MOCK_OIDC_USER} from "./helpers/mockOidcProvider";

const HANDOFF_START_PATH = "/api/auth/oauth-handoff/start";
const HANDOFF_VERIFY_PATH = "/api/auth/one-time-token/verify";
const STATE_COOKIE = "better-auth.state";

interface HandoffTraffic {
  /** Set-cookie values the start navigation's response carried. */
  startCookies: string[];
  verifyRequests: number;
}

const watchHandoffTraffic = (page: Page): HandoffTraffic => {
  const traffic: HandoffTraffic = {startCookies: [], verifyRequests: 0};
  page.on("request", (sent) => {
    if (sent.url().startsWith(`${CROSS_SITE_API_URL}${HANDOFF_VERIFY_PATH}`)) {
      traffic.verifyRequests += 1;
    }
  });
  page.on("response", async (received) => {
    if (!received.url().startsWith(`${CROSS_SITE_API_URL}${HANDOFF_START_PATH}`)) {
      return;
    }
    const headers = await received.headersArray().catch(() => []);
    for (const {name, value} of headers) {
      if (name.toLowerCase() === "set-cookie") {
        traffic.startCookies.push(value);
      }
    }
  });
  return traffic;
};

const storedBearer = (page: Page): Promise<string | null> =>
  page.evaluate((key) => localStorage.getItem(key), BEARER_TOKEN_KEY);

test.describe("Cross-site social sign-in", () => {
  // The sign-in reloads the whole bundle twice (return from the provider, then /profile).
  test.slow();

  let traffic: HandoffTraffic;

  test.beforeEach(async ({context, page}) => {
    await stripApiCookies(context);
    traffic = watchHandoffTraffic(page);
  });

  test("user signs in with the mock provider and keeps no session cookie", async ({
    context,
    page,
  }, testInfo) => {
    await page.goto("/login");
    await page.getByTestId("login-screen").waitFor({state: "visible"});
    await page.getByTestId("login-mock-oidc-button").click();

    // Back from the provider: the tabs root, or the consent navigator for a fresh user.
    await page
      .locator('[data-testid="todos-screen"], [data-testid="consent-form-footer"]')
      .first()
      .waitFor({state: "visible"});

    const landed = new URL(page.url());
    expect(landed.hash, "the one-time token left the address bar").not.toContain("ott=");
    expect(landed.searchParams.has("ott")).toBe(false);
    expect(landed.searchParams.has("handoff")).toBe(false);
    expect(traffic.verifyRequests, "the app exchanged the token once").toBe(1);
    expect(
      traffic.startCookies.some((cookie) => cookie.startsWith(`${STATE_COOKIE}=`)),
      "the start navigation set the OAuth state cookie first-party on the API"
    ).toBe(true);

    const bearer = await storedBearer(page);
    expect(bearer, "the exchange stored a bearer token").toBeTruthy();
    expect(await betterAuthSessionCookies(context)).toEqual([]);

    // The bearer alone is the session: the API knows the provider's user by it.
    const api = await request.newContext();
    try {
      const me = await api.get(`${CROSS_SITE_API_URL}/auth/me`, {
        headers: {authorization: `Bearer ${bearer}`},
      });
      expect(me.ok()).toBe(true);
      const body = (await me.json()) as {data?: {email?: string}};
      expect(body.data?.email).toBe(MOCK_OIDC_USER.email);
      // A fresh provider user has consent forms pending; agree so the profile screen shows.
      await acceptPendingConsentForms(api, bearer ?? "");
    } finally {
      await api.dispose();
    }

    await page.goto("/profile");
    await expect(page.getByTestId("profile-logged-in-as").first()).toContainText(
      MOCK_OIDC_USER.email
    );
    expect(await betterAuthSessionCookies(context)).toEqual([]);
    const screenshot = testInfo.outputPath("cross-site-oauth-signed-in.png");
    await page.screenshot({fullPage: true, path: screenshot});
    await testInfo.attach("signed-in after the OAuth return", {
      contentType: "image/png",
      path: screenshot,
    });
  });

  test("opening the app with a made-up one-time token does not sign in", async ({
    context,
    page,
  }) => {
    await page.goto("/login?handoff=made-up-nonce#ott=made-up-token");
    await page.getByTestId("login-screen").waitFor({state: "visible"});

    const landed = new URL(page.url());
    expect(landed.hash).not.toContain("ott=");
    expect(landed.searchParams.has("handoff")).toBe(false);
    expect(traffic.verifyRequests, "an unsolicited token is never sent").toBe(0);
    expect(await storedBearer(page)).toBeNull();
    expect(await betterAuthSessionCookies(context)).toEqual([]);
  });

  test("user sees an error when the provider is not available", async ({page}) => {
    // The server's start endpoint refuses the provider and sends the page back to /login.
    const start = new URL(`${CROSS_SITE_API_URL}${HANDOFF_START_PATH}`);
    start.searchParams.set("provider", "not-a-provider");
    start.searchParams.set("callbackURL", "http://localhost:8082/login");
    await page.goto(start.toString());

    await page.getByTestId("login-screen").waitFor({state: "visible"});
    await expect(page.getByTestId("login-screen-error")).toContainText("not available");
  });
});
