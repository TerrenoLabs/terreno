import {describe, expect, it, mock} from "bun:test";
import {DateTime} from "luxon";
import {Platform} from "react-native";

import {
  buildConsentPdfHtml,
  type PdfTemplateData,
  printConsentHtml,
  sharePdfFromHtml,
} from "./pdfHtmlTemplate";

const printToFileAsync = mock(() => Promise.resolve({uri: "file:///tmp/consent.pdf"}));
const printAsync = mock(() => Promise.resolve());
const shareAsync = mock(() => Promise.resolve());

mock.module("expo-print", () => ({printAsync, printToFileAsync}));
mock.module("expo-sharing", () => ({shareAsync}));

const baseData: PdfTemplateData = {
  fields: [
    {label: "Full Name", value: "Jane <Doe>"},
    {label: "Notes", value: 'Says "hi" & bye'},
  ],
  formTitle: "Consent & Release",
  title: "Consent Record",
};

describe("buildConsentPdfHtml", () => {
  it("renders the required sections and escapes HTML", () => {
    const html = buildConsentPdfHtml(baseData);

    expect(html).toStartWith("<!DOCTYPE html>");
    expect(html).toContain("<h1>Consent Record</h1>");
    expect(html).toContain('<div class="form-title">Consent &amp; Release</div>');
    expect(html).toContain('<td class="field-value">Jane &lt;Doe&gt;</td>');
    expect(html).toContain('<td class="field-value">Says &quot;hi&quot; &amp; bye</td>');
    expect(html).toContain("<h2>Response Details</h2>");
    expect(html).toMatch(/<span>Generated .+<\/span>/);

    expect(html).not.toContain("<h2>User Information</h2>");
    expect(html).not.toContain("<h2>Checkbox Responses</h2>");
    expect(html).not.toContain("<h2>Audit Trail</h2>");
    expect(html).not.toContain("<h2>Signature</h2>");
    expect(html).not.toContain("<h2>Content Snapshot</h2>");
    expect(html).not.toContain("Response ID:");
  });

  it("renders user info, checkboxes, audit trail, signature, snapshot and response id", () => {
    const html = buildConsentPdfHtml({
      ...baseData,
      auditTrail: [{label: "Signed At", value: "2025-01-01"}],
      checkboxes: [
        {checked: true, label: "I agree"},
        {checked: false, label: "Send me <updates>"},
      ],
      contentSnapshot: "Line one <b>bold</b>",
      responseId: "resp_123",
      signature: 'data:image/png;base64,abc"def',
      userInfo: {email: "jane@example.com", name: "Jane Doe", userId: "user_1"},
    });

    expect(html).toContain("<h2>User Information</h2>");
    expect(html).toContain('<td class="field-label">User ID:</td>');
    expect(html).toContain('<td class="field-value">user_1</td>');
    expect(html).toContain('<td class="field-value">Jane Doe</td>');
    expect(html).toContain('<td class="field-value">jane@example.com</td>');

    expect(html).toContain("<h2>Checkbox Responses</h2>");
    expect(html).toContain('<div class="checkbox-row">&#9745; I agree</div>');
    expect(html).toContain('<div class="checkbox-row">&#9744; Send me &lt;updates&gt;</div>');

    expect(html).toContain("<h2>Audit Trail</h2>");
    expect(html).toContain('<td class="field-label">Signed At</td>');

    expect(html).toContain("<h2>Signature</h2>");
    expect(html).toContain(
      '<img src="data:image/png;base64,abc&quot;def" class="signature-img" />'
    );

    expect(html).toContain("<h2>Content Snapshot</h2>");
    expect(html).toContain('<div class="content-snapshot">Line one &lt;b&gt;bold&lt;/b&gt;</div>');

    expect(html).toContain("<span>Response ID: resp_123</span>");
  });

  it("omits optional user info rows that are not provided", () => {
    const html = buildConsentPdfHtml({...baseData, userInfo: {userId: "user_2"}});

    expect(html).toContain('<td class="field-value">user_2</td>');
    expect(html).not.toContain('<td class="field-label">Name:</td>');
    expect(html).not.toContain('<td class="field-label">Email:</td>');
  });

  it("treats empty checkbox and audit trail lists as absent sections", () => {
    const html = buildConsentPdfHtml({...baseData, auditTrail: [], checkboxes: []});

    expect(html).not.toContain("<h2>Checkbox Responses</h2>");
    expect(html).not.toContain("<h2>Audit Trail</h2>");
  });
});

