import {expect, test} from "@playwright/test";
import {readHydrationErrors, recordHydrationErrors, waitForHydration} from "../helpers/hydration";

// Must match the credentials seeded by example-backend/src/scripts/seed-admin-spa-admin.ts.
const ADMIN_EMAIL = process.env.ADMIN_SPA_E2E_EMAIL ?? "admin-spa-e2e@example.com";
const ADMIN_PASSWORD = process.env.ADMIN_SPA_E2E_PASSWORD ?? "admin-spa-e2e-password";

const isUserListRequest = (url: string): boolean => {
  return /\/admin\/users(\?|$)/.test(`${new URL(url).pathname}${new URL(url).search}`);
};

/**
 * E4: the model list is server-rendered. With JavaScript disabled, `/console/User` already shows
 * the seeded user emails; with it enabled the page hydrates from the embedded list and the browser
 * never asks for `GET /admin/users`. The seeded admin is itself a user row, so its email is the
 * known row. Read-only: nothing here mutates backend state.
 */
test.describe("admin SPA server-rendered model list", () => {
  test("with JavaScript disabled, /console/User shows the seeded user emails", async ({
    baseURL,
    browser,
    request,
  }) => {
    // Sign in through the API, then hand the session to a context that cannot run scripts.
    const signIn = await request.post("/api/auth/sign-in/email", {
      data: {email: ADMIN_EMAIL, password: ADMIN_PASSWORD},
    });
    expect(signIn.ok()).toBeTruthy();
    const storageState = await request.storageState();

    const context = await browser.newContext({baseURL, javaScriptEnabled: false, storageState});
    const page = await context.newPage();
    try {
      const response = await page.goto("/console/User");
      expect(response?.status()).toBe(200);
      await expect(page.getByText(ADMIN_EMAIL).locator("visible=true").first()).toBeVisible();
      await expect(page.getByRole("progressbar")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test("with JavaScript enabled, the list hydrates without requesting GET /admin/users", async ({
    page,
  }) => {
    await page.goto("/console/login");
    await page.getByTestId("admin-spa-login-email").fill(ADMIN_EMAIL);
    await page.getByTestId("admin-spa-login-password").fill(ADMIN_PASSWORD);
    await page.getByTestId("admin-spa-login-submit").click();
    await page.waitForURL(/\/console\/?$/, {timeout: 30_000});

    const listRequests: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "GET" && isUserListRequest(request.url())) {
        listRequests.push(request.url());
      }
    });
    await recordHydrationErrors(page);
    await page.setViewportSize({height: 800, width: 1280});
    // A full document load, so the list comes from the server render and not a client navigation.
    const hydrated = waitForHydration(page);
    await page.goto("/console/User");
    await hydrated;
    await page.waitForLoadState("networkidle");

    await expect(page.getByText(ADMIN_EMAIL).locator("visible=true").first()).toBeVisible();
    expect(listRequests).toEqual([]);
    expect(await readHydrationErrors(page)).toEqual([]);
  });
});
