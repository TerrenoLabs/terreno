import {expect, test} from "./fixtures/test";
import {loginAsAdmin} from "./helpers/adminAuth";

test.describe("Admin contributed custom screens", () => {
  test.beforeEach(async ({page}) => {
    await loginAsAdmin(page);
  });

  test("renders the Documents browser through AdminScreenRouter", async ({consoleGuard, page}) => {
    consoleGuard.allow("Failed to load resource: the server responded with a status of 503");
    await page.goto("/admin/documents");
    await page.getByTestId("document-refresh-button").waitFor({state: "visible", timeout: 15_000});
    // The app tab is also titled Documents and stays mounted hidden. Box onClick
    // puts the nav test id on the pressable as `${testID}-clickable`.
    await expect(page.getByTestId("admin-shell-nav-screen-documents-clickable")).toBeVisible();
    await expect(page.getByTestId("document-refresh-button")).toBeVisible();
  });

  test("renders the AI request explorer through AdminScreenRouter", async ({
    consoleGuard,
    page,
  }) => {
    consoleGuard.allow("UTC is not a valid timezone");
    await page.goto("/admin/ai-requests");
    await expect(page.getByText("AI Request Explorer").first()).toBeVisible();
  });
});
