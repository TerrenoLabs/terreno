import {beforeEach, describe, expect, it, mock} from "bun:test";
import {Platform} from "react-native";

interface JsPDFCall {
  method: string;
  args: unknown[];
}

const calls: JsPDFCall[] = [];
let imageMode: "success" | "throw" = "success";
let splitMode: "default" | "overflow" = "default";
const sharePdfFromHtml = mock(async () => undefined);
const buildConsentPdfHtml = mock(() => "<html>consent</html>");

class MockJsPDF {
  constructor(options?: unknown) {
    calls.push({args: [options], method: "ctor"});
  }

  addImage(...args: unknown[]): void {
    calls.push({args, method: "addImage"});
    if (imageMode === "throw") {
      throw new Error("bad image");
    }
  }

  addPage(): void {
    calls.push({args: [], method: "addPage"});
  }

  line(...args: unknown[]): void {
    calls.push({args, method: "line"});
  }

  save(...args: unknown[]): void {
    calls.push({args, method: "save"});
  }

  setDrawColor(...args: unknown[]): void {
    calls.push({args, method: "setDrawColor"});
  }

  setFont(...args: unknown[]): void {
    calls.push({args, method: "setFont"});
  }

  setFontSize(...args: unknown[]): void {
    calls.push({args, method: "setFontSize"});
  }

  setTextColor(...args: unknown[]): void {
    calls.push({args, method: "setTextColor"});
  }

  splitTextToSize(text: string, _width: number): string[] {
    if (splitMode === "overflow") {
      return Array.from({length: 200}, (_value, index) => `overflow-line-${index}`);
    }
    return text.split("\n");
  }

  text(...args: unknown[]): void {
    calls.push({args, method: "text"});
  }
}

mock.module("jspdf", () => ({jsPDF: MockJsPDF}));
mock.module("@terreno/ui", () => ({
  buildConsentPdfHtml,
  sharePdfFromHtml,
}));

Platform.OS = "web";

import {generateConsentHistoryPdf} from "../generateConsentHistoryPdf";
import {formatDate} from "../pdfUtils";
import type {ConsentHistoryEntry} from "../useConsentHistory";

const getRenderedText = (): string[] =>
  calls.filter((call) => call.method === "text").map((call) => String(call.args[0]));

const baseEntry = (): ConsentHistoryEntry => ({
  _id: "hist-1",
  agreed: true,
  agreedAt: "2024-01-15T12:00:00Z",
  form: {
    captureSignature: true,
    checkboxes: [{label: "Age", required: true}],
    slug: "privacy",
    title: "Privacy Policy",
    type: "legal",
    version: 2,
  },
});

