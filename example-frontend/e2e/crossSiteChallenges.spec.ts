/**
 * Two-factor and passkey sign-in for a cross-site web app with no cookies.
 *
 * playwright.config.ts runs this spec in the cross-site bearer project: the web app at
 * localhost:8082 calls the API at 127.0.0.1:4000 with `EXPO_PUBLIC_BETTER_AUTH_WEB_BEARER=true`,
 * and every API response loses `set-cookie` before the browser sees it. Better Auth keeps the
 * two-factor and passkey challenges in signed cookies, so these flows finish only because
 * @terreno/api copies those cookies into `X-Terreno-Auth-Challenge` and rtk's bearer mode stores
 * the header beside the bearer token and sends it back.
 *
 * The sign-in steps drive the example login screen (TerrenoLoginScreen): its inline two-factor
 * challenge (`two-factor-challenge`) and its passkey button. Passkey registration is setup, so it
 * runs in the page against the API with the stored-header protocol, through a CDP virtual
 * authenticator (helpers/authFlows.ts).
 */
import type {APIRequestContext, Page, Request} from "@playwright/test";
import {expect, test} from "./fixtures/test";
import {
  AUTH_API_URL,
  addVirtualAuthenticator,
  CHALLENGE_HEADER,
  disablePasskeyAutofill,
  enrollTwoFactor,
  newAuthApiContext,
  registerPasskeyInPage,
  signUpApiUser,
} from "./helpers/authFlows";
import {BEARER_TOKEN_KEY, betterAuthCookies, stripApiCookies} from "./helpers/crossSiteApi";
import {waitForSignedIn} from "./helpers/login";
import {totpCode, totpSecretFromBase32} from "./helpers/totp";

// Mirrors lib/betterAuth.ts's storage prefix and rtk's `${storagePrefix}_auth_challenge` key.
const CHALLENGE_KEY = "terreno-example_auth_challenge";

/** Waits for the next POST to a Better Auth path on the API. */
const waitForAuthPost = (page: Page, path: string): Promise<Request> =>
  page.waitForRequest(
    (apiRequest) =>
      apiRequest.method() === "POST" &&
      apiRequest.url().startsWith(`${AUTH_API_URL}/api/auth${path}`)
  );

const storedValue = (page: Page, key: string): Promise<string | null> =>
  page.evaluate((storageKey) => localStorage.getItem(storageKey), key);

test.describe("Cross-site challenges without cookies", () => {
  // A cold cross-site bundle load plus a full sign-in ceremony.
  test.slow();

  let api: APIRequestContext;

  test.beforeEach(async ({context, playwright}) => {
    await stripApiCookies(context);
    // Better Auth checks the Origin of any request that carries a cookie.
    api = await newAuthApiContext(playwright);
  });

  test.afterEach(async () => {
    await api.dispose();
  });

  test("user with 2FA completes the challenge", async ({context, page}) => {
    const user = await enrollTwoFactor(api, await signUpApiUser(api, {label: "two-factor"}));

    await page.goto("/login");
    await page.getByTestId("login-screen").waitFor({state: "visible"});
    await page.getByTestId("login-screen-email-input").fill(user.email);
    await page.getByTestId("login-screen-password-input").fill(user.password);
    await page.getByTestId("login-screen-submit-button").click();

    // The login screen shows the challenge inline when the sign-in needs a second factor.
    await page.getByTestId("two-factor-challenge").waitFor({state: "visible"});
    const challenge = new URLSearchParams((await storedValue(page, CHALLENGE_KEY)) ?? "");
    expect(
      Array.from(challenge.keys()).some((name) => name.endsWith("two_factor")),
      "the client stores the two-factor challenge from the sign-in response"
    ).toBe(true);
    // The code goes into the first cell at once, as a paste does, and the challenge submits on
    // its own, so nothing is clicked: a click after the auto-submit would send a second,
    // already-spent verify.
    const verifyRequest = waitForAuthPost(page, "/two-factor/verify-totp");
    await page
      .getByTestId("two-factor-challenge-otp-cell-1")
      .fill(totpCode(totpSecretFromBase32(user.totpSecret)));
    const verify = await verifyRequest;

    await waitForSignedIn(page);
    expect(
      await verify.headerValue(CHALLENGE_HEADER),
      "verify sends the stored challenge"
    ).toContain("two_factor");
    expect(await storedValue(page, BEARER_TOKEN_KEY), "verify stores the bearer").toBeTruthy();
    const remaining = (await storedValue(page, CHALLENGE_KEY)) ?? "";
    expect(remaining, "a finished challenge is forgotten").not.toContain("two_factor");
    expect(await betterAuthCookies(context)).toEqual([]);
  });

  test("user signs in with a passkey", async ({context, page}) => {
    // The button's ceremony alone: no autofill ceremony runs beside it.
    await disablePasskeyAutofill(page);
    const user = await signUpApiUser(api, {label: "passkey"});
    await addVirtualAuthenticator(context, page);
    await page.goto("/login");
    await page.getByTestId("login-screen").waitFor({state: "visible"});
    expect(await registerPasskeyInPage(page, user), "passkey registration status").toBe(200);
    const verifyRequest = waitForAuthPost(page, "/passkey/verify-authentication");

    // The login screen offers passkey sign-in when the server enables passkeys.
    await page.getByTestId("login-screen-passkey-button").click();
    const verify = await verifyRequest;

    await waitForSignedIn(page);
    expect(
      await verify.headerValue(CHALLENGE_HEADER),
      "verify sends the stored passkey challenge"
    ).toContain("passkey");
    expect(
      await storedValue(page, BEARER_TOKEN_KEY),
      "passkey sign-in stores the bearer"
    ).toBeTruthy();
    expect(await betterAuthCookies(context)).toEqual([]);
  });
});
