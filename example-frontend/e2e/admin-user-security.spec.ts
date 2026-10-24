/**
 * Platform account recovery from the admin User record (T25).
 *
 * An operator (the locked `operator` role: `admin:access` + `user:manageSecurity`) opens a user's
 * admin record, follows its Security link to `/admin/users/:id/security`, and disables then
 * re-enables the account through `/users/:id/security/*`. Each run makes its own operator and
 * target, so it never touches the shared e2e users.
 */
import {randomUUID} from "node:crypto";
import type {APIRequestContext, PlaywrightWorkerArgs} from "@playwright/test";
import {expect, test} from "./fixtures/test";
import type {E2EUser} from "./fixtures/testUsers";
import {addUserRole} from "./helpers/adminAuth";
import {signUpOrSignInBetterAuth} from "./helpers/betterAuthSession";
import {acceptPendingConsentForms} from "./helpers/consentForms";
import {ensureLoggedOut, loginAs} from "./helpers/login";

const API_URL = process.env.BACKEND_URL ?? "http://localhost:4000";
const FRONTEND_ORIGIN = process.env.FRONTEND_URL ?? "http://localhost:8082";

type Playwright = PlaywrightWorkerArgs["playwright"];
const SCREEN = "user-security-screen";
const PANEL = `${SCREEN}-panel`;
const ACTION_TIMEOUT_MS = 15_000;

interface SignedInUser extends E2EUser {
  token: string;
  userId: string;
}

/** A request context of its own, so no user's session cookie leaks into another's calls. */
const newApi = (playwright: Playwright): Promise<APIRequestContext> =>
  playwright.request.newContext({extraHTTPHeaders: {origin: FRONTEND_ORIGIN}});

/** Signs a fresh user up, agrees to their consent forms, and reads their app User id. */
const createUser = async (api: APIRequestContext, label: string): Promise<SignedInUser> => {
  const user: E2EUser = {
    email: `e2e-${label}-${randomUUID()}@terreno.dev`,
    name: `E2E ${label}`,
    password: "UserSecurityPassword123!",
  };
  const token = await signUpOrSignInBetterAuth(api, user);
  await acceptPendingConsentForms(api, token);
  const me = await api.get(`${API_URL}/auth/me`, {headers: {authorization: `Bearer ${token}`}});
  expect(me.ok(), `/auth/me answered ${me.status()}`).toBe(true);
  const body = (await me.json()) as {data?: {_id?: string; id?: string}};
  const userId = body.data?._id ?? body.data?.id ?? "";
  expect(userId, "the app User exists").toBeTruthy();
  return {...user, token, userId};
};

/** The status `/auth/me` answers for a bearer token. */
const meStatus = async (playwright: Playwright, token: string): Promise<number> => {
  const api = await newApi(playwright);
  try {
    const response = await api.get(`${API_URL}/auth/me`, {
      headers: {authorization: `Bearer ${token}`},
    });
    return response.status();
  } finally {
    await api.dispose();
  }
};

/**
 * Signs in while the account is disabled. Better Auth may refuse outright or issue a session; an
 * issued session must not authenticate (REST ignores a disabled user's sessions).
 */
const expectSignInRefusedWhileDisabled = async (
  playwright: Playwright,
  user: SignedInUser
): Promise<void> => {
  const api = await newApi(playwright);
  let token = "";
  try {
    const response = await api.post(`${API_URL}/api/auth/sign-in/email`, {
      data: {email: user.email, password: user.password},
    });
    if (!response.ok()) {
      return;
    }
    const body = (await response.json()) as {session?: {token?: string}; token?: string};
    token = body.token ?? body.session?.token ?? "";
  } finally {
    await api.dispose();
  }
  if (token) {
    expect(await meStatus(playwright, token), "a session issued while disabled").toBe(401);
  }
};

