import {beforeEach, describe, expect, it, mock} from "bun:test";
import {Platform} from "react-native";

interface JsPDFCall {
  method: string;
  args: unknown[];
}

// All tests share this single calls array and single mock module. We toggle
// behavior via closure flags so the generateConsentPdf module is imported
// once and its coverage counters accumulate across every test.
const calls: JsPDFCall[] = [];
let imageMode: "success" | "throw" = "success";
let splitMode: "default" | "overflow" = "default";

class MockJsPDF {
  constructor(_opts?: unknown) {
    calls.push({args: [_opts], method: "ctor"});
  }
  addImage(...args: unknown[]) {
    calls.push({args, method: "addImage"});
    if (imageMode === "throw") {
      throw new Error("bad image");
    }
  }
  addPage() {
    calls.push({args: [], method: "addPage"});
  }
  line(...args: unknown[]) {
    calls.push({args, method: "line"});
  }
  save(...args: unknown[]) {
    calls.push({args, method: "save"});
  }
  setDrawColor(...args: unknown[]) {
    calls.push({args, method: "setDrawColor"});
  }
  setFont(...args: unknown[]) {
    calls.push({args, method: "setFont"});
  }
  setFontSize(...args: unknown[]) {
    calls.push({args, method: "setFontSize"});
  }
  setTextColor(...args: unknown[]) {
    calls.push({args, method: "setTextColor"});
  }
  splitTextToSize(text: string, _width: number): string[] {
    if (splitMode === "overflow") {
      return Array.from({length: 200}, (_v, i) => `overflow-line-${i}`);
    }
    return text.split("\n");
  }
  text(...args: unknown[]) {
    calls.push({args, method: "text"});
  }
}

mock.module("jspdf", () => ({jsPDF: MockJsPDF}));

// These tests assert against the jsPDF drawing calls, which only the web branch of
// generateConsentPdf makes; the native branch delegates to expo-print instead.
Platform.OS = "web";

// Single import of the module-under-test so all tests share coverage counters.
import {generateConsentPdf} from "../generateConsentPdf";
import {formatDate} from "../pdfUtils";

