import {mkdirSync} from "node:fs";
import type {Page} from "@playwright/test";
import {expect, test} from "./fixtures/test";
import {
  ADMIN_USER,
  PROVISIONAL_MEMBER_USER,
  PROVISIONAL_OUTSIDER_USER,
  PROVISIONAL_STAFF_USER,
} from "./fixtures/testUsers";
import {getAdminToken, loginAsAdmin, setUserAdmin} from "./helpers/adminAuth";
import {signUpOrSignInBetterAuth} from "./helpers/betterAuthSession";
import {
  acceptPendingConsentForms,
  agreeToConsentForm,
  createConsentForm,
  deleteConsentForm,
  getUserIdForToken,
  grantConsentSignerRole,
  signConsentProvisionally,
} from "./helpers/consentForms";
import {loginAs} from "./helpers/login";
import {waitForSyncTodosScreen} from "./helpers/syncdbSuite";

const ARTIFACTS_DIR = "/opt/cursor/artifacts/screenshots";
const NOTE = "Guardian gave verbal consent at intake";

const saveScreenshot = async (page: Page, name: string): Promise<void> => {
  try {
    mkdirSync(ARTIFACTS_DIR, {recursive: true});
    await page.screenshot({fullPage: true, path: `${ARTIFACTS_DIR}/${name}.png`});
  } catch {
    // Evidence only: a missing artifacts directory must not fail the behavior under test.
  }
};

/** Open the signer screen for the member and wait for the form's row. */
const openSigner = async (page: Page, memberId: string, formId: string): Promise<void> => {
  await page.goto(`/consent-sign/${memberId}`);
  await page.getByTestId("provisional-consent-signer").waitFor({state: "visible"});
  await page.getByTestId(`provisional-consent-row-${formId}`).waitFor({state: "visible"});
};

/** Sign the open form through the UI with the shared note. */
const signThroughUi = async (page: Page, formId: string): Promise<void> => {
  await page.getByTestId(`provisional-consent-open-${formId}`).click();
  await page.getByTestId("provisional-consent-note-input").waitFor({state: "visible"});
  await page.getByTestId("provisional-consent-note-input").fill(NOTE);
  await page.getByTestId("provisional-consent-submit-button").click();
  await page.getByTestId("provisional-consent-success").waitFor({state: "visible"});
};