describe("buildConsentPdfHtml provisional signature", () => {
  const signedAt = "2026-10-20T15:30:00.000Z";
  const voidedAt = "2026-10-21T09:00:00.000Z";
  const full = (iso: string): string =>
    DateTime.fromISO(iso).toLocaleString(DateTime.DATETIME_FULL);

  it("renders the signer and date", () => {
    const html = buildConsentPdfHtml({
      ...baseData,
      provisionalSignature: {signedAt, signedByName: "Dana <Rivera>"},
    });

    expect(html).toContain("<h2>Provisional signature</h2>");
    expect(html).toContain('<td class="field-value">Dana &lt;Rivera&gt;</td>');
    expect(html).toContain(`<td class="field-value">${full(signedAt)}</td>`);
    expect(html).not.toContain("Note:");
    expect(html).not.toContain("Signer IP:");
    expect(html).not.toContain("Voided");
  });

  it("renders the escaped note, signer IP, and void date when given", () => {
    const html = buildConsentPdfHtml({
      ...baseData,
      provisionalSignature: {
        note: 'Guardian said "yes" <by phone>',
        signedAt,
        signedByName: "Dana Rivera",
        signerIp: "10.0.0.7",
        voidedAt,
      },
    });

    expect(html).toContain('<td class="field-label">Note:</td>');
    expect(html).toContain(
      '<td class="field-value">Guardian said &quot;yes&quot; &lt;by phone&gt;</td>'
    );
    expect(html).toContain('<td class="field-value">10.0.0.7</td>');
    expect(html).toContain(`<div class="voided">Voided ${full(voidedAt)}</div>`);
  });

  it("prints a date that is not ISO as written", () => {
    const html = buildConsentPdfHtml({
      ...baseData,
      provisionalSignature: {signedAt: "Oct 20, 2026", signedByName: "Dana Rivera"},
    });
    expect(html).toContain('<td class="field-value">Oct 20, 2026</td>');
  });

  it("omits the date row when the signing date is unknown", () => {
    const html = buildConsentPdfHtml({
      ...baseData,
      provisionalSignature: {signedAt: "", signedByName: "Dana Rivera"},
    });
    expect(html).toContain("<h2>Provisional signature</h2>");
    expect(html).not.toContain("Signed at:");
  });

  it("renders nothing extra without a provisional signature", () => {
    expect(buildConsentPdfHtml(baseData)).not.toContain("Provisional signature");
  });
});

interface FakeIframe {
  attributes: Record<string, string>;
  contentWindow: {
    addEventListener: (event: string, listener: () => void) => void;
    focus: ReturnType<typeof mock>;
    print: ReturnType<typeof mock>;
  };
  onload: (() => void) | null;
  removed: boolean;
  remove: () => void;
  setAttribute: (name: string, value: string) => void;
  srcdoc: string;
  style: Record<string, string>;
}

/** A minimal DOM: appending the iframe loads it, like a browser does with `srcdoc`. */
const installFakeDocument = (): {iframes: FakeIframe[]; restore: () => void} => {
  const iframes: FakeIframe[] = [];
  const g = globalThis as unknown as {document?: unknown};
  const originalDocument = g.document;
  g.document = {
    body: {
      appendChild: (iframe: FakeIframe) => {
        iframe.onload?.();
      },
    },
    createElement: (tag: string) => {
      expect(tag).toBe("iframe");
      const listeners: Record<string, () => void> = {};
      const iframe: FakeIframe = {
        attributes: {},
        contentWindow: {
          addEventListener: (event, listener) => {
            listeners[event] = listener;
          },
          focus: mock(() => {}),
          print: mock(() => {
            listeners.afterprint?.();
          }),
        },
        onload: null,
        remove: () => {
          iframe.removed = true;
        },
        removed: false,
        setAttribute: (name, value) => {
          iframe.attributes[name] = value;
        },
        srcdoc: "",
        style: {},
      };
      iframes.push(iframe);
      return iframe;
    },
  };
  return {
    iframes,
    restore: () => {
      g.document = originalDocument;
    },
  };
};

