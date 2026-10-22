import {expect, test} from "@playwright/test";
import {E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD} from "./credentials";

/**
 * End-to-end: an anonymous visitor opening the SPA root is redirected to the login
 * screen, which renders the config-driven brand name and auth providers. Exercises the
 * full client stack — AppConfigGate (loads app-config.json), StoreProvider (builds the
 * Better Auth client and mounts SessionProvider), and AdminGate (no session -> /login).
 */
test("anonymous visitor is redirected to the login screen", async ({page}) => {
  await page.goto("/console/");

  // AdminGate redirects unauthenticated users to /login (client-side).
  await page.waitForURL(/\/console\/login/, {timeout: 20_000});

  await expect(page.getByText("Terreno Admin (e2e)")).toBeVisible();
  await expect(page.getByTestId("admin-spa-login-email")).toBeVisible();
  await expect(page.getByTestId("admin-spa-login-password")).toBeVisible();
  await expect(page.getByTestId("admin-spa-login-submit")).toBeVisible();
  // app-config declares the google provider, so the social button renders.
  await expect(page.getByTestId("admin-spa-login-google")).toBeVisible();
});

/**
 * End-to-end: email/password login against the test server's mock better-auth
 * endpoints. Exercises the login form, `authClient.signIn.email`, the session cookie,
 * the session refresh (get-session), and AdminGate's admin check (`/admin/config` 200) before
 * rendering the admin home (models grid from config).
 */
test("admin logs in with email/password and sees the admin home", async ({page}) => {
  await page.goto("/console/login");
  await expect(page.getByTestId("admin-spa-login-email")).toBeVisible();

  await page.getByTestId("admin-spa-login-email").fill(E2E_ADMIN_EMAIL);
  await page.getByTestId("admin-spa-login-password").fill(E2E_ADMIN_PASSWORD);
  await page.getByTestId("admin-spa-login-submit").click();

  // Successful sign-in routes back to the SPA root, which renders AdminHome
  // from the (mocked) /admin/config response.
  await page.waitForURL(/\/console\/?$/, {timeout: 20_000});
  // @terreno/ui Box with onClick exposes testID as `${id}-clickable` (see ui/src/Box.tsx).
  await expect(page.getByTestId("admin-home-models-grid-Todo-clickable")).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByTestId("admin-home-models-grid-User-clickable")).toBeVisible();
});

/**
 * End-to-end: a failed sign-in (mock better-auth returns 401) surfaces the error
 * message on the login screen and does not navigate away.
 */
test("wrong password shows an error and stays on the login screen", async ({page}) => {
  await page.goto("/console/login");
  await expect(page.getByTestId("admin-spa-login-email")).toBeVisible();

  await page.getByTestId("admin-spa-login-email").fill(E2E_ADMIN_EMAIL);
  await page.getByTestId("admin-spa-login-password").fill("not-the-password");
  await page.getByTestId("admin-spa-login-submit").click();

  await expect(page.getByTestId("admin-spa-login-error")).toBeVisible({timeout: 20_000});
  await expect(page).toHaveURL(/\/console\/login/);
});