describe("generateConsentPdf", () => {
  beforeEach(() => {
    calls.length = 0;
    imageMode = "success";
    splitMode = "default";
  });

  it("generates a pdf with a populated consent response (object form + signature + checkboxes + audit trail)", async () => {
    const longContent = Array.from({length: 120}, (_, i) => `line ${i}`).join("\n");

    await generateConsentPdf({
      _id: "response-123",
      agreed: true,
      agreedAt: "2024-01-15T12:00:00Z",
      checkboxValues: {"0": true, "1": false},
      consentFormId: {
        slug: "privacy",
        title: "Privacy Policy",
        type: "legal",
        version: 2,
      },
      contentSnapshot: longContent,
      formVersionSnapshot: 2,
      ipAddress: "127.0.0.1",
      locale: "en",
      signature: "data:image/png;base64,AAA",
      signedAt: "2024-01-15T12:01:00Z",
      userAgent: "Mozilla",
      userId: {_id: "user-1", email: "u@x.com", name: "User"},
    });

    const methods = calls.map((c) => c.method);
    expect(methods).toContain("ctor");
    expect(methods).toContain("save");
    expect(methods).toContain("addImage");
    // Long content should force at least one additional page.
    expect(methods).toContain("addPage");

    // Filename starts with "consent-<slug>-<last6 of id>-"
    const saveCall = calls.find((c) => c.method === "save");
    expect(String(saveCall?.args[0])).toMatch(/^consent-privacy-user-1-/);

    // Response ID footer rendered (uses _id)
    const textArgs = calls.filter((c) => c.method === "text").map((c) => String(c.args[0]));
    expect(textArgs.some((t) => t.startsWith("Response ID: response-123"))).toBe(true);
    // Locale label rendered
    expect(textArgs.some((t) => t === "en")).toBe(true);
  });

  it("handles declined responses and string-based consentFormId/userId", async () => {
    await generateConsentPdf({
      agreed: false,
      consentFormId: "legacy-string",
      userId: "legacy-user",
    });
    const saveCall = calls.find((c) => c.method === "save");
    expect(String(saveCall?.args[0])).toMatch(/^consent-response-/);
    const textArgs = calls.filter((c) => c.method === "text").map((c) => String(c.args[0]));
    // Decision rendered as "Declined"
    expect(textArgs.some((t) => t === "Declined")).toBe(true);
  });

  it("falls back gracefully when signature addImage throws", async () => {
    imageMode = "throw";
    await generateConsentPdf({
      agreed: true,
      signature: "data:image/jpeg;base64,BBB",
      userId: "u1",
    });
    const textCalls = calls.filter((c) => c.method === "text" && typeof c.args[0] === "string");
    const messages = textCalls.map((c) => c.args[0]);
    expect(
      messages.some((m) => String(m).includes("(Signature image could not be embedded)"))
    ).toBe(true);
  });

  it("formats invalid dates by returning the raw value", async () => {
    await generateConsentPdf({
      agreed: true,
      agreedAt: "not-a-date",
      userId: "user-short",
    });

    const textCalls = calls.filter((c) => c.method === "text");
    const rendered = textCalls.map((c) => String(c.args[0]));
    expect(rendered.some((t) => t === "not-a-date")).toBe(true);
  });

  it("formats empty/undefined date values as empty string", async () => {
    await generateConsentPdf({
      agreed: true,
      agreedAt: "",
      userId: "u",
    });
    expect(calls.find((c) => c.method === "save")).toBeDefined();
  });

  it("renders agreedAt with a valid date", async () => {
    await generateConsentPdf({
      agreed: true,
      agreedAt: "2024-06-15T10:30:00Z",
      userId: "u",
    });
    const textArgs = calls.filter((c) => c.method === "text").map((c) => String(c.args[0]));
    expect(textArgs.some((t) => t.includes("Agreed At:"))).toBe(true);
  });

  it("covers audit trail branches independently (ipAddress only)", async () => {
    await generateConsentPdf({
      agreed: true,
      ipAddress: "10.0.0.1",
      userId: "u",
    });
    const textArgs = calls.filter((c) => c.method === "text").map((c) => String(c.args[0]));
    expect(textArgs.some((t) => t.includes("Audit Trail"))).toBe(true);
    expect(textArgs.some((t) => t === "10.0.0.1")).toBe(true);
  });

  it("covers audit trail branches independently (userAgent only)", async () => {
    await generateConsentPdf({
      agreed: true,
      userAgent: "Mozilla",
      userId: "u",
    });
    const textArgs = calls.filter((c) => c.method === "text").map((c) => String(c.args[0]));
    expect(textArgs.some((t) => t === "Mozilla")).toBe(true);
  });

  it("covers audit trail branches independently (signedAt valid date)", async () => {
    await generateConsentPdf({
      agreed: true,
      formVersionSnapshot: 3,
      signedAt: "2024-02-01T10:00:00Z",
      userId: "u",
    });
    const textArgs = calls.filter((c) => c.method === "text").map((c) => String(c.args[0]));
    expect(textArgs.some((t) => t.includes("Signed At:"))).toBe(true);
    // formVersionSnapshot renders inside the audit trail
    expect(textArgs.some((t) => t === "3")).toBe(true);
  });

  it("covers contentSnapshot without audit trail", async () => {
    await generateConsentPdf({
      agreed: true,
      contentSnapshot: "paragraph one\nparagraph two\nparagraph three",
      userId: "u",
    });
    const textArgs = calls.filter((c) => c.method === "text").map((c) => String(c.args[0]));
    expect(textArgs.some((t) => t === "paragraph one")).toBe(true);
  });

  it("covers checkboxValues with only falsy entries and no other optional fields", async () => {
    await generateConsentPdf({
      agreed: false,
      checkboxValues: {"0": false, "1": false},
      userId: "user",
    });
    const textArgs = calls.filter((c) => c.method === "text").map((c) => String(c.args[0]));
    expect(textArgs.some((t) => t.startsWith("[ ] Checkbox"))).toBe(true);
  });

  it("handles consentFormId object with missing optional fields", async () => {
    await generateConsentPdf({
      agreed: true,
      consentFormId: {} as unknown as {title?: string},
      userId: {} as unknown as {_id?: string},
    });
    expect(calls.find((c) => c.method === "save")).toBeDefined();
  });

  it("renders a JPEG signature successfully (no throw)", async () => {
    await generateConsentPdf({
      _id: "id-final",
      agreed: true,
      signature: "data:image/jpeg;base64,ZZZ",
      userId: "u",
    });
    const imgCalls = calls.filter((c) => c.method === "addImage");
    expect(imgCalls.length).toBe(1);
    expect(imgCalls[0].args[1]).toBe("JPEG");
  });

  it("renders a PNG signature successfully (no throw)", async () => {
    await generateConsentPdf({
      agreed: true,
      signature: "data:image/png;base64,AAA",
      userId: "u",
    });
    const imgCalls = calls.filter((c) => c.method === "addImage");
    expect(imgCalls[0].args[1]).toBe("PNG");
  });

  it("handles object-form userId missing _id by falling back to String(userId)", async () => {
    const userIdObj = {email: "only@email.com"};
    await generateConsentPdf({
      agreed: true,
      userId: userIdObj as unknown as {_id?: string},
    });
    // No crash and a save is produced; filename uses last 6 chars of
    // String({email:...}) which is "[object Object]" → "Object]".
    expect(calls.find((c) => c.method === "save")).toBeDefined();
  });

  it("renders formVersionSnapshot as Form Version when consentFormId is a string", async () => {
    await generateConsentPdf({
      agreed: true,
      consentFormId: "legacy",
      formVersionSnapshot: 7,
      userId: "u",
    });
    const textArgs = calls.filter((c) => c.method === "text").map((c) => String(c.args[0]));
    // "Form Version:" label appears in Response Details (from formVersionSnapshot)
    expect(textArgs.some((t) => t === "Form Version:")).toBe(true);
    expect(textArgs.some((t) => t === "7")).toBe(true);
  });

  it("adds a new page when ensureSpace needs space for content snapshot that overflows", async () => {
    splitMode = "overflow";
    await generateConsentPdf({
      agreed: true,
      checkboxValues: Object.fromEntries(
        Array.from({length: 40}, (_v, i) => [String(i), i % 2 === 0])
      ),
      consentFormId: {slug: "x", title: "T", type: "t", version: 1},
      contentSnapshot: "content",
      ipAddress: "a",
      signedAt: "2024-01-01T00:00:00Z",
      userAgent: "a",
      userId: {_id: "u", email: "e@x", name: "N"},
    });
    const pageBreaks = calls.filter((c) => c.method === "addPage");
    expect(pageBreaks.length).toBeGreaterThan(0);
  });
  it("draws a provisional signature with the signer, date, note, IP, and void date", async () => {
    await generateConsentPdf({
      _id: "response-9",
      agreed: true,
      agreedAt: "2026-10-20T15:30:00Z",
      consentFormId: {slug: "intake", title: "Intake", type: "agreement", version: 1},
      provisional: true,
      provisionalNote: "Guardian agreed by phone",
      provisionalSignedBy: {_id: "staff-1", email: "dana@example.com", name: "Dana Rivera"},
      provisionalSignerIp: "10.0.0.7",
      userId: {_id: "member-1", name: "Sam"},
      voidedAt: "2026-10-21T09:00:00Z",
    });

    const textArgs = calls.filter((c) => c.method === "text").map((c) => String(c.args[0]));
    expect(textArgs).toContain("Provisional signature");
    expect(textArgs).toContain("Dana Rivera");
    expect(textArgs).toContain(formatDate("2026-10-20T15:30:00Z"));
    expect(textArgs).toContain("Guardian agreed by phone");
    expect(textArgs).toContain("10.0.0.7");
    expect(textArgs).toContain(`Voided ${formatDate("2026-10-21T09:00:00Z")}`);
  });

  it("falls back to Staff when the provisional signer is not populated", async () => {
    await generateConsentPdf({
      agreed: true,
      provisional: true,
      provisionalSignedBy: "staff-1",
      userId: "member-1",
    });
    const textArgs = calls.filter((c) => c.method === "text").map((c) => String(c.args[0]));
    expect(textArgs).toContain("Provisional signature");
    expect(textArgs).toContain("Staff");
    expect(textArgs).not.toContain("Signed at:");
  });

  it("draws no provisional section for the user's own response", async () => {
    await generateConsentPdf({
      agreed: true,
      agreedAt: "2026-10-20T15:30:00Z",
      provisional: false,
      userId: "member-1",
    });
    const textArgs = calls.filter((c) => c.method === "text").map((c) => String(c.args[0]));
    expect(textArgs).not.toContain("Provisional signature");
  });
});
