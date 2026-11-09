/**
 * Smoke test for a deployed example-frontend web build in Better Auth bearer mode.
 *
 * playwright.smoke.config.ts runs only this file, against the already-running site at
 * `SMOKE_BASE_URL` (CircleCI: the PR's Netlify preview, which calls the PR's own Cloud Run
 * backend). Nothing here starts servers or touches cookies: the real browser talks to the real
 * API on another site, so a build that fell back to cookie mode, or a backend that refuses the
 * preview origin, fails here. It never runs against production, because it signs up a new user.
 *
 * Optional `SMOKE_API_URL` names the API the build must call; the spec fails when the app calls
 * another one (for example a preview built against the production backend).
 */
import {randomUUID} from "node:crypto";
import {expect, request, test} from "@playwright/test";
import {acceptPendingConsentForms} from "./helpers/consentForms";
import {BEARER_TOKEN_KEY, betterAuthSessionCookies} from "./helpers/crossSiteApi";

const SMOKE_BASE_URL = process.env.SMOKE_BASE_URL;
if (!SMOKE_BASE_URL) {
  throw new Error(
    "SMOKE_BASE_URL is required, e.g. https://pr-123--terreno-frontend.netlify.app or http://localhost:8082"
  );
}

// example-backend serves Better Auth at its default base path.
const BETTER_AUTH_BASE_PATH = "/api/auth";
const SIGN_UP_PATH = "/sign-up/email";
const SMOKE_PASSWORD = "SmokeTestPassword123!";

// A Cloud Run preview scales to zero, so the first API calls can wait on a cold start.
const API_TIMEOUT = 60_000;

test.describe("Deployed web bearer sign-in", () => {
  test("user signs up and stays signed in across a reload with no session cookie", async ({
    context,
    page,
  }, testInfo) => {
    const runId = process.env.SMOKE_RUN_ID ?? randomUUID().slice(0, 8);
    // A retry signs up a new user rather than colliding with the first attempt's.
    const email = `smoke-${runId}-${testInfo.retry}@example.com`;

    await page.goto("/signup");
    await page.getByTestId("signup-screen").waitFor({state: "visible"});
    await page.getByTestId("signup-screen-name-input").fill("Smoke Test User");
    await page.getByTestId("signup-screen-email-input").fill(email);
    await page.getByTestId("signup-screen-password-input").fill(SMOKE_PASSWORD);

    const signUpResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname.endsWith(SIGN_UP_PATH),
      {timeout: API_TIMEOUT}
    );
    await page.getByTestId("signup-screen-submit-button").click();
    const signUp = await signUpResponse;
    expect(signUp.ok(), `sign-up answered ${signUp.status()}`).toBe(true);

    const apiOrigin = new URL(signUp.url()).origin;
    expect(apiOrigin, "the app calls an API on another origin").not.toBe(
      new URL(SMOKE_BASE_URL).origin
    );
    if (process.env.SMOKE_API_URL) {
      expect(apiOrigin, "the build calls the API it was deployed with").toBe(
        new URL(process.env.SMOKE_API_URL).origin
      );
    }

    // A new user lands on the tabs root, or on the consent navigator when forms are pending.
    await page
      .getByTestId("todos-screen")
      .or(page.getByTestId("consent-form-footer"))
      .first()
      .waitFor({state: "visible", timeout: API_TIMEOUT});

    const bearer = await page.evaluate((key) => localStorage.getItem(key), BEARER_TOKEN_KEY);
    expect(bearer, "the web build stores the bearer token from sign-up").toBeTruthy();
    expect(await betterAuthSessionCookies(context, [apiOrigin])).toEqual([]);

    // Agree to the seeded consent forms (one asks for a signature) so the profile screen shows.
    const api = await request.newContext();
    try {
      await acceptPendingConsentForms(api, bearer ?? "", {apiUrl: apiOrigin});
      // The helper ignores failed responses; check none is left so a failure names its cause.
      const pending = await api.get(`${apiOrigin}/consents/pending`, {
        headers: {authorization: `Bearer ${bearer}`},
      });
      expect(pending.ok(), `pending consents answered ${pending.status()}`).toBe(true);
      const pendingBody = (await pending.json()) as {data?: unknown[]};
      expect(pendingBody.data ?? [], "every consent form is agreed to").toEqual([]);
    } finally {
      await api.dispose();
    }

    await page.reload();
    await page.getByTestId("todos-screen").waitFor({state: "visible", timeout: API_TIMEOUT});
    await page.goto("/profile");
    await expect(page.getByTestId("profile-logged-in-as").first()).toContainText(email, {
      timeout: API_TIMEOUT,
    });
    expect(await betterAuthSessionCookies(context, [apiOrigin])).toEqual([]);

    // The bearer build's social buttons navigate to the API's OAuth handoff start. With no
    // provider configured it sends the page back to the app with `error=provider_not_found`;
    // with one, it redirects to the provider. A 404 means the backend has no handoff.
    const returnURL = new URL("/login", SMOKE_BASE_URL).toString();
    const startURL = new URL(`${apiOrigin}${BETTER_AUTH_BASE_PATH}/oauth-handoff/start`);
    startURL.searchParams.set("provider", "google");
    startURL.searchParams.set("callbackURL", returnURL);
    startURL.searchParams.set("errorCallbackURL", returnURL);
    const startApi = await request.newContext();
    try {
      const start = await startApi.get(startURL.toString(), {maxRedirects: 0});
      expect(start.status(), "the Google button's start link redirects").toBeGreaterThanOrEqual(
        300
      );
      expect(start.status()).toBeLessThan(400);
      const location = new URL(start.headers().location ?? "", startURL);
      if (location.origin === new URL(SMOKE_BASE_URL).origin) {
        expect(location.pathname).toBe("/login");
        expect(location.searchParams.get("error")).toBe("provider_not_found");
      } else {
        expect(location.protocol, `redirects to the provider, got ${location}`).toBe("https:");
      }
    } finally {
      await startApi.dispose();
    }

    const screenshot = testInfo.outputPath("deployed-bearer-profile.png");
    await page.screenshot({fullPage: true, path: screenshot});
    await testInfo.attach("profile after the reload", {contentType: "image/png", path: screenshot});
  });
});
