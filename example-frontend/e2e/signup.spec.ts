import {expect, test} from "./fixtures/test";
import {TEST_USER} from "./fixtures/testUsers";

test.describe("Signup", () => {
  test.beforeEach(async ({page}) => {
    await page.goto("/signup");
    await page.getByTestId("signup-screen").waitFor({state: "visible"});
  });

  test("signup screen renders correctly", async ({page}) => {
    await expect(page.getByTestId("signup-screen-name-input")).toBeVisible();
    await expect(page.getByTestId("signup-screen-email-input")).toBeVisible();
    await expect(page.getByTestId("signup-screen-password-input")).toBeVisible();
    await expect(page.getByTestId("signup-screen-submit-button")).toBeVisible();
    await expect(page.getByTestId("signup-screen-login-link")).toBeVisible();
  });

  test("shows password requirements when typing password", async ({page}) => {
    await page.getByTestId("signup-screen-password-input").fill("short");
    await page.getByTestId("signup-screen-password-requirements").waitFor({state: "visible"});
    await expect(page.getByTestId("signup-screen-password-requirements")).toBeVisible();
  });

  test("navigates back to login", async ({page}) => {
    await page.getByTestId("signup-screen-login-link").click();
    await page.getByTestId("login-screen").waitFor({state: "visible"});
  });

  test("shows error for duplicate email", async ({page, consoleGuard}) => {
    // Better Auth's sign-up-with-email endpoint returns 422 (duplicate user), which the
    // browser logs and store/errors.ts forwards to Sentry.
    consoleGuard.allow("Sentry not initialized, captured exception Error:");
    consoleGuard.allow("Failed to load resource: the server responded with a status of 422");
    consoleGuard.allow("USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL");
    consoleGuard.allow("A user with the given username is already registered");
    consoleGuard.allow(/^Object$/);
    await page.getByTestId("signup-screen-name-input").fill("Duplicate User");
    await page.getByTestId("signup-screen-email-input").fill(TEST_USER.email);
    await page.getByTestId("signup-screen-password-input").fill("TestPassword123!");
    await page.getByTestId("signup-screen-submit-button").click();

    await page.getByTestId("signup-screen-error").waitFor({state: "visible"});
    await expect(page.getByTestId("signup-screen-error")).toBeVisible();
  });

  test("user can sign up with valid credentials", async ({page}) => {
    const uniqueEmail = `e2e-signup-${Date.now()}@terreno.dev`;

    await page.getByTestId("signup-screen-name-input").fill("New E2E User");
    await page.getByTestId("signup-screen-email-input").fill(uniqueEmail);
    await page.getByTestId("signup-screen-password-input").fill("TestPassword123!");
    await page.getByTestId("signup-screen-submit-button").click();

    // After signup the user is logged in and redirected away from signup
    await page.getByTestId("signup-screen").first().waitFor({state: "hidden"});
  });
});
