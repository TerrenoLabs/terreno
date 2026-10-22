/**
 * Shared helpers for the @terreno/syncdb local-first e2e suite (Tasks 7.2/7.3/7.4,
 * acceptance criteria AC-1..AC-14 in docs/implementationPlans/syncdb-local-first.md).
 * The suite is split across the syncdb-*.spec.ts files so each file can run on its
 * own worker (and CI shard) with its own dedicated user.
 *
 * Offline simulation severs the network instead of using the dev panel's
 * `syncdb-offline-toggle` (which now uses the client's goOffline()/goOnline()
 * transport-level simulation). The tests abort HTTP requests to the backend and
 * sever/refuse the socket.io WebSocket via page.routeWebSocket, which is a truer
 * outage: the client stays started, mutations queue in the durable outbox, and the
 * transport reports disconnected. API seeding from the test runner (simulating
 * "another client") is unaffected because only the page's requests are blocked.
 *
 * Note on clickable Boxes: @terreno/ui Box renders onClick pressables with a
 * "-clickable" testID suffix (Box.tsx), so `todo-toggle-{id}` / `sync-conflict-badge`
 * are addressed as `todo-toggle-{id}-clickable` / `sync-conflict-badge-clickable`,
 * matching the convention already used by todos.spec.ts. `clickTodoControl`
 * scrolls the target to the viewport center so the Expo Router tab bar does
 * not intercept Playwright clicks on the 720px CI viewport.
 */
import type {Browser, BrowserContext, Locator, Page, WebSocketRoute} from "@playwright/test";
import type {ConsoleGuard} from "../fixtures/test";

export const SYNC_DB_NAME = "terreno-example";
export const CONVERGE_TIMEOUT = 20_000;

/**
 * Per-test budget for the syncdb suites, applied with `test.describe.configure`.
 *
 * Playwright counts `beforeEach` against the test timeout, and these hooks seed the
 * backend, log in through the UI, and then wait up to CONVERGE_TIMEOUT for the seeded
 * sentinel — which can exceed the 30s CI default before the test body even starts. When
 * it does, the run dies with a generic "Test timeout exceeded while running beforeEach"
 * and truncates whichever convergence assertion was mid-flight, so the failure says
 * nothing about which wait actually stalled. Every meaningful wait in these suites
 * carries its own explicit timeout; this only bounds the total.
 */
export const SYNCDB_TEST_TIMEOUT = 90_000;

const API_URL = process.env.BACKEND_URL ?? "http://localhost:4000";

/** Console noise expected while the network is severed and the client reconnects. */
export const allowSyncDbNoise = (consoleGuard: ConsoleGuard): void => {
  consoleGuard.allow(/\[syncdb\]/);
  consoleGuard.allow(/\[sync\]/);
  consoleGuard.allow(/WebSocket/i);
  consoleGuard.allow(/websocket error/i);
  consoleGuard.allow(/socket\.io/i);
  consoleGuard.allow("Failed to load resource");
  consoleGuard.allow("Sentry not initialized");
  consoleGuard.allow("[useConsentForms] Failed to fetch pending consent forms");
  consoleGuard.allow("[ConsentNavigator] Error fetching pending consents");
  consoleGuard.allow("Error fetching OpenAPI spec");
  // Logging out while offline (see syncdb-storage.spec.ts's user-switch scenario)
  // legitimately fails Better Auth's session and sign-out network calls. The session
  // store in @terreno/syncdb/auth logs these (they were "Better Auth: ..." before 58).
  consoleGuard.allow("[terreno/syncdb] Error syncing session: TypeError: Failed to fetch");
  consoleGuard.allow("[terreno/syncdb] Error signing out");
  consoleGuard.allow(/sync needs attention/i);
  // Queueing mutations against a severed network is the point of these suites, so the
  // app's own "queue is deep" health warning is expected rather than a defect.
  consoleGuard.allow(/Sync is falling behind/i);
};

export const todoItemByTitle = (page: Page, title: string): Locator =>
  page.locator('[data-testid^="todo-item-"]').filter({hasText: title});

/**
 * Click a control that may sit under the bottom tab bar. Playwright's default
 * scroll-into-view aligns to the viewport bottom, which is exactly where `/ai`
 * intercepts pointer events on the 720px Desktop Chrome CI viewport.
 */
export const clickTodoControl = async (locator: Locator): Promise<void> => {
  await locator.waitFor({state: "visible"});
  await locator.evaluate((node: HTMLElement) => {
    node.scrollIntoView({block: "center", inline: "center"});
  });
  await locator.click({force: true});
};

/**
 * Wait for the syncdb-backed Todos screen. The banner is asserted as *attached*
 * rather than visible: when sync is idle it renders no children, and Playwright
 * treats the resulting zero-size element as hidden.
 */
