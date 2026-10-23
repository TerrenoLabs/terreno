import {DateTime} from "luxon";
import {Platform} from "react-native";

interface PdfField {
  label: string;
  value: string;
}

interface PdfCheckbox {
  label: string;
  checked: boolean;
}

interface PdfUserInfo {
  userId: string;
  name?: string;
  email?: string;
}

/** A signature staff recorded on the user's behalf. Dates are ISO strings. */
export interface PdfProvisionalSignature {
  signedAt: string;
  signedByName: string;
  /** The signer's note. Pass it only on admin printouts; the user never sees it. */
  note?: string;
  signerIp?: string;
  voidedAt?: string;
}

export interface PdfTemplateData {
  title: string;
  formTitle: string;
  fields: PdfField[];
  checkboxes?: PdfCheckbox[];
  auditTrail?: PdfField[];
  signature?: string;
  contentSnapshot?: string;
  responseId?: string;
  userInfo?: PdfUserInfo;
  provisionalSignature?: PdfProvisionalSignature;
}

const escapeHtml = (text: string): string => {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
};

const renderField = (field: PdfField): string => {
  return `<tr>
    <td class="field-label">${escapeHtml(field.label)}</td>
    <td class="field-value">${escapeHtml(field.value)}</td>
  </tr>`;
};

/** Format an ISO date for print; anything that is not ISO prints as written. */
const formatPrintDate = (value: string): string => {
  const date = DateTime.fromISO(value);
  return date.isValid ? date.toLocaleString(DateTime.DATETIME_FULL) : value;
};

const renderProvisionalSignature = (signature?: PdfProvisionalSignature): string => {
  if (!signature) {
    return "";
  }
  const rows = [
    renderField({label: "Signed by:", value: signature.signedByName}),
    signature.signedAt
      ? renderField({label: "Signed at:", value: formatPrintDate(signature.signedAt)})
      : "",
    signature.note ? renderField({label: "Note:", value: signature.note}) : "",
    signature.signerIp ? renderField({label: "Signer IP:", value: signature.signerIp}) : "",
  ].join("\n");
  const voidedHtml = signature.voidedAt
    ? `<div class="voided">Voided ${escapeHtml(formatPrintDate(signature.voidedAt))}</div>`
    : "";
  return `<div class="section">
      <h2>Provisional signature</h2>
      <table>${rows}</table>
      ${voidedHtml}
    </div>`;
};

