/**
 * Org-admin account recovery from the admin members screen (T24).
 *
 * An org-admin opens a member's Security panel on `/admin/orgs/:orgId/members`, which reads
 * `GET /orgs/:orgId/members/:userId/security` and renders the server's recovery actions. Each run
 * makes its own org-admin, member, and organization, so it never touches the shared e2e users.
 */
import {randomUUID} from "node:crypto";
import type {APIRequestContext, PlaywrightWorkerArgs} from "@playwright/test";
import {expect, test} from "./fixtures/test";
import type {E2EUser} from "./fixtures/testUsers";
import {getAdminToken} from "./helpers/adminAuth";
import {signUpOrSignInBetterAuth} from "./helpers/betterAuthSession";
import {acceptPendingConsentForms} from "./helpers/consentForms";
import {ensureLoggedOut, loginAs} from "./helpers/login";
import {totpCode, totpSecretFromURI} from "./helpers/totp";

const API_URL = process.env.BACKEND_URL ?? "http://localhost:4000";
const FRONTEND_ORIGIN = process.env.FRONTEND_URL ?? "http://localhost:8082";

type Playwright = PlaywrightWorkerArgs["playwright"];
const PANEL = "org-members-security-panel";

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
    password: "OrgSecurityPassword123!",
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

/** Turns on TOTP two-factor for the user, as their own Security screen does. */
const enrollTwoFactor = async (api: APIRequestContext, user: SignedInUser): Promise<void> => {
  const headers = {authorization: `Bearer ${user.token}`};
  const enable = await api.post(`${API_URL}/api/auth/two-factor/enable`, {
    data: {password: user.password},
    headers,
  });
  expect(enable.ok(), `two-factor enable answered ${enable.status()}`).toBe(true);
  const secret = totpSecretFromURI(((await enable.json()) as {totpURI: string}).totpURI);
  const verify = await api.post(`${API_URL}/api/auth/two-factor/verify-totp`, {
    data: {code: totpCode(secret)},
    headers,
  });
  expect(verify.ok(), `two-factor verify answered ${verify.status()}`).toBe(true);
};

/** Whether a password sign-in stops at a second-factor challenge. */
const signInNeedsTwoFactor = async (
  playwright: Playwright,
  user: SignedInUser
): Promise<boolean> => {
  const api = await newApi(playwright);
  try {
    const response = await api.post(`${API_URL}/api/auth/sign-in/email`, {
      data: {email: user.email, password: user.password},
    });
    expect(response.ok(), `sign-in answered ${response.status()}`).toBe(true);
    const body = (await response.json()) as {twoFactorRedirect?: boolean};
    return body.twoFactorRedirect === true;
  } finally {
    await api.dispose();
  }
};

/** Creates an organization as platform staff and attaches both users. */
const createOrganization = async ({
  api,
  member,
  orgAdmin,
}: {
  api: APIRequestContext;
  member: SignedInUser;
  orgAdmin: SignedInUser;
}): Promise<string> => {
  const headers = {authorization: `Bearer ${await getAdminToken(api)}`};
  const created = await api.post(`${API_URL}/orgs`, {
    data: {name: `E2E Security Org ${randomUUID()}`},
    headers,
  });
  expect(created.ok(), `org create answered ${created.status()}`).toBe(true);
  const orgId = ((await created.json()) as {data: {_id: string}}).data._id;
  for (const [user, roleName] of [
    [orgAdmin, "org-admin"],
    [member, "member"],
  ] as const) {
    const attached = await api.post(`${API_URL}/orgs/${orgId}/members`, {
      data: {email: user.email, roleName},
      headers: {...headers, "X-Organization-Id": orgId},
    });
    expect(attached.ok(), `attach ${roleName} answered ${attached.status()}`).toBe(true);
  }
  return orgId;
};

test.describe("Org-admin member security", () => {
  // A cold admin bundle load plus two sign-ins.
  test.slow();

  let orgAdmin: SignedInUser;
  let member: SignedInUser;
  let orgId: string;

  test.beforeEach(async ({playwright}) => {
    const adminApi = await newApi(playwright);
    const orgAdminApi = await newApi(playwright);
    const memberApi = await newApi(playwright);
    try {
      orgAdmin = await createUser(orgAdminApi, "org-admin");
      member = await createUser(memberApi, "org-member");
      orgId = await createOrganization({api: adminApi, member, orgAdmin});
      await enrollTwoFactor(memberApi, member);
    } finally {
      await Promise.all([adminApi.dispose(), orgAdminApi.dispose(), memberApi.dispose()]);
    }
    expect(await signInNeedsTwoFactor(playwright, member), "2FA is on before the reset").toBe(true);
  });

  // No "UTC is not a valid timezone" allowance: that warning comes from @terreno/ui
  // TimezonePicker (DateTimeField with a timezone, in admin model forms and date filters) when the
  // test browser's zone is UTC. The members screen and MemberSecurityPanel render no timezone
  // picker; the panel formats times with Luxon only.
  test("org-admin resets a member's 2FA", async ({consoleGuard, page, playwright}, testInfo) => {
    await loginAs(page, orgAdmin);
    await page.goto(`/admin/orgs/${orgId}/members`);
    await page.getByTestId("org-members-table").waitFor({state: "visible"});

    await page.getByTestId(`org-members-security-${member.userId}`).click();
    const twoFactorStatus = page.getByTestId(`${PANEL}-two-factor-status`);
    await expect(twoFactorStatus).toHaveText(/^On/);

    await page.getByTestId(`${PANEL}-action-reset-two-factor`).click();
    await page.getByTestId(`${PANEL}-confirm.primary`).click();

    // The reset revokes sessions and records security events; give a loaded machine room.
    await expect(page.getByTestId(`${PANEL}-result`)).toContainText("Two-factor reset", {
      timeout: 15_000,
    });
    await expect(twoFactorStatus).toHaveText("Off");
    await expect(page.getByTestId(`${PANEL}-action-reset-two-factor`)).toHaveCount(0);
    await page.screenshot({path: testInfo.outputPath("org-admin-security-reset-2fa.png")});

    // The member's next password sign-in gets no second-factor challenge.
    expect(await signInNeedsTwoFactor(playwright, member)).toBe(false);
    // Signing a second user in on this browser finds the first user's syncdb store, which their
    // key cannot decrypt; syncdb wipes it and warns, as documented.
    consoleGuard.allow(/\[syncdb\] persisted data for ".*" could not be decrypted/);
    await ensureLoggedOut(page);
    await loginAs(page, member);
    await page.getByTestId("todos-screen").waitFor({state: "visible"});
    await expect(page.getByTestId("two-factor-challenge")).toHaveCount(0);
  });
});
