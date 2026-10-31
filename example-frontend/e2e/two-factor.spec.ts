/**
 * The example login screen's two-factor step (TerrenoLoginScreen's inline challenge).
 *
 * Runs in the cookie-mode run (the `auth` shard): the challenge travels in Better Auth's own
 * cookie. crossSiteChallenges.spec.ts covers the same challenge for a bearer client without
 * cookies. Each test makes its own user through the API and turns on TOTP for it; the code is
 * computed in the test from the enrollment secret.
 */
import type {APIRequestContext, Page} from "@playwright/test";
import {expect, test} from "./fixtures/test";
import {
  enrollTwoFactor,
  newAuthApiContext,
  openLoginScreen,
  signUpApiUser,
  type TwoFactorUser,
} from "./helpers/authFlows";
import {loginAs, waitForSignedIn} from "./helpers/login";
import {totpCode, totpSecretFromBase32} from "./helpers/totp";

/** A six-digit code that is not the current one. */
const wrongCodeFor = (user: TwoFactorUser): string => {
  const current = totpCode(totpSecretFromBase32(user.totpSecret));
  return current
    .split("")
    .map((digit) => String((Number(digit) + 5) % 10))
    .join("");
};

/** Fills the email form and submits it, leaving the page on the challenge. */
const submitPassword = async (page: Page, user: TwoFactorUser): Promise<void> => {
  await openLoginScreen(page);
  await page.getByTestId("login-screen-email-input").fill(user.email);
  await page.getByTestId("login-screen-password-input").fill(user.password);
  await page.getByTestId("login-screen-submit-button").click();
  await page.getByTestId("two-factor-challenge").waitFor({state: "visible"});
};

test.describe("Two-factor sign-in", () => {
  // A cold bundle load plus a full sign-in.
  test.slow();

  let api: APIRequestContext;
  let user: TwoFactorUser;

  test.beforeEach(async ({playwright}) => {
    api = await newAuthApiContext(playwright);
    user = await enrollTwoFactor(api, await signUpApiUser(api, {label: "two-factor-login"}));
  });

  test.afterEach(async () => {
    await api.dispose();
  });

  test("user with 2FA completes the TOTP challenge", async ({page}, testInfo) => {
    await submitPassword(page, user);
    await expect(page.getByTestId("two-factor-challenge-title")).toBeVisible();
    await expect(page.getByTestId("two-factor-challenge-trust-device")).toBeVisible();
    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath("two-factor-challenge.png"),
    });

    await page
      .getByTestId("two-factor-challenge-otp-cell-1")
      .fill(totpCode(totpSecretFromBase32(user.totpSecret)));

    await page.getByTestId("todos-screen").first().waitFor({state: "visible"});
  });

  test("loginAs answers the challenge for a fixture user with a TOTP secret", async ({page}) => {
    await loginAs(page, user);
    await page.getByTestId("todos-screen").first().waitFor({state: "visible"});
  });

  test("user sees an error for a wrong code and then signs in", async ({page, consoleGuard}) => {
    // The refused verify answers 401, which the browser logs.
    consoleGuard.allow("Failed to load resource: the server responded with a status of 401");
    await submitPassword(page, user);

    await page.getByTestId("two-factor-challenge-otp-cell-1").fill(wrongCodeFor(user));
    await expect(page.getByTestId("two-factor-challenge-error")).toBeVisible();

    // The cells clear after a rejected code, and focus returns to the first one.
    const firstCell = page.getByTestId("two-factor-challenge-otp-cell-1");
    await expect(firstCell).toHaveValue("");
    await expect(firstCell).toBeFocused();
    await firstCell.fill(totpCode(totpSecretFromBase32(user.totpSecret)));
    await waitForSignedIn(page);
  });

  test("user signs in with a backup code", async ({page}) => {
    expect(user.backupCodes.length).toBeGreaterThan(0);
    await submitPassword(page, user);

    await page.getByTestId("two-factor-challenge-backup-toggle").click();
    await page.getByTestId("two-factor-challenge-backup-input").fill(user.backupCodes[0]);
    await page.getByTestId("two-factor-challenge-submit").click();

    await waitForSignedIn(page);
  });

  test("user can leave the challenge for the login form", async ({page}) => {
    await submitPassword(page, user);

    await page.getByTestId("two-factor-challenge-cancel").click();

    await page.getByTestId("login-screen").waitFor({state: "visible"});
    await expect(page.getByTestId("two-factor-challenge")).toHaveCount(0);
  });
});
