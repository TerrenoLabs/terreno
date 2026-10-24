import type {Page, Route} from "@playwright/test";
import {expect, test} from "./fixtures/test";
import {TEST_USER} from "./fixtures/testUsers";
import {loginAs} from "./helpers/login";

/**
 * The login, sign-up and account forms on web: every password input sits in a real <form> (so
 * Chrome does not warn and password managers can pair it with the username), autofill hints are
 * set, Enter moves through the fields and submits once, and Tab follows the screen.
 */

// Chrome's password-form checks run in the full browser, not the headless shell Playwright uses
// by default, so this file runs in the full Chromium build.
test.use({channel: "chromium"});

const FORM_WARNING = "Password field is not contained in a form";
const SIGN_IN_ROUTE = "**/api/auth/sign-in/email";
const METHODS_ROUTE = "**/api/auth/terreno/methods";

/**
 * Collects Chrome's "[DOM] Password field is not contained in a form" messages, which Chrome logs
 * to the page console at the verbose level.
 */
const watchFormWarnings = (page: Page): string[] => {
  const messages: string[] = [];
  page.on("console", (message) => {
    if (message.text().includes(FORM_WARNING)) {
      messages.push(message.text());
    }
  });
  return messages;
};

interface PasswordInputState {
  autocomplete: string | null;
  hasFormAncestor: boolean;
  testID: string | null;
}

/** Every visible password input on the page, with its autofill hint and form ancestry. */
const readPasswordInputs = (page: Page): Promise<PasswordInputState[]> =>
  page.evaluate((): PasswordInputState[] =>
    Array.from(document.querySelectorAll<HTMLInputElement>('input[type="password"]'))
      .filter((input) => input.offsetParent !== null)
      .map((input) => ({
        autocomplete: input.getAttribute("autocomplete"),
        hasFormAncestor: input.closest("form") !== null,
        testID: input.getAttribute("data-testid"),
      }))
  );

/** The testID of the focused element, or of its nearest ancestor that has one. */
const focusedTestID = (page: Page): Promise<string | null> =>
  page.evaluate(
    (): string | null =>
      document.activeElement?.closest("[data-testid]")?.getAttribute("data-testid") ?? null
  );

/** Answers the methods request with one generic provider, so the provider tab stop is known. */
const stubMethods = async (page: Page): Promise<void> => {
  await page.route(METHODS_ROUTE, async (route: Route): Promise<void> => {
    const origin = route.request().headers().origin ?? "http://localhost:8082";
    await route.fulfill({
      headers: {
        "access-control-allow-credentials": "true",
        "access-control-allow-origin": origin,
      },
      json: {
        accountLinking: {mode: "verified-email"},
        emailPassword: true,
        multiSession: false,
        passkey: false,
        providers: ["github"],
        signUp: true,
        twoFactor: false,
      },
    });
  });
};

/** Counts email sign-in requests, to prove Enter submits exactly once. */
const countSignIns = async (page: Page): Promise<{count: () => number}> => {
  let count = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/api/auth/sign-in/email")) {
      count += 1;
    }
  });
  return {count: (): number => count};
};

