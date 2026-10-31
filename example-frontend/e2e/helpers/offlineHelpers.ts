import type {Page} from "@playwright/test";
import type {ConsoleGuard} from "../fixtures/test";
import {TEST_USER} from "../fixtures/testUsers";
import {createTodoAs, patchTodoAs, type TodoApiUser, type TodoRecord} from "./todosApi";

const API_URL = process.env.BACKEND_URL ?? "http://localhost:4000";

/**
 * Patterns emitted as console.warn/error while the app is offline. The browser
 * logs net::ERR_CONNECTION_REFUSED for every blocked API request, and consent
 * fetching paths log a warning when those requests fail.
 */
export const allowOfflineNoise = (consoleGuard: ConsoleGuard): void => {
  consoleGuard.allow("Failed to load resource: net::ERR_CONNECTION_REFUSED");
  consoleGuard.allow("Failed to load resource: net::ERR_INTERNET_DISCONNECTED");
  consoleGuard.allow("[useConsentForms] Failed to fetch pending consent forms");
  consoleGuard.allow("[ConsentNavigator] Error fetching pending consents");
  consoleGuard.allow("Sentry not initialized, captured exception Error:");
  // Conflict-detection tests deliberately trigger 409s from the backend.
  consoleGuard.allow("Failed to load resource: the server responded with a status of 409");
  // Replay attempts may surface non-Network failures (e.g. tombstoned docs).
  consoleGuard.allow(/^\[offline\] Replay failed for /);
  // Sentry's getOpenApi fetch can fail while routes are intercepted offline.
  consoleGuard.allow("Error fetching OpenAPI spec");
};

/**
 * Simulate going offline by blocking API requests and dispatching offline event.
 */
export const goOffline = async (page: Page): Promise<void> => {
  // Block all API requests to the backend
  await page.route(`${API_URL}/**`, (route) => route.abort("connectionrefused"));
  await page.route("**/todos**", (route) => {
    // Only block if it's going to our API
    const url = route.request().url();
    if (url.includes("localhost:4000") || url.includes(API_URL)) {
      return route.abort("connectionrefused");
    }
    return route.continue();
  });

  // Dispatch the offline event so the middleware detects the state change
  await page.evaluate(() => {
    window.dispatchEvent(new Event("offline"));
  });
};

/**
 * Simulate coming back online by removing route blocks and dispatching online event.
 */
export const goOnline = async (page: Page): Promise<void> => {
  // Remove all route blocks
  await page.unroute(`${API_URL}/**`);
  await page.unroute("**/todos**");

  // Dispatch the online event
  await page.evaluate(() => {
    window.dispatchEvent(new Event("online"));
  });
};

/**
 * Create a todo directly via the API (bypassing the browser), as the given user.
 * Returns the created todo including its _id and updated timestamp.
 */
export const createTodoViaApi = async (
  title: string,
  user: TodoApiUser = TEST_USER
): Promise<TodoRecord> => {
  return createTodoAs(user, title);
};

/**
 * Update a todo directly via the API (simulating another client), as the given user.
 */
export const updateTodoViaApi = async (
  todoId: string,
  body: Record<string, unknown>,
  user: TodoApiUser = TEST_USER
): Promise<TodoRecord> => {
  return patchTodoAs(user, todoId, body);
};
