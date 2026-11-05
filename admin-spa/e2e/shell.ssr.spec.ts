import {expect, test} from "@playwright/test";
import {E2E_ADMIN_SESSION_COOKIE, E2E_ADMIN_SESSION_TOKEN} from "./credentials";
import {readHydrationErrors, recordHydrationErrors, waitForHydration} from "./helpers/hydration";

// Brand name configured in e2e/serveTestApp.ts.
const E2E_BRAND = "Terreno Admin (e2e)";

/**
 * E3: an admin's `/console` is server-rendered with the whole shell (brand, nav, model links),
 * including the windowed sync model, and the browser hydrates from the embedded payload without
 * asking for the admin config again.
 */
test.describe("admin shell server rendering", () => {
  test.beforeEach(async ({baseURL, context}) => {
    // The test server's mock better-auth session for the admin; `req.user` follows it.
    await context.addCookies([
      {
        name: E2E_ADMIN_SESSION_COOKIE,
        url: baseURL,
        value: E2E_ADMIN_SESSION_TOKEN,
      },
    ]);
  });

  test("with JavaScript disabled, the admin shell is in the first HTML with no spinner", async ({
    baseURL,
    browser,
  }) => {
    const context = await browser.newContext({javaScriptEnabled: false});
    await context.addCookies([
      {name: E2E_ADMIN_SESSION_COOKIE, url: baseURL, value: E2E_ADMIN_SESSION_TOKEN},
    ]);
    const page = await context.newPage();
    try {
      const response = await page.goto("/console");
      expect(response?.status()).toBe(200);

      await expect(page.getByTestId("admin-shell-nav-home-clickable")).toBeVisible();
      await expect(page.getByTestId("admin-shell-nav-model-User-clickable")).toBeVisible();
      await expect(page.getByTestId("admin-shell-nav-model-Todo-clickable")).toBeVisible();
      // The windowed sync model's link renders too, without waiting for syncdb to start.
      await expect(page.getByTestId("admin-shell-nav-model-Note-clickable")).toBeVisible();

      // No loading screens, no spinner, no sync error in the server-rendered HTML.
      await expect(page.getByTestId("admin-spa-admin-gate-loading")).toHaveCount(0);
      await expect(page.getByTestId("admin-spa-app-config-loading")).toHaveCount(0);
      await expect(page.getByTestId("admin-spa-sync-error")).toHaveCount(0);
      await expect(page.getByRole("progressbar")).toHaveCount(0);

      // The brand reaches the browser in the page's embedded config.
      expect(await page.content()).toContain(E2E_BRAND);
    } finally {
      await context.close();
    }
  });

  test("with JavaScript enabled, the page hydrates without asking for the admin config again", async ({
    page,
  }) => {
    const adminConfigRequests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.endsWith("/admin/config")) {
        adminConfigRequests.push(request.url());
      }
    });

    await recordHydrationErrors(page);
    await page.setViewportSize({height: 800, width: 1280});
    const hydrated = waitForHydration(page);
    await page.goto("/console");
    await hydrated;
    await page.waitForLoadState("networkidle");

    await expect(page.getByTestId("admin-shell-nav-home-clickable")).toBeVisible();
    await expect(page.getByTestId("admin-shell-nav-model-Note-clickable")).toBeVisible();
    expect(adminConfigRequests).toEqual([]);
    // The desktop shell is server-rendered at 1280x800, so the client must match it exactly.
    expect(await readHydrationErrors(page)).toEqual([]);
  });

  test("after hydration, no loader data or shell payload stays in the page", async ({page}) => {
    const hydrated = waitForHydration(page);
    await page.goto("/console");
    await hydrated;
    await expect(page.getByTestId("admin-shell-nav-home-clickable")).toBeVisible();

    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as {__EXPO_ROUTER_LOADER_DATA__?: unknown})
              .__EXPO_ROUTER_LOADER_DATA__
        )
      )
      .toBeUndefined();
    await expect(page.locator("#admin-spa-ssr")).toHaveCount(0);
  });
});