test.describe("Password forms", () => {
  test("the warning check catches a password field outside a form", async ({page}) => {
    const warnings = watchFormWarnings(page);
    await page.goto("/login");
    await page.getByTestId("login-screen").waitFor({state: "visible"});
    // A bare password input outside any form must trigger the warning, or the zero-warning
    // checks below would prove nothing.
    await page.evaluate((): void => {
      const input = document.createElement("input");
      input.type = "password";
      document.body.appendChild(input);
    });
    await expect.poll(() => warnings.length).toBeGreaterThan(0);
  });

  test("login and sign-up keep their password fields in forms, with autofill hints", async ({
    page,
  }) => {
    const warnings = watchFormWarnings(page);

    await page.goto("/login");
    await page.getByTestId("login-screen").waitFor({state: "visible"});
    await expect(page.getByTestId("login-screen-email-input")).toHaveAttribute(
      "autocomplete",
      /^username( webauthn)?$/
    );
    await expect(page.getByTestId("login-screen-email-input")).toHaveAttribute(
      "aria-label",
      "Email"
    );
    await expect(page.getByTestId("login-screen-password-input")).toHaveAttribute(
      "aria-label",
      "Password"
    );
    expect(await readPasswordInputs(page)).toEqual([
      {
        autocomplete: "current-password",
        hasFormAncestor: true,
        testID: "login-screen-password-input",
      },
    ]);
    // The email field shares the password's form, so password managers pair them.
    const sharesForm = await page.evaluate((): boolean => {
      const email = document.querySelector('[data-testid="login-screen-email-input"]');
      const password = document.querySelector('[data-testid="login-screen-password-input"]');
      return (
        Boolean(email?.closest("form")) && email?.closest("form") === password?.closest("form")
      );
    });
    expect(sharesForm).toBe(true);

    await page.getByTestId("login-screen-signup-link").click();
    await page.getByTestId("signup-screen").waitFor({state: "visible"});
    await expect(page.getByTestId("signup-screen-email-input")).toHaveAttribute(
      "autocomplete",
      "username"
    );
    await expect(page.getByTestId("signup-screen-name-input")).toHaveAttribute(
      "aria-label",
      "Name"
    );
    expect(await readPasswordInputs(page)).toEqual([
      {
        autocomplete: "new-password",
        hasFormAncestor: true,
        testID: "signup-screen-password-input",
      },
    ]);

    await page.goto("/resetPassword?token=e2e-token");
    await page.getByTestId("reset-password-screen").waitFor({state: "visible"});
    expect(await readPasswordInputs(page)).toEqual([
      {
        autocomplete: "new-password",
        hasFormAncestor: true,
        testID: "reset-password-password",
      },
    ]);

    expect(warnings).toEqual([]);
  });

  test("security and profile keep their password fields in forms", async ({page}) => {
    const warnings = watchFormWarnings(page);
    await loginAs(page);

    await page.goto("/settings/security");
    await page.getByTestId("password-card").waitFor({state: "visible"});
    const securityInputs = await readPasswordInputs(page);
    expect(securityInputs.length).toBeGreaterThan(0);
    expect(securityInputs.every((input) => input.hasFormAncestor)).toBe(true);
    // The change-password form names the account for password managers.
    await expect(page.getByTestId("password-card-form-username")).toHaveValue(TEST_USER.email);
    await expect(page.getByTestId("password-card-current")).toHaveAttribute(
      "autocomplete",
      "current-password"
    );
    await expect(page.getByTestId("password-card-new")).toHaveAttribute(
      "autocomplete",
      "new-password"
    );

    await page.goto("/profile");
    await page.getByTestId("profile-gemini-key-input").waitFor({state: "visible"});
    const profileInputs = await readPasswordInputs(page);
    expect(profileInputs.length).toBeGreaterThan(0);
    expect(profileInputs.every((input) => input.hasFormAncestor)).toBe(true);

    expect(warnings).toEqual([]);
  });
});

test.describe("Login keyboard", () => {
  test.beforeEach(async ({page}) => {
    await stubMethods(page);
    await page.goto("/login");
    await page.getByTestId("login-screen").waitFor({state: "visible"});
  });

  test("user can sign in with Enter: email moves to password, password submits once", async ({
    page,
  }) => {
    const signIns = await countSignIns(page);
    // A full page reload would drop this marker.
    await page.evaluate((): void => {
      (window as unknown as {noReloadMarker: boolean}).noReloadMarker = true;
    });

    await page.getByTestId("login-screen-email-input").fill(TEST_USER.email);
    await page.getByTestId("login-screen-email-input").press("Enter");
    await expect.poll(() => focusedTestID(page)).toBe("login-screen-password-input");
    expect(signIns.count()).toBe(0);

    await page.getByTestId("login-screen-password-input").fill(TEST_USER.password);
    await page.getByTestId("login-screen-password-input").press("Enter");
    await page.getByTestId("login-screen").first().waitFor({state: "hidden"});

    expect(signIns.count()).toBe(1);
    expect(
      await page.evaluate(
        (): boolean => (window as unknown as {noReloadMarker?: boolean}).noReloadMarker === true
      )
    ).toBe(true);
  });

  test("Enter does nothing while a required field is empty", async ({page}) => {
    const signIns = await countSignIns(page);
    await page.route(SIGN_IN_ROUTE, async (route: Route): Promise<void> => {
      await route.abort();
    });
    await page.getByTestId("login-screen-password-input").fill(TEST_USER.password);
    await page.getByTestId("login-screen-password-input").press("Enter");
    await expect(page.getByTestId("login-screen-submit-button")).toBeVisible();
    await expect(page.getByTestId("login-screen-password-input")).toHaveValue(TEST_USER.password);
    expect(signIns.count()).toBe(0);
  });

  test("Tab follows the screen: fields, show password, Log In, links, providers", async ({
    page,
  }) => {
    await page.getByTestId("login-screen-oauth-github").waitFor({state: "visible"});
    // Log In takes focus only once it is enabled.
    await page.getByTestId("login-screen-email-input").fill(TEST_USER.email);
    await page.getByTestId("login-screen-password-input").fill(TEST_USER.password);
    await page.getByTestId("login-screen-email-input").focus();

    const expected = [
      "login-screen-password-input",
      "login-screen-password-input.visibility-toggle",
      "login-screen-submit-button",
      "login-screen-forgot-password",
      "login-screen-signup-link",
      "login-screen-oauth-github",
    ];
    const visited: (string | null)[] = [];
    for (let step = 0; step < expected.length; step += 1) {
      await page.keyboard.press("Tab");
      visited.push(await focusedTestID(page));
    }
    expect(visited).toEqual(expected);
  });
});
