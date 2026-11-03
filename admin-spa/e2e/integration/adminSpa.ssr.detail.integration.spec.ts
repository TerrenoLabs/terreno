import {expect, test} from "@playwright/test";
import {readHydrationErrors, recordHydrationErrors, waitForHydration} from "../helpers/hydration";

// Must match the credentials seeded by example-backend/src/scripts/seed-admin-spa-admin.ts.
const ADMIN_EMAIL = process.env.ADMIN_SPA_E2E_EMAIL ?? "admin-spa-e2e@example.com";
const ADMIN_PASSWORD = process.env.ADMIN_SPA_E2E_PASSWORD ?? "admin-spa-e2e-password";

/**
 * E5: the model detail form is server-rendered. With JavaScript disabled, `/console/User/<id>`
 * already shows that user's email in the form; with it enabled the form hydrates from the
 * embedded record and the browser never asks for `GET /admin/users/<id>`. The seeded admin is
 * itself a user row, so its id is looked up through the API. Read-only: nothing here mutates
 * backend state.
 */
test.describe("admin SPA server-rendered model detail", () => {
  const signInAndFindAdminId = async (
    request: import("@playwright/test").APIRequestContext
  ): Promise<string> => {
    const signIn = await request.post("/api/auth/sign-in/email", {
      data: {email: ADMIN_EMAIL, password: ADMIN_PASSWORD},
    });
    expect(signIn.ok()).toBeTruthy();
    const list = await request.get("/admin/users?limit=100");
    expect(list.ok()).toBeTruthy();
    const body = (await list.json()) as {data: {_id: string; email?: string}[]};
    const admin = body.data.find((user) => user.email === ADMIN_EMAIL);
    expect(admin).toBeDefined();
    return String(admin?._id);
  };

  test("with JavaScript disabled, /console/User/<id> shows the user's email in the form", async ({
    baseURL,
    browser,
    request,
  }) => {
    const userId = await signInAndFindAdminId(request);
    const storageState = await request.storageState();

    const context = await browser.newContext({baseURL, javaScriptEnabled: false, storageState});
    const page = await context.newPage();
    try {
      const response = await page.goto(`/console/User/${userId}`);
      expect(response?.status()).toBe(200);
      await expect(
        page.getByTestId("admin-field-email").locator("visible=true").first()
      ).toHaveValue(ADMIN_EMAIL);
      await expect(page.getByRole("progressbar")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test("with JavaScript disabled, a fully percent-encoded /console/User/<id> shows the user's email in the form", async ({
    baseURL,
    browser,
    request,
  }) => {
    const userId = await signInAndFindAdminId(request);
    const storageState = await request.storageState();
    // Every character escaped (e.g. %36%61...), so the gate must canonicalize the id before Expo keys its loader data.
    const encodedId = [...userId]
      .map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`)
      .join("");

    const context = await browser.newContext({baseURL, javaScriptEnabled: false, storageState});
    const page = await context.newPage();
    try {
      const response = await page.goto(`/console/User/${encodedId}`);
      expect(response?.status()).toBe(200);
      await expect(
        page.getByTestId("admin-field-email").locator("visible=true").first()
      ).toHaveValue(ADMIN_EMAIL);
      await expect(page.getByRole("progressbar")).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test("with JavaScript enabled, the form hydrates without requesting GET /admin/users/<id>", async ({
    page,
    request,
  }) => {
    const userId = await signInAndFindAdminId(request);
    await page.goto("/console/login");
    await page.getByTestId("admin-spa-login-email").fill(ADMIN_EMAIL);
    await page.getByTestId("admin-spa-login-password").fill(ADMIN_PASSWORD);
    await page.getByTestId("admin-spa-login-submit").click();
    await page.waitForURL(/\/console\/?$/, {timeout: 30_000});

    const readRequests: string[] = [];
    page.on("request", (pageRequest) => {
      const {pathname} = new URL(pageRequest.url());
      if (pageRequest.method() === "GET" && pathname === `/admin/users/${userId}`) {
        readRequests.push(pageRequest.url());
      }
    });
    await recordHydrationErrors(page);
    await page.setViewportSize({height: 800, width: 1280});
    // A full document load, so the form comes from the server render and not a client navigation.
    const hydrated = waitForHydration(page);
    await page.goto(`/console/User/${userId}`);
    await hydrated;
    await page.waitForLoadState("networkidle");

    await expect(page.getByTestId("admin-field-email").locator("visible=true").first()).toHaveValue(
      ADMIN_EMAIL
    );
    expect(readRequests).toEqual([]);
    expect(await readHydrationErrors(page)).toEqual([]);
  });
});
