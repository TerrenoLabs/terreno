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
 * The sign-in steps drive the example login screen: the two-factor challenge screen
 * (`two-factor-challenge`) and the login screen's passkey button come from the example login
 * wiring (T22). Passkey registration is setup, so it runs in the page against the API with the
 * stored-header protocol, through a CDP virtual authenticator.
 */
import {randomUUID} from "node:crypto";
import type {APIRequestContext, BrowserContext, Page, Request} from "@playwright/test";
import {expect, test} from "./fixtures/test";
import {
  BEARER_TOKEN_KEY,
  betterAuthCookies,
  CROSS_SITE_API_URL,
  stripApiCookies,
} from "./helpers/crossSiteApi";
import {totpCode, totpSecretFromURI} from "./helpers/totp";

const FRONTEND_ORIGIN = "http://localhost:8082";
const CHALLENGE_HEADER = "X-Terreno-Auth-Challenge";
// Mirrors lib/betterAuth.ts's storage prefix and rtk's `${storagePrefix}_auth_challenge` key.
const CHALLENGE_KEY = "terreno-example_auth_challenge";
const PASSWORD = "ChallengePassword123!";

interface ChallengeUser {
  bearer: string;
  email: string;
}

/** Waits for the next POST to a Better Auth path on the API. */
const waitForAuthPost = (page: Page, path: string): Promise<Request> =>
  page.waitForRequest(
    (apiRequest) =>
      apiRequest.method() === "POST" &&
      apiRequest.url().startsWith(`${CROSS_SITE_API_URL}/api/auth${path}`)
  );

/** Signs up a new user through the API and returns its bearer token. */
const signUp = async (api: APIRequestContext, label: string): Promise<ChallengeUser> => {
  const email = `e2e-${label}-${randomUUID()}@terreno.dev`;
  const response = await api.post(`${CROSS_SITE_API_URL}/api/auth/sign-up/email`, {
    data: {email, name: "Challenge User", password: PASSWORD},
  });
  expect(response.ok(), `sign-up answered ${response.status()}`).toBe(true);
  const bearer = response.headers()["set-auth-token"];
  expect(bearer, "sign-up returns a bearer token").toBeTruthy();
  return {bearer, email};
};

/** Turns on TOTP two-factor for the user, as the Security screen does, and returns the secret. */
const enrollTwoFactor = async (api: APIRequestContext, user: ChallengeUser): Promise<Buffer> => {
  const headers = {authorization: `Bearer ${user.bearer}`};
  const enable = await api.post(`${CROSS_SITE_API_URL}/api/auth/two-factor/enable`, {
    data: {password: PASSWORD},
    headers,
  });
  expect(enable.ok(), `two-factor enable answered ${enable.status()}`).toBe(true);
  const secret = totpSecretFromURI(((await enable.json()) as {totpURI: string}).totpURI);
  const confirm = await api.post(`${CROSS_SITE_API_URL}/api/auth/two-factor/verify-totp`, {
    data: {code: totpCode(secret)},
    headers,
  });
  expect(confirm.ok(), `two-factor confirm answered ${confirm.status()}`).toBe(true);
  return secret;
};

/**
 * Adds a CDP virtual platform authenticator that answers every WebAuthn prompt at once, as a
 * user approving with a fingerprint would.
 */
const addVirtualAuthenticator = async (context: BrowserContext, page: Page): Promise<void> => {
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      automaticPresenceSimulation: true,
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      protocol: "ctap2",
      transport: "internal",
    },
  });
};

/**
 * Registers a passkey for the user from the page (so the credential lands in the virtual
 * authenticator and the WebAuthn origin is the app's), with no cookies: the bearer carries the
 * session and the challenge header carries the registration challenge.
 */
