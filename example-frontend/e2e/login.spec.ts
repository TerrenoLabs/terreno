import {expect, test} from "./fixtures/test";
import {TEST_USER} from "./fixtures/testUsers";

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
    // A rejected sign-in can surface as an unhandled pageerror whose body is the
    // API response object (no message/stack), so it renders as "Object".
    consoleGuard.allow(/^Object$/);
    await page.getByTestId("login-screen-email-input").fill("wrong@example.com");
    await page.getByTestId("login-screen-password-input").fill("wrongpassword");
    await page.getByTestId("login-screen-submit-button").click();

    await page.getByTestId("login-screen-error").waitFor({state: "visible"});
    await expect(page.getByTestId("login-screen-error")).toBeVisible();
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
