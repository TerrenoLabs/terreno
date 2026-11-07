import {expect, test} from "@playwright/test";
import {E2E_MEMBER_EMAIL, E2E_MEMBER_PASSWORD} from "./credentials";
import {readHydrationErrors, recordHydrationErrors, waitForHydration} from "./helpers/hydration";

// Brand name configured in e2e/serveTestApp.ts.
const E2E_BRAND = "Terreno Admin (e2e)";

/**
 * End-to-end for the server-rendered login page (SSR tracer). The first HTML must already
 * contain the brand and the login form, the client must be able to fetch loader data from
 * Expo's site-root loader path, and hydration must not warn.
 */
test.describe("admin SPA server rendering", () => {
  test("login page shows the brand and the login form with JavaScript disabled", async ({
    browser,
  }) => {
    const context = await browser.newContext({javaScriptEnabled: false});
    const page = await context.newPage();
    try {
      await page.goto("/console/login");

      await expect(page.getByText(E2E_BRAND)).toBeVisible();
      await expect(page.getByTestId("admin-spa-login-email")).toBeVisible();
      await expect(page.getByTestId("admin-spa-login-password")).toBeVisible();
      await expect(page.getByTestId("admin-spa-app-config-loading")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test("anonymous visit to a protected route gets a server 302 to login", async ({page}) => {
    const response = await page.request.get("/console/forbidden", {maxRedirects: 0});
    expect(response.status()).toBe(302);
    expect(response.headers().location).toBe("/console/login?returnTo=%2Fforbidden");
  });

  test("client-side navigation to login loads loader data and hydrates cleanly", async ({page}) => {
    await recordHydrationErrors(page);

    const hydrated = waitForHydration(page);
    await page.goto("/console/login");
    await hydrated;

    await page.getByTestId("admin-spa-login-email").fill(E2E_MEMBER_EMAIL);
    await page.getByTestId("admin-spa-login-password").fill(E2E_MEMBER_PASSWORD);
    await page.getByTestId("admin-spa-login-submit").click();

    await expect(page).toHaveURL(/\/console\/forbidden$/);
    await expect(page.getByTestId("admin-spa-forbidden-screen")).toBeVisible();

    // Expo's client requests loader data from the site root, not from /console.
    const loaderResponse = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/_expo/loaders/login"
    );
    await page.getByTestId("admin-spa-forbidden-signout").click();

    await expect(page).toHaveURL(/\/console\/login/);
    expect((await loaderResponse).status()).toBe(200);
    await expect(page.getByText(E2E_BRAND)).toBeVisible();
    await expect(page.getByTestId("admin-spa-login-email")).toBeVisible();

    expect(await readHydrationErrors(page)).toEqual([]);
  });

  test("a direct visit to login hydrates without a hydration warning", async ({page}) => {
    await recordHydrationErrors(page);

    const hydrated = waitForHydration(page);
    await page.goto("/console/login");
    await hydrated;
    await expect(page.getByTestId("admin-spa-login-email")).toBeVisible();

    expect(await readHydrationErrors(page)).toEqual([]);
  });
});
