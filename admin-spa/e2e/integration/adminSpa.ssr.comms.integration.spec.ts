import type {Browser, BrowserContext, Page} from "@playwright/test";
import {expect, test} from "@playwright/test";

// Must match the credentials seeded by example-backend/src/scripts/seed-admin-spa-admin.ts.
const ADMIN_EMAIL = process.env.ADMIN_SPA_E2E_EMAIL ?? "admin-spa-e2e@example.com";
const ADMIN_PASSWORD = process.env.ADMIN_SPA_E2E_PASSWORD ?? "admin-spa-e2e-password";

interface CommsMessage {
  subject?: string;
}

/**
 * E9: the comms dashboard is server-rendered. With JavaScript disabled, `/console/comms` already
 * shows the message rows, with no spinner. A fresh database holds no messages, so the spec makes
 * one through the API: a password-reset request for the seeded admin goes through the example
 * backend's `sendMail`, which logs a comms message. Recipients are masked in the list, so the
 * spec asserts on a row's subject, read through the API.
 */
test.describe("admin SPA server-rendered comms dashboard", () => {
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

  const listMessages = async (page: Page): Promise<CommsMessage[]> => {
    const response = await page.request.get("/comms/messages?limit=20&page=1");
    expect(response.ok()).toBeTruthy();
    return ((await response.json()) as {data?: CommsMessage[]}).data ?? [];
  };

  test("with JavaScript disabled, /console/comms shows the seeded message rows", async ({
    baseURL,
    browser,
    request,
  }) => {
    const {context, page} = await openWithoutScripts({baseURL, browser, request});
    try {
      if ((await listMessages(page)).length === 0) {
        const reset = await request.post("/api/auth/request-password-reset", {
          data: {email: ADMIN_EMAIL, redirectTo: "/console/login"},
        });
        expect(reset.ok()).toBeTruthy();
        await expect.poll(async () => (await listMessages(page)).length).toBeGreaterThan(0);
      }
      const [first] = await listMessages(page);

      const response = await page.goto("/console/comms");
      expect(response?.status()).toBe(200);
      await expect(
        page.getByTestId("comms-dashboard").locator("visible=true").first()
      ).toBeVisible();
      await expect(
        page.getByTestId("comms-row-open").locator("visible=true").first()
      ).toBeVisible();
      if (first?.subject) {
        await expect(page.getByText(first.subject).locator("visible=true").first()).toBeVisible();
      }
      await expect(
        page.getByTestId("comms-stat-sent").locator("visible=true").first()
      ).toContainText(/\d+/);
      await expect(page.getByTestId("comms-dashboard-loading")).toHaveCount(0);
      await expect(page.getByRole("progressbar")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
