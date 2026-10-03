import type {Locator, Page} from "@playwright/test";
import {expect, test} from "./fixtures/test";
import {getAdminToken, loginAsAdmin} from "./helpers/adminAuth";
import {adminModelEntry} from "./helpers/adminUi";
import {loginAs} from "./helpers/login";

const permissionControl = (page: Page, resource: string, action: string): Locator => {
  const testID = `admin-role-permission-${resource}-${action}`;
  return page.getByTestId(`${testID}-clickable`).or(page.getByTestId(testID));
};

test.describe("Admin Panel", () => {
  test.beforeEach(async ({page, consoleGuard}) => {
    consoleGuard.allow("UTC is not a valid timezone");
    await loginAsAdmin(page);
    await page.goto("/admin");
  });

  test("admin panel renders model list", async ({page}) => {
    const userEntry = adminModelEntry(page, "User");
    const todoEntry = adminModelEntry(page, "Todo");
    await userEntry.first().waitFor({state: "visible"});
    await expect(userEntry.first()).toBeVisible();
    await expect(todoEntry.first()).toBeVisible();
  });

  test("admin panel shows custom screens", async ({page}) => {
    await expect(page.getByText("AI Requests").first()).toBeVisible();
    // The app tab is also titled Documents and stays mounted hidden. Box onClick
    // puts the nav test id on the pressable as `${testID}-clickable`.
    await expect(page.getByTestId("admin-shell-nav-screen-documents-clickable")).toBeVisible();
  });

  test("can navigate to model table", async ({page}) => {
    const todoEntry = adminModelEntry(page, "Todo");
    await todoEntry.first().waitFor({state: "visible"});
    await todoEntry.first().click();
    await page.getByTestId("admin-create-button").waitFor({state: "visible"});
    await expect(page.getByTestId("admin-create-button")).toBeVisible();
  });

  test("can navigate to create form", async ({page}) => {
    const todoEntry = adminModelEntry(page, "Todo");
    await todoEntry.first().waitFor({state: "visible"});
    await todoEntry.first().click();
    await page.getByTestId("admin-create-button").waitFor({state: "visible"});
    await page.getByTestId("admin-create-button").click();
    await page.getByTestId("admin-save-button").waitFor({state: "visible"});
    await expect(page.getByTestId("admin-save-button")).toBeVisible();
  });

  test("can create a todo via admin", async ({page, request}) => {
    const API_URL = process.env.BACKEND_URL ?? "http://localhost:4000";
    const token = await getAdminToken(request);

    // Seed via the consumer todos API — ownerId is assigned server-side. Admin POST
    // strips readonly ownerId, so /admin/todos cannot accept it in the body.
    const todoTitle = `Admin Todo ${Date.now()}`;
    const createRes = await request.post(`${API_URL}/todos`, {
      data: {title: todoTitle},
      headers: {authorization: `Bearer ${token}`},
    });
    expect(createRes.ok()).toBeTruthy();

    // Navigate to the Todos admin table
    const todoEntry = adminModelEntry(page, "Todo");
    await todoEntry.first().waitFor({state: "visible"});
    await todoEntry.first().click();

    // Verify the todo appears in the admin table. Other screens (e.g. the
    // consumer todos tab) may still be mounted in the background and receive
    // the same todo via realtime sync — scope the locator to a visible element
    // so we don't match a hidden duplicate.
    await expect(page.getByText(todoTitle).locator("visible=true").first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test("admin panel shows configuration in the shell nav", async ({page}) => {
    const configurationEntry = page
      .getByTestId("admin-shell-nav-configuration-clickable")
      .or(page.getByTestId("admin-shell-nav-configuration"))
      .or(page.getByTestId("admin-configuration-card-clickable"))
      .or(page.getByTestId("admin-configuration-card"));
    const menuButton = page
      .getByTestId("admin-shell-menu-button-clickable")
      .or(page.getByTestId("admin-shell-menu-button"));
    if (await menuButton.first().isVisible()) {
      await menuButton.first().click();
    }
    await configurationEntry.first().waitFor({state: "visible"});
    await expect(configurationEntry.first()).toBeVisible();
  });

  test("superadmin profile lists its role and links to role editing", async ({page}) => {
    await page.goto("/profile");
    await page.getByTestId("profile-roles-card").waitFor({state: "visible"});

    await expect(page.getByTestId("profile-roles-list")).toContainText("superadmin");
    await page.getByTestId("profile-edit-roles-button").click();
    await expect(page).toHaveURL(/\/admin\/roles$/);
  });

  test("admin scripts include the database reset action", async ({page}) => {
    await page.goto("/admin/__scripts");

    await expect(page.getByTestId("admin-script-card-resetDatabase")).toBeVisible();
    await page.getByTestId("admin-script-run-resetDatabase").click();
    await page.getByTestId("admin-script-dry-run-button").click();

    await expect(page.getByText("Dry run completed cleanly.")).toBeVisible({timeout: 15_000});
    await expect(page.getByText(/Dry run: would reset \d+ record/)).toBeVisible();
  });

  test("can create and edit a role with attached permissions", async ({page, request}) => {
    const API_URL = process.env.BACKEND_URL ?? "http://localhost:4000";
    const token = await getAdminToken(request);
    const roleName = "e2eRoleEditor";
    await request.delete(`${API_URL}/rbac/roles/${roleName}`, {
      headers: {authorization: `Bearer ${token}`},
    });

    await page.goto("/admin/roles");
    await expect(page.getByTestId("admin-permissions-list")).toContainText("todo:update");
    await page.getByTestId("admin-roles-add-button").click();
    await page.getByTestId("admin-role-name").fill(roleName);
    await page.getByTestId("admin-role-display-name").fill("E2E Role Editor");
    await page.getByTestId("admin-role-description").fill("Created by Playwright");
    await permissionControl(page, "todo", "read").click();
    const saveButton = page.getByTestId("admin-role-save-button");
    await saveButton.scrollIntoViewIfNeeded();
    await saveButton.click();

    const roleItem = page.getByTestId(`admin-roles-item-${roleName}`);
    await expect(roleItem).toContainText("todo:read");
    await page.getByTestId(`admin-roles-edit-${roleName}`).click();
    await permissionControl(page, "todo", "update").click();
    await saveButton.scrollIntoViewIfNeeded();
    await saveButton.click();
    await expect(roleItem).toContainText("todo:update");

    await request.delete(`${API_URL}/rbac/roles/${roleName}`, {
      headers: {authorization: `Bearer ${token}`},
    });
  });
});

test.describe("Admin Access Control", () => {
  test("non-admin user cannot see admin button in profile", async ({page}) => {
    await loginAs(page);
    await page.goto("/profile");
    await page.getByTestId("profile-name-input.edit-clickable").first().waitFor({state: "visible"});
    await expect(page.getByTestId("profile-admin-button")).not.toBeVisible();
  });
});
