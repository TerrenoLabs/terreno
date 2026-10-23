/**
 * Account linking from the example login screen: an email account and a sign-in with the mock
 * OIDC provider on the same email.
 *
 * Runs in the cross-site bearer run (playwright.config.ts), which starts the mock OIDC provider.
 * The backend's linking mode is `AUTH_ACCOUNT_LINKING`, default `verified-email`:
 * - verified-email: the provider sign-in joins the account once the account's email is verified.
 * - explicit: the provider sign-in is refused with `account_not_linked`, and the login screen
 *   says to sign in the usual way and link from Security. Those cases need a backend started
 *   with the mode, which Playwright's shared web server cannot switch per test, so they run only
 *   when the backend reports it:
 *   `E2E_ACCOUNT_LINKING=explicit bunx playwright test e2e/account-linking.spec.ts`. A stubbed
 *   `/terreno/methods` case covers the explicit guidance in every run.
 */
import type {APIRequestContext, Page, Route} from "@playwright/test";
import {expect, test} from "./fixtures/test";
import {setBetterAuthEmailVerified} from "./helpers/adminAuth";
import {
  type ApiUser,
  AUTH_API_URL,
  appUserIdFor,
  newAuthApiContext,
  openLoginScreen,
  signOutFromProfile,
  signUpApiUser,
} from "./helpers/authFlows";
import {BEARER_TOKEN_KEY} from "./helpers/crossSiteApi";
import {loginAs} from "./helpers/login";
import {setMockOidcIdentity} from "./helpers/mockOidcProvider";

const MOCK_OIDC_BUTTON = "login-screen-oauth-mock-oidc";
// The todo list fills once syncdb has started and pulled the user's todos after sign-in.
const TODO_SYNC_TIMEOUT = 30_000;

/** The backend's linking mode, from the public methods endpoint. */
const backendLinkingMode = async (api: APIRequestContext): Promise<string | undefined> => {
  const response = await api.get(`${AUTH_API_URL}/api/auth/terreno/methods`);
  if (!response.ok()) {
    return undefined;
  }
  const body = (await response.json()) as {accountLinking?: {mode?: string}};
  return body.accountLinking?.mode;
};

/** Creates a todo for the user through the API and returns its id. */
const createTodo = async (
  api: APIRequestContext,
  user: ApiUser,
  title: string
): Promise<string> => {
  const response = await api.post(`${AUTH_API_URL}/todos`, {
    data: {title},
    headers: {authorization: `Bearer ${user.bearer}`},
  });
  expect(response.ok(), `todo create answered ${response.status()}`).toBe(true);
  const body = (await response.json()) as {data: {_id?: string; id?: string}};
  return body.data._id ?? body.data.id ?? "";
};

const storedBearer = async (page: Page): Promise<string> =>
  (await page.evaluate((key) => localStorage.getItem(key), BEARER_TOKEN_KEY)) ?? "";

