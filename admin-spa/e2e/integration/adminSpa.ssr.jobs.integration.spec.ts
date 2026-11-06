import type {Browser, BrowserContext, Page} from "@playwright/test";
import {expect, test} from "@playwright/test";

// Must match the credentials seeded by example-backend/src/scripts/seed-admin-spa-admin.ts.
const ADMIN_EMAIL = process.env.ADMIN_SPA_E2E_EMAIL ?? "admin-spa-e2e@example.com";
const ADMIN_PASSWORD = process.env.ADMIN_SPA_E2E_PASSWORD ?? "admin-spa-e2e-password";

/**
 * E7: the jobs dashboard is server-rendered. With JavaScript disabled, `/console/jobs` already
 * shows the dashboard data (stat counts, the schedules the backend defines, the queue's result
 * count), with no spinner. The example backend defines scheduled jobs (`example/heartbeat`), so a
 * fresh database has schedules to show; the spec reads them through the API and asserts the page
 * shows the first.
 */
test.describe("admin SPA server-rendered jobs dashboard", () => {
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

  test("with JavaScript disabled, /console/jobs shows the dashboard data, not a spinner", async ({
    baseURL,
    browser,
    request,
  }) => {
    const {context, page} = await openWithoutScripts({baseURL, browser, request});
    try {
      const schedulesResponse = await page.request.get("/jobs/schedules");
      expect(schedulesResponse.ok()).toBeTruthy();
      const schedulesBody = (await schedulesResponse.json()) as
        | {data?: {name: string}[]}
        | {name: string}[];
      const schedules = Array.isArray(schedulesBody) ? schedulesBody : (schedulesBody.data ?? []);

      const response = await page.goto("/console/jobs");
      expect(response?.status()).toBe(200);
      await expect(
        page.getByTestId("jobs-dashboard").locator("visible=true").first()
      ).toBeVisible();
      // The stat cards carry the counts from `/jobs/stats`, not a loading placeholder.
      for (const stat of ["dead", "running", "failed", "pending"]) {
        await expect(
          page.getByTestId(`jobs-stat-${stat}`).locator("visible=true").first()
        ).toContainText(/\d+/);
      }
      await expect(
        page.getByTestId("jobs-result-count").locator("visible=true").first()
      ).toHaveText(/^\d+ matching jobs?$/);
      if (schedules.length > 0) {
        await expect(
          page.getByTestId(`jobs-schedule-${schedules[0].name}`).locator("visible=true").first()
        ).toBeVisible();
      }
      await expect(page.getByTestId("jobs-stats-loading")).toHaveCount(0);
      await expect(page.getByTestId("jobs-schedules-loading")).toHaveCount(0);
      await expect(page.getByTestId("jobs-dashboard-loading")).toHaveCount(0);
      await expect(page.getByRole("progressbar")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
