import {beforeEach, describe, expect, it, mock} from "bun:test";
import {Platform} from "react-native";

interface ShareCall {
  filename: string;
  html: string;
}

const templateCalls: unknown[] = [];
const shareCalls: ShareCall[] = [];

mock.module("@terreno/ui", () => ({
  buildConsentPdfHtml: (data: unknown): string => {
    templateCalls.push(data);
    return "<html>consent</html>";
  },
  sharePdfFromHtml: async (call: ShareCall): Promise<void> => {
    shareCalls.push(call);
  },
}));

Platform.OS = "ios";

import {generateConsentHistoryPdf} from "../generateConsentHistoryPdf";
import {generateConsentPdf} from "../generateConsentPdf";
import type {ConsentHistoryEntry} from "../useConsentHistory";

type ConsentForm = NonNullable<ConsentHistoryEntry["form"]>;

/** A history entry as older or partial server records store it: optional form fields and dates. */
interface StoredConsentEntry
  extends Omit<ConsentHistoryEntry, "agreedAt" | "checkboxValues" | "form"> {
  agreedAt?: string;
  checkboxValues?: Record<string, boolean> | null;
  form?:
    | (Partial<Omit<ConsentForm, "checkboxes">> & {
        checkboxes?: Array<
          Omit<ConsentForm["checkboxes"][number], "required"> & {required?: boolean}
        >;
      })
    | null;
}

/** Feeds a partial stored record to the generator, which must tolerate the missing fields. */
const generateFromStored = (entry: StoredConsentEntry): Promise<void> =>
  generateConsentHistoryPdf(entry as unknown as ConsentHistoryEntry);

describe("mobile consent PDF generation", () => {
  beforeEach(() => {
    templateCalls.length = 0;
    shareCalls.length = 0;
  });

  it("builds and shares a complete consent response template", async () => {
    await generateConsentPdf({
      _id: "response-123",
      agreed: true,
      agreedAt: "2026-09-01T10:00:00.000Z",
      checkboxValues: {"0": true},
      consentFormId: {slug: "privacy", title: "Privacy", type: "legal", version: 2},
      contentSnapshot: "Terms",
      formVersionSnapshot: 2,
      ipAddress: "127.0.0.1",
      locale: "en",
      signature: "data:image/png;base64,AAA",
      signedAt: "2026-09-01T10:01:00.000Z",
      userAgent: "Mobile",
      userId: {_id: "user-1", email: "user@example.com", name: "User"},
    });

    expect(templateCalls).toHaveLength(1);
    expect(templateCalls[0]).toMatchObject({
      auditTrail: expect.any(Array),
      fields: expect.any(Array),
      formTitle: "Privacy",
      responseId: "response-123",
      title: "Consent Record",
      userInfo: {email: "user@example.com", name: "User", userId: "user-1"},
    });
    expect(shareCalls).toHaveLength(1);
    expect(shareCalls[0].filename).toMatch(/^consent-privacy-user-1-\d{4}-\d{2}-\d{2}\.pdf$/);
    expect(shareCalls[0].html).toBe("<html>consent</html>");
  });

  it("builds fallback consent response fields for legacy ids", async () => {
    await generateConsentPdf({
      agreed: false,
      consentFormId: "legacy-form",
      formVersionSnapshot: 3,
      userId: "legacy-user",
    });

    expect(templateCalls[0]).toMatchObject({
      auditTrail: expect.any(Array),
      formTitle: "Unknown Form",
      userInfo: {email: undefined, name: undefined, userId: "legacy-user"},
    });
    expect(shareCalls[0].filename).toMatch(/^consent-response-y-user-\d{4}-\d{2}-\d{2}\.pdf$/);
  });

  it("builds and shares a complete history-entry template", async () => {
    await generateFromStored({
      _id: "history-1",
      agreed: true,
      agreedAt: "2026-09-01T10:00:00.000Z",
      checkboxValues: {"0": true, "2": false},
      contentSnapshot: "Snapshot",
      form: {
        checkboxes: [{label: "Email"}],
        slug: "terms",
        title: "Terms",
        type: "legal",
        version: 4,
      },
      formVersionSnapshot: 4,
      ipAddress: "127.0.0.1",
      locale: "en",
      signature: "data:image/png;base64,BBB",
      signedAt: "2026-09-01T10:01:00.000Z",
      userAgent: "Mobile",
    });

    expect(templateCalls[0]).toMatchObject({
      auditTrail: expect.any(Array),
      checkboxes: [
        {checked: true, label: "Email"},
        {checked: false, label: "Checkbox 2"},
      ],
      formTitle: "Terms",
      responseId: "history-1",
      title: "Consent Record",
    });
    expect(shareCalls[0].filename).toMatch(/^consent-terms-\d{4}-\d{2}-\d{2}\.pdf$/);
  });

  it("omits empty optional history sections", async () => {
    await generateFromStored({
      _id: "history-2",
      agreed: false,
    });

    expect(templateCalls[0]).toMatchObject({
      auditTrail: undefined,
      checkboxes: undefined,
      fields: [{label: "Decision:", value: "Declined"}],
      formTitle: "Unknown Form",
    });
    expect(shareCalls[0].filename).toMatch(/^consent-response-\d{4}-\d{2}-\d{2}\.pdf$/);
  });
  it("passes the provisional signer and date, without the note, for a user's history entry", async () => {
    await generateFromStored({
      _id: "history-3",
      agreed: true,
      agreedAt: "2026-10-20T15:30:00.000Z",
      provisional: true,
      provisionalSignedBy: {name: "Dana Rivera"},
    });

    expect((templateCalls[0] as {provisionalSignature?: unknown}).provisionalSignature).toEqual({
      signedAt: "2026-10-20T15:30:00.000Z",
      signedByName: "Dana Rivera",
      voidedAt: undefined,
    });
  });

  it("passes the provisional signature with note and IP for an admin response", async () => {
    await generateConsentPdf({
      agreed: true,
      agreedAt: "2026-10-20T15:30:00.000Z",
      provisional: true,
      provisionalNote: "Phone",
      provisionalSignedBy: {email: "dana@example.com"},
      provisionalSignerIp: "10.0.0.7",
      userId: "member-1",
      voidedAt: "2026-10-21T09:00:00.000Z",
    });

    expect((templateCalls[0] as {provisionalSignature?: unknown}).provisionalSignature).toEqual({
      note: "Phone",
      signedAt: "2026-10-20T15:30:00.000Z",
      signedByName: "dana@example.com",
      signerIp: "10.0.0.7",
      voidedAt: "2026-10-21T09:00:00.000Z",
    });
  });
});
