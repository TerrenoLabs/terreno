/**
 * Setup steps the auth-experience specs share: users made through the API, two-factor
 * enrollment, passkeys registered through a CDP virtual authenticator, and the waits around the
 * login screen. The API calls send no cookies; the bearer token carries the session.
 */
import {randomUUID} from "node:crypto";
import {type APIRequestContext, type BrowserContext, expect, type Page} from "@playwright/test";
import type {E2EUser} from "../fixtures/testUsers";
import {acceptPendingConsentForms} from "./consentForms";
import {base32TotpSecretFromURI, totpCode, totpSecretFromBase32} from "./totp";

/** The web app's origin. Better Auth checks the Origin of requests that carry a cookie. */
const FRONTEND_ORIGIN = "http://localhost:8082";

/**
 * The API the web app calls: 127.0.0.1 in the cross-site bearer run (another site than the app),
 * localhost in the cookie-mode run. playwright.config.ts sets `E2E_CROSS_SITE_BEARER` for both
 * the runner and its workers.
 */
export const AUTH_API_URL =
  process.env.E2E_CROSS_SITE_BEARER === "true" ? "http://127.0.0.1:4000" : "http://localhost:4000";

/** Header @terreno/api carries Better Auth's two-factor and passkey challenge cookies in. */
export const CHALLENGE_HEADER = "X-Terreno-Auth-Challenge";

const DEFAULT_PASSWORD = "AuthFlowPassword123!";

/** A user made through the API, with the bearer token its sign-up returned. */
export interface ApiUser extends E2EUser {
  bearer: string;
}

/** A user with TOTP two-factor on. */
export interface TwoFactorUser extends ApiUser {
  totpSecret: string;
  /** The single-use backup codes enrollment returned. */
  backupCodes: string[];
}

/** An API context that sends the web app's Origin, as the browser would. */
export const newAuthApiContext = (playwright: {
  request: {
    newContext: (options: {extraHTTPHeaders: Record<string, string>}) => Promise<APIRequestContext>;
  };
}): Promise<APIRequestContext> =>
  playwright.request.newContext({extraHTTPHeaders: {origin: FRONTEND_ORIGIN}});

/** A unique e2e email, so parallel runs and reruns never meet an earlier account. */
const uniqueEmail = (label: string): string => `e2e-${label}-${randomUUID()}@terreno.dev`;

/**
 * Signs up a new user by email through the API. With `acceptConsents` (the default) it also
 * agrees to every pending consent form, so the app opens on the todos screen after sign-in.
 */
export const signUpApiUser = async (
  api: APIRequestContext,
  {
    acceptConsents = true,
    email,
    label = "user",
    name = "Auth Flow User",
    password = DEFAULT_PASSWORD,
  }: {
    acceptConsents?: boolean;
    email?: string;
    label?: string;
    name?: string;
    password?: string;
  } = {}
): Promise<ApiUser> => {
  const userEmail = email ?? uniqueEmail(label);
  const response = await api.post(`${AUTH_API_URL}/api/auth/sign-up/email`, {
    data: {email: userEmail, name, password},
  });
  expect(response.ok(), `sign-up answered ${response.status()}`).toBe(true);
  const bearer = response.headers()["set-auth-token"];
  expect(bearer, "sign-up returns a bearer token").toBeTruthy();
  if (acceptConsents) {
    await acceptPendingConsentForms(api, bearer, {apiUrl: AUTH_API_URL});
  }
  return {bearer, email: userEmail, name, password};
};

/**
 * Turns on TOTP two-factor for the user, as the Security screen does, and returns the user with
 * its base32 `totpSecret` and backup codes.
 */
export const enrollTwoFactor = async (
  api: APIRequestContext,
  user: ApiUser
): Promise<TwoFactorUser> => {
  const headers = {authorization: `Bearer ${user.bearer}`};
  const enable = await api.post(`${AUTH_API_URL}/api/auth/two-factor/enable`, {
    data: {password: user.password},
    headers,
  });
  expect(enable.ok(), `two-factor enable answered ${enable.status()}`).toBe(true);
  const enabled = (await enable.json()) as {backupCodes?: string[]; totpURI: string};
  const totpSecret = base32TotpSecretFromURI(enabled.totpURI);
  const confirm = await api.post(`${AUTH_API_URL}/api/auth/two-factor/verify-totp`, {
    data: {code: totpCode(totpSecretFromBase32(totpSecret))},
    headers,
  });
  expect(confirm.ok(), `two-factor confirm answered ${confirm.status()}`).toBe(true);
  return {...user, backupCodes: enabled.backupCodes ?? [], totpSecret};
};

/** The API's `/auth/me` user id for a bearer token. */
export const appUserIdFor = async (api: APIRequestContext, bearer: string): Promise<string> => {
  const me = await api.get(`${AUTH_API_URL}/auth/me`, {
    headers: {authorization: `Bearer ${bearer}`},
  });
  expect(me.ok(), `/auth/me answered ${me.status()}`).toBe(true);
  const body = (await me.json()) as {data?: {_id?: string; id?: string}};
  return body.data?.id ?? body.data?._id ?? "";
};

/**
 * Adds a CDP virtual platform authenticator that answers every WebAuthn prompt at once, as a
 * user approving with a fingerprint would.
 */
export const addVirtualAuthenticator = async (
  context: BrowserContext,
  page: Page
): Promise<void> => {
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
 * Makes the browser report no passkey autofill (conditional mediation), so the login screen
 * starts no background ceremony. A pending autofill ceremony refuses a passkey registration in
 * the same page ("A request is already pending"), and the virtual authenticator can answer it
 * alongside the passkey button's ceremony. Call before the page loads.
 */
export const disablePasskeyAutofill = async (page: Page): Promise<void> => {
  await page.addInitScript(() => {
    if (typeof window.PublicKeyCredential === "function") {
      window.PublicKeyCredential.isConditionalMediationAvailable = async (): Promise<boolean> =>
        false;
    }
  });
};

/**
 * Registers a passkey for the user from the page (so the credential lands in the virtual
 * authenticator and the WebAuthn origin is the app's), with no cookies: the bearer carries the
 * session and the challenge header carries the registration challenge. Returns the verify
 * response's status.
 */
export const registerPasskeyInPage = async (page: Page, user: ApiUser): Promise<number> => {
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
    {apiURL: AUTH_API_URL, bearer: user.bearer, header: CHALLENGE_HEADER}
  );
};

/** Opens /login and waits for the form (past the screen's live-session check). */
export const openLoginScreen = async (page: Page): Promise<void> => {
  await page.goto("/login");
  await page.getByTestId("login-screen").waitFor({state: "visible"});
};

/** Signs out from the profile screen and waits for the login form. */
export const signOutFromProfile = async (page: Page): Promise<void> => {
  await page.goto("/profile");
  const logout = page.getByTestId("profile-logout-button").first();
  await logout.waitFor({state: "visible"});
  await logout.click();
  await page.getByTestId("login-screen").waitFor({state: "visible"});
};
