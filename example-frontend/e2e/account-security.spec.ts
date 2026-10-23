/**
 * The example Security screen (app/settings/security.tsx, TerrenoAccountSecurityScreen): link and
 * unlink a provider, turn on two-factor and sign in with a saved backup code, add and remove a
 * passkey, sign out another session, and change the password.
 *
 * Runs in the cross-site bearer run (playwright.config.ts), which starts the mock OIDC provider
 * the linking cases need: the web app at localhost:8082 calls the API at 127.0.0.1:4000 with a
 * stored bearer token and no cookies. Each test signs up its own user through the API, signs in
 * through the login screen, and opens Security from the profile's `profile-security-link`.
 */
import {existsSync, mkdirSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import type {APIRequestContext, BrowserContext, Page, TestInfo} from "@playwright/test";
import {expect, test} from "./fixtures/test";
import {
  type ApiUser,
  AUTH_API_URL,
  addVirtualAuthenticator,
  disablePasskeyAutofill,
  newAuthApiContext,
  openLoginScreen,
  signOutFromProfile,
  signUpApiUser,
} from "./helpers/authFlows";
import {BEARER_TOKEN_KEY} from "./helpers/crossSiteApi";
import {loginAs, waitForSignedIn} from "./helpers/login";
import {setMockOidcIdentity} from "./helpers/mockOidcProvider";
import {totpCode, totpSecretFromBase32} from "./helpers/totp";

const MOCK_OIDC = "mock-oidc";

/**
 * Where screenshots are copied for PR evidence, besides the test's output directory: `E2E_SCREENSHOT_DIR`,
 * or the cloud agent artifacts folder when it exists. CI has neither and keeps only the output copy.
 */
const SCREENSHOT_COPY_DIR =
  process.env.E2E_SCREENSHOT_DIR ??
  (existsSync("/opt/cursor/artifacts") ? "/opt/cursor/artifacts/t23" : undefined);

/** Saves a full-page screenshot to the test's output directory and the evidence folder. */
const saveScreenshot = async (page: Page, testInfo: TestInfo, name: string): Promise<void> => {
  const image = await page.screenshot({fullPage: true, path: testInfo.outputPath(name)});
  if (!SCREENSHOT_COPY_DIR) {
    return;
  }
  mkdirSync(SCREENSHOT_COPY_DIR, {recursive: true});
  writeFileSync(join(SCREENSHOT_COPY_DIR, name), image);
};

/** The bearer token the page's Better Auth client stored. */
const storedBearer = async (page: Page): Promise<string> =>
  (await page.evaluate((key) => localStorage.getItem(key), BEARER_TOKEN_KEY)) ?? "";

interface PageApiResult {
  status: number;
  body: unknown;
}

/**
 * Calls the API from the page the way the app does: with a bearer token and no cookies. (A
 * Playwright request context would keep Better Auth's five-minute session cookie cache, which
 * outlives a revoked session.)
 */
const fetchFromPage = (page: Page, path: string, bearer: string): Promise<PageApiResult> =>
  page.evaluate(
    async ({apiURL, requestPath, token}): Promise<PageApiResult> => {
      const response = await fetch(`${apiURL}${requestPath}`, {
        credentials: "omit",
        headers: {authorization: `Bearer ${token}`},
      });
      const text = await response.text();
      return {body: text ? JSON.parse(text) : null, status: response.status};
    },
    {apiURL: AUTH_API_URL, requestPath: path, token: bearer}
  );

/** Waits until the Security screen has loaded every card. */
const waitForSecurityScreen = async (page: Page): Promise<void> => {
  await page.getByTestId("security-screen").waitFor({state: "visible"});
  await expect(page.getByTestId("security-screen-loading")).toHaveCount(0);
  await page.getByTestId("sessions-card").waitFor({state: "visible"});
};

/** Opens Security the way a user does: Profile, then its Security link. */
const openSecurityFromProfile = async (page: Page): Promise<void> => {
  await page.goto("/profile");
  const link = page.getByTestId("profile-security-link");
  await link.waitFor({state: "visible"});
  await link.click();
  await waitForSecurityScreen(page);
};

/**
 * Links the mock provider from the Linked accounts card. The page leaves for the provider and
 * comes back to the Security screen, which then lists the provider as linked.
 */
const linkMockProvider = async (
  context: BrowserContext,
  page: Page,
  user: ApiUser
): Promise<string> => {
  // Better Auth links only a provider account with the user's own email. The subject names the
  // provider account, so the test can find the exact account that was linked.
  const sub = `security-${user.email}`;
  await setMockOidcIdentity(context, {email: user.email, emailVerified: true, sub});
  // The page is already on /settings/security, so wait for the document the link returns with.
  const returned = page.waitForResponse(
    (response) =>
      response.request().isNavigationRequest() &&
      new URL(response.url()).pathname === "/settings/security"
  );
  await page.getByTestId(`linked-accounts-card-link-${MOCK_OIDC}`).click();
  await returned;
  // The returned page loads the bundle again before it lists the accounts.
  await expect(page.getByTestId(`linked-accounts-card-unlink-${MOCK_OIDC}`)).toBeVisible({
    timeout: 60_000,
  });
  await waitForSecurityScreen(page);
  return sub;
};

/** Fills the login form and submits it. */
const submitLoginForm = async (page: Page, email: string, password: string): Promise<void> => {
  await openLoginScreen(page);
  await page.getByTestId("login-screen-email-input").fill(email);
  await page.getByTestId("login-screen-password-input").fill(password);
  await page.getByTestId("login-screen-submit-button").click();
};

test.describe("Account security", () => {
  // A cold cross-site bundle load, a sign-in, and several reloads per test.
  test.slow();

  let api: APIRequestContext;
  let user: ApiUser;

  test.beforeEach(async ({page, playwright}) => {
    // The login screen's background passkey autofill would hold the WebAuthn request that adding
    // a passkey needs.
    await disablePasskeyAutofill(page);
    api = await newAuthApiContext(playwright);
    user = await signUpApiUser(api, {label: "security", name: "Security Person"});
    await loginAs(page, user);
    await openSecurityFromProfile(page);
  });

  test.afterEach(async () => {
    await api.dispose();
  });

  test("user links the mock provider and sees it listed", async ({context, page}, testInfo) => {
    await expect(page.getByTestId(`linked-accounts-card-status-${MOCK_OIDC}`)).toHaveText(
      "Not linked"
    );

    const sub = await linkMockProvider(context, page, user);

    // Better Auth's account list has no email, so the row shows the linked date.
    await expect(page.getByTestId(`linked-accounts-card-status-${MOCK_OIDC}`)).toHaveText(
      /^Linked [A-Z][a-z]{2} \d{1,2}, \d{4}$/
    );
    await expect(page.getByTestId("linked-accounts-card-error")).toHaveCount(0);
    // The signed-in user now owns the provider account the mock provider signed in as.
    const accounts = await fetchFromPage(page, "/api/auth/list-accounts", await storedBearer(page));
    expect(accounts.status).toBe(200);
    expect(accounts.body).toEqual(
      expect.arrayContaining([expect.objectContaining({accountId: sub, providerId: MOCK_OIDC})])
    );
    await saveScreenshot(page, testInfo, "security-linked.png");
  });

  test("user unlinks the mock provider and still signs in with their password", async ({
    context,
    page,
  }, testInfo) => {
    // The password stays as a second way to sign in, so unlinking never removes the last one.
    await linkMockProvider(context, page, user);

    await page.getByTestId(`linked-accounts-card-unlink-${MOCK_OIDC}`).click();
    await page.getByTestId("linked-accounts-card-confirm-submit").click();

    await expect(page.getByTestId(`linked-accounts-card-status-${MOCK_OIDC}`)).toHaveText(
      "Not linked"
    );
    await expect(page.getByTestId(`linked-accounts-card-link-${MOCK_OIDC}`)).toBeVisible();
    await saveScreenshot(page, testInfo, "security-unlinked.png");

    await signOutFromProfile(page);
    await loginAs(page, user);
    await expect(page.getByTestId("todos-screen").filter({visible: true})).toBeVisible();
  });

  test("user turns on 2FA, saves backup codes, and signs in with a backup code", async ({
    page,
  }, testInfo) => {
    const card = "two-factor-settings-card";
    await expect(page.getByTestId(`${card}-status`)).toHaveText("Off");

    await page.getByTestId(`${card}-enable`).click();
    await page.getByTestId(`${card}-password`).fill(user.password);
    await page.getByTestId(`${card}-password-submit`).click();

    // The setup key is the authenticator secret, shown in groups for reading aloud.
    const secret = ((await page.getByTestId(`${card}-secret`).textContent()) ?? "").replace(
      /\s+/g,
      ""
    );
    expect(secret.length).toBeGreaterThan(0);
    await page.getByTestId(`${card}-next`).click();
    // The code goes into the first cell at once, as a paste does; the field verifies when full.
    await page.getByTestId(`${card}-otp-cell-1`).fill(totpCode(totpSecretFromBase32(secret)));

    await page.getByTestId(`${card}-backup-codes`).waitFor({state: "visible"});
    const backupCode = (
      (await page.getByTestId(`${card}-backup-code-1`).textContent()) ?? ""
    ).trim();
    expect(backupCode.length).toBeGreaterThan(0);
    await saveScreenshot(page, testInfo, "security-backup-codes.png");
    await page.getByTestId(`${card}-saved`).click();
    await page.getByTestId(`${card}-finish`).click();
    await expect(page.getByTestId(`${card}-status`)).toHaveText("On");

    await signOutFromProfile(page);
    await submitLoginForm(page, user.email, user.password);
    await page.getByTestId("two-factor-challenge").waitFor({state: "visible"});
    await page.getByTestId("two-factor-challenge-backup-toggle").click();
    await page.getByTestId("two-factor-challenge-backup-input").fill(backupCode);
    await page.getByTestId("two-factor-challenge-submit").click();

    await waitForSignedIn(page);
  });

  test("user adds a passkey and then removes it", async ({context, page}, testInfo) => {
    await addVirtualAuthenticator(context, page);
    const rows = page.getByTestId(/^passkeys-card-row-/);
    await expect(page.getByTestId("passkeys-card-empty")).toBeVisible();

    await page.getByTestId("passkeys-card-add").click();
    await page.getByTestId("passkeys-card-add-dialog-name").fill("E2E laptop");
    await page.getByTestId("passkeys-card-add-dialog-submit").click();

    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("E2E laptop");
    const rowTestID = (await rows.first().getAttribute("data-testid")) ?? "";
    const passkeyId = rowTestID.replace("passkeys-card-row-", "");
    await saveScreenshot(page, testInfo, "security-passkey.png");

    await page.getByTestId(`passkeys-card-remove-${passkeyId}`).click();
    await page.getByTestId("passkeys-card-confirm-submit").click();

    await expect(rows).toHaveCount(0);
    await expect(page.getByTestId("passkeys-card-empty")).toBeVisible();
  });

  test("user signs out another session, which then gets 401", async ({browser, page}, testInfo) => {
    // A second browser, signed in as the same user.
    const otherContext = await browser.newContext({baseURL: testInfo.project.use.baseURL});
    try {
      const otherPage = await otherContext.newPage();
      await loginAs(otherPage, user);
      // Read once, so the 401 below is for this exact token, not a missing one.
      const otherBearer = await storedBearer(otherPage);
      expect(otherBearer).not.toBe("");
      const otherSession = await fetchFromPage(otherPage, "/api/auth/get-session", otherBearer);
      const otherSessionId = (otherSession.body as {session: {id: string}}).session.id;
      expect((await fetchFromPage(otherPage, "/auth/me", otherBearer)).status).toBe(200);

      // The sessions card lists the new session after a reload.
      await page.reload();
      await waitForSecurityScreen(page);
      const otherRow = page.getByTestId(`sessions-card-row-${otherSessionId}`);
      await expect(otherRow).toBeVisible();
      await saveScreenshot(page, testInfo, "security-sessions.png");
      await page.getByTestId(`sessions-card-revoke-${otherSessionId}`).click();
      await expect(otherRow).toHaveCount(0);

      expect((await fetchFromPage(otherPage, "/auth/me", otherBearer)).status).toBe(401);
      // This browser stays signed in.
      expect((await fetchFromPage(page, "/auth/me", await storedBearer(page))).status).toBe(200);
    } finally {
      await otherContext.close();
    }
  });

  test("user changes the password, then signs in with the new one only", async ({
    consoleGuard,
    page,
  }, testInfo) => {
    // The refused sign-in with the old password answers 401, which the browser logs.
    consoleGuard.allow("Failed to load resource: the server responded with a status of 401");
    const newPassword = "ChangedPassword456!";

    await page.getByTestId("password-card-current").fill(user.password);
    await page.getByTestId("password-card-new").fill(newPassword);
    await page.getByTestId("password-card-confirm").fill(newPassword);
    await page.getByTestId("password-card-submit").click();
    await expect(page.getByTestId("password-card-success")).toBeVisible();
    await saveScreenshot(page, testInfo, "security-password.png");

    await signOutFromProfile(page);
    await submitLoginForm(page, user.email, user.password);
    await expect(page.getByTestId("login-screen-error")).toHaveText("Invalid email or password");

    await loginAs(page, {...user, password: newPassword});
    await expect(page.getByTestId("todos-screen").filter({visible: true})).toBeVisible();
  });
});
