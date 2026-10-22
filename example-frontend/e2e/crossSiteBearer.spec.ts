/**
 * Cross-site web sign-in with Better Auth's bearer scheme and no cookies.
 *
 * playwright.config.ts runs this spec on its own: the web app at localhost:8082 calls the API at
 * 127.0.0.1:4000 (a different site) with `EXPO_PUBLIC_BETTER_AUTH_WEB_BEARER=true`. Every API
 * response loses its `set-cookie` header before the browser sees it, the way Safari treats
 * third-party cookies, so the session has to survive a reload on the stored bearer token alone.
 *
 * With a route set, Playwright's Chromium answers CORS preflights itself, so this spec does not
 * cover the server's real preflight; the deployed bearer smoke does.
 */
import type {Page} from "@playwright/test";
import {expect, test} from "./fixtures/test";
import {TEST_USER} from "./fixtures/testUsers";
import {
  BEARER_TOKEN_KEY,
  betterAuthCookies,
  CROSS_SITE_API_URL,
  stripApiCookies,
} from "./helpers/crossSiteApi";
import {loginAs} from "./helpers/login";

const CROSS_SITE_SOCKET_URL = `${CROSS_SITE_API_URL.replace(/^http/, "ws")}/socket.io/`;
const SOCKET_TIMEOUT = 20_000;

/**
 * Socket.IO namespace outcomes per Engine.IO session: `40{"sid"` is a successful CONNECT and
 * `44` a CONNECT_ERROR, such as the server's auth middleware rejecting the handshake. Sessions
 * that emit `sync:subscribe` belong to the syncdb transport, the app's one socket.
 */
interface SocketHandshakes {
  connected: Set<string>;
  rejected: string[];
  syncSubscribers: Set<string>;
}

const SYNC_SUBSCRIBE_PACKET = '42["sync:subscribe"';

const engineSessionId = (url: string): string | null => new URL(url).searchParams.get("sid");

// Engine.IO joins polling packets with the 0x1e record separator.
const splitPackets = (payload: string): string[] => payload.split("\u001e");

const recordReceived = (handshakes: SocketHandshakes, sessionId: string, payload: string): void => {
  for (const packet of splitPackets(payload)) {
    if (packet.startsWith('40{"sid"')) {
      handshakes.connected.add(sessionId);
    } else if (packet.startsWith("44")) {
      handshakes.rejected.push(packet);
    }
  }
};

const recordSent = (handshakes: SocketHandshakes, sessionId: string, payload: string): void => {
  if (splitPackets(payload).some((packet) => packet.startsWith(SYNC_SUBSCRIBE_PACKET))) {
    handshakes.syncSubscribers.add(sessionId);
  }
};

/** Connected sessions that subscribed to sync, i.e. the syncdb transport's sockets. */
const connectedSyncSockets = (handshakes: SocketHandshakes): number => {
  return [...handshakes.connected].filter((sessionId) => handshakes.syncSubscribers.has(sessionId))
    .length;
};

/** Watches every Socket.IO session to the API, over polling and after the WebSocket upgrade. */
const watchSocketHandshakes = (page: Page): SocketHandshakes => {
  const handshakes: SocketHandshakes = {
    connected: new Set(),
    rejected: [],
    syncSubscribers: new Set(),
  };
  page.on("request", (socketRequest) => {
    const url = socketRequest.url();
    const sessionId = engineSessionId(url);
    if (!url.startsWith(`${CROSS_SITE_API_URL}/socket.io/`) || !sessionId) {
      return;
    }
    if (socketRequest.method() === "POST") {
      recordSent(handshakes, sessionId, socketRequest.postData() ?? "");
    }
  });
  page.on("response", async (response) => {
    const url = response.url();
    const sessionId = engineSessionId(url);
    if (!url.startsWith(`${CROSS_SITE_API_URL}/socket.io/`) || !sessionId) {
      return;
    }
    if (response.request().method() !== "GET") {
      return;
    }
    const body = await response.text().catch(() => "");
    recordReceived(handshakes, sessionId, body);
  });
  page.on("websocket", (socket) => {
    const sessionId = engineSessionId(socket.url());
    if (!socket.url().startsWith(CROSS_SITE_SOCKET_URL) || !sessionId) {
      return;
    }
    socket.on("framereceived", ({payload}) => {
      recordReceived(handshakes, sessionId, String(payload));
    });
    socket.on("framesent", ({payload}) => {
      recordSent(handshakes, sessionId, String(payload));
    });
  });
  return handshakes;
};

test.describe("Cross-site bearer sign-in", () => {
  // Four full bundle loads (login, reload, profile, AI tab) run in one test.
  test.slow();

  let handshakes: SocketHandshakes;
  let proxiedRequests: () => number;

  test.beforeEach(async ({context, page}) => {
    proxiedRequests = await stripApiCookies(context);
    handshakes = watchSocketHandshakes(page);
    await loginAs(page, TEST_USER);
    await page.getByTestId("todos-screen").waitFor({state: "visible"});
  });

  test("user stays signed in across a reload with no cookies", async ({context, page}) => {
    expect(proxiedRequests(), "the app calls the API on 127.0.0.1, another site").toBeGreaterThan(
      0
    );
    const storedToken = await page.evaluate((key) => localStorage.getItem(key), BEARER_TOKEN_KEY);
    expect(storedToken, "the web client stores the bearer token from sign-in").toBeTruthy();
    expect(await betterAuthCookies(context)).toEqual([]);

    // Only sessions opened after the reload count towards the socket assertion below.
    handshakes.connected.clear();
    handshakes.syncSubscribers.clear();
    await page.reload();
    await page.getByTestId("todos-screen").waitFor({state: "visible"});
    await page.goto("/profile");
    await expect(page.getByTestId("profile-logged-in-as").first()).toContainText(TEST_USER.email);
    expect(await betterAuthCookies(context)).toEqual([]);

    // The syncdb socket (which also carries flags and server events) authenticates with the
    // shared authProvider's bearer token.
    await expect
      .poll(() => connectedSyncSockets(handshakes) > 0, {timeout: SOCKET_TIMEOUT})
      .toBe(true);
    expect(handshakes.rejected).toEqual([]);

    await page.goto("/ai");
    await page.getByTestId("gpt-input").waitFor({state: "visible"});
    // The tools button renders only once useMCPTools has listed the backend's MCP tools.
    await expect(page.getByTestId("gpt-tools-button")).toBeVisible();
    expect(await betterAuthCookies(context)).toEqual([]);
  });
});
