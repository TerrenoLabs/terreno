import type {APIRequestContext, Page} from "@playwright/test";
import {expect, test} from "./fixtures/test";
import {ADMIN_USER} from "./fixtures/testUsers";
import {getAdminToken, setUserAdmin} from "./helpers/adminAuth";
import {loginAs} from "./helpers/login";

const API_URL = process.env.BACKEND_URL ?? "http://localhost:4000";

interface FlagAdmin {
  setEnabled: (enabled: boolean) => Promise<void>;
  remove: () => Promise<void>;
}

/** Creates a boolean flag through the admin API and returns controls for it. */
const createBooleanFlag = async (request: APIRequestContext, key: string): Promise<FlagAdmin> => {
  await setUserAdmin(ADMIN_USER.email);
  const token = await getAdminToken(request);
  const headers = {authorization: `Bearer ${token}`};
  const createResponse = await request.post(`${API_URL}/feature-flags/flags`, {
    data: {
      enabled: false,
      key,
      name: "E2E socket push flag",
      rolloutPercentage: 100,
      type: "boolean",
    },
    headers,
  });
  expect(createResponse.ok()).toBe(true);
  const created = (await createResponse.json()) as {data: {_id: string}};
  const flagId = created.data._id;
  return {
    remove: async (): Promise<void> => {
      await request.delete(`${API_URL}/feature-flags/flags/${flagId}`, {headers});
    },
    setEnabled: async (enabled: boolean): Promise<void> => {
      const response = await request.patch(`${API_URL}/feature-flags/flags/${flagId}`, {
        data: {enabled},
        headers,
      });
      expect(response.ok()).toBe(true);
    },
  };
};

/** Tracks the socket.io websockets the page currently has open. */
const trackSocketIoConnections = (page: Page): {openCount: () => number} => {
  const open = new Set<unknown>();
  page.on("websocket", (socket) => {
    if (!socket.url().includes("/socket.io/")) {
      return;
    }
    open.add(socket);
    socket.on("close", () => {
      open.delete(socket);
    });
  });
  return {openCount: (): number => open.size};
};

test.describe("Socket and live feature flags", () => {
  let flag: FlagAdmin | undefined;
  let flagKey = "";
  let sockets: {openCount: () => number};

  test.beforeEach(async ({page, request}) => {
    flagKey = `e2e-socket-flag-${Date.now()}`;
    flag = await createBooleanFlag(request, flagKey);
    sockets = trackSocketIoConnections(page);
    await loginAs(page);
    await page.goto("/profile");
    await page.getByTestId("profile-feature-flags-card").first().waitFor({state: "visible"});
  });

  test.afterEach(async () => {
    await flag?.remove();
    flag = undefined;
  });

  test("logged-in app keeps exactly one socket.io connection", async ({page}) => {
    await page.getByTestId(`profile-feature-flag-${flagKey}`).first().waitFor({state: "visible"});
    await expect.poll(() => sockets.openCount(), {timeout: 15_000}).toBe(1);
  });

  test("a flag change pushed by the server updates the UI", async ({page}) => {
    const flagValue = page.getByTestId(`profile-feature-flag-${flagKey}-value`).first();
    await expect(flagValue).toHaveText("false", {timeout: 15_000});
    // The push rides the syncdb socket; wait for it before changing the flag.
    await expect.poll(() => sockets.openCount(), {timeout: 15_000}).toBe(1);

    await flag?.setEnabled(true);

    await expect(flagValue).toHaveText("true", {timeout: 15_000});
    expect(sockets.openCount()).toBe(1);
  });
});
