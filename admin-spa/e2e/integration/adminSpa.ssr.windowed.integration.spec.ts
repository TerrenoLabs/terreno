import {expect, test} from "@playwright/test";
import {DateTime} from "luxon";
import {readHydrationErrors, recordHydrationErrors, waitForHydration} from "../helpers/hydration";

// Must match the credentials seeded by example-backend/src/scripts/seed-admin-spa-admin.ts.
const ADMIN_EMAIL = process.env.ADMIN_SPA_E2E_EMAIL ?? "admin-spa-e2e@example.com";
const ADMIN_PASSWORD = process.env.ADMIN_SPA_E2E_PASSWORD ?? "admin-spa-e2e-password";

/**
 * E8: `/console/Todo` is a windowed syncdb model. Its first view is server-rendered from REST rows;
 * once syncdb starts the rows stay, and a change made between the server render and `start()` shows
 * up without a manual refresh. Each test creates its own todo through the API and deletes it after.
 */
test.describe("admin SPA server-rendered windowed table", () => {
  let todoId: string | undefined;
  let title = "";

  test.beforeEach(async ({page}) => {
    await page.goto("/console/login");
    await page.getByTestId("admin-spa-login-email").fill(ADMIN_EMAIL);
    await page.getByTestId("admin-spa-login-password").fill(ADMIN_PASSWORD);
    await page.getByTestId("admin-spa-login-submit").click();
    await page.waitForURL(/\/console\/?$/, {timeout: 30_000});

    title = `SSR windowed ${DateTime.now().toMillis()}`;
    const created = await page.request.post("/todos", {data: {title}});
    expect(created.ok()).toBeTruthy();
    todoId = ((await created.json()) as {data?: {_id?: string}}).data?._id;
    expect(todoId).toBeTruthy();
  });

  test.afterEach(async ({page}) => {
    if (todoId) {
      await page.request.delete(`/todos/${todoId}`);
      todoId = undefined;
    }
  });

  test("with JavaScript disabled, /console/Todo shows the seeded todo titles", async ({
    baseURL,
    browser,
    page,
  }) => {
    const storageState = await page.context().storageState();
    const context = await browser.newContext({baseURL, javaScriptEnabled: false, storageState});
    const noScript = await context.newPage();
    try {
      const response = await noScript.goto("/console/Todo");
      expect(response?.status()).toBe(200);
      await expect(noScript.getByText(title).locator("visible=true").first()).toBeVisible();
      await expect(noScript.getByRole("progressbar")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test("with JavaScript enabled, syncdb starts and the rows stay", async ({page}) => {
    await recordHydrationErrors(page);
    await page.setViewportSize({height: 800, width: 1280});
    const hydrated = waitForHydration(page);
    await page.goto("/console/Todo");
    await hydrated;
    await expect(page.getByText(title).locator("visible=true").first()).toBeVisible();
    await expect(page.getByTestId("admin-table-refresh")).toBeVisible({timeout: 15_000});
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(title).locator("visible=true").first()).toBeVisible();
    expect(await readHydrationErrors(page)).toEqual([]);
  });

  test("a change made right after the server render shows up without a refresh", async ({page}) => {
    const updatedTitle = `${title} updated`;
    await page.setViewportSize({height: 800, width: 1280});
    // Resolve on the first byte of the document, then change the todo before syncdb can start.
    await page.goto("/console/Todo", {waitUntil: "commit"});
    const patch = await page.request.patch(`/todos/${todoId}`, {data: {title: updatedTitle}});
    expect(patch.ok()).toBeTruthy();

    await expect(page.getByText(updatedTitle).locator("visible=true").first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(title, {exact: true}).locator("visible=true")).toHaveCount(0);
  });
});