export const buildConsentPdfHtml = (data: PdfTemplateData): string => {
  const now = DateTime.now().toLocaleString(DateTime.DATETIME_FULL);

  const fieldsHtml = data.fields.map(renderField).join("\n");

  const userInfoHtml = data.userInfo
    ? `<div class="section">
        <h2>User Information</h2>
        <table>${renderField({label: "User ID:", value: data.userInfo.userId})}
          ${data.userInfo.name ? renderField({label: "Name:", value: data.userInfo.name}) : ""}
          ${data.userInfo.email ? renderField({label: "Email:", value: data.userInfo.email}) : ""}
        </table>
      </div>`
    : "";

  const checkboxesHtml =
    data.checkboxes && data.checkboxes.length > 0
      ? `<div class="section">
          <h2>Checkbox Responses</h2>
          ${data.checkboxes
            .map(
              (cb) =>
                `<div class="checkbox-row">${cb.checked ? "&#9745;" : "&#9744;"} ${escapeHtml(cb.label)}</div>`
            )
            .join("\n")}
        </div>`
      : "";

  const auditTrailHtml =
    data.auditTrail && data.auditTrail.length > 0
      ? `<div class="section">
          <h2>Audit Trail</h2>
          <table>${data.auditTrail.map(renderField).join("\n")}</table>
        </div>`
      : "";

  const signatureHtml = data.signature
    ? `<div class="section">
        <h2>Signature</h2>
        <img src="${escapeHtml(data.signature)}" class="signature-img" />
      </div>`
    : "";

  const contentSnapshotHtml = data.contentSnapshot
    ? `<div class="section">
        <h2>Content Snapshot</h2>
        <div class="content-snapshot">${escapeHtml(data.contentSnapshot)}</div>
      </div>`
    : "";

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    body {
      font-family: Helvetica, Arial, sans-serif;
      margin: 0;
      color: #000;
      font-size: 10pt;
      line-height: 1.4;
    }
    h1 {
      font-size: 18pt;
      margin: 0 0 4mm 0;
    }
    .form-title {
      font-size: 14pt;
      font-weight: normal;
      margin: 0 0 6mm 0;
    }
    hr {
      border: none;
      border-top: 1px solid #c8c8c8;
      margin: 4mm 0;
    }
    h2 {
      font-size: 12pt;
      margin: 6mm 0 4mm 0;
    }
    table {
      border-collapse: collapse;
    }
    .field-label {
      font-size: 9pt;
      font-weight: bold;
      color: #646464;
      width: 45mm;
      padding: 1mm 0;
      vertical-align: top;
    }
    .field-value {
      font-size: 10pt;
      padding: 1mm 0;
    }
    .checkbox-row {
      font-size: 10pt;
      margin-left: 4mm;
      padding: 1mm 0;
    }
    .signature-img {
      width: 80mm;
      height: 30mm;
      object-fit: contain;
    }
    .content-snapshot {
      font-size: 9pt;
      color: #323232;
      white-space: pre-wrap;
      word-wrap: break-word;
    }
    .footer {
      margin-top: 8mm;
      border-top: 1px solid #c8c8c8;
      padding-top: 3mm;
      font-size: 8pt;
      font-style: italic;
      color: #969696;
      display: flex;
      justify-content: space-between;
    }
    .section {
      margin-bottom: 4mm;
    }
    .voided {
      font-weight: bold;
      color: #a00000;
      margin-top: 2mm;
    }
    @page {
      size: A4;
      margin: 20mm;
    }
  </style>
</head>
<body>
  <h1>${escapeHtml(data.title)}</h1>
  <div class="form-title">${escapeHtml(data.formTitle)}</div>
  <hr />

  <div class="section">
    <h2>Response Details</h2>
    <table>${fieldsHtml}</table>
  </div>

  ${userInfoHtml}
  ${checkboxesHtml}
  ${auditTrailHtml}
  ${renderProvisionalSignature(data.provisionalSignature)}
  ${signatureHtml}
  ${contentSnapshotHtml}

  <div class="footer">
    <span>Generated ${escapeHtml(now)}</span>
    ${data.responseId ? `<span>Response ID: ${escapeHtml(data.responseId)}</span>` : ""}
  </div>
</body>
</html>`;
};

export const sharePdfFromHtml = async (options: {
  html: string;
  filename: string;
}): Promise<void> => {
  if (Platform.OS === "web") {
    throw new Error("sharePdfFromHtml is only supported on mobile platforms");
  }

  const Print = await import("expo-print");
  const Sharing = await import("expo-sharing");

  const {uri} = await Print.printToFileAsync({html: options.html});

  await Sharing.shareAsync(uri, {
    dialogTitle: options.filename,
    mimeType: "application/pdf",
    UTI: "com.adobe.pdf",
  });
};

/** The last web print frame, removed before the next print in case `afterprint` never fired. */
let lastPrintFrame: HTMLIFrameElement | undefined;

/**
 * Open the print dialog for consent HTML (for example from `buildConsentPdfHtml`). Native uses
 * `expo-print`; web prints from a hidden iframe so the app page itself is not printed.
 */
export const printConsentHtml = async ({html}: {html: string}): Promise<void> => {
  if (Platform.OS !== "web") {
    const Print = await import("expo-print");
    await Print.printAsync({html});
    return;
  }

  // Consent HTML can hold PHI, so never leave an old frame in the page.
  lastPrintFrame?.remove();
  await new Promise<void>((resolve, reject) => {
    const iframe = document.createElement("iframe");
    lastPrintFrame = iframe;
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.position = "fixed";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.style.visibility = "hidden";
    iframe.onload = (): void => {
      const frameWindow = iframe.contentWindow;
      if (!frameWindow) {
        iframe.remove();
        reject(new Error("Print frame did not load"));
        return;
      }
      // Some browsers return from print() before the dialog closes; remove the frame after.
      frameWindow.addEventListener("afterprint", () => iframe.remove());
      try {
        frameWindow.focus();
        frameWindow.print();
        resolve();
      } catch (error) {
        iframe.remove();
        reject(error);
      }
    };
    iframe.srcdoc = html;
    document.body.appendChild(iframe);
  });
};
