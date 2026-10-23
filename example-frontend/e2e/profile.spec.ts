import {expect, test} from "./fixtures/test";
import {TEST_USER} from "./fixtures/testUsers";
import {loginAs} from "./helpers/login";

test.describe("Profile", () => {
  test.beforeEach(async ({page}) => {
    await loginAs(page);
    await page.goto("/profile");
    await page.getByTestId("profile-name-input.edit-clickable").first().waitFor({state: "visible"});
  });

  test("profile screen renders correctly", async ({page}) => {
    await expect(page.getByTestId("profile-name-input.edit-clickable").first()).toBeVisible();
    await expect(page.getByTestId("profile-email-input.edit-clickable").first()).toBeVisible();
    await expect(page.getByTestId("profile-password-input.edit-clickable").first()).toBeVisible();
    await expect(page.getByTestId("profile-logout-button").first()).toBeVisible();
    await expect(page.getByTestId("profile-verify-email-banner").first()).toBeVisible();
  });

  test("shows current user info", async ({page}) => {
    await expect(page.getByTestId("profile-logged-in-as").first()).toContainText(TEST_USER.email);
    await expect(page.getByTestId("profile-roles-card").first()).toBeVisible();
    await expect(page.getByTestId("profile-roles-list").first()).toContainText("todoUser");
    await expect(page.getByTestId("profile-edit-roles-button")).not.toBeVisible();
  });

  test("can edit name and save", async ({page}) => {
    await page.getByTestId("profile-name-input.edit-clickable").first().click();
    const nameInput = page.getByTestId("profile-name-input").first();
    await nameInput.waitFor({state: "visible"});
    await nameInput.clear();
    await nameInput.fill("Updated E2E Name");
    await page.getByTestId("profile-name-input.save").first().click();

    await page.getByTestId("profile-save-success").first().waitFor({state: "visible"});
    await expect(page.getByTestId("profile-save-success").first()).toBeVisible();

    await page.getByTestId("profile-name-input.edit-clickable").first().click();
    const restoredInput = page.getByTestId("profile-name-input").first();
    await restoredInput.waitFor({state: "visible"});
    await restoredInput.clear();
    await restoredInput.fill(TEST_USER.name);
    await page.getByTestId("profile-name-input.save").first().click();
    await page.getByTestId("profile-save-success").first().waitFor({state: "visible"});
  });

  test("can save and clear Gemini API key", async ({page}) => {
    const keyInput = page.getByTestId("profile-gemini-key-input").first();
    await keyInput.fill("test-api-key-12345");

    await page.getByTestId("profile-gemini-save-button").first().click();
    await page.getByTestId("profile-gemini-saved-text").first().waitFor({state: "visible"});
    await expect(page.getByTestId("profile-gemini-saved-text").first()).toBeVisible();

    await page.getByTestId("profile-gemini-clear-button").first().click();
    await expect(keyInput).toHaveValue("");
  });

  test("feature flags card renders", async ({page}) => {
    await expect(page.getByTestId("profile-feature-flags-card").first()).toBeVisible();
  });

  test("user who cannot reach the server stays signed in and sees the sign-out error", async ({
    consoleGuard,
    page,
  }) => {
    // The sign-out and the session check after it both fail, as they do offline. A cookie
    // session may still be live on the server, so the app keeps it rather than showing the
    // login screen.
    consoleGuard.allow("Failed to load resource");
    consoleGuard.allow("Better Auth: Error signing out");
    consoleGuard.allow("Better Auth: Could not check the session after a failed sign out");
    await page.route("**/api/auth/sign-out", (route) => route.abort("connectionrefused"));
    await page.route("**/api/auth/get-session**", (route) => route.abort("connectionrefused"));

    await page.getByTestId("profile-logout-button").first().click();

    await expect(page.getByTestId("profile-logout-error").first()).toBeVisible();
    await expect(page.getByTestId("profile-logout-error").first()).toContainText(
      "Couldn't sign out"
    );
    await expect(page).toHaveURL(/\/profile$/);
    await expect(page.getByTestId("profile-logged-in-as").first()).toContainText(TEST_USER.email);
    await expect(page.getByTestId("login-screen")).toHaveCount(0);
  });

  test("logout redirects to login", async ({page}) => {
    await page.getByTestId("profile-logout-button").first().click();
    await page.getByTestId("login-screen").waitFor({state: "visible"});
    await expect(page.getByTestId("login-screen")).toBeVisible();
  });

  test("admin panel button hidden for non-admin", async ({page}) => {
    await expect(page.getByTestId("profile-admin-button")).not.toBeVisible();
  });

  test("notification preferences screen loads without SyncDbProvider crash", async ({page}) => {
    await page.getByTestId("profile-notification-settings-button").first().click();
    await page.getByTestId("notification-settings-back").first().waitFor({state: "visible"});
    await expect(page.getByTestId("notification-settings-back").first()).toBeVisible();
    await page.getByTestId("notification-preferences").waitFor({state: "visible"});
    await expect(page.getByTestId("notification-preferences-inapp.switch")).toBeVisible();
  });
});
