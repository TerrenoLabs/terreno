import type {Browser, BrowserContext, Page} from "@playwright/test";
import {expect, test} from "@playwright/test";

// Must match the credentials seeded by example-backend/src/scripts/seed-admin-spa-admin.ts. That
// user holds the superadmin role, which `isOrganizationOperatorProfile` treats as an operator.
const ADMIN_EMAIL = process.env.ADMIN_SPA_E2E_EMAIL ?? "admin-spa-e2e@example.com";
const ADMIN_PASSWORD = process.env.ADMIN_SPA_E2E_PASSWORD ?? "admin-spa-e2e-password";

/**
 * E10: the organizations directory and an organization's members are server-rendered. With
 * JavaScript disabled, an operator's `/console/orgs` shows the organization names and
 * `/console/orgs/<id>/members` shows the member emails, with no spinner. The example backend
 * enables organizations (`organizations` in `example-backend/src/server.ts`). The spec arranges
 * through the API: it creates its own uniquely named organization, attaches the signed-in
 * operator as a member, and deletes the organization afterwards. When the backend does not serve
 * the organizations API (404) the spec skips.
 */
test.describe("admin SPA server-rendered organizations", () => {
  // A fresh name per test: organization names are unique, and each test creates its own.
  let orgName = "";
  let orgId: string | undefined;

  const openWithoutScripts = async ({
    baseURL,
    browser,
    request,
  }: {
    baseURL: string | undefined;
    browser: Browser;
    request: import("@playwright/test").APIRequestContext;
  }): Promise<{context: BrowserContext; page: Page}> => {
    // beforeEach signed in on this request context; hand that session to a context that cannot
    // run scripts (a second sign-in on the same context is rejected).
    const storageState = await request.storageState();
    const context = await browser.newContext({baseURL, javaScriptEnabled: false, storageState});
    return {context, page: await context.newPage()};
  };

  test.beforeEach(async ({request}) => {
    const signIn = await request.post("/api/auth/sign-in/email", {
      data: {email: ADMIN_EMAIL, password: ADMIN_PASSWORD},
    });
    expect(signIn.ok()).toBeTruthy();
    const probe = await request.get("/orgs");
    test.skip(probe.status() === 404, "The backend does not serve the organizations API (/orgs)");
    expect(probe.ok()).toBeTruthy();

    orgName = `SSR Orgs E2E ${Date.now()}`;
    const created = await request.post("/orgs", {data: {name: orgName}});
    expect(created.status()).toBe(201);
    orgId = ((await created.json()) as {data: {_id: string}}).data._id;
    // Attach the operator so the organization has a member whose email the page can show.
    const attached = await request.post(`/orgs/${orgId}/members`, {
      data: {email: ADMIN_EMAIL, roleName: "member"},
      headers: {"X-Organization-Id": orgId},
    });
    expect([201, 409]).toContain(attached.status());
  });

  test.afterEach(async ({request}) => {
    if (!orgId) {
      return;
    }
    await request.delete(`/orgs/${orgId}`, {headers: {"X-Organization-Id": orgId}});
    orgId = undefined;
  });

  test("with JavaScript disabled, /console/orgs shows the organization names, not a spinner", async ({
    baseURL,
    browser,
    request,
  }) => {
    const {context, page} = await openWithoutScripts({baseURL, browser, request});
    try {
      const response = await page.goto("/console/orgs");
      expect(response?.status()).toBe(200);
      await expect(
        page.getByTestId("org-directory-table").locator("visible=true").first()
      ).toBeVisible();
      await expect(page.getByText(orgName).locator("visible=true").first()).toBeVisible();
      await expect(page.getByTestId("org-directory-loading")).toHaveCount(0);
      await expect(page.getByTestId("org-directory-empty")).toHaveCount(0);
      await expect(page.getByRole("progressbar")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test("with JavaScript disabled, /console/orgs/<id>/members shows member emails", async ({
    baseURL,
    browser,
    request,
  }) => {
    const {context, page} = await openWithoutScripts({baseURL, browser, request});
    try {
      const response = await page.goto(`/console/orgs/${orgId}/members`);
      expect(response?.status()).toBe(200);
      await expect(
        page.getByTestId("org-members-table").locator("visible=true").first()
      ).toBeVisible();
      // Scoped to the table: the shell shows the visitor's own email on every page.
      await expect(
        page.getByTestId("org-members-table").getByText(ADMIN_EMAIL).locator("visible=true").first()
      ).toBeVisible();
      await expect(page.getByRole("progressbar")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});