export const waitForSyncTodosScreen = async (page: Page): Promise<void> => {
  await page.getByTestId("todos-screen").first().waitFor({state: "visible", timeout: 30_000});
  await page.getByTestId("sync-status-banner").waitFor({state: "attached", timeout: 30_000});
  await page.getByTestId("todos-title-input").waitFor({state: "visible"});
};

export const openSyncTodos = async (page: Page): Promise<void> => {
  await page.goto("/");
  await waitForSyncTodosScreen(page);
};

/**
 * Network-level offline simulation. installOfflineControl must run before login so
 * the WebSocket route wraps every socket.io connection the page opens; goSyncOffline
 * then severs live sockets and refuses new connections + HTTP until goSyncOnline.
 * (The dev panel's syncdb-offline-toggle is not used: these tests exercise a real
 * network outage rather than the client's built-in simulation — see the header note.)
 */
const offlinePages = new WeakSet<Page>();
const liveSockets = new WeakMap<Page, Set<WebSocketRoute>>();

export const installOfflineControl = async (page: Page): Promise<void> => {
  liveSockets.set(page, new Set());
  await page.routeWebSocket(/\/socket\.io\//, (ws) => {
    if (offlinePages.has(page)) {
      ws.close();
      return;
    }
    const server = ws.connectToServer();
    ws.onMessage((message) => server.send(message));
    server.onMessage((message) => ws.send(message));
    const sockets = liveSockets.get(page);
    sockets?.add(ws);
    ws.onClose(() => sockets?.delete(ws));
  });
};

export const goSyncOffline = async (page: Page): Promise<void> => {
  offlinePages.add(page);
  await page.route(`${API_URL}/**`, (route) => route.abort("connectionrefused"));
  for (const ws of liveSockets.get(page) ?? []) {
    ws.close();
  }
  await page.getByTestId("sync-offline-indicator").waitFor({state: "visible", timeout: 15_000});
};

export const goSyncOnline = async (page: Page): Promise<void> => {
  offlinePages.delete(page);
  await page.unroute(`${API_URL}/**`);
  // socket.io retries with backoff (max 5s), so reconnect lands within a few seconds.
  await page.getByTestId("sync-offline-indicator").waitFor({state: "hidden", timeout: 30_000});
};

/**
 * Restore the network without waiting for the reconnect indicator — used when the
 * page is mid user-switch and the sync UI is not mounted.
 */
export const restoreNetwork = async (page: Page): Promise<void> => {
  offlinePages.delete(page);
  await page.unroute(`${API_URL}/**`);
};

/**
 * Chaos e2e (Phase F3): helpers that stress the syncdb transport with jitter,
 * reordering, live-socket drops, and rapid offline/online flapping — distinct from
 * (and additive to) installOfflineControl above, which stays untouched so the
 * non-chaos syncdb-*.spec.ts files keep their simpler, deterministic outage model.
 *
 * These helpers exist to try to *forge* the failure modes the outbox/idempotency
 * ledger is supposed to prevent: duplicate deliveries from a reconnect racing an
 * in-flight ack, or a lost mutation from a frame dropped mid-flight. A chaos test
 * runs these concurrently with real UI mutations, then stops the chaos and asserts
 * the client converges to exactly the mutated set with no duplicates.
 *
 * Per-repo research already established that Chrome DevTools Protocol's
 * `Network.emulateNetworkConditions` does NOT throttle WebSocket frames (only HTTP),
 * so latency/reordering here is injected by hand in the page.routeWebSocket relay
 * below rather than via CDP.
 */

/** Uniform random integer/float in [min, max). */
const rand = (min: number, max: number): number => min + Math.random() * (max - min);

export interface ChaosControl {
  /** Force-close every currently-live chaos-proxied WebSocket (simulates a dead connection). */
  dropSocket: () => void;
  /** Toggle full network outage, reusing the same semantics as goSyncOffline/goSyncOnline. */
  goOffline: () => Promise<void>;
  goOnline: () => Promise<void>;
  /** Stop chaos-proxying: HTTP jitter route is removed and sockets forward immediately. */
  stop: () => Promise<void>;
}

export interface ChaosControlOptions {
  /** Max per-frame WebSocket latency in ms; each frame sleeps rand(0, latencyMs). Default 150. */
  latencyMs?: number;
}

/**
 * Install ONE routeWebSocket handler (Playwright does not expect multiple overlapping
 * handlers registered for the same URL pattern) that supersets installOfflineControl
 * with per-frame latency injection and live-socket dropping, plus an HTTP jitter route
 * for REST calls. Must be called before login/navigation, exactly like
 * installOfflineControl, so it wraps every socket.io connection the page ever opens.
 */
