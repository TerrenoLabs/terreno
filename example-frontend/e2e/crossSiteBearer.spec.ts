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
import {type BrowserContext, type Page, type Route, request} from "@playwright/test";
import {expect, test} from "./fixtures/test";
import {TEST_USER} from "./fixtures/testUsers";
import {loginAs} from "./helpers/login";

const CROSS_SITE_API_URL = "http://127.0.0.1:4000";
const CROSS_SITE_SOCKET_URL = `${CROSS_SITE_API_URL.replace(/^http/, "ws")}/socket.io/`;
// Mirrors lib/betterAuth.ts's storage prefix and rtk's `${storagePrefix}_bearer_token` key.
const BEARER_TOKEN_KEY = "terreno-example_bearer_token";
const SOCKET_TIMEOUT = 20_000;

// Response headers the proxy drops: the cookie under test, and the encoding headers that no
// longer match the decoded body Playwright hands back.
const DROPPED_RESPONSE_HEADERS = ["content-encoding", "content-length", "set-cookie"];

/**
 * Socket.IO namespace outcomes per Engine.IO session: `40{"sid"` is a successful CONNECT and
 * `44` a CONNECT_ERROR, such as the server's auth middleware rejecting the handshake. Sessions
 * that emit `sync:subscribe` belong to the syncdb transport; the others to rtk's
 * useSocketConnection.
 */
interface SocketHandshakes {
  connected: Set<string>;
  rejected: string[];
  syncSubscribers: Set<string>;
}

const SYNC_SUBSCRIBE_PACKET = '42["sync:subscribe"';

/**
 * Proxies one API request through a fresh API context, so no cookie jar carries a session
 * between requests, and fulfills it without `set-cookie`.
 */
const fulfillWithoutCookies = async (route: Route): Promise<void> => {
  const api = await request.newContext();
  try {
    const response = await api.fetch(route.request(), {maxRedirects: 0});
    const headers = Object.fromEntries(
      Object.entries(response.headers()).filter(
        ([name]) => !DROPPED_RESPONSE_HEADERS.includes(name.toLowerCase())
      )
    );
    await route.fulfill({body: await response.body(), headers, status: response.status()});
  } catch (error) {
    // Usually the page cancelled the request (a long-lived stream on navigation); logged so a
    // backend that is down does not surface only as a later UI timeout.
    console.warn(`[crossSiteBearer] proxy failed for ${route.request().url()}`, error);
    await route.abort().catch(() => undefined);
  } finally {
    await api.dispose();
  }
};

/** Strips `set-cookie` from every API response; returns how many requests it proxied. */
const stripApiCookies = async (context: BrowserContext): Promise<() => number> => {
  let proxiedRequests = 0;
  await context.route(`${CROSS_SITE_API_URL}/**`, async (route) => {
    // Socket.IO long-polling holds requests open and sets no cookies; let it through untouched.
    if (route.request().url().includes("/socket.io/")) {
      await route.continue();
      return;
    }
    proxiedRequests += 1;
    await fulfillWithoutCookies(route);
  });
  return (): number => proxiedRequests;
};

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

/** Connected sessions split by client: syncdb's transport and rtk's useSocketConnection. */
const connectedClients = (handshakes: SocketHandshakes): {rtk: number; syncdb: number} => {
  const connected = [...handshakes.connected];
  const syncdb = connected.filter((sessionId) => handshakes.syncSubscribers.has(sessionId));
  return {rtk: connected.length - syncdb.length, syncdb: syncdb.length};
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

/** Better Auth's session cookies (`better-auth.session_token` and friends) on any domain. */
const betterAuthCookies = async (context: BrowserContext): Promise<string[]> => {
  const cookies = await context.cookies();
  return cookies
    .filter((cookie) => cookie.name.includes("better-auth"))
    .map((cookie) => `${cookie.domain} ${cookie.name}`);
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

    // Both Socket.IO clients authenticate with the token source: rtk's useSocketConnection and
    // the syncdb transport.
    await expect
      .poll(
        () => {
          const clients = connectedClients(handshakes);
          return clients.rtk > 0 && clients.syncdb > 0;
        },
        {timeout: SOCKET_TIMEOUT}
      )
      .toBe(true);
    expect(handshakes.rejected).toEqual([]);

    await page.goto("/ai");
    await page.getByTestId("gpt-input").waitFor({state: "visible"});
    // The tools button renders only once useMCPTools has listed the backend's MCP tools.
    await expect(page.getByTestId("gpt-tools-button")).toBeVisible();
    expect(await betterAuthCookies(context)).toEqual([]);
  });
});
