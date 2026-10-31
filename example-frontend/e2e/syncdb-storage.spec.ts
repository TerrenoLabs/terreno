/**
 * SyncDB storage guarantees: encryption at rest (AC-14) and the local wipe on user
 * switch (AC-7). Shared suite notes and helpers live in helpers/syncdbSuite.ts. Uses
 * a dedicated user so it can run in parallel with the other syncdb-*.spec.ts files
 * (SECOND_USER is only ever mutated here during this phase, so the cross-user scenario
 * stays isolated too).
 */
import {expect, test} from "./fixtures/test";
import {SECOND_USER, SYNCDB_STORAGE_USER} from "./fixtures/testUsers";
import {ensureLoggedOut, loginAs} from "./helpers/login";
import {
  allowAuthWhileOffline,
  allowSyncDbNoise,
  CONVERGE_TIMEOUT,
  createTodoViaUi,
  goSyncOffline,
  installOfflineControl,
  openSyncTodos,
  readAllStorageSerialized,
  readSyncDbBlobLength,
  restoreNetwork,
  SYNC_DB_NAME,
  SYNCDB_TEST_TIMEOUT,
  todoItemByTitle,
  waitForSyncTodosScreen,
} from "./helpers/syncdbSuite";
import {clearTodosAs, createTodoAs, listTodosAs} from "./helpers/todosApi";

const USER = SYNCDB_STORAGE_USER;

// Logging in through the UI happens inside beforeEach, which Playwright charges to the
// test timeout — see SYNCDB_TEST_TIMEOUT.
test.describe.configure({timeout: SYNCDB_TEST_TIMEOUT});

test.describe("SyncDB encryption at rest (AC-14)", () => {
  test.beforeEach(async ({page, consoleGuard}) => {
    allowSyncDbNoise(consoleGuard);
    await clearTodosAs(USER);
    // Sentinel todo: rendering it proves syncDb.start() completed before we mutate.
    const sentinel = await createTodoAs(USER, "Pre-synced sentinel");
    await loginAs(page, USER);
    await openSyncTodos(page);
    await expect(page.getByTestId(`todo-item-${sentinel._id}`)).toBeVisible({
      timeout: CONVERGE_TIMEOUT,
    });
  });

  test("IndexedDB holds only ciphertext and the store decrypts after reload", async ({page}) => {
    // Wait for the persister's first (post-bootstrap) save so growth below can only
    // come from a save that snapshots the store after the marker todo exists.
    await expect
      .poll(() => readSyncDbBlobLength(page), {timeout: CONVERGE_TIMEOUT})
      .toBeGreaterThan(0);
    const baseline = await readSyncDbBlobLength(page);

    await createTodoViaUi(page, "SECRET_MARKER_XYZ");
    await expect(page.getByTestId("sync-queued-count")).toBeHidden({timeout: CONVERGE_TIMEOUT});

    // Wait out the debounced persister save (poll, no waitForTimeout).
    await expect
      .poll(() => readSyncDbBlobLength(page), {timeout: CONVERGE_TIMEOUT})
      .toBeGreaterThan(baseline);

    const storage = await readAllStorageSerialized(page);
    expect(storage.databases).toContain(SYNC_DB_NAME);
    expect(storage.serialized).not.toContain("SECRET_MARKER_XYZ");

    // Reload: the persisted blob decrypts and the todo renders with its title.
    await page.reload();
    await waitForSyncTodosScreen(page);
    await expect(todoItemByTitle(page, "SECRET_MARKER_XYZ")).toBeVisible({
      timeout: CONVERGE_TIMEOUT,
    });
  });
});

test.describe("SyncDB user switch wipe (AC-7)", () => {
  let seededForA: {_id: string; title: string};

  test.beforeEach(async ({page, consoleGuard}) => {
    allowSyncDbNoise(consoleGuard);
    await clearTodosAs(USER);
    await clearTodosAs(SECOND_USER);
    seededForA = await createTodoAs(USER, "User A synced todo");
    await installOfflineControl(page);
    await loginAs(page, USER);
    await openSyncTodos(page);
    await expect(page.getByTestId(`todo-item-${seededForA._id}`)).toBeVisible({
      timeout: CONVERGE_TIMEOUT,
    });
  });

  test("logging in as another user wipes local data and the queued outbox", async ({page}) => {
    // Queue an offline mutation as user A.
    await goSyncOffline(page);
    await page.getByTestId("todos-title-input").fill("A queued secret");
    await page.getByTestId("todos-create-button").click();
    await expect(page.getByTestId("sync-queued-count")).toContainText("1");

    // Log out while sync is still offline so the queued mutation cannot replay as A. The
    // sign-out itself must reach the server: rtk's logout() keeps a session it could not end.
    // Navigate via the tab bar (client-side) — a full goto would reload the document
    // and re-evaluate the feature flag against the blocked network.
    await allowAuthWhileOffline(page);
    await page.getByTestId("tab-profile").click();
    await page.getByTestId("profile-logout-button").waitFor({state: "visible", timeout: 15_000});
    await page.getByTestId("profile-logout-button").click();
    await page.getByTestId("login-screen").first().waitFor({state: "visible"});

    // Restore the network, then switch users. This scenario is inherently a mid-test
    // user switch, so loginAs is reused here rather than in beforeEach.
    await restoreNetwork(page);

    // Already signed out; this only confirms the login screen after the network change.
    await ensureLoggedOut(page);

    await loginAs(page, SECOND_USER);
    await openSyncTodos(page);

    // None of A's data or queued work is visible as B.
    await expect(page.getByTestId("todos-empty-state")).toBeVisible({timeout: CONVERGE_TIMEOUT});
    await expect(page.locator('[data-testid^="todo-item-"]')).toHaveCount(0);
    await expect(page.getByTestId("sync-queued-count")).toBeHidden();

    // A's queued create is never replayed under B's identity.
    const bTodos = await listTodosAs(SECOND_USER);
    expect(bTodos.some((todo) => todo.title === "A queued secret")).toBe(false);

    // Logging back in as A re-bootstraps A's server data.
    await page.goto("/profile");
    await page.getByTestId("profile-logout-button").waitFor({state: "visible"});
    await page.getByTestId("profile-logout-button").click();
    await page.getByTestId("login-screen").first().waitFor({state: "visible"});
    await loginAs(page, USER);
    await openSyncTodos(page);
    await expect(page.getByTestId(`todo-item-${seededForA._id}`)).toBeVisible({
      timeout: CONVERGE_TIMEOUT,
    });
  });
});
