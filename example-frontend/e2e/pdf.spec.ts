import {expect, test} from "@playwright/test";
import {loginAs} from "./helpers/login";

test.describe("PDF Generation", () => {
  test.beforeEach(async ({page}) => {
    await loginAs(page);
    await page.goto("/documents?section=pdf");
    await page.waitForLoadState("networkidle");
    await page.getByTestId("pdf-screen").first().waitFor({state: "visible"});
  });

  test("pdf screen renders correctly", async ({page}) => {
    await expect(page.getByTestId("pdf-generate-button").first()).toBeVisible();
    await expect(page.getByText("PDF Generation Test").first()).toBeVisible();
    await expect(page.getByText("Sample Data Preview").first()).toBeVisible();
  });

  test("user can generate a pdf", async ({page}) => {
    const downloadPromise = page.waitForEvent("download");

    await page.getByTestId("pdf-generate-button").first().click();

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^consent-sample-consent-.*\.pdf$/);

    await page.getByTestId("pdf-status-text").first().waitFor({state: "visible"});
    await expect(page.getByText("PDF generated successfully!").first()).toBeVisible();
  });
});