export const installChaosControl = async (
  page: Page,
  options?: ChaosControlOptions
): Promise<ChaosControl> => {
  const latencyMs = options?.latencyMs ?? 150;
  let offline = false;
  let chaosActive = true;
  const sockets = new Set<WebSocketRoute>();

  // Per-frame latency + jitter in both directions: instead of forwarding immediately,
  // each message is delayed by an independent random duration so frames can arrive
  // out of order relative to one another (a truer approximation of a lossy network
  // than a single fixed delay, and enough to race the outbox drain against acks).
  const forwardWithJitter = (
    send: (message: string | Buffer) => void,
    message: string | Buffer
  ): void => {
    if (!chaosActive) {
      send(message);
      return;
    }
    setTimeout(() => send(message), rand(0, latencyMs));
  };

  await page.routeWebSocket(/\/socket\.io\//, (ws) => {
    if (offline) {
      ws.close();
      return;
    }
    const server = ws.connectToServer();
    ws.onMessage((message) => forwardWithJitter((m) => server.send(m), message));
    server.onMessage((message) => forwardWithJitter((m) => ws.send(m), message));
    sockets.add(ws);
    ws.onClose(() => sockets.delete(ws));
  });

  const dropSocket = (): void => {
    for (const ws of sockets) {
      ws.close();
    }
  };

  const goOffline = async (): Promise<void> => {
    offline = true;
    await page.route(`${API_URL}/**`, (route) => route.abort("connectionrefused"));
    dropSocket();
    await page.getByTestId("sync-offline-indicator").waitFor({state: "visible", timeout: 15_000});
  };

  const goOnline = async (): Promise<void> => {
    offline = false;
    await page.unroute(`${API_URL}/**`);
    await page.getByTestId("sync-offline-indicator").waitFor({state: "hidden", timeout: 30_000});
  };

  const stop = async (): Promise<void> => {
    chaosActive = false;
    await goOnline();
  };

  return {dropSocket, goOffline, goOnline, stop};
};

/**
 * HTTP-only latency injection (no outage): every REST call to the backend is delayed
 * by a random duration in [minMs, maxMs) via route.continue(), so requests still
 * succeed — this simulates a slow/jittery network rather than a severed one, and
 * composes with installChaosControl's WebSocket jitter for full-stack chaos.
 */
export const installHttpJitter = async (
  page: Page,
  {minMs, maxMs}: {minMs: number; maxMs: number}
): Promise<void> => {
  await page.route(`${API_URL}/**`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, rand(minMs, maxMs)));
    await route.continue();
  });
};

export interface SyncFlapLoopController {
  /**
   * Signal the loop to stop. Lets any in-flight goOffline/goOnline settle, then
   * performs one final goOnline so callers can rely on ending online before running
   * convergence assertions.
   */
  stop: () => Promise<void>;
}

/** Minimal shape a flap loop needs to toggle connectivity — satisfied by ChaosControl. */
export interface SyncFlapToggle {
  goOffline: () => Promise<void>;
  goOnline: () => Promise<void>;
}

/**
 * Repeatedly toggle connectivity via the given `toggle` (pass the ChaosControl
 * returned by installChaosControl — its goOffline/goOnline share the chaos-proxied
 * WebSocket state, unlike the plain module-level goSyncOffline/goSyncOnline, which
 * only affect installOfflineControl's separate routing) with a random dwell between
 * toggles (default 1-8s, per the chaos plan). Runs as a detached background loop the
 * caller `void`s; call `stop()` to end it deterministically.
 */
export const startSyncFlapLoop = (
  toggle: SyncFlapToggle,
  options?: {minDwellMs?: number; maxDwellMs?: number}
): SyncFlapLoopController => {
  const minDwellMs = options?.minDwellMs ?? 1000;
  const maxDwellMs = options?.maxDwellMs ?? 8000;
  let stopped = false;
  let resolveStopped: (() => void) | undefined;
  const stoppedPromise = new Promise<void>((resolve) => {
    resolveStopped = resolve;
  });

  const dwell = (): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, rand(minDwellMs, maxDwellMs)));

  const loop = async (): Promise<void> => {
    while (!stopped) {
      await toggle.goOffline();
      if (stopped) {
        break;
      }
      await dwell();
      if (stopped) {
        break;
      }
      await toggle.goOnline();
      if (stopped) {
        break;
      }
      await dwell();
    }
    resolveStopped?.();
  };

  void loop();

  const stop = async (): Promise<void> => {
    stopped = true;
    await stoppedPromise;
    // Guarantee a known, online end state regardless of which phase the loop was in.
    await toggle.goOnline();
  };

  return {stop};
};

