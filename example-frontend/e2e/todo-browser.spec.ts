import type {Page} from "@playwright/test";
import {expect, test} from "./fixtures/test";
import {TEST_USER} from "./fixtures/testUsers";
import {clearTodos} from "./helpers/clearTodos";
import {loginAs} from "./helpers/login";
import {allowSyncDbNoise, CONVERGE_TIMEOUT, waitForSyncTodosScreen} from "./helpers/syncdbSuite";
import {createTodoAs} from "./helpers/todosApi";

const PHONE = {height: 844, width: 390};
const TABLET = {height: 768, width: 1024};

// A clickable Box renders its pressable as `${testID}-clickable`; that element carries aria-current.
const row = (page: Page, id: string) => page.getByTestId(`todo-browser-item-${id}-clickable`);
const detail = (page: Page, id: string) => page.getByTestId(`todo-browser-detail-${id}`);

const seedTodos = async (): Promise<{first: string; second: string}> => {
  await clearTodos();
  const first = await createTodoAs(TEST_USER, "Browse first");
  const second = await createTodoAs(TEST_USER, "Browse second");
  return {first: first._id, second: second._id};
};

const openTodoBrowser = async (page: Page): Promise<void> => {
  await waitForSyncTodosScreen(page);
  await page.getByTestId("todos-browse-button").click();
  await page
    .getByTestId("todo-browser-list")
    .waitFor({state: "visible", timeout: CONVERGE_TIMEOUT});
};

test.describe("Todo browser on a phone", () => {
  test.use({viewport: PHONE});
  let ids: {first: string; second: string};

  test.beforeEach(async ({page, consoleGuard}) => {
    allowSyncDbNoise(consoleGuard);
    ids = await seedTodos();
    await loginAs(page);
    await openTodoBrowser(page);
  });

  test("user opens a todo and goes back to the list", async ({page}) => {
    await row(page, ids.first).waitFor({state: "visible", timeout: CONVERGE_TIMEOUT});
    await expect(page.getByTestId("list-detail-list-pane")).toHaveCount(0);

    await row(page, ids.first).click();
    await detail(page, ids.first).waitFor({state: "visible"});
    await expect(page).toHaveURL(new RegExp(`/todo-browser/${ids.first}$`));
    await expect(page.getByTestId("list-detail-list-pane")).toHaveCount(0);
    await expect(page.getByTestId("todo-browser-list")).toBeHidden();

    await page.goBack();
    await page.getByTestId("todo-browser-list").waitFor({state: "visible"});
    await expect(page).toHaveURL(/\/todo-browser$/);
  });
});

test.describe("Todo browser on a tablet", () => {
  test.use({viewport: TABLET});
  let ids: {first: string; second: string};

  test.beforeEach(async ({page, consoleGuard}) => {
    allowSyncDbNoise(consoleGuard);
    ids = await seedTodos();
    await loginAs(page);
  });

  test("user sees the list beside the open todo and switches todos", async ({page}) => {
    await openTodoBrowser(page);
    await expect(page.getByTestId("list-detail-list-pane")).toBeVisible();
    await expect(page.getByTestId("list-detail-empty")).toBeVisible();

    await row(page, ids.first).click();
    await detail(page, ids.first).waitFor({state: "visible"});
    await expect(page).toHaveURL(new RegExp(`/todo-browser/${ids.first}$`));
    await expect(page.getByTestId("todo-browser-list")).toBeVisible();
    await expect(row(page, ids.first)).toHaveAttribute("aria-current", "true");

    await row(page, ids.second).click();
    await detail(page, ids.second).waitFor({state: "visible"});
    await expect(detail(page, ids.first)).toHaveCount(0);
    await expect(row(page, ids.second)).toHaveAttribute("aria-current", "true");
    await expect(row(page, ids.first)).not.toHaveAttribute("aria-current", "true");

    // The second todo replaced the first, so back returns to the list, not the first todo.
    await page.goBack();
    await expect(page).toHaveURL(/\/todo-browser$/);
    await expect(page.getByTestId("list-detail-empty")).toBeVisible();
  });

  test("user deep links to a todo and sees it selected in the list", async ({page}) => {
    await waitForSyncTodosScreen(page);
    await page.goto(`/todo-browser/${ids.second}`);

    await detail(page, ids.second).waitFor({state: "visible", timeout: CONVERGE_TIMEOUT});
    await expect(page.getByTestId("list-detail-list-pane")).toBeVisible();
    await expect(row(page, ids.second)).toHaveAttribute("aria-current", "true");
  });

  test("user keeps the open todo when the window narrows to phone width", async ({page}) => {
    await openTodoBrowser(page);
    await row(page, ids.first).click();
    await detail(page, ids.first).waitFor({state: "visible"});

    await page.setViewportSize(PHONE);

    await expect(page.getByTestId("list-detail-list-pane")).toHaveCount(0);
    await expect(detail(page, ids.first)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/todo-browser/${ids.first}$`));
  });

  test("user leaves the todo browser from the open todo", async ({page}) => {
    await openTodoBrowser(page);
    await row(page, ids.first).click();
    await detail(page, ids.first).waitFor({state: "visible"});

    // The index screen under the open todo has its own (hidden) header button.
    await page.getByTestId("list-detail-leave").filter({visible: true}).click();

    await page.getByTestId("todos-screen").waitFor({state: "visible"});
    await expect(page).not.toHaveURL(/todo-browser/);
  });

  test("user tabs from the list into the open todo", async ({page}) => {
    await openTodoBrowser(page);
    await row(page, ids.first).click();
    await detail(page, ids.first).waitFor({state: "visible"});

    // The list is newest first, so the first seeded todo is the last row.
    await row(page, ids.first).focus();
    await page.keyboard.press("Tab");

    const isFocusInDetail = await page.evaluate((): boolean => {
      const pane = document.querySelector('[data-testid="list-detail-detail-pane"]');
      return pane?.contains(document.activeElement) ?? false;
    });
    expect(isFocusInDetail).toBe(true);
  });
});