/** Signs in with email and password and returns the new session token. */
const signIn = async (playwright: Playwright, user: SignedInUser): Promise<string> => {
  const api = await newApi(playwright);
  try {
    const response = await api.post(`${API_URL}/api/auth/sign-in/email`, {
      data: {email: user.email, password: user.password},
    });
    expect(response.ok(), `sign-in answered ${response.status()}`).toBe(true);
    const body = (await response.json()) as {session?: {token?: string}; token?: string};
    const token = body.token ?? body.session?.token ?? "";
    expect(token, "sign-in returned a session token").toBeTruthy();
    return token;
  } finally {
    await api.dispose();
  }
};

test.describe("Platform user security", () => {
  // A cold admin bundle load plus two browser sign-ins.
  test.slow();

  let operator: SignedInUser;
  let target: SignedInUser;

  test.beforeEach(async ({playwright}) => {
    const operatorApi = await newApi(playwright);
    const targetApi = await newApi(playwright);
    try {
      operator = await createUser(operatorApi, "operator");
      target = await createUser(targetApi, "security-target");
    } finally {
      await Promise.all([operatorApi.dispose(), targetApi.dispose()]);
    }
    // Promote before the operator's browser session reads /auth/me, so the admin layout sees
    // admin:access and user:manageSecurity on first load. The operator keeps the todoUser role
    // every signup gets: D9 refuses a target holding any permission the actor lacks, and the
    // target holds todoUser's todo permissions, which the operator role alone does not grant.
    await addUserRole(operator.email, "operator");
    expect(await meStatus(playwright, target.token), "the target starts signed in").toBe(200);
  });

  test("operator disables and re-enables a user", async ({
    consoleGuard,
    page,
    playwright,
  }, testInfo) => {
    await loginAs(page, operator);
    await page.goto(`/admin/User/${target.userId}`);
    await page.getByTestId("admin-user-security-link").waitFor({state: "visible"});
    // Setting a password is admin-only, so an operator's record view leaves the card out.
    await expect(page.getByTestId("admin-user-password-card")).toHaveCount(0);
    await page.getByTestId("admin-user-security-link").click();

    await page.getByTestId(SCREEN).waitFor({state: "visible"});
    await expect(page.getByTestId(`${SCREEN}-header`)).toContainText(target.name);
    await expect(page.getByTestId(`${SCREEN}-header`)).toContainText(target.email);
    await expect(page.getByTestId(`${PANEL}-sessions`)).toBeVisible();

    await page.getByTestId(`${PANEL}-action-disable`).click();
    await page.getByTestId(`${PANEL}-confirm.primary`).click();
    // Each action revokes sessions and records security events; give a loaded machine room.
    await expect(page.getByTestId(`${PANEL}-result`)).toContainText("Account disabled", {
      timeout: ACTION_TIMEOUT_MS,
    });
    await expect(page.getByTestId(`${PANEL}-disabled`)).toBeVisible();
    await page.screenshot({path: testInfo.outputPath("admin-user-security-disabled.png")});

    // Disable also revokes sessions, so the old token alone does not prove "disabled": a fresh
    // sign-in while disabled must not yield a working session either.
    expect(await meStatus(playwright, target.token)).toBe(401);
    await expectSignInRefusedWhileDisabled(playwright, target);

    await page.getByTestId(`${PANEL}-action-enable`).click();
    await expect(page.getByTestId(`${PANEL}-result`)).toContainText("Account enabled", {
      timeout: ACTION_TIMEOUT_MS,
    });
    await expect(page.getByTestId(`${PANEL}-disabled`)).toHaveCount(0);
    await expect(page.getByTestId(`${PANEL}-action-disable`)).toBeVisible();

    // After enable the user signs in again, over the API and in the app.
    const freshToken = await signIn(playwright, target);
    expect(await meStatus(playwright, freshToken)).toBe(200);
    // Signing a second user in on this browser finds the first user's syncdb store, which their
    // key cannot decrypt; syncdb wipes it and warns, as documented.
    consoleGuard.allow(/\[syncdb\] persisted data for ".*" could not be decrypted/);
    await ensureLoggedOut(page);
    await loginAs(page, target);
    await page.getByTestId("todos-screen").waitFor({state: "visible"});
  });
});
