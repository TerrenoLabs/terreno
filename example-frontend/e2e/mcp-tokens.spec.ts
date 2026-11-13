import {existsSync} from "node:fs";
import type {APIRequestContext, Page} from "@playwright/test";

import {expect, test} from "./fixtures/test";
import {TEST_USER} from "./fixtures/testUsers";
import {signUpOrSignInBetterAuth} from "./helpers/betterAuthSession";
import {loginAs} from "./helpers/login";

const API_URL = process.env.BACKEND_URL ?? "http://localhost:4000";
const FRONTEND_ORIGIN = process.env.FRONTEND_URL ?? "http://localhost:8082";

interface TokenRow {
  _id: string;
  revokedAt?: string;
}

interface IssuedToken {
  token: string;
  tokenPrefix: string;
}

/** Revokes the user's active tokens so the 10-active-token cap never fails a rerun. */
const revokeActiveTokens = async (request: APIRequestContext): Promise<void> => {
  const token = await signUpOrSignInBetterAuth(request, TEST_USER);
  const headers = {authorization: `Bearer ${token}`, origin: FRONTEND_ORIGIN};
  const list = await request.get(`${API_URL}/mcp/service-tokens?limit=100`, {headers});
  if (!list.ok()) {
    throw new Error(`GET /mcp/service-tokens failed with ${list.status()}`);
  }
  const rows = ((await list.json()) as {data: TokenRow[]}).data;
  for (const row of rows.filter((candidate) => !candidate.revokedAt)) {
    const revoked = await request.post(`${API_URL}/mcp/service-tokens/${row._id}/revoke`, {
      headers,
    });
    if (!revoked.ok()) {
      throw new Error(`Revoking MCP token ${row._id} failed with ${revoked.status()}`);
    }
  }
};

/** Cloud agents attach these shots to the PR. CircleCI has no such directory. */
const saveShot = async (page: Page, name: string): Promise<void> => {
  const dir = `${process.env.E2E_ARTIFACTS_DIR ?? "/opt/cursor/artifacts"}/screenshots`;
  if (!existsSync(dir)) {
    return;
  }
  await page.screenshot({fullPage: true, path: `${dir}/${name}`});
};

test.describe("MCP tokens", () => {
  test.beforeEach(async ({page, request, consoleGuard}) => {
    // The expiry DateTimeField warns when the headless browser's timezone is "UTC".
    consoleGuard.allow("UTC is not a valid timezone");
    await revokeActiveTokens(request);
    await loginAs(page);
    await page.goto("/settings/mcp");
    await page.getByTestId("settings-mcp-screen").waitFor({state: "visible"});
  });

  test("user creates a token, sees the secret once, and revokes it", async ({page}) => {
    const name = `E2E token ${Date.now()}`;
    await page.getByTestId("settings-mcp-name").fill(name);
    const created = page.waitForResponse(
      (response) =>
        response.url().endsWith("/mcp/service-tokens/create") &&
        response.request().method() === "POST"
    );
    await page.getByTestId("settings-mcp-create").click();
    const createResponse = await created;
    expect(createResponse.status()).toBe(200);
    const body = (await createResponse.json()) as IssuedToken | {data: IssuedToken};
    const {token, tokenPrefix} = "data" in body ? body.data : body;

    // The plaintext is shown once, in the modal.
    await expect(page.getByTestId("settings-mcp-issued-token")).toHaveText(token);
    // The client JSON's text node and the URL link inside it share the test id.
    await expect(page.getByTestId("settings-mcp-issued-json").first()).toContainText(token);

    // The new row arrives over sync; the list is never refetched.
    const row = page.getByTestId(`settings-mcp-row-${tokenPrefix}`);
    await page.getByTestId("settings-mcp-issued-modal.primary").click();
    await expect(page.getByTestId("settings-mcp-issued-modal")).toHaveCount(0);
    await expect(row).toContainText(name);
    await expect(row).toContainText(`Prefix mcp_${tokenPrefix}`);
    await expect(page.getByText(token)).toHaveCount(0);
    await saveShot(page, "mcp-tokens-list.png");

    // After a reload the row comes from the synced store, and the secret is gone for good.
    await page.reload();
    await expect(row).toContainText(name);
    await expect(page.getByText(token)).toHaveCount(0);

    await page.getByTestId(`settings-mcp-revoke-${tokenPrefix}`).click();
    await page.getByRole("button", {exact: true, name: "Confirm"}).click();
    await expect(row).toContainText("(revoked)");
    await expect(page.getByTestId(`settings-mcp-revoke-${tokenPrefix}`)).toHaveCount(0);
    await saveShot(page, "mcp-tokens-revoked.png");
  });

  test("user sees an error and no token when the name is empty", async ({page}) => {
    await page.getByTestId("settings-mcp-create").click();
    await expect(page.getByText("Name is required")).toBeVisible();
    await expect(page.getByTestId("settings-mcp-issued-modal")).toHaveCount(0);
  });
});