test.describe("Provisional consent signing", () => {
  let adminToken: string;
  let memberToken: string;
  let staffToken: string;
  let outsiderToken: string;
  let memberId: string;
  let consentFormId: string;

  test.beforeAll(async ({request}) => {
    await setUserAdmin(ADMIN_USER.email);
    adminToken = await getAdminToken(request);
    memberToken = await signUpOrSignInBetterAuth(request, PROVISIONAL_MEMBER_USER);
    staffToken = await signUpOrSignInBetterAuth(request, PROVISIONAL_STAFF_USER);
    outsiderToken = await signUpOrSignInBetterAuth(request, PROVISIONAL_OUTSIDER_USER);
    memberId = await getUserIdForToken(request, memberToken);
    const staffId = await getUserIdForToken(request, staffToken);
    await grantConsentSignerRole(request, adminToken, staffId);
  });

  test.beforeEach(async ({request}) => {
    // Clear forms left by other suites so the member's gate shows only this test's form.
    for (const token of [memberToken, staffToken, outsiderToken]) {
      await acceptPendingConsentForms(request, token);
    }
    consentFormId = await createConsentForm(request, adminToken);
    // Staff and the outsider agree for themselves so their own consent gate stays out of the way.
    for (const token of [staffToken, outsiderToken]) {
      await agreeToConsentForm(request, token, consentFormId);
    }
  });

  test.afterEach(async ({request}) => {
    if (consentFormId) {
      await deleteConsentForm(request, adminToken, consentFormId);
    }
  });

  test("admin signs a pending form on the member's behalf", async ({page}) => {
    await loginAsAdmin(page);
    await openSigner(page, memberId, consentFormId);
    await expect(page.getByTestId(`provisional-consent-status-${consentFormId}`)).toContainText(
      "Pending"
    );

    await signThroughUi(page, consentFormId);

    await expect(page.getByTestId("provisional-consent-success")).toContainText(
      "signed provisionally by"
    );
    await expect(page.getByTestId(`provisional-consent-status-${consentFormId}`)).toContainText(
      "Signed provisionally by"
    );
    await saveScreenshot(page, "provisional-consent-signer");
  });

  test("member sees the provisional notice without the note and still agrees", async ({
    page,
    request,
  }) => {
    await signConsentProvisionally(request, adminToken, {
      consentFormId,
      note: NOTE,
      userId: memberId,
    });

    await loginAs(page, PROVISIONAL_MEMBER_USER);
    const notice = page.getByTestId("consent-form-provisional-notice");
    await notice.waitFor({state: "visible"});
    await expect(notice).toContainText("Signed on your behalf by");
    await expect(page.getByText(NOTE)).toHaveCount(0);
    await saveScreenshot(page, "provisional-consent-notice");

    await page.getByTestId("consent-form-agree-button").click();
    await waitForSyncTodosScreen(page);
  });

  test("admin sees the form as signed after the member agrees", async ({page, request}) => {
    await signConsentProvisionally(request, adminToken, {
      consentFormId,
      note: NOTE,
      userId: memberId,
    });
    await agreeToConsentForm(request, memberToken, consentFormId);

    await loginAsAdmin(page);
    await openSigner(page, memberId, consentFormId);
    await expect(page.getByTestId(`provisional-consent-status-${consentFormId}`)).toContainText(
      "Signed by user"
    );
  });

  test("admin prints a provisional signature with the note", async ({page, request}) => {
    await signConsentProvisionally(request, adminToken, {
      consentFormId,
      note: NOTE,
      userId: memberId,
    });
    // Record the HTML handed to the print frame so the printout can be checked and captured.
    await page.addInitScript(() => {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "srcdoc");
      Object.defineProperty(HTMLIFrameElement.prototype, "srcdoc", {
        configurable: true,
        get(): string {
          return descriptor?.get?.call(this) ?? "";
        },
        set(value: string): void {
          (window as unknown as {printedConsentHtml?: string}).printedConsentHtml = value;
          descriptor?.set?.call(this, value);
        },
      });
    });

    await loginAsAdmin(page);
    await openSigner(page, memberId, consentFormId);
    await page.getByTestId(`provisional-consent-print-${consentFormId}`).click();
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as {printedConsentHtml?: string}).printedConsentHtml ?? ""
        )
      )
      .toContain("Provisional signature");
    const html = await page.evaluate(
      () => (window as unknown as {printedConsentHtml?: string}).printedConsentHtml ?? ""
    );
    expect(html).toContain(NOTE);

    const printPage = await page.context().newPage();
    await printPage.setContent(html);
    await saveScreenshot(printPage, "provisional-consent-print");
    await printPage.close();
  });

  test("admin opens the signer from a consent response's detail page", async ({page, request}) => {
    const responseId = await signConsentProvisionally(request, adminToken, {
      consentFormId,
      note: NOTE,
      userId: memberId,
    });

    await loginAsAdmin(page);
    await page.goto(`/admin/consent-responses/${responseId}`);
    await page.getByTestId("consent-response-provisional").waitFor({state: "visible"});
    await page.getByTestId("consent-response-sign-on-behalf-button").click();

    await page.getByTestId(`provisional-consent-row-${consentFormId}`).waitFor({state: "visible"});
    expect(page.url()).toContain(`/consent-sign/${memberId}`);
  });

  test("staff with the signOnBehalf role signs from the same route", async ({page}) => {
    await loginAs(page, PROVISIONAL_STAFF_USER);
    await waitForSyncTodosScreen(page);
    await openSigner(page, memberId, consentFormId);

    await signThroughUi(page, consentFormId);

    await expect(page.getByTestId(`provisional-consent-status-${consentFormId}`)).toContainText(
      "Signed provisionally by E2E Provisional Staff"
    );
  });

  test("a user without the role sees the error state", async ({consoleGuard, page}) => {
    // The denied status request (405) is what this test expects; the app logs it.
    consoleGuard.allow("the server responded with a status of 405");
    consoleGuard.allow("/consent-responses/status?userId=");
    await loginAs(page, PROVISIONAL_OUTSIDER_USER);
    await waitForSyncTodosScreen(page);
    await page.goto(`/consent-sign/${memberId}`);
    await page.getByTestId("provisional-consent-error").waitFor({state: "visible"});
    await expect(page.getByTestId(`provisional-consent-row-${consentFormId}`)).toHaveCount(0);
  });
});
