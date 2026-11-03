import type {Page, Route} from "@playwright/test";
import {expect, test} from "./fixtures/test";
import {TEST_USER} from "./fixtures/testUsers";
import {ensureLoggedOut, loginAs, showOtherSignInMethods} from "./helpers/login";

const METHODS_ROUTE = "**/api/auth/terreno/methods";

interface StubbedMethods {
  /** Resolves once the stubbed response has been sent. */
  answered: Promise<void>;
  /** Sends a held response; a no-op when the response is not held. */
  release: () => void;
}

// Answers the login screen's methods request with `providers`, optionally holding the response
// until `release()`. The API is on another origin, so the stub sends the CORS headers too.
const stubMethods = async (
  page: Page,
  providers: string[],
  {hold = false}: {hold?: boolean} = {}
): Promise<StubbedMethods> => {
  let release = (): void => {};
  const gate = hold
    ? new Promise<void>((resolve) => {
        release = resolve;
      })
    : Promise.resolve();
  let markAnswered = (): void => {};
  const answered = new Promise<void>((resolve) => {
    markAnswered = resolve;
  });
  await page.route(METHODS_ROUTE, async (route: Route): Promise<void> => {
    await gate;
    const origin = route.request().headers().origin ?? "http://localhost:8082";
    await route.fulfill({
      headers: {
        "access-control-allow-credentials": "true",
        "access-control-allow-origin": origin,
      },
      json: {
        accountLinking: {mode: "verified-email"},
        emailPassword: true,
        multiSession: false,
        passkey: false,
        providers,
        signUp: true,
        twoFactor: false,
      },
    });
    markAnswered();
  });
  return {answered, release: (): void => release()};
};

test.describe("Login", () => {
  test.beforeEach(async ({page}) => {
    await page.goto("/login");
    await page.getByTestId("login-screen").waitFor({state: "visible"});
  });

  test("login screen renders correctly", async ({page}) => {
    await expect(page.getByTestId("login-screen-email-input")).toBeVisible();
    await expect(page.getByTestId("login-screen-password-input")).toBeVisible();
    await expect(page.getByTestId("login-screen-submit-button")).toBeVisible();
    await expect(page.getByTestId("login-screen-signup-link")).toBeVisible();
    await expect(page.getByTestId("login-screen-forgot-password")).toBeVisible();
  });

  test("user can log in with valid credentials", async ({page}) => {
    await page.getByTestId("login-screen-email-input").fill(TEST_USER.email);
    await page.getByTestId("login-screen-password-input").fill(TEST_USER.password);
    await page.getByTestId("login-screen-submit-button").click();

    // After login the login screen is replaced — wait for it to be hidden.
    // Expo Router pre-renders (tabs) as initialRouteName, so todos-screen exists
    // twice in the DOM. Waiting for login-screen to hide is the reliable signal.
    await page.getByTestId("login-screen").first().waitFor({state: "hidden"});
  });

  test("shows error with invalid credentials", async ({page, consoleGuard}) => {
    // The login fetch is expected to return 401, which the browser logs.
    consoleGuard.allow("Failed to load resource: the server responded with a status of 401");
    // The RTK Query rejection surfaces as an unhandled pageerror whose body is
    // the API response object (no message/stack), so it renders as "Object".
    consoleGuard.allow(/^Object$/);
    await page.getByTestId("login-screen-email-input").fill("wrong@example.com");
    await page.getByTestId("login-screen-password-input").fill("wrongpassword");
    await page.getByTestId("login-screen-submit-button").click();

    const passwordError = page.getByTestId("login-screen-password-input.error");
    await passwordError.waitFor({state: "visible"});
    await expect(passwordError).toContainText(
      "That password doesn't match. Try again or reset it."
    );
  });

  test("navigates to signup screen", async ({page}) => {
    await page.getByTestId("login-screen-signup-link").click();
    await page.getByTestId("signup-screen").waitFor({state: "visible"});
  });

  test("navigates to forgot password screen", async ({page}) => {
    await page.getByTestId("login-screen-forgot-password").click();
    await page.getByTestId("forgot-password-screen").waitFor({state: "visible"});
    await expect(page.getByTestId("forgot-password-email")).toBeVisible();
    await expect(page.getByTestId("forgot-password-submit")).toBeVisible();
  });
});

test.describe("Login providers", () => {
  test("user sees only configured providers", async ({page}) => {
    const methods = await stubMethods(page, []);
    await page.goto("/login");
    await page.getByTestId("login-screen").waitFor({state: "visible"});
    await methods.answered;

    await expect(page.getByTestId(/^login-screen-oauth/)).toHaveCount(0);
  });

  test("user sees branded and generic providers the server lists", async ({page}) => {
    await stubMethods(page, ["github", "mock-oidc"]);
    await page.goto("/login");
    await page.getByTestId("login-screen").waitFor({state: "visible"});

    await expect(page.getByTestId("login-screen-oauth-github")).toBeVisible();
    // The mock provider has no brand, so it gets a generic button with the example's label.
    await expect(page.getByTestId("login-screen-oauth-mock-oidc")).toContainText("Mock OIDC");
    await expect(page.getByTestId("login-screen-oauth-google")).toHaveCount(0);
    await expect(page.getByTestId("login-screen-oauth-apple")).toHaveCount(0);
  });

  test("typed email survives the methods response", async ({page}) => {
    const methods = await stubMethods(page, ["github", "mock-oidc"], {hold: true});
    await page.goto("/login");
    await page.getByTestId("login-screen").waitFor({state: "visible"});
    await page.getByTestId("login-screen-email-input").fill(TEST_USER.email);

    methods.release();
    await expect(page.getByTestId("login-screen-oauth-mock-oidc")).toBeVisible();
    await expect(page.getByTestId("login-screen-email-input")).toHaveValue(TEST_USER.email);
  });
});

test.describe("Remembered accounts", () => {
  // Each test starts on the login screen after TEST_USER signed in and out on this device.
  test.beforeEach(async ({page}) => {
    await loginAs(page, TEST_USER);
    await ensureLoggedOut(page);
  });

  test("user sees email as the last used method after signing out", async ({page}) => {
    await expect(page.getByTestId("login-screen-continue-0")).toContainText(TEST_USER.name);
    await expect(page.getByTestId("login-screen-last-used-account-0")).toBeVisible();
    await showOtherSignInMethods(page);
    await expect(page.getByTestId("login-screen-last-used-email")).toBeVisible();
  });

  test("user continues as a remembered email account", async ({page}) => {
    // The stored email is masked, so the card asks for the email and password.
    await page.getByTestId("login-screen-continue-0").click();
    await expect(page.getByTestId("login-screen-notice")).toContainText(
      `Enter your email and password to continue as ${TEST_USER.name}.`
    );

    await loginAs(page, TEST_USER);
  });

  test("user can forget a remembered account", async ({page}) => {
    await page.getByTestId("login-screen-accounts-edit").click();
    await page.getByTestId("login-screen-forget-0").click();

    await expect(page.getByTestId("login-screen-continue-0")).toHaveCount(0);
    await expect(page.getByTestId("login-screen-last-used-email")).toHaveCount(0);
  });
});
