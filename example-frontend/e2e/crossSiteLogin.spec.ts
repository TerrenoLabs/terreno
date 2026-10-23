/**
 * What the example login screen remembers on this device: the last used method and the
 * "Continue as" cards (TerrenoLoginScreen with `rememberIdentity`), for social and passkey
 * sign-ins.
 *
 * Runs in the cross-site bearer run (playwright.config.ts), which starts the mock OIDC provider.
 * The page and the API are on different sites and API responses lose `set-cookie`, so nothing
 * here can come from a backend cookie such as Better Auth's `last_used_login_method`: the badge
 * and the cards come from the remembered-accounts store in the page's own storage.
 */
import type {APIRequestContext, BrowserContext} from "@playwright/test";
import {expect, test} from "./fixtures/test";
import {setBetterAuthEmailVerified} from "./helpers/adminAuth";
import {
  type ApiUser,
  addVirtualAuthenticator,
  disablePasskeyAutofill,
  newAuthApiContext,
  openLoginScreen,
  registerPasskeyInPage,
  signOutFromProfile,
  signUpApiUser,
} from "./helpers/authFlows";
import {betterAuthSessionCookies, stripApiCookies} from "./helpers/crossSiteApi";
import {waitForSignedIn} from "./helpers/login";
import {setMockOidcIdentity} from "./helpers/mockOidcProvider";

const MOCK_OIDC_BUTTON = "login-screen-oauth-mock-oidc";

test.describe("Remembered sign-ins on this device", () => {
  // Each test reloads the cross-site bundle several times (provider round trips, sign-out).
  test.slow();

  let api: APIRequestContext;

  test.beforeEach(async ({context, playwright}) => {
    await stripApiCookies(context);
    api = await newAuthApiContext(playwright);
  });

  test.afterEach(async () => {
    await api.dispose();
  });

  /**
   * A verified email account the mock provider signs in to (verified-email linking joins them),
   * so the app opens on the todos screen rather than a new user's consent forms.
   */
  const providerAccount = async (context: BrowserContext, label: string): Promise<ApiUser> => {
    const user = await signUpApiUser(api, {label, name: "Remembered Person"});
    await setBetterAuthEmailVerified(user.email);
    await setMockOidcIdentity(context, {email: user.email, emailVerified: true});
    return user;
  };

  test("user sees last used method after signing out", async ({context, page}, testInfo) => {
    await providerAccount(context, "last-used");
    await openLoginScreen(page);
    await expect(page.getByTestId("login-screen-accounts")).toHaveCount(0);

    await page.getByTestId(MOCK_OIDC_BUTTON).click();
    await page.getByTestId("todos-screen").first().waitFor({state: "visible"});
    await signOutFromProfile(page);

    await expect(page.getByTestId("login-screen-last-used-mock-oidc")).toBeVisible();
    // Both render in the cross-site run, where no backend cookie can be read.
    await expect(page.getByTestId("login-screen-continue-0")).toContainText("Remembered Person");
    expect(await betterAuthSessionCookies(context)).toEqual([]);
    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath("login-last-used-and-continue.png"),
    });
  });

  test("user continues as a remembered account", async ({context, page}) => {
    await providerAccount(context, "continue-as");
    await openLoginScreen(page);
    await page.getByTestId(MOCK_OIDC_BUTTON).click();
    await page.getByTestId("todos-screen").first().waitFor({state: "visible"});
    await signOutFromProfile(page);

    // The card signs in again with the remembered method, the mock provider.
    await page.getByTestId("login-screen-continue-0").click();

    await page.getByTestId("todos-screen").first().waitFor({state: "visible"});
  });

  test("user can forget a remembered account", async ({context, page}) => {
    await providerAccount(context, "forget");
    await openLoginScreen(page);
    await page.getByTestId(MOCK_OIDC_BUTTON).click();
    await page.getByTestId("todos-screen").first().waitFor({state: "visible"});
    await signOutFromProfile(page);

    await page.getByTestId("login-screen-forget-0").click();

    await expect(page.getByTestId("login-screen-continue-0")).toHaveCount(0);
    await expect(page.getByTestId("login-screen-last-used-mock-oidc")).toHaveCount(0);
  });

  test("user signs in with a passkey", async ({context, page}) => {
    // The button's ceremony alone: no autofill ceremony runs beside it.
    await disablePasskeyAutofill(page);
    const user = await signUpApiUser(api, {label: "passkey-login"});
    await addVirtualAuthenticator(context, page);
    await openLoginScreen(page);
    expect(await registerPasskeyInPage(page, user), "passkey registration status").toBe(200);

    await page.getByTestId("login-screen-passkey-button").click();
    await waitForSignedIn(page);
    await signOutFromProfile(page);

    await expect(page.getByTestId("login-screen-last-used-passkey")).toBeVisible();
    await expect(page.getByTestId("login-screen-continue-0")).toBeVisible();
  });

  test("user signs in with a saved passkey from autofill", async ({context, page}) => {
    const user = await signUpApiUser(api, {label: "passkey-autofill"});
    await addVirtualAuthenticator(context, page);
    // Registered on another public page, so no login-screen ceremony is pending.
    await page.goto("/signup");
    await page.getByTestId("signup-screen").waitFor({state: "visible"});
    expect(await registerPasskeyInPage(page, user), "passkey registration status").toBe(200);

    // The login screen offers saved passkeys in the email field's autofill; the virtual
    // authenticator picks the only one, as a user choosing it would. Nothing is clicked.
    await page.goto("/login");

    await page.getByTestId("todos-screen").first().waitFor({state: "visible"});
  });
});
