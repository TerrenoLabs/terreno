import type {Page} from "@playwright/test";
import {expect, test} from "./fixtures/test";
import {type ApiUser, newAuthApiContext, signUpApiUser} from "./helpers/authFlows";
import {acceptPendingConsentForms} from "./helpers/consentForms";
import {showOtherSignInMethods} from "./helpers/login";
import {
  callMcp,
  exchangeCode,
  isOAuthDisabled,
  OAUTH_API_URL,
  OAUTH_REDIRECT_URI,
  type PendingAuthorization,
  startAuthorization,
} from "./helpers/mcpOAuth";
import {listTodosAs} from "./helpers/todosApi";

/**
 * MCP OAuth consent on the example app's own `/oauth/consent` route. Needs the example-backend
 * running with MCP_OAUTH_ENABLED=true, PUBLIC_API_URL=http://localhost:4000, and
 * MCP_OAUTH_CONSENT_URL=http://localhost:8082/oauth/consent (set by playwright.config.ts and the
 * CircleCI backend step). The client's redirect URI is unreachable, so the spec fulfils it in the
 * browser and reads the redirect's query from the URL.
 */

const TODO_TITLE = "should-not-exist-via-read-only-grant";

// Fulfils the unreachable client redirect and resolves with the URL the browser was sent to.
const captureRedirect = async (page: Page): Promise<() => Promise<URL>> => {
  let resolveUrl: (url: URL) => void = () => undefined;
  const redirected = new Promise<URL>((resolve) => {
    resolveUrl = resolve;
  });
  await page.route(`${OAUTH_REDIRECT_URI}**`, async (route) => {
    resolveUrl(new URL(route.request().url()));
    await route.fulfill({body: "redirected", contentType: "text/plain", status: 200});
  });
  return () => redirected;
};

// Signs in on the login screen the consent route shows to a signed-out user.
const signInOnConsentRoute = async (page: Page, user: ApiUser): Promise<void> => {
  await page.getByTestId("login-screen").waitFor({state: "visible"});
  await showOtherSignInMethods(page);
  await page.getByTestId("login-screen-email-input").fill(user.email);
  await page.getByTestId("login-screen-password-input").fill(user.password);
  await page.getByTestId("login-screen-submit-button").click();
};

test.describe("example app MCP OAuth consent", () => {
  let pending: PendingAuthorization;

  // Skip, rather than fail, against a backend started without MCP_OAUTH_ENABLED.
  test.beforeAll(async ({playwright}) => {
    const api = await playwright.request.newContext();
    const disabled = await isOAuthDisabled(api);
    await api.dispose();
    test.skip(disabled, "Backend runs without MCP_OAUTH_ENABLED=true");
  });

  // Each test owns its client registration and authorization request.
  test.beforeEach(async ({playwright}) => {
    const api = await newAuthApiContext(playwright);
    pending = await startAuthorization(api);
    await api.dispose();
  });

  test("the authorize redirect points at the example app's /oauth/consent route", async () => {
    expect(pending.consentPath.startsWith("/oauth/consent?request=")).toBe(true);
  });

  test("a signed-out user signs in, narrows the grant to read, and the token cannot create todos", async ({
    page,
    playwright,
  }) => {
    const api = await newAuthApiContext(playwright);
    const user = await signUpApiUser(api, {label: "mcp-consent"});
    const readRedirect = await captureRedirect(page);

    await page.goto(pending.consentPath);
    await signInOnConsentRoute(page, user);
    await page.getByTestId("oauth-consent-screen").waitFor({state: "visible"});

    await expect(page.getByTestId("oauth-consent-client-name")).toContainText("E2E Connector");
    const read = page.getByTestId("oauth-consent-grant-mcp:read");
    const write = page.getByTestId("oauth-consent-grant-mcp:write");
    await expect(read).toContainText("Read your data");
    await expect(write).toContainText("Change your data");
    await expect(read).toHaveAttribute("aria-checked", "true");
    await expect(write).toHaveAttribute("aria-checked", "true");

    await write.click();
    await expect(write).toHaveAttribute("aria-checked", "false");
    await page.getByTestId("oauth-consent-approve-button").click();

    const redirected = await readRedirect();
    const code = redirected.searchParams.get("code");
    expect(code).toBeTruthy();
    expect(redirected.searchParams.get("state")).toBe(pending.state);

    const token = await exchangeCode(api, pending, code ?? "");
    expect(token.status).toBe(200);
    expect(token.body.scope).toBe("mcp:read");
    const bearer = token.body.access_token ?? "";
    expect(bearer).toBeTruthy();

    const listed = await callMcp(api, bearer, "tools/list");
    const names = (listed.result?.tools ?? []).map((tool) => tool.name);
    expect(names).toContain("todos_list");
    expect(names).not.toContain("todos_create");

    const created = await callMcp(api, bearer, "tools/call", {
      arguments: {title: TODO_TITLE},
      name: "todos_create",
    });
    expect(created.error !== undefined || created.result?.isError === true).toBe(true);
    const todos = await listTodosAs(user);
    expect(todos.map((todo) => todo.title)).not.toContain(TODO_TITLE);
    await api.dispose();
  });

  test("a signed-in user who taps Deny is sent back with access_denied and no code", async ({
    page,
    playwright,
  }) => {
    const api = await newAuthApiContext(playwright);
    const user = await signUpApiUser(api, {label: "mcp-consent-deny"});
    const readRedirect = await captureRedirect(page);

    await page.goto(pending.consentPath);
    await signInOnConsentRoute(page, user);
    await page.getByTestId("oauth-consent-deny-button").waitFor({state: "visible"});
    await page.getByTestId("oauth-consent-deny-button").click();

    const redirected = await readRedirect();
    expect(redirected.searchParams.get("error")).toBe("access_denied");
    expect(redirected.searchParams.get("code")).toBeNull();
    expect(redirected.searchParams.get("state")).toBe(pending.state);

    // With no code issued, nothing can be exchanged for this request.
    const token = await exchangeCode(api, pending, "not-a-real-code");
    expect(token.status).toBeGreaterThanOrEqual(400);
    expect(token.body.access_token).toBeUndefined();
    await api.dispose();
  });

  test("a fresh user sees the legal consent modal before the OAuth consent card", async ({
    page,
    playwright,
  }) => {
    const api = await newAuthApiContext(playwright);
    const user = await signUpApiUser(api, {acceptConsents: false, label: "mcp-consent-legal"});

    await page.goto(pending.consentPath);
    await signInOnConsentRoute(page, user);
    await page.getByTestId("consent-form-footer").waitFor({state: "visible"});
    await expect(page.getByTestId("oauth-consent-approve-button")).toHaveCount(0);

    // The seeded forms need scrolling and a drawn signature, so accept through the API and reopen
    // the same request.
    await acceptPendingConsentForms(api, user.bearer, {apiUrl: OAUTH_API_URL});
    await page.goto(pending.consentPath);
    await page.getByTestId("oauth-consent-screen").waitFor({state: "visible"});
    await expect(page.getByTestId("oauth-consent-client-name")).toContainText("E2E Connector");
    await expect(page.getByTestId("consent-form-footer")).toHaveCount(0);
    await api.dispose();
  });
});
