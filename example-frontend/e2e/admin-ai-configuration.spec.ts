import type {Page} from "@playwright/test";

import {expect, test} from "./fixtures/test";
import {ADMIN_USER, TEST_USER} from "./fixtures/testUsers";
import {loginAsAdmin} from "./helpers/adminAuth";
import {ensureLoggedOut, loginAs} from "./helpers/login";
import {type SkillsApi, skillsApiAs} from "./helpers/skillsApi";

const SYSTEM_PROMPT_INPUT = "config-ai-systemPrompt-input";
const IMAGE_STYLE_INPUT = "config-ai-imageStylePrompt-input";

const openConfiguration = async (page: Page): Promise<void> => {
  await page.goto("/admin/configuration");
  await page.getByTestId("config-form").waitFor({state: "visible", timeout: 15_000});
  await page.getByTestId(SYSTEM_PROMPT_INPUT).waitFor({state: "visible"});
};

/** Replaces a field's text so it reads as an edit even when the stored value already matches. */
const replaceText = async (page: Page, testId: string, text: string): Promise<void> => {
  const input = page.getByTestId(testId);
  await input.fill(`${text} (edit)`);
  await input.fill(text);
};

const saveConfiguration = async (page: Page): Promise<void> => {
  const saved = page.waitForResponse(
    (response) =>
      response.url().includes("/configuration") &&
      ["PATCH", "PUT", "POST"].includes(response.request().method()) &&
      response.ok()
  );
  await page.getByTestId("config-save-button").click();
  await saved;
};

// The specs share one configuration document and one global skill list, so they run in order.
test.describe.configure({mode: "serial"});

test.describe("Admin AI configuration", () => {
  test.beforeEach(async ({page}) => {
    await ensureLoggedOut(page);
    await loginAsAdmin(page);
    await openConfiguration(page);
  });

  test("admin saves the system and image style prompts and sees them after reload", async ({
    page,
  }) => {
    await replaceText(page, SYSTEM_PROMPT_INPUT, "Answer as Terreno Bot");
    await replaceText(page, IMAGE_STYLE_INPUT, "Flat pastel illustration");
    await saveConfiguration(page);

    await page.reload();
    await page.getByTestId(SYSTEM_PROMPT_INPUT).waitFor({state: "visible", timeout: 15_000});
    await expect(page.getByTestId(SYSTEM_PROMPT_INPUT)).toHaveValue("Answer as Terreno Bot");
    await expect(page.getByTestId(IMAGE_STYLE_INPUT)).toHaveValue("Flat pastel illustration");
  });

  test("admin clears the system prompt and it saves as empty", async ({page}) => {
    await replaceText(page, SYSTEM_PROMPT_INPUT, "Answer as Terreno Bot");
    await saveConfiguration(page);

    await page.getByTestId(SYSTEM_PROMPT_INPUT).fill("");
    await saveConfiguration(page);

    await page.reload();
    await page.getByTestId(SYSTEM_PROMPT_INPUT).waitFor({state: "visible", timeout: 15_000});
    await expect(page.getByTestId(SYSTEM_PROMPT_INPUT)).toHaveValue("");
  });
});

test.describe("Admin global skills", () => {
  let adminApi: SkillsApi;

  test.beforeAll(async () => {
    adminApi = await skillsApiAs(ADMIN_USER);
    await adminApi.clear("global");
  });

  test.afterAll(async () => {
    await adminApi.clear("global");
    await adminApi.dispose();
  });

  test("admin creates team-poster and a regular user sees it with the global badge", async ({
    consoleGuard,
    page,
  }) => {
    // Two sign-ins (admin, then user) in one test.
    test.slow();
    // Switching from the admin to the user re-keys syncdb's local store, which logs this once.
    consoleGuard.allow(/\[syncdb\] persisted data for ".*" could not be decrypted/);
    await ensureLoggedOut(page);
    await loginAsAdmin(page);
    await page.goto("/admin/GptSkill/create");
    await page.getByTestId("admin-save-button").waitFor({state: "visible", timeout: 15_000});
    await page.getByTestId("admin-field-name").fill("team-poster");
    await page.getByTestId("admin-field-description").fill("Make posters in the team style.");
    await page.getByTestId("admin-field-instructions").fill("Use bold colors and big type.");
    await page.getByTestId("admin-save-button").click();
    await expect(page.getByTestId("admin-save-button")).toBeHidden({timeout: 15_000});

    await ensureLoggedOut(page);
    await loginAs(page, TEST_USER);
    await page.goto("/settings/skills");
    await page.getByTestId("skills-screen").waitFor({state: "visible"});
    await expect(page.getByTestId("skills-global-badge-team-poster")).toBeVisible();
  });
});
