import {describe, expect, it} from "bun:test";

import {
  buildConsentHistoryTemplateData,
  buildConsentResponseTemplateData,
  consentHistoryPrintHtml,
  consentResponsePrintHtml,
  extractResponseFields,
} from "./consentPdfTemplates";
import {formatDate} from "./pdfUtils";

const signedAt = "2026-10-20T15:30:00.000Z";

describe("buildConsentResponseTemplateData", () => {
  it("builds every section of a full admin response", () => {
    const data = buildConsentResponseTemplateData({
      _id: "response-1",
      agreed: true,
      agreedAt: signedAt,
      checkboxValues: {"0": true, "1": false},
      consentFormId: {slug: "intake", title: "Intake", type: "agreement", version: 2},
      contentSnapshot: "# Intake",
      formVersionSnapshot: 2,
      ipAddress: "192.168.1.5",
      locale: "en",
      provisional: true,
      provisionalNote: "Guardian agreed by phone",
      provisionalSignedBy: {_id: "staff-1", name: "Dana Rivera"},
      provisionalSignerIp: "10.0.0.7",
      signature: "data:image/png;base64,AAA",
      signedAt,
      userAgent: "Safari",
      userId: {_id: "member-1", email: "sam@example.com", name: "Sam"},
      voidedAt: "2026-10-21T09:00:00.000Z",
    });

    expect(data.formTitle).toBe("Intake");
    expect(data.fields).toEqual([
      {label: "Form Slug:", value: "intake"},
      {label: "Form Type:", value: "agreement"},
      {label: "Form Version:", value: "2"},
      {label: "Decision:", value: "Agreed"},
      {label: "Agreed At:", value: formatDate(signedAt)},
      {label: "Locale:", value: "en"},
    ]);
    expect(data.checkboxes).toEqual([
      {checked: true, label: "Checkbox 0"},
      {checked: false, label: "Checkbox 1"},
    ]);
    expect(data.auditTrail).toEqual([
      {label: "IP Address:", value: "192.168.1.5"},
      {label: "User Agent:", value: "Safari"},
      {label: "Form Version:", value: "2"},
      {label: "Signed At:", value: formatDate(signedAt)},
    ]);
    expect(data.userInfo).toEqual({email: "sam@example.com", name: "Sam", userId: "member-1"});
    expect(data.provisionalSignature).toEqual({
      note: "Guardian agreed by phone",
      signedAt,
      signedByName: "Dana Rivera",
      signerIp: "10.0.0.7",
      voidedAt: "2026-10-21T09:00:00.000Z",
    });
    expect(data.responseId).toBe("response-1");
  });

  it("leaves optional sections out of a minimal response", () => {
    const data = buildConsentResponseTemplateData({agreed: false, userId: "member-1"});
    expect(data.formTitle).toBe("Unknown Form");
    expect(data.fields).toEqual([{label: "Decision:", value: "Declined"}]);
    expect(data.checkboxes).toBeUndefined();
    expect(data.auditTrail).toBeUndefined();
    expect(data.provisionalSignature).toBeUndefined();
  });
});

describe("extractResponseFields", () => {
  it("reads ids from string refs", () => {
    expect(
      extractResponseFields({agreed: true, consentFormId: "form-1", userId: "member-1"})
    ).toEqual({
      formSlug: "",
      formTitle: "Unknown Form",
      formType: "",
      formVersion: undefined,
      userEmail: "",
      userId: "member-1",
      userName: "",
    });
  });
});

describe("buildConsentHistoryTemplateData", () => {
  it("builds every section of the user's entry, without the signer's note", () => {
    const data = buildConsentHistoryTemplateData({
      _id: "entry-1",
      agreed: true,
      agreedAt: signedAt,
      checkboxValues: {"0": true, "1": true},
      contentSnapshot: "# Terms",
      form: {
        captureSignature: false,
        checkboxes: [{label: "I have read the terms", required: true}],
        slug: "tos",
        title: "Terms",
        type: "terms",
        version: 3,
      },
      formVersionSnapshot: 3,
      ipAddress: "192.168.1.5",
      locale: "es",
      provisional: true,
      provisionalSignedBy: {name: "Dana Rivera"},
      signature: "data:image/png;base64,BBB",
      signedAt,
      userAgent: "Chrome",
    });

    expect(data.fields).toEqual([
      {label: "Form Slug:", value: "tos"},
      {label: "Form Type:", value: "terms"},
      {label: "Form Version:", value: "3"},
      {label: "Decision:", value: "Agreed"},
      {label: "Agreed At:", value: formatDate(signedAt)},
      {label: "Locale:", value: "es"},
    ]);
    expect(data.checkboxes).toEqual([
      {checked: true, label: "I have read the terms"},
      {checked: true, label: "Checkbox 1"},
    ]);
    expect(data.auditTrail).toHaveLength(4);
    expect(data.provisionalSignature).toEqual({
      signedAt,
      signedByName: "Dana Rivera",
      voidedAt: undefined,
    });
  });

  it("leaves optional sections out of a minimal entry", () => {
    const data = buildConsentHistoryTemplateData({
      _id: "entry-2",
      agreed: false,
      agreedAt: "",
      form: null,
    });
    expect(data.formTitle).toBe("Unknown Form");
    expect(data.fields).toEqual([{label: "Decision:", value: "Declined"}]);
    expect(data.checkboxes).toBeUndefined();
    expect(data.provisionalSignature).toBeUndefined();
  });
});

describe("print HTML", () => {
  it("renders the admin provisional block with the note", () => {
    const html = consentResponsePrintHtml({
      agreed: true,
      agreedAt: signedAt,
      provisional: true,
      provisionalNote: "Guardian agreed by phone",
      provisionalSignedBy: {name: "Dana Rivera"},
      userId: "member-1",
    });
    expect(html).toContain("<h2>Provisional signature</h2>");
    expect(html).toContain("Guardian agreed by phone");
  });

  it("renders the user's provisional block without a note", () => {
    const html = consentHistoryPrintHtml({
      _id: "entry-1",
      agreed: true,
      agreedAt: signedAt,
      form: null,
      provisional: true,
      provisionalSignedBy: {name: "Dana Rivera"},
    });
    expect(html).toContain("<h2>Provisional signature</h2>");
    expect(html).toContain("Dana Rivera");
    expect(html).not.toContain("Note:");
  });
});