describe("printConsentHtml", () => {
  it("opens the native print dialog with the HTML on native", async () => {
    printAsync.mockClear();
    await printConsentHtml({html: "<p>consent</p>"});
    expect(printAsync).toHaveBeenCalledWith({html: "<p>consent</p>"});
  });

  it("prints from a hidden iframe on web and removes it afterwards", async () => {
    const originalOS = Platform.OS;
    Platform.OS = "web";
    const {iframes, restore} = installFakeDocument();
    printAsync.mockClear();
    try {
      await printConsentHtml({html: "<p>consent</p>"});
    } finally {
      Platform.OS = originalOS;
      restore();
    }

    expect(iframes).toHaveLength(1);
    expect(iframes[0].srcdoc).toBe("<p>consent</p>");
    expect(iframes[0].attributes["aria-hidden"]).toBe("true");
    expect(iframes[0].style.visibility).toBe("hidden");
    expect(iframes[0].contentWindow.print).toHaveBeenCalledTimes(1);
    expect(iframes[0].removed).toBe(true);
    expect(printAsync).not.toHaveBeenCalled();
  });

  it("removes the iframe and rejects when printing throws on web", async () => {
    const originalOS = Platform.OS;
    Platform.OS = "web";
    const {iframes, restore} = installFakeDocument();
    const failure = new Error("print blocked");
    const g = globalThis as unknown as {document: {createElement: (tag: string) => FakeIframe}};
    const createElement = g.document.createElement;
    g.document.createElement = (tag: string): FakeIframe => {
      const iframe = createElement(tag);
      iframe.contentWindow.print = mock(() => {
        throw failure;
      });
      return iframe;
    };
    try {
      await expect(printConsentHtml({html: "<p>consent</p>"})).rejects.toBe(failure);
    } finally {
      Platform.OS = originalOS;
      restore();
    }
    expect(iframes[0].removed).toBe(true);
  });
});

describe("printConsentHtml when afterprint never fires", () => {
  it("removes the previous print frame before printing again", async () => {
    const originalOS = Platform.OS;
    Platform.OS = "web";
    const {iframes, restore} = installFakeDocument();
    const g = globalThis as unknown as {document: {createElement: (tag: string) => FakeIframe}};
    const createElement = g.document.createElement;
    g.document.createElement = (tag: string): FakeIframe => {
      const iframe = createElement(tag);
      iframe.contentWindow.print = mock(() => {});
      return iframe;
    };
    try {
      await printConsentHtml({html: "<p>first</p>"});
      expect(iframes[0].removed).toBe(false);
      await printConsentHtml({html: "<p>second</p>"});
    } finally {
      Platform.OS = originalOS;
      restore();
    }
    expect(iframes[0].removed).toBe(true);
    expect(iframes[1].srcdoc).toBe("<p>second</p>");
  });
});

describe("printConsentHtml without a frame window", () => {
  it("removes the iframe and rejects", async () => {
    const originalOS = Platform.OS;
    Platform.OS = "web";
    const {iframes, restore} = installFakeDocument();
    const g = globalThis as unknown as {document: {createElement: (tag: string) => FakeIframe}};
    const createElement = g.document.createElement;
    g.document.createElement = (tag: string): FakeIframe => {
      const iframe = createElement(tag);
      (iframe as unknown as {contentWindow: null}).contentWindow = null;
      return iframe;
    };
    try {
      await expect(printConsentHtml({html: "<p>consent</p>"})).rejects.toThrow(
        "Print frame did not load"
      );
    } finally {
      Platform.OS = originalOS;
      restore();
    }
    expect(iframes[0].removed).toBe(true);
  });
});

describe("sharePdfFromHtml", () => {
  it("throws on web", async () => {
    const originalOS = Platform.OS;
    Platform.OS = "web";
    try {
      await expect(sharePdfFromHtml({filename: "consent.pdf", html: "<p>hi</p>"})).rejects.toThrow(
        "sharePdfFromHtml is only supported on mobile platforms"
      );
    } finally {
      Platform.OS = originalOS;
    }
    expect(printToFileAsync).not.toHaveBeenCalled();
  });

  it("prints to a file and shares it on native", async () => {
    await sharePdfFromHtml({filename: "consent.pdf", html: "<p>hi</p>"});

    expect(printToFileAsync).toHaveBeenCalledWith({html: "<p>hi</p>"});
    expect(shareAsync).toHaveBeenCalledWith("file:///tmp/consent.pdf", {
      dialogTitle: "consent.pdf",
      mimeType: "application/pdf",
      UTI: "com.adobe.pdf",
    });
  });
});
