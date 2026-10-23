import {buildConsentPdfHtml, sharePdfFromHtml} from "@terreno/ui";
import {DateTime} from "luxon";
import {Platform} from "react-native";
import {buildConsentHistoryTemplateData, historyProvisionalSection} from "./consentPdfTemplates";
import {
  CONTENT_WIDTH,
  drawProvisionalSignature,
  ensureSpace,
  formatDate,
  MARGIN_LEFT,
  MARGIN_RIGHT,
  PAGE_WIDTH,
} from "./pdfUtils";
import type {ConsentHistoryEntry} from "./useConsentHistory";

const generatePdfWeb = async (entry: ConsentHistoryEntry): Promise<void> => {
  const {jsPDF: JsPDF} = await import("jspdf");
  const doc = new JsPDF({format: "a4", orientation: "portrait", unit: "mm"});

  const formTitle = entry.form?.title ?? "Unknown Form";
  const formSlug = entry.form?.slug ?? "";
  const formType = entry.form?.type ?? "";
  const formVersion = entry.form?.version ?? entry.formVersionSnapshot;

  let y = 20;

  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text("Consent Record", MARGIN_LEFT, y);
  y += 10;

  doc.setFontSize(14);
  doc.setFont("helvetica", "normal");
  doc.text(formTitle, MARGIN_LEFT, y);
  y += 10;

  doc.setDrawColor(200, 200, 200);
  doc.line(MARGIN_LEFT, y, PAGE_WIDTH - MARGIN_RIGHT, y);
  y += 8;

  const addField = (label: string, value: string) => {
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
  };

  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(0, 0, 0);
  doc.text("Response Details", MARGIN_LEFT, y);
  y += 8;

  if (formSlug) {
    addField("Form Slug:", formSlug);
  }
  if (formType) {
    addField("Form Type:", formType);
  }
  if (formVersion !== undefined) {
    addField("Form Version:", String(formVersion));
  }
  addField("Decision:", entry.agreed ? "Agreed" : "Declined");
  if (entry.agreedAt) {
    addField("Agreed At:", formatDate(entry.agreedAt));
  }
  if (entry.locale) {
    addField("Locale:", entry.locale);
  }

  y += 4;

  const checkboxEntries =
    entry.checkboxValues && typeof entry.checkboxValues === "object"
      ? Object.entries(entry.checkboxValues)
      : [];

  if (checkboxEntries.length > 0) {
    y = ensureSpace(doc, y, 12 + checkboxEntries.length * 6);
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(0, 0, 0);
    doc.text("Checkbox Responses", MARGIN_LEFT, y);
    y += 8;

    for (const [index, checked] of checkboxEntries) {
      y = ensureSpace(doc, y, 6);
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      const label = entry.form?.checkboxes?.[Number(index)]?.label;
      const checkmark = checked ? "[x]" : "[ ]";
      doc.text(`${checkmark} ${label ?? `Checkbox ${index}`}`, MARGIN_LEFT + 4, y);
      y += 6;
    }
    y += 4;
  }

  const hasAuditTrail = entry.ipAddress || entry.userAgent || entry.formVersionSnapshot;

  if (hasAuditTrail) {
    y = ensureSpace(doc, y, 20);
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(0, 0, 0);
    doc.text("Audit Trail", MARGIN_LEFT, y);
    y += 8;

    if (entry.ipAddress) {
      addField("IP Address:", entry.ipAddress);
    }
    if (entry.userAgent) {
      addField("User Agent:", entry.userAgent);
    }
    if (entry.formVersionSnapshot !== undefined) {
      addField("Form Version:", String(entry.formVersionSnapshot));
    }
    if (entry.signedAt) {
      addField("Signed At:", formatDate(entry.signedAt));
    }
    y += 4;
  }

  const provisional = historyProvisionalSection(entry);
  if (provisional) {
    y = drawProvisionalSignature(doc, y, provisional);
  }

  if (entry.signature) {
    y = ensureSpace(doc, y, 50);
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(0, 0, 0);
    doc.text("Signature", MARGIN_LEFT, y);
    y += 6;

    try {
      const format = entry.signature.includes("image/png") ? "PNG" : "JPEG";
      doc.addImage(entry.signature, format, MARGIN_LEFT, y, 80, 30);
      y += 34;
    } catch {
      doc.setFontSize(10);
      doc.setFont("helvetica", "italic");
      doc.text("(Signature image could not be embedded)", MARGIN_LEFT, y);
      y += 6;
    }
    y += 4;
  }

  if (entry.contentSnapshot) {
    y = ensureSpace(doc, y, 20);
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(0, 0, 0);
    doc.text("Content Snapshot", MARGIN_LEFT, y);
    y += 8;

    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(50, 50, 50);

    const lines = doc.splitTextToSize(entry.contentSnapshot, CONTENT_WIDTH);
    for (const line of lines) {
      y = ensureSpace(doc, y, 5);
      doc.text(line, MARGIN_LEFT, y);
      y += 4;
    }
  }

  y = ensureSpace(doc, y, 20);
  y += 8;
  doc.setDrawColor(200, 200, 200);
  doc.line(MARGIN_LEFT, y, PAGE_WIDTH - MARGIN_RIGHT, y);
  y += 6;
  doc.setFontSize(8);
  doc.setFont("helvetica", "italic");
  doc.setTextColor(150, 150, 150);
  doc.text(`Generated ${DateTime.now().toLocaleString(DateTime.DATETIME_FULL)}`, MARGIN_LEFT, y);
  if (entry._id) {
    doc.text(`Response ID: ${entry._id}`, PAGE_WIDTH - MARGIN_RIGHT, y, {align: "right"});
  }

  const filename = `consent-${formSlug || "response"}-${DateTime.now().toFormat("yyyy-MM-dd")}.pdf`;
  doc.save(filename);
};

const generatePdfMobile = async (entry: ConsentHistoryEntry): Promise<void> => {
  const templateData = buildConsentHistoryTemplateData(entry);
  const html = buildConsentPdfHtml(templateData);
  const formSlug = entry.form?.slug ?? "response";
  const filename = `consent-${formSlug}-${DateTime.now().toFormat("yyyy-MM-dd")}.pdf`;
  await sharePdfFromHtml({filename, html});
};

export const generateConsentHistoryPdf = async (entry: ConsentHistoryEntry): Promise<void> => {
  if (Platform.OS === "web") {
    return generatePdfWeb(entry);
  }
  return generatePdfMobile(entry);
};