test.describe("Account linking", () => {
  // Each test reloads the cross-site bundle several times (provider round trips, sign-out).
  test.slow();
  // Tall enough that the todo list's first row renders below the todos screen's header cards;
  // the list is virtualized, so a row past the window is not in the page at all.
  test.use({viewport: {height: 1400, width: 1280}});

  let api: APIRequestContext;
  let linkingMode: string | undefined;

  test.beforeEach(async ({playwright}) => {
    api = await newAuthApiContext(playwright);
    linkingMode = await backendLinkingMode(api);
  });

  test.afterEach(async () => {
    await api.dispose();
  });

  test("user's email and mock-OAuth sign-ins land in one account", async ({
    context,
    page,
  }, testInfo) => {
    test.skip(linkingMode !== "verified-email", "needs AUTH_ACCOUNT_LINKING=verified-email");
    // 1. Sign up by email and verify it.
    const user = await signUpApiUser(api, {label: "linked", name: "Linked Person"});
    await setBetterAuthEmailVerified(user.email);
    const todoId = await createTodo(api, user, "Written before linking");
    const userId = await appUserIdFor(api, user.bearer);

    await loginAs(page, user);
    await expect(page.getByTestId(`todo-item-${todoId}`)).toBeVisible({timeout: TODO_SYNC_TIMEOUT});

    // 2. Sign out, then sign in with mock OAuth on the same email.
    await signOutFromProfile(page);
    await setMockOidcIdentity(context, {email: user.email, emailVerified: true});
    await page.getByTestId(MOCK_OIDC_BUTTON).click();

    // 3. The same todos show, for the same user.
    await expect(page.getByTestId(`todo-item-${todoId}`)).toBeVisible({timeout: TODO_SYNC_TIMEOUT});
    expect(await appUserIdFor(api, await storedBearer(page))).toBe(userId);
    await page.screenshot({fullPage: true, path: testInfo.outputPath("linked-account-todos.png")});
  });

  test("user with an unverified email is told to verify, then the same sign-in links", async ({
    context,
    page,
  }, testInfo) => {
    test.skip(linkingMode !== "verified-email", "needs AUTH_ACCOUNT_LINKING=verified-email");
    const user = await signUpApiUser(api, {label: "unverified-link"});
    const todoId = await createTodo(api, user, "Waiting for verification");
    const userId = await appUserIdFor(api, user.bearer);
    await setMockOidcIdentity(context, {email: user.email, emailVerified: true});

    await openLoginScreen(page);
    await page.getByTestId(MOCK_OIDC_BUTTON).click();

    const notice = page.getByTestId("login-screen-notice");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("Verify your email");
    await page.screenshot({fullPage: true, path: testInfo.outputPath("verify-to-link.png")});

    await setBetterAuthEmailVerified(user.email);
    await page.getByTestId(MOCK_OIDC_BUTTON).click();

    await expect(page.getByTestId(`todo-item-${todoId}`)).toBeVisible({timeout: TODO_SYNC_TIMEOUT});
    expect(await appUserIdFor(api, await storedBearer(page))).toBe(userId);
  });

  test("explicit linking mode shows the link guidance", async ({context, page}, testInfo) => {
    test.skip(
      linkingMode !== "explicit",
      "needs a backend started with E2E_ACCOUNT_LINKING=explicit"
    );
    const user = await signUpApiUser(api, {label: "explicit-link"});
    await setBetterAuthEmailVerified(user.email);

    // An email sign-in first, so the device remembers how this account signs in.
    await loginAs(page, user);
    await signOutFromProfile(page);
    await setMockOidcIdentity(context, {email: user.email, emailVerified: true});
    await page.getByTestId(MOCK_OIDC_BUTTON).click();

    const notice = page.getByTestId("login-screen-notice");
    await expect(notice).toContainText(
      "Sign in with email, then link this sign-in method from Security."
    );
    await page.screenshot({fullPage: true, path: testInfo.outputPath("explicit-link.png")});
  });

  test("explicit linking guidance shows for an account_not_linked return", async ({page}) => {
    // The page reads the linking mode from the methods endpoint, so a stubbed answer shows the
    // explicit-mode copy whatever mode this run's backend has.
    await page.route("**/api/auth/terreno/methods", async (route: Route): Promise<void> => {
      const origin = route.request().headers().origin ?? "http://localhost:8082";
      await route.fulfill({
        headers: {
          "access-control-allow-credentials": "true",
          "access-control-allow-headers": "*",
          "access-control-allow-origin": origin,
        },
        json: {
          accountLinking: {mode: "explicit"},
          emailPassword: true,
          multiSession: true,
          passkey: true,
          providers: ["mock-oidc"],
          signUp: true,
          twoFactor: true,
        },
      });
    });

    await page.goto("/login?error=account_not_linked");
    await page.getByTestId("login-screen").waitFor({state: "visible"});

    await expect(page.getByTestId("login-screen-notice")).toContainText(
      "then link this sign-in method from Security."
    );
    await expect(page.getByTestId("login-screen-error")).toHaveCount(0);
  });
});
