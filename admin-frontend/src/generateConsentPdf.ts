import {buildConsentPdfHtml, sharePdfFromHtml} from "@terreno/ui";
import {DateTime} from "luxon";
import {Platform} from "react-native";
import {
  buildConsentResponseTemplateData,
  type ConsentResponseData,
  extractResponseFields,
  responseProvisionalSection,
} from "./consentPdfTemplates";
import {
  CONTENT_WIDTH,
  drawProvisionalSignature,
  ensureSpace,
  formatDate,
  MARGIN_LEFT,
  MARGIN_RIGHT,
  PAGE_WIDTH,
} from "./pdfUtils";

const generatePdfWeb = async (response: ConsentResponseData): Promise<void> => {
  const {jsPDF: JsPDF} = await import("jspdf");
  const doc = new JsPDF({format: "a4", orientation: "portrait", unit: "mm"});

  const {formTitle, formSlug, formType, formVersion, userId, userEmail, userName} =
    extractResponseFields(response);

  let y = 20;

  // Title
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text("Consent Record", MARGIN_LEFT, y);
  y += 10;

  // Form title
  doc.setFontSize(14);
  doc.setFont("helvetica", "normal");
  doc.text(formTitle, MARGIN_LEFT, y);
  y += 10;

  // Separator
  doc.setDrawColor(200, 200, 200);
  doc.line(MARGIN_LEFT, y, PAGE_WIDTH - MARGIN_RIGHT, y);
  y += 8;

  // Helper to add a labeled field
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

  // Response Details
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
  addField("Decision:", response.agreed ? "Agreed" : "Declined");
  if (response.agreedAt) {
    addField("Agreed At:", formatDate(response.agreedAt));
  }
  if (response.locale) {
    addField("Locale:", response.locale);
  }

  y += 4;

  // User Info
  y = ensureSpace(doc, y, 20);
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(0, 0, 0);
  doc.text("User Information", MARGIN_LEFT, y);
  y += 8;

  addField("User ID:", userId);
  if (userName) {
    addField("Name:", userName);
  }
  if (userEmail) {
    addField("Email:", userEmail);
  }

  y += 4;

  // Checkbox Values
  const checkboxEntries =
    response.checkboxValues && typeof response.checkboxValues === "object"
      ? Object.entries(response.checkboxValues)
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
      const checkmark = checked ? "[x]" : "[ ]";
      doc.text(`${checkmark} Checkbox ${index}`, MARGIN_LEFT + 4, y);
      y += 6;
    }
    y += 4;
  }

  // Audit Trail
  const hasAuditTrail = response.ipAddress || response.userAgent || response.formVersionSnapshot;

  if (hasAuditTrail) {
    y = ensureSpace(doc, y, 20);
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(0, 0, 0);
    doc.text("Audit Trail", MARGIN_LEFT, y);
    y += 8;

    if (response.ipAddress) {
      addField("IP Address:", response.ipAddress);
    }
    if (response.userAgent) {
      addField("User Agent:", response.userAgent);
    }
    if (response.formVersionSnapshot !== undefined) {
      addField("Form Version:", String(response.formVersionSnapshot));
    }
    if (response.signedAt) {
      addField("Signed At:", formatDate(response.signedAt));
    }
    y += 4;
  }

  const provisional = responseProvisionalSection(response);
  if (provisional) {
    y = drawProvisionalSignature(doc, y, provisional);
  }

  // Signature
  if (response.signature) {
    y = ensureSpace(doc, y, 50);
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(0, 0, 0);
    doc.text("Signature", MARGIN_LEFT, y);
    y += 6;

    try {
      const sigData = response.signature;
      const format = sigData.includes("image/png") ? "PNG" : "JPEG";
      doc.addImage(sigData, format, MARGIN_LEFT, y, 80, 30);
      y += 34;
    } catch {
      doc.setFontSize(10);
      doc.setFont("helvetica", "italic");
      doc.text("(Signature image could not be embedded)", MARGIN_LEFT, y);
      y += 6;
    }
    y += 4;
  }

  // Content Snapshot
  if (response.contentSnapshot) {
    y = ensureSpace(doc, y, 20);
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(0, 0, 0);
    doc.text("Content Snapshot", MARGIN_LEFT, y);
    y += 8;

    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(50, 50, 50);

    const lines = doc.splitTextToSize(response.contentSnapshot, CONTENT_WIDTH);
    for (const line of lines) {
      y = ensureSpace(doc, y, 5);
      doc.text(line, MARGIN_LEFT, y);
      y += 4;
    }
  }

  // Footer
  y = ensureSpace(doc, y, 20);
  y += 8;
  doc.setDrawColor(200, 200, 200);
  doc.line(MARGIN_LEFT, y, PAGE_WIDTH - MARGIN_RIGHT, y);
  y += 6;
  doc.setFontSize(8);
  doc.setFont("helvetica", "italic");
  doc.setTextColor(150, 150, 150);
  doc.text(`Generated ${DateTime.now().toLocaleString(DateTime.DATETIME_FULL)}`, MARGIN_LEFT, y);
  if (response._id) {
    doc.text(`Response ID: ${response._id}`, PAGE_WIDTH - MARGIN_RIGHT, y, {align: "right"});
  }

  // Download
  const filename = `consent-${formSlug || "response"}-${userId.slice(-6)}-${DateTime.now().toFormat("yyyy-MM-dd")}.pdf`;
  doc.save(filename);
};

const generatePdfMobile = async (response: ConsentResponseData): Promise<void> => {
  const templateData = buildConsentResponseTemplateData(response);
  const html = buildConsentPdfHtml(templateData);
  const {formSlug, userId} = extractResponseFields(response);
  const filename = `consent-${formSlug || "response"}-${userId.slice(-6)}-${DateTime.now().toFormat("yyyy-MM-dd")}.pdf`;
  await sharePdfFromHtml({filename, html});
};

export const generateConsentPdf = async (response: ConsentResponseData): Promise<void> => {
  if (Platform.OS === "web") {
    return generatePdfWeb(response);
  }
  return generatePdfMobile(response);
};
