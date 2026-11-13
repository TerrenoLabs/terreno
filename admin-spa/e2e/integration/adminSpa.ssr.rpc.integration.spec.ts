import type {Browser, BrowserContext, Page} from "@playwright/test";
import {expect, test} from "@playwright/test";

// Must match the credentials seeded by example-backend/src/scripts/seed-admin-spa-admin.ts.
const ADMIN_EMAIL = process.env.ADMIN_SPA_E2E_EMAIL ?? "admin-spa-e2e@example.com";
const ADMIN_PASSWORD = process.env.ADMIN_SPA_E2E_PASSWORD ?? "admin-spa-e2e-password";

/**
 * E6: the configuration screen and the admin home are server-rendered. With JavaScript disabled,
 * `/console/configuration` already shows the example app configuration's values and `/console`
 * shows the data of the example config's home widgets (model row counts from `modelStats`, job
 * counts from `jobs`), with no spinner. The configuration test stores a known appName first.
 */
test.describe("admin SPA server-rendered rpc screens", () => {
  const openWithoutScripts = async ({
    baseURL,
    browser,
    request,
  }: {
    baseURL: string | undefined;
    browser: Browser;
    request: import("@playwright/test").APIRequestContext;
  }): Promise<{context: BrowserContext; page: Page}> => {
    // Sign in through the API, then hand the session to a context that cannot run scripts.
    const signIn = await request.post("/api/auth/sign-in/email", {
      data: {email: ADMIN_EMAIL, password: ADMIN_PASSWORD},
    });
    expect(signIn.ok()).toBeTruthy();
    const storageState = await request.storageState();
    const context = await browser.newContext({baseURL, javaScriptEnabled: false, storageState});
    return {context, page: await context.newPage()};
  };

  test("with JavaScript disabled, /console/configuration shows its data, not a spinner", async ({
    baseURL,
    browser,
    request,
  }) => {
    const {context, page} = await openWithoutScripts({baseURL, browser, request});
    try {
      // Store a known value: a fresh database holds no configuration values, only defaults.
      const appName = `E6 App ${Date.now()}`;
      const update = await page.request.patch("/configuration", {data: {general: {appName}}});
      expect(update.ok()).toBeTruthy();
      const response = await page.goto("/console/configuration");
      expect(response?.status()).toBe(200);
      await expect(page.getByTestId("config-form").locator("visible=true").first()).toBeVisible();
      await expect(
        page.getByTestId("config-general-appName").locator("visible=true").first()
      ).toHaveValue(appName);
      await expect(page.getByRole("progressbar")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test("with JavaScript disabled, /console shows the example config's widget data", async ({
    baseURL,
    browser,
    request,
  }) => {
    const {context, page} = await openWithoutScripts({baseURL, browser, request});
    try {
      const response = await page.goto("/console");
      expect(response?.status()).toBe(200);
      // `modelStats`: a loaded count reads "N rows"; a pending one reads "— rows". The seeded
      // admin is itself a user, so the User count is at least 1.
      await expect(
        page.getByTestId("admin-home-model-count-User").locator("visible=true").first()
      ).toHaveText(/^[1-9]\d* rows$/);
      // `jobs`: the counts line replaces the spinner once the stats are loaded.
      await expect(
        page.getByTestId("jobs-home-widget-counts").locator("visible=true").first()
      ).toHaveText(/\d+ dead · \d+ running/);
      await expect(page.getByRole("progressbar")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
