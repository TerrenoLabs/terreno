import type {Page} from "@playwright/test";
import {expect, test} from "./fixtures/test";
import {clearTodos} from "./helpers/clearTodos";
import {loginAs} from "./helpers/login";
import {
  allowSyncDbNoise,
  CONVERGE_TIMEOUT,
  clickTodoControl,
  createTodoViaUi,
  openSyncTodos,
  todoItemByTitle,
  waitForOutboxDrained,
} from "./helpers/syncdbSuite";

const SCREENSHOT_DIR = process.env.E2E_SCREENSHOT_DIR;

const capture = async (page: Page, name: string): Promise<void> => {
  if (!SCREENSHOT_DIR) {
    return;
  }
  await page.screenshot({fullPage: true, path: `${SCREENSHOT_DIR}/${name}.png`});
};

test.describe("Todo query windows", () => {
  test.beforeEach(async ({page, consoleGuard}) => {
    allowSyncDbNoise(consoleGuard);
    await clearTodos();
    await loginAs(page);
    await openSyncTodos(page);
  });

  test("overlapping windows share rows but keep separate results", async ({page}) => {
    for (const title of ["Alpha", "Beta", "Gamma"]) {
      await createTodoViaUi(page, title);
    }
    const beta = todoItemByTitle(page, "Beta");
    const betaId = ((await beta.getAttribute("data-testid")) ?? "").replace("todo-item-", "");
    await clickTodoControl(page.getByTestId(`todo-toggle-${betaId}-clickable`));
    await waitForOutboxDrained(page);

    await page.getByTestId("todos-open-windows").click();
    const openWindow = page.getByTestId("todo-windows-open");
    const recentWindow = page.getByTestId("todo-windows-recent");
    const stats = page.getByTestId("todo-windows-stats-text");

    // Open = not completed (Alpha, Gamma); Recent = created in the last day (all three).
    await expect(page.getByTestId("todo-windows-open-count")).toHaveText("Showing 2 of 2", {
      timeout: CONVERGE_TIMEOUT,
    });
    await expect(page.getByTestId("todo-windows-recent-count")).toHaveText("Showing 3 of 3");
    await expect(openWindow.getByText("Beta")).toHaveCount(0);
    await expect(recentWindow.getByText("Beta")).toBeVisible();
    await expect(stats).toHaveText("Open: 2 · Recent: 3 · Shared: 2 · Rows stored for both: 3");
    await capture(page, "todo-windows-initial");

    // Completing a shared todo is one local write: it leaves Open and stays in Recent.
    const alphaRow = openWindow.locator('[data-testid^="todo-windows-open-row-"]').filter({
      hasText: "Alpha",
    });
    const alphaId = ((await alphaRow.getAttribute("data-testid")) ?? "").replace(
      "todo-windows-open-row-",
      ""
    );
    await page.getByTestId(`todo-windows-open-toggle-${alphaId}`).click();
    await expect(openWindow.getByText("Alpha")).toHaveCount(0);
    await expect(recentWindow.getByTestId(`todo-windows-recent-row-${alphaId}`)).toBeVisible();
    await expect(stats).toHaveText("Open: 1 · Recent: 3 · Shared: 1 · Rows stored for both: 3");
    await capture(page, "todo-windows-after-complete");
  });

  test("a where field missing from queryFields fails loudly", async ({page}) => {
    await page.getByTestId("todos-open-windows").click();
    await page.getByTestId("todo-windows-missing-field-run").click();
    const error = page.getByTestId("todo-windows-missing-field-error");
    await expect(error).toContainText("query-param-not-allowed", {timeout: CONVERGE_TIMEOUT});
    await expect(error).toContainText('Add "title" to queryFields');
    await expect(error).toContainText("Allowed: completed, created, ownerId.");
    await capture(page, "todo-windows-missing-queryfield");
  });
});
