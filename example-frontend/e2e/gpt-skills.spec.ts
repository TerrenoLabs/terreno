import path from "node:path";
import type {Page} from "@playwright/test";

import {expect, test} from "./fixtures/test";
import {ADMIN_USER, TEST_USER} from "./fixtures/testUsers";
import {loginAsAdmin} from "./helpers/adminAuth";
import {ensureLoggedOut, loginAs} from "./helpers/login";
import {type SkillsApi, skillsApiAs} from "./helpers/skillsApi";

const POSTER_STYLE = path.resolve(__dirname, "fixtures/poster-style.md");
const TEAM_POSTER = path.resolve(__dirname, "fixtures/team-poster.zip");

const openSkills = async (page: Page): Promise<void> => {
  await page.goto("/settings/skills");
  await page.getByTestId("skills-screen").waitFor({state: "visible"});
};

/** Picks `file` in the native file chooser the upload button opens. */
const uploadSkillFile = async (page: Page, file: string): Promise<void> => {
  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId("skills-upload-button").click();
  await (await chooser).setFiles(file);
};

// Specs share the users' skill lists, so they run in order and each one starts from a cleared list.
test.describe.configure({mode: "serial"});

test.describe("Skills screen", () => {
  let userApi: SkillsApi;
  let adminApi: SkillsApi;

  test.beforeAll(async () => {
    userApi = await skillsApiAs(TEST_USER);
    adminApi = await skillsApiAs(ADMIN_USER);
  });

  test.afterAll(async () => {
    await userApi.clear("user");
    await adminApi.clear("global");
    await userApi.dispose();
    await adminApi.dispose();
  });

  test.beforeEach(async ({page}) => {
    await adminApi.clear("global");
    await userApi.clear("user");
    await ensureLoggedOut(page);
    await loginAs(page);
    await openSkills(page);
  });

  test("user sees the empty state with no skills", async ({page}) => {
    await expect(page.getByTestId("skills-empty")).toBeVisible();
  });

  test("user can create a skill", async ({page}) => {
    await page.getByTestId("skills-new-button").click();
    await page.getByTestId("skills-form-name-input").fill("brand-voice");
    await page.getByTestId("skills-form-description-input").fill("Write in our brand voice.");
    await page.getByTestId("skills-form-instructions-input").fill("Be warm and plain-spoken.");
    await page.getByTestId("skills-form-save-button").click();
    await expect(page.getByTestId("skills-item-brand-voice")).toBeVisible();
    await expect(page.getByTestId("skills-empty")).toHaveCount(0);
  });

  test("user sees the API error inline for an invalid name", async ({consoleGuard, page}) => {
    // The 400 is the behavior under test; the browser and the screen both report it.
    consoleGuard.allow("Failed to load resource: the server responded with a status of 400");
    consoleGuard.allow("Failed to create skill");
    await page.getByTestId("skills-new-button").click();
    await page.getByTestId("skills-form-name-input").fill("Bad Name");
    await page.getByTestId("skills-form-description-input").fill("Bad name.");
    await page.getByTestId("skills-form-instructions-input").fill("Anything.");
    await page.getByTestId("skills-form-save-button").click();
    await expect(page.getByTestId("skills-form-error")).toBeVisible();
    await expect(page.getByTestId("skills-form-error")).not.toBeEmpty();
    await expect(page.getByTestId("skills-item-Bad Name")).toHaveCount(0);
  });

  test("user can upload a SKILL.md", async ({page}) => {
    await uploadSkillFile(page, POSTER_STYLE);
    await expect(page.getByTestId("skills-item-poster-style")).toBeVisible();
  });

  test("user can delete a skill after confirming", async ({page}) => {
    await userApi.seed({
      description: "Write in our brand voice.",
      instructions: "Be warm.",
      name: "brand-voice",
    });
    await openSkills(page);
    await expect(page.getByTestId("skills-item-brand-voice")).toBeVisible();
    await page.getByTestId("skills-delete-button-brand-voice").click();
    // The confirmation has no testID in the brief; it is the only other "Delete" button on screen.
    await page.getByRole("button", {exact: true, name: /^delete$/i}).click();
    await expect(page.getByTestId("skills-item-brand-voice")).toHaveCount(0);
  });

  test("user sees a global skill badged and cannot delete it", async ({page}) => {
    await adminApi.seed({
      description: "The house style.",
      instructions: "Keep it consistent.",
      name: "house-style",
      scope: "global",
    });
    await openSkills(page);
    await expect(page.getByTestId("skills-item-house-style")).toBeVisible();
    await expect(page.getByTestId("skills-global-badge-house-style")).toBeVisible();
    await expect(page.getByTestId("skills-delete-button-house-style")).toHaveCount(0);
  });

  test("a non-admin has no Install for everyone switch", async ({page}) => {
    await page.getByTestId("skills-new-button").click();
    await page.getByTestId("skills-form-name-input").waitFor({state: "visible"});
    await expect(page.getByTestId("skills-form-global-switch")).toHaveCount(0);
  });

  test("admin uploads a zip for everyone and a user sees it badged", async ({
    consoleGuard,
    page,
  }) => {
    // Two sign-ins (admin, then user) in one test.
    test.slow();
    // Switching from the admin to the user re-keys syncdb's local store, which logs this once.
    consoleGuard.allow(/\[syncdb\] persisted data for ".*" could not be decrypted/);
    await ensureLoggedOut(page);
    await loginAsAdmin(page);
    await openSkills(page);
    const globalSwitch = page.getByTestId("skills-form-global-switch");
    await expect(globalSwitch).toBeVisible();
    await globalSwitch.click();
    await uploadSkillFile(page, TEAM_POSTER);
    await expect(page.getByTestId("skills-global-badge-team-poster")).toBeVisible();

    await ensureLoggedOut(page);
    await loginAs(page);
    await openSkills(page);
    await expect(page.getByTestId("skills-global-badge-team-poster")).toBeVisible();
  });
});
