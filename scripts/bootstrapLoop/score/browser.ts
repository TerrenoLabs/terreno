import {randomUUID} from "node:crypto";

import {envOr} from "./probes/probeKit";

interface Credentials {
  email: string;
  password: string;
}

interface ViewportOutcome {
  horizontalScroll: boolean;
  primaryActionVisible: boolean;
  todoCreateWorks: boolean;
}

/** Playwright is the app's own dependency, so it loads lazily and only when a browser is needed. */
const loadChromium = async (): Promise<{launch: () => Promise<unknown>}> => {
  const moduleName = "playwright";
  const {chromium} = await import(moduleName);
  return chromium;
};

interface Locator {
  click: () => Promise<void>;
  fill: (value: string) => Promise<void>;
  first: () => Locator;
  isVisible: () => Promise<boolean>;
  press: (key: string) => Promise<void>;
  waitFor: (options: {state: "visible"; timeout: number}) => Promise<void>;
}

/** The slice of Playwright's Page used here; Playwright itself loads lazily, without types. */
interface Page {
  evaluate: <T>(script: () => T) => Promise<T>;
  getByRole: (role: string, options: {name: RegExp}) => Locator;
  getByText: (text: string) => Locator;
  goto: (url: string, options: {waitUntil: "networkidle"}) => Promise<unknown>;
  locator: (selector: string) => Locator;
  screenshot: (options: {fullPage: boolean; path: string}) => Promise<unknown>;
  waitForLoadState: (state: "networkidle") => Promise<void>;
  waitForURL: (predicate: (url: URL) => boolean, options: {timeout: number}) => Promise<void>;
}

export const memberLogin = (env: Record<string, string | undefined>): Credentials => ({
  email: envOr(env, "BOOTSTRAP_LOOP_SEED_EMAIL", "test@example.com"),
  password: envOr(env, "BOOTSTRAP_LOOP_SEED_PASSWORD", "testpassword123"),
});

export const adminLogin = (env: Record<string, string | undefined>): Credentials => ({
  email: envOr(env, "BOOTSTRAP_LOOP_ADMIN_EMAIL", "admin@example.com"),
  password: envOr(env, "BOOTSTRAP_LOOP_ADMIN_PASSWORD", "testpassword123"),
});

/** Accepts every required consent gate a first-time sign-in shows before the app. */
const acceptConsents = async (page: Page): Promise<void> => {
  for (let step = 0; step < 4; step++) {
    const accept = page.getByRole("button", {name: /^(i )?(accept|agree)/i}).first();
    if (!(await accept.isVisible().catch(() => false))) {
      return;
    }
    await accept.click().catch(() => undefined);
    await page.waitForLoadState("networkidle").catch(() => undefined);
  }
};

/** Signs in through the app's own login screen, then clears consent gates. */
const signInThroughUi = async (page: Page, base: string, login: Credentials): Promise<void> => {
  await page.goto(`${base}/login`, {waitUntil: "networkidle"});
  await page.locator('input[type="email"], input[type="text"]').first().fill(login.email);
  await page.locator('input[type="password"]').first().fill(login.password);
  await page.locator('input[type="password"]').first().press("Enter");
  await page
    .waitForURL((url: URL) => !url.pathname.includes("/login"), {timeout: 15_000})
    .catch(() => undefined);
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await acceptConsents(page);
};

export interface ShotOptions {
  url: string;
  width: number;
  height: number;
  path: string;
  /** Sign in as this user first; omit for the public login screen. */
  login?: Credentials;
}

/** One PNG of a screen, signed in when `login` is given so the real screen is captured. */
export const screenshotPage = async ({
  height,
  login,
  path,
  url,
  width,
}: ShotOptions): Promise<void> => {
  const chromium = await loadChromium();
  const browser = (await chromium.launch()) as {
    close: () => Promise<void>;
    newPage: (options: unknown) => Promise<Page>;
  };
  try {
    const page = await browser.newPage({viewport: {height, width}});
    if (login) {
      await signInThroughUi(page, new URL(url).origin, login);
    }
    await page.goto(url, {waitUntil: "networkidle"});
    await acceptConsents(page);
    await page.screenshot({fullPage: true, path});
  } finally {
    await browser.close();
  }
};

/** R4 measurements at one viewport: scroll, a visible primary action, and creating a todo. */
export const measureViewport = async (options: {
  url: string;
  width: number;
  height: number;
  login: Credentials;
}): Promise<ViewportOutcome> => {
  const chromium = await loadChromium();
  const browser = (await chromium.launch()) as {
    close: () => Promise<void>;
    newPage: (options: unknown) => Promise<Page>;
  };
  try {
    const page = await browser.newPage({viewport: {height: options.height, width: options.width}});
    await signInThroughUi(page, new URL(options.url).origin, options.login);
    await page.goto(options.url, {waitUntil: "networkidle"});
    await acceptConsents(page);
    const horizontalScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1
    );
    const action = page.getByRole("button", {name: /add|create|new|save/i}).first();
    const primaryActionVisible = await action.isVisible().catch(() => false);
    const title = `r4 ${randomUUID().slice(0, 8)}`;
    let todoCreateWorks = false;
    try {
      await page.locator("input, textarea").first().fill(title);
      if (primaryActionVisible) {
        await action.click();
      } else {
        await page.locator("input, textarea").first().press("Enter");
      }
      await page.getByText(title).first().waitFor({state: "visible", timeout: 10_000});
      todoCreateWorks = true;
    } catch {
      todoCreateWorks = false;
    }
    return {horizontalScroll, primaryActionVisible, todoCreateWorks};
  } finally {
    await browser.close();
  }
};