const registerPasskeyInPage = async (page: Page, user: ChallengeUser): Promise<number> => {
  return page.evaluate(
    async ({apiURL, bearer, header}): Promise<number> => {
      const toBytes = (value: string): Uint8Array => {
        const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
        const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
        return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
      };
      const toBase64URL = (buffer: ArrayBuffer): string =>
        btoa(String.fromCharCode(...new Uint8Array(buffer)))
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/, "");
      const authorization = `Bearer ${bearer}`;
      const optionsResponse = await fetch(`${apiURL}/api/auth/passkey/generate-register-options`, {
        credentials: "omit",
        headers: {authorization, [header]: "-"},
      });
      const challenge = optionsResponse.headers.get(header) ?? "";
      const options = await optionsResponse.json();
      const credential = (await navigator.credentials.create({
        publicKey: {
          ...options,
          challenge: toBytes(options.challenge),
          excludeCredentials: (options.excludeCredentials ?? []).map(
            (excluded: {id: string; type: "public-key"}) => ({
              ...excluded,
              id: toBytes(excluded.id),
            })
          ),
          user: {...options.user, id: toBytes(options.user.id)},
        },
      })) as PublicKeyCredential;
      const attestation = credential.response as AuthenticatorAttestationResponse;
      const verify = await fetch(`${apiURL}/api/auth/passkey/verify-registration`, {
        body: JSON.stringify({
          name: "E2E passkey",
          response: {
            clientExtensionResults: credential.getClientExtensionResults(),
            id: credential.id,
            rawId: toBase64URL(credential.rawId),
            response: {
              attestationObject: toBase64URL(attestation.attestationObject),
              clientDataJSON: toBase64URL(attestation.clientDataJSON),
              transports: attestation.getTransports(),
            },
            type: credential.type,
          },
        }),
        credentials: "omit",
        headers: {authorization, "content-type": "application/json", [header]: challenge},
        method: "POST",
      });
      return verify.status;
    },
    {apiURL: CROSS_SITE_API_URL, bearer: user.bearer, header: CHALLENGE_HEADER}
  );
};

/** Waits for the signed-in app: the tabs root, or the consent forms a new user sees first. */
const waitForSignedIn = async (page: Page): Promise<void> => {
  await page
    .locator('[data-testid="todos-screen"], [data-testid="consent-form-footer"]')
    .first()
    .waitFor({state: "visible"});
};

const storedValue = (page: Page, key: string): Promise<string | null> =>
  page.evaluate((storageKey) => localStorage.getItem(storageKey), key);

test.describe("Cross-site challenges without cookies", () => {
  // A cold cross-site bundle load plus a full sign-in ceremony.
  test.slow();

  let api: APIRequestContext;

  test.beforeEach(async ({context, playwright}) => {
    await stripApiCookies(context);
    // Better Auth checks the Origin of any request that carries a cookie.
    api = await playwright.request.newContext({extraHTTPHeaders: {origin: FRONTEND_ORIGIN}});
  });

  test.afterEach(async () => {
    await api.dispose();
  });

  // Enabled by T22 (example login wires 2FA and passkey).
  test.fixme("user with 2FA completes the challenge", async ({context, page}) => {
    const user = await signUp(api, "two-factor");
    const secret = await enrollTwoFactor(api, user);

    await page.goto("/login");
    await page.getByTestId("login-screen").waitFor({state: "visible"});
    await page.getByTestId("login-screen-email-input").fill(user.email);
    await page.getByTestId("login-screen-password-input").fill(PASSWORD);
    await page.getByTestId("login-screen-submit-button").click();

    // T22: the example routes a sign-in that needs a second factor to its challenge screen.
    await page.getByTestId("two-factor-challenge").waitFor({state: "visible"});
    const challenge = new URLSearchParams((await storedValue(page, CHALLENGE_KEY)) ?? "");
    expect(
      Array.from(challenge.keys()).some((name) => name.endsWith("two_factor")),
      "the client stores the two-factor challenge from the sign-in response"
    ).toBe(true);
    // The challenge screen submits on its own once the last digit is typed, so nothing is
    // clicked: a click after the auto-submit would send a second, already-spent verify.
    const verifyRequest = waitForAuthPost(page, "/two-factor/verify-totp");
    await page.getByTestId("two-factor-challenge-otp-cell-1").click();
    await page.keyboard.type(totpCode(secret));
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

  // Enabled by T22 (example login wires 2FA and passkey).
  test.fixme("user signs in with a passkey", async ({context, page}) => {
    const user = await signUp(api, "passkey");
    await addVirtualAuthenticator(context, page);
    await page.goto("/login");
    await page.getByTestId("login-screen").waitFor({state: "visible"});
    expect(await registerPasskeyInPage(page, user), "passkey registration status").toBe(200);
    const verifyRequest = waitForAuthPost(page, "/passkey/verify-authentication");

    // T22: the example login screen offers passkey sign-in when the server enables passkeys.
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
