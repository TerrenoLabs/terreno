import type {Page} from "@playwright/test";

// The served bundle is a production build, where React reports a hydration mismatch only as
// "Minified React error #418/#423/#425"; development builds name it in words.
const HYDRATION_ERROR = /hydrat|Minified React error #(418|423|425)/i;

/**
 * Record hydration errors inside the page before any app script runs. Playwright's own
 * `pageerror` and `console` events can miss what React reports during hydration, so the
 * page keeps its own list.
 */
export const recordHydrationErrors = async (page: Page): Promise<void> => {
  await page.addInitScript((source: string) => {
    const pattern = new RegExp(source, "i");
    const seen: string[] = [];
    (window as unknown as {__hydrationErrors: string[]}).__hydrationErrors = seen;
    const keep = (text: string): void => {
      if (pattern.test(text)) {
        seen.push(text);
      }
    };
    window.addEventListener("error", (event) => keep(String(event.message ?? event.error)));
    const originalError = console.error.bind(console);
    console.error = (...args: unknown[]): void => {
      keep(args.map(String).join(" "));
      originalError(...args);
    };
    const originalWarn = console.warn.bind(console);
    console.warn = (...args: unknown[]): void => {
      keep(args.map(String).join(" "));
      originalWarn(...args);
    };
  }, HYDRATION_ERROR.source);
};

/**
 * Resolves once React has committed the hydrated tree. React reports hydration errors at
 * commit, and the session provider requests `get-session` from a passive effect, which runs
 * only after that commit. `networkidle` alone can come first under parallel load.
 */
export const waitForHydration = (page: Page): Promise<unknown> => {
  return page.waitForRequest((request) => new URL(request.url()).pathname.endsWith("/get-session"));
};

export const readHydrationErrors = async (page: Page): Promise<string[]> => {
  return page.evaluate(
    () => (window as unknown as {__hydrationErrors?: string[]}).__hydrationErrors ?? []
  );
};
