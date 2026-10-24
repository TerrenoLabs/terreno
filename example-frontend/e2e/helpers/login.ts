import type {Page} from "@playwright/test";
import {type E2EUser, TEST_USER} from "../fixtures/testUsers";
import {totpCode, totpSecretFromBase32} from "./totp";

const SIGNED_IN_OR_CHALLENGE =
  '[data-testid="todos-screen"], [data-testid="consent-form-footer"], [data-testid="two-factor-challenge"]';

/**
 * Answers the login screen's inline two-factor challenge with the user's current TOTP code. The
 * code goes into the first cell at once, as a paste or an authenticator's autofill does: typing
 * key by key outruns the cells' focus moves and drops digits. The challenge submits on its own
 * once the code is complete, so nothing is clicked afterwards: a second verify would spend the
 * code twice.
 */
const answerTwoFactorChallenge = async (page: Page, user: E2EUser): Promise<void> => {
  if (!user.totpSecret) {
    throw new Error(`loginAs: ${user.email} met a two-factor challenge but has no totpSecret`);
  }
  await page
    .getByTestId("two-factor-challenge-otp-cell-1")
    .fill(totpCode(totpSecretFromBase32(user.totpSecret)));
};

/** Waits for the signed-in app: the tabs root, or the consent forms a new user sees first. */
export const waitForSignedIn = async (page: Page): Promise<void> => {
  await page
    .locator('[data-testid="todos-screen"], [data-testid="consent-form-footer"]')
    .first()
    .waitFor({state: "visible"});
};

/**
 * Signs in through the login screen. A user with `totpSecret` gets the two-factor challenge
 * answered with the current code.
 */
export const loginAs = async (page: Page, user: E2EUser = TEST_USER): Promise<void> => {
  if ((await page.getByTestId("login-screen").count()) === 0) {
    await page.goto("/login");
  }
  await page.getByTestId("login-screen").waitFor({state: "visible"});
  await page.getByTestId("login-screen-email-input").fill(user.email);
  await page.getByTestId("login-screen-password-input").fill(user.password);
  await page.getByTestId("login-screen-submit-button").click();
  await page.getByTestId("login-screen").first().waitFor({state: "hidden"});
  // A user with two-factor on gets the challenge in place of the login form.
  // Expo Router pre-renders a hidden todos screen, so wait for a visible match.
  await page.locator(SIGNED_IN_OR_CHALLENGE).filter({visible: true}).first().waitFor();
  if (await page.getByTestId("two-factor-challenge").isVisible()) {
    await answerTwoFactorChallenge(page, user);
  }
  // login.tsx's own router.replace("/(tabs)") is still in flight when the login screen
  // hides — a caller that immediately does page.goto() to a different route (e.g.
  // loginAsAdmin() followed by page.goto("/admin")) can race that client-side redirect:
  // the hard navigation can land before Expo Router's replace resolves, which then
  // overrides it back to "/(tabs)". Waiting for the post-login UI to actually mount
  // closes that window before control returns to the caller.
  //
  // The tabs root is the usual landing spot, but a user with pending consents is
  // intercepted by the consent navigator and never reaches it — so accept either, and
  // let the caller assert which one it expected.
  await waitForSignedIn(page);
};

export const ensureLoggedOut = async (page: Page): Promise<void> => {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      // Do not reload `/login` while a session cookie may still be valid: Better Auth
      // rehydrates during `app-auth-loading` and the login screen never mounts.
      if ((await page.getByTestId("login-screen").count()) > 0) {
        return;
      }
      await page.goto("/profile");
      const authLoading = page.getByTestId("app-auth-loading");
      if ((await authLoading.count()) > 0) {
        await authLoading.waitFor({state: "hidden", timeout: 15_000});
      }
      if ((await page.getByTestId("login-screen").count()) > 0) {
        return;
      }
      const logout = page.getByTestId("profile-logout-button");
      await logout.waitFor({state: "visible", timeout: 15_000});
      await logout.click();
      await page.getByTestId("login-screen").first().waitFor({state: "visible", timeout: 15_000});
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Could not reach a logged-out login screen");
};