describe("generateConsentHistoryPdf", () => {
  beforeEach(() => {
    calls.length = 0;
    imageMode = "success";
    splitMode = "default";
    sharePdfFromHtml.mockClear();
    buildConsentPdfHtml.mockClear();
    Platform.OS = "web";
  });

  it("renders a complete consent record with all optional fields", async () => {
    await generateConsentHistoryPdf({
      _id: "response-123",
      agreed: true,
      agreedAt: "2024-01-15T12:00:00Z",
      checkboxValues: {"0": true, "1": false},
      contentSnapshot: Array.from({length: 120}, (_value, index) => `line ${index}`).join("\n"),
      form: {
        checkboxes: [{label: "Emails"}, {label: "Analytics"}],
        slug: "privacy",
        title: "Privacy Policy",
        type: "legal",
        version: 2,
      },
      formVersionSnapshot: 2,
      ipAddress: "127.0.0.1",
      locale: "en",
      signature: "data:image/png;base64,AAA",
      signedAt: "2024-01-15T12:01:00Z",
      userAgent: "Mozilla",
    });

    const methods = calls.map((call) => call.method);
    expect(methods).toContain("ctor");
    expect(methods).toContain("save");
    expect(methods).toContain("addImage");
    expect(methods).toContain("addPage");
    expect(String(calls.find((call) => call.method === "save")?.args[0])).toMatch(
      /^consent-privacy-/
    );

    const renderedText = getRenderedText();
    expect(renderedText).toContain("[x] Emails");
    expect(renderedText).toContain("[ ] Analytics");
    expect(renderedText).toContain("127.0.0.1");
    expect(renderedText).toContain("Mozilla");
    expect(renderedText.some((value) => value.startsWith("Response ID: response-123"))).toBe(true);
  });

  it("writes a populated web pdf with checkboxes, audit trail, signature, and snapshot", async () => {
    splitMode = "overflow";
    await generateConsentHistoryPdf({
      ...baseEntry(),
      checkboxValues: {"0": true, "1": false},
      contentSnapshot: "snapshot",
      formVersionSnapshot: 2,
      ipAddress: "127.0.0.1",
      locale: "en",
      signature: "data:image/png;base64,AAA",
      signedAt: "2024-01-15T12:01:00Z",
      userAgent: "Mozilla",
    });
    const methods = calls.map((call) => call.method);
    expect(methods).toContain("save");
    expect(methods).toContain("addImage");
    expect(methods).toContain("addPage");
    const textArgs = calls
      .filter((call) => call.method === "text")
      .map((call) => String(call.args[0]));
    expect(textArgs).toContain("Agreed");
    expect(textArgs).toContain("en");
    expect(textArgs.some((value) => value.includes("Response ID: hist-1"))).toBe(true);
  });

  it("handles missing form metadata and a declined response", async () => {
    await generateConsentHistoryPdf({
      _id: "response-456",
      agreed: false,
      checkboxValues: null,
      formVersionSnapshot: 7,
    });

    const renderedText = getRenderedText();
    expect(renderedText).toContain("Unknown Form");
    expect(renderedText).toContain("Declined");
    expect(renderedText).toContain("7");
    expect(String(calls.find((call) => call.method === "save")?.args[0])).toMatch(
      /^consent-response-/
    );
  });

  it("renders declined entries without a form and JPEG signature failures", async () => {
    imageMode = "throw";
    await generateConsentHistoryPdf({
      _id: "x",
      agreed: false,
      agreedAt: "not-a-date",
      form: null,
      signature: "data:image/jpeg;base64,BBB",
    });
    const textArgs = calls
      .filter((call) => call.method === "text")
      .map((call) => String(call.args[0]));
    expect(textArgs).toContain("Declined");
    expect(textArgs).toContain("Unknown Form");
    expect(textArgs.some((value) => value.includes("could not be embedded"))).toBe(true);
  });

  it("uses fallback labels and handles a failed signature image", async () => {
    imageMode = "throw";
    await generateConsentHistoryPdf({
      _id: "response-789",
      agreed: true,
      checkboxValues: {"3": true},
      signature: "data:image/jpeg;base64,BBB",
    });

    const renderedText = getRenderedText();
    expect(renderedText).toContain("[x] Checkbox 3");
    expect(
      renderedText.some((value) => value.includes("Signature image could not be embedded"))
    ).toBe(true);
  });

  it("adds pages while rendering overflowing content", async () => {
    splitMode = "overflow";
    await generateConsentHistoryPdf({
      _id: "response-overflow",
      agreed: true,
      checkboxValues: Object.fromEntries(
        Array.from({length: 40}, (_value, index) => [String(index), index % 2 === 0])
      ),
      contentSnapshot: "content",
      form: {slug: "terms", title: "Terms"},
      ipAddress: "10.0.0.1",
      signature: "data:image/jpeg;base64,CCC",
      signedAt: "2024-02-01T00:00:00Z",
      userAgent: "Test agent",
    });

    expect(calls.filter((call) => call.method === "addPage").length).toBeGreaterThan(0);
  });

  it("shares HTML on native platforms", async () => {
    Platform.OS = "ios";
    await generateConsentHistoryPdf({
      ...baseEntry(),
      checkboxValues: {"0": false},
      ipAddress: "10.0.0.1",
      locale: "es",
      signedAt: "2024-02-01T00:00:00Z",
      userAgent: "UA",
    });
    expect(buildConsentPdfHtml).toHaveBeenCalled();
    expect(sharePdfFromHtml).toHaveBeenCalled();
  });
  it("draws the provisional signer and date for the user, without a note", async () => {
    await generateConsentHistoryPdf({
      ...baseEntry(),
      agreedAt: "2026-10-20T15:30:00Z",
      provisional: true,
      provisionalSignedBy: {name: "Dana Rivera"},
    });

    const text = getRenderedText();
    expect(text).toContain("Provisional signature");
    expect(text).toContain("Dana Rivera");
    expect(text).toContain(formatDate("2026-10-20T15:30:00Z"));
    expect(text).not.toContain("Note:");
    expect(text).not.toContain("Signer IP:");
  });

  it("marks a voided provisional signature", async () => {
    await generateConsentHistoryPdf({
      ...baseEntry(),
      provisional: true,
      provisionalSignedBy: null,
      voidedAt: "2026-10-21T09:00:00Z",
    });
    const text = getRenderedText();
    expect(text).toContain("Staff");
    expect(text).toContain(`Voided ${formatDate("2026-10-21T09:00:00Z")}`);
  });

  it("draws no provisional section for the user's own entry", async () => {
    await generateConsentHistoryPdf({...baseEntry(), provisional: false});
    expect(getRenderedText()).not.toContain("Provisional signature");
  });
});
