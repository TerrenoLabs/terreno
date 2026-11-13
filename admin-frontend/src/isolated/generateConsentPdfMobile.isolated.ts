import {beforeEach, describe, it, mock} from "bun:test";
import {assert} from "chai";

const buildConsentPdfHtml = mock((_data: unknown): string => "<html>consent</html>");
const sharePdfFromHtml = mock(async (_input: unknown): Promise<void> => undefined);

mock.module("@terreno/ui", () => ({
  buildConsentPdfHtml,
  sharePdfFromHtml,
}));

mock.module("react-native", () => ({
  Platform: {OS: "ios"},
}));

import {generateConsentPdf} from "../generateConsentPdf";

describe("generateConsentPdf mobile", () => {
  beforeEach(() => {
    buildConsentPdfHtml.mockClear();
    sharePdfFromHtml.mockClear();
  });

  it("builds and shares a complete native consent record", async () => {
    await generateConsentPdf({
      _id: "response-1",
      agreed: true,
      agreedAt: "2026-09-10T12:00:00Z",
      checkboxValues: {"0": true, "1": false},
      consentFormId: {
        slug: "privacy",
        title: "Privacy Policy",
        type: "legal",
        version: 3,
      },
      contentSnapshot: "Terms",
      formVersionSnapshot: 3,
      ipAddress: "127.0.0.1",
      locale: "en",
      signature: "data:image/png;base64,AAA",
      signedAt: "2026-09-10T12:01:00Z",
      userAgent: "Browser",
      userId: {email: "person@example.com", id: "user-1", name: "Person"},
    });

    assert.equal(buildConsentPdfHtml.mock.calls.length, 1);
    const template = buildConsentPdfHtml.mock.calls[0]?.[0] as {
      auditTrail?: unknown[];
      checkboxes?: unknown[];
      fields: unknown[];
      formTitle: string;
      userInfo: {email?: string; name?: string; userId: string};
    };
    assert.equal(template.formTitle, "Privacy Policy");
    assert.lengthOf(template.checkboxes ?? [], 2);
    assert.lengthOf(template.auditTrail ?? [], 4);
    assert.deepEqual(template.userInfo, {
      email: "person@example.com",
      name: "Person",
      userId: "user-1",
    });
    const shareInput = sharePdfFromHtml.mock.calls[0]?.[0] as {filename: string} | undefined;
    assert.isDefined(shareInput);
    assert.match(shareInput.filename, /^consent-privacy-user-1-\d{4}-\d{2}-\d{2}\.pdf$/);
  });

  it("uses empty optional sections for a minimal declined response", async () => {
    await generateConsentPdf({
      agreed: false,
      consentFormId: "legacy-form",
      userId: "legacy-user",
    });

    const template = buildConsentPdfHtml.mock.calls[0]?.[0] as {
      auditTrail?: unknown[];
      checkboxes?: unknown[];
      fields: Array<{label: string; value: string}>;
      formTitle: string;
      userInfo: {email?: string; name?: string; userId: string};
    };
    assert.equal(template.formTitle, "Unknown Form");
    assert.isUndefined(template.auditTrail);
    assert.isUndefined(template.checkboxes);
    assert.deepEqual(template.fields, [{label: "Decision:", value: "Declined"}]);
    assert.deepEqual(template.userInfo, {email: undefined, name: undefined, userId: "legacy-user"});
  });
  it("passes the full provisional signature to the native template", async () => {
    await generateConsentPdf({
      agreed: true,
      agreedAt: "2026-10-20T15:30:00Z",
      provisional: true,
      provisionalNote: "Guardian agreed by phone",
      provisionalSignedBy: {_id: "staff-1", name: "Dana Rivera"},
      provisionalSignerIp: "10.0.0.7",
      userId: "member-1",
    });

    const template = buildConsentPdfHtml.mock.calls[0]?.[0] as {
      provisionalSignature?: Record<string, unknown>;
    };
    assert.deepEqual(template.provisionalSignature, {
      note: "Guardian agreed by phone",
      signedAt: "2026-10-20T15:30:00Z",
      signedByName: "Dana Rivera",
      signerIp: "10.0.0.7",
      voidedAt: undefined,
    });
  });

  it("leaves provisionalSignature unset for the user's own response", async () => {
    await generateConsentPdf({agreed: true, userId: "member-1"});
    const template = buildConsentPdfHtml.mock.calls[0]?.[0] as {provisionalSignature?: unknown};
    assert.isUndefined(template.provisionalSignature);
  });
});
