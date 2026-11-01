import type {PdfTemplateData} from "@terreno/ui";
import type {jsPDF} from "jspdf";
import {DateTime} from "luxon";

export const PAGE_WIDTH = 210;
export const MARGIN_LEFT = 20;
export const MARGIN_RIGHT = 20;
export const CONTENT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;
const PAGE_HEIGHT = 297;
const MARGIN_BOTTOM = 20;

export const formatDate = (value: unknown): string => {
  if (!value) {
    return "";
  }
  const dt = DateTime.fromISO(String(value));
  if (!dt.isValid) {
    return String(value);
  }
  return dt.toLocaleString(DateTime.DATETIME_FULL);
};

export const ensureSpace = (doc: jsPDF, y: number, needed: number): number => {
  if (y + needed > PAGE_HEIGHT - MARGIN_BOTTOM) {
    doc.addPage();
    return 20;
  }
  return y;
};

/** A provisional signature as printed. `note` and `signerIp` belong on admin printouts only. */
export interface PdfProvisionalSignatureSection {
  signedAt?: string;
  signedByName: string;
  note?: string;
  signerIp?: string;
  voidedAt?: string;
}

/** The display name of a populated provisional signer, falling back to email, then "Staff". */
export const provisionalSignerName = (signer: unknown): string => {
  if (signer && typeof signer === "object") {
    const {email, name} = signer as {email?: string; name?: string};
    return name || email || "Staff";
  }
  return "Staff";
};

/** Draw the "Provisional signature" section on a jsPDF page and return the next y. */
export const drawProvisionalSignature = (
  doc: jsPDF,
  startY: number,
  signature: PdfProvisionalSignatureSection
): number => {
  let y = ensureSpace(doc, startY, 20);
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(0, 0, 0);
  doc.text("Provisional signature", MARGIN_LEFT, y);
  y += 8;

  const fields: Array<[string, string]> = [["Signed by:", signature.signedByName]];
  if (signature.signedAt) {
    fields.push(["Signed at:", formatDate(signature.signedAt)]);
  }
  if (signature.signerIp) {
    fields.push(["Signer IP:", signature.signerIp]);
  }
  for (const [label, value] of fields) {
    y = ensureSpace(doc, y, 8);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(100, 100, 100);
    doc.text(label, MARGIN_LEFT, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(10);
    doc.text(value, MARGIN_LEFT + 45, y);
    y += 6;
  }

  if (signature.note) {
    y = ensureSpace(doc, y, 8);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(100, 100, 100);
    doc.text("Note:", MARGIN_LEFT, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(10);
    const lines = doc.splitTextToSize(signature.note, CONTENT_WIDTH - 45);
    for (const line of lines) {
      y = ensureSpace(doc, y, 5);
      doc.text(line, MARGIN_LEFT + 45, y);
      y += 5;
    }
    y += 1;
  }

  if (signature.voidedAt) {
    y = ensureSpace(doc, y, 8);
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(160, 0, 0);
    doc.text(`Voided ${formatDate(signature.voidedAt)}`, MARGIN_LEFT, y);
    doc.setTextColor(0, 0, 0);
    y += 6;
  }

  return y + 4;
};

/** The `@terreno/ui` template shape for a provisional section; `signedAt` falls back to "". */
export const provisionalPdfSignature = (
  section: PdfProvisionalSignatureSection | undefined
): PdfTemplateData["provisionalSignature"] => {
  if (!section) {
    return undefined;
  }
  return {...section, signedAt: section.signedAt ?? ""};
};