export const createTodoViaUi = async (page: Page, title: string): Promise<void> => {
  await page.getByTestId("todos-title-input").fill(title);
  await page.getByTestId("todos-create-button").click();
  await todoItemByTitle(page, title).waitFor({state: "visible"});
};

/**
 * Wait until this page's outbox is empty, i.e. every local mutation has been
 * server-acked. Creating a todo only proves the optimistic local apply, so a test that
 * asserts another session sees it needs this in between — otherwise a mutation stuck in
 * the sender's queue fails as "the receiver never got the delta", blaming the wrong side.
 */
export const waitForOutboxDrained = async (page: Page): Promise<void> => {
  await page.getByTestId("sync-queued-count").waitFor({state: "hidden", timeout: CONVERGE_TIMEOUT});
};

/**
 * Open a second logged-in browser session on the sync Todos screen, cloning the
 * authenticated storage state of `page` rather than driving the login form again. A
 * second UI login costs seconds of the test budget on CI and adds an unrelated failure
 * surface to tests that are about the sync protocol.
 */
export const openSecondSession = async (
  browser: Browser,
  page: Page
): Promise<{context: BrowserContext; page: Page}> => {
  const context = await browser.newContext({storageState: await page.context().storageState()});
  const secondPage = await context.newPage();
  await openSyncTodos(secondPage);
  return {context, page: secondPage};
};

/** Byte length of the encrypted syncdb blob in IndexedDB (0 when absent). */
export const readSyncDbBlobLength = async (page: Page): Promise<number> => {
  return page.evaluate(async (databaseName: string) => {
    const openDb = (): Promise<IDBDatabase | null> =>
      new Promise((resolve) => {
        const req = indexedDB.open(databaseName);
        req.onsuccess = (): void => resolve(req.result);
        req.onerror = (): void => resolve(null);
      });
    const db = await openDb();
    if (!db) {
      return 0;
    }
    try {
      if (!Array.from(db.objectStoreNames).includes("kv")) {
        return 0;
      }
      const value: unknown = await new Promise((resolve, reject) => {
        const tx = db.transaction("kv", "readonly");
        const rq = tx.objectStore("kv").get("content");
        rq.onsuccess = (): void => resolve(rq.result);
        rq.onerror = (): void => reject(rq.error);
      });
      if (value instanceof Uint8Array) {
        return value.byteLength;
      }
      if (value instanceof ArrayBuffer) {
        return value.byteLength;
      }
      return 0;
    } finally {
      db.close();
    }
  }, SYNC_DB_NAME);
};

/**
 * Serialize the raw contents of every IndexedDB database (binary payloads decoded
 * byte-per-char so any plaintext substring would surface) plus localStorage.
 */
export const readAllStorageSerialized = async (
  page: Page
): Promise<{databases: string[]; serialized: string}> => {
  return page.evaluate(async () => {
    const bytesToString = (bytes: Uint8Array): string => {
      let out = "";
      for (let i = 0; i < bytes.length; i++) {
        out += String.fromCharCode(bytes[i]);
      }
      return out;
    };
    const serializeValue = (value: unknown): string => {
      if (value instanceof Uint8Array) {
        return bytesToString(value);
      }
      if (value instanceof ArrayBuffer) {
        return bytesToString(new Uint8Array(value));
      }
      if (ArrayBuffer.isView(value)) {
        return bytesToString(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
      }
      if (value && typeof value === "object") {
        const parts: string[] = [];
        for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
          parts.push(key, serializeValue(nested));
        }
        return parts.join("|");
      }
      try {
        return JSON.stringify(value) ?? String(value);
      } catch {
        return String(value);
      }
    };

    const names: string[] = [];
    let serialized = "";
    const infos = await indexedDB.databases();
    for (const info of infos) {
      if (!info.name) {
        continue;
      }
      names.push(info.name);
      const db: IDBDatabase | null = await new Promise((resolve) => {
        const req = indexedDB.open(info.name as string);
        req.onsuccess = (): void => resolve(req.result);
        req.onerror = (): void => resolve(null);
      });
      if (!db) {
        continue;
      }
      try {
        for (const storeName of Array.from(db.objectStoreNames)) {
          const records: unknown[] = await new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, "readonly");
            const rq = tx.objectStore(storeName).getAll();
            rq.onsuccess = (): void => resolve(rq.result as unknown[]);
            rq.onerror = (): void => reject(rq.error);
          });
          for (const record of records) {
            serialized += serializeValue(record);
          }
        }
      } finally {
        db.close();
      }
    }

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) {
        serialized += `${key}|${localStorage.getItem(key) ?? ""}`;
      }
    }
    return {databases: names, serialized};
  });
};
