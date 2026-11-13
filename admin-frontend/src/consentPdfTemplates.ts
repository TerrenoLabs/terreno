/**
 * `@terreno/ui` PdfTemplateData builders for consent records, shared by the native PDF
 * generators and the print buttons. Admin records include the provisional signer's note and
 * IP; the user's own history never does.
 */

import {buildConsentPdfHtml, type PdfTemplateData} from "@terreno/ui";

import {
  formatDate,
  type PdfProvisionalSignatureSection,
  provisionalPdfSignature,
  provisionalSignerName,
} from "./pdfUtils";
import type {ConsentHistoryEntry} from "./useConsentHistory";

export interface ConsentResponseData {
  _id?: string;
  agreed: boolean;
  agreedAt?: string;
  checkboxValues?: Record<string, boolean>;
  consentFormId?: {title?: string; slug?: string; version?: number; type?: string} | string;
  contentSnapshot?: string;
  formVersionSnapshot?: number;
  ipAddress?: string;
  locale?: string;
  provisional?: boolean;
  provisionalNote?: string;
  provisionalSignedBy?: {_id?: string; email?: string; name?: string} | string | null;
  provisionalSignerIp?: string;
  signature?: string;
  signedAt?: string;
  userAgent?: string;
  userId?: {_id?: string; email?: string; id?: string; name?: string} | string;
  voidReason?: string;
  voidedAt?: string;
}

/** Admin printouts show every provisional detail, including the signer's note and IP. */
export const responseProvisionalSection = (
  response: ConsentResponseData
): PdfProvisionalSignatureSection | undefined => {
  if (!response.provisional) {
    return undefined;
  }
  return {
    note: response.provisionalNote,
    signedAt: response.agreedAt,
    signedByName: provisionalSignerName(response.provisionalSignedBy),
    signerIp: response.provisionalSignerIp,
    voidedAt: response.voidedAt,
  };
};

export const extractResponseFields = (response: ConsentResponseData) => {
  const formTitle =
    typeof response.consentFormId === "object"
      ? (response.consentFormId?.title ?? "Unknown Form")
      : "Unknown Form";

  const formSlug =
    typeof response.consentFormId === "object" ? (response.consentFormId?.slug ?? "") : "";

  const formType =
    typeof response.consentFormId === "object" ? (response.consentFormId?.type ?? "") : "";

  const formVersion =
    typeof response.consentFormId === "object"
      ? response.consentFormId?.version
      : response.formVersionSnapshot;

  const userId =
    typeof response.userId === "object"
      ? String(response.userId?._id ?? response.userId?.id ?? response.userId)
      : String(response.userId ?? "");

  const userEmail = typeof response.userId === "object" ? (response.userId?.email ?? "") : "";

  const userName = typeof response.userId === "object" ? (response.userId?.name ?? "") : "";

  return {formSlug, formTitle, formType, formVersion, userEmail, userId, userName};
};

/** Template data for one admin consent response, used by the native PDF and printing. */
export const buildConsentResponseTemplateData = (
  response: ConsentResponseData
): PdfTemplateData => {
  const {formTitle, formSlug, formType, formVersion, userId, userEmail, userName} =
    extractResponseFields(response);

  const fields: PdfTemplateData["fields"] = [];
  if (formSlug) {
    fields.push({label: "Form Slug:", value: formSlug});
  }
  if (formType) {
    fields.push({label: "Form Type:", value: formType});
  }
  if (formVersion !== undefined) {
    fields.push({label: "Form Version:", value: String(formVersion)});
  }
  fields.push({label: "Decision:", value: response.agreed ? "Agreed" : "Declined"});
  if (response.agreedAt) {
    fields.push({label: "Agreed At:", value: formatDate(response.agreedAt)});
  }
  if (response.locale) {
    fields.push({label: "Locale:", value: response.locale});
  }

  const checkboxEntries =
    response.checkboxValues && typeof response.checkboxValues === "object"
      ? Object.entries(response.checkboxValues)
      : [];

  const checkboxes = checkboxEntries.map(([index, checked]) => ({
    checked: Boolean(checked),
    label: `Checkbox ${index}`,
  }));

  const auditTrail: PdfTemplateData["fields"] = [];
  if (response.ipAddress) {
    auditTrail.push({label: "IP Address:", value: response.ipAddress});
  }
  if (response.userAgent) {
    auditTrail.push({label: "User Agent:", value: response.userAgent});
  }
  if (response.formVersionSnapshot !== undefined) {
    auditTrail.push({label: "Form Version:", value: String(response.formVersionSnapshot)});
  }
  if (response.signedAt) {
    auditTrail.push({label: "Signed At:", value: formatDate(response.signedAt)});
  }

  return {
    auditTrail: auditTrail.length > 0 ? auditTrail : undefined,
    checkboxes: checkboxes.length > 0 ? checkboxes : undefined,
    contentSnapshot: response.contentSnapshot,
    fields,
    formTitle,
    provisionalSignature: provisionalPdfSignature(responseProvisionalSection(response)),
    responseId: response._id,
    signature: response.signature,
    title: "Consent Record",
    userInfo: {email: userEmail || undefined, name: userName || undefined, userId},
  };
};

/** The user's own printout names the signer and date only, never the signer's note. */
export const historyProvisionalSection = (
  entry: ConsentHistoryEntry
): PdfProvisionalSignatureSection | undefined => {
  if (!entry.provisional) {
    return undefined;
  }
  return {
    signedAt: entry.agreedAt,
    signedByName: provisionalSignerName(entry.provisionalSignedBy),
    voidedAt: entry.voidedAt,
  };
};

/** Template data for one of the user's consent entries, used by the native PDF and printing. */
export const buildConsentHistoryTemplateData = (entry: ConsentHistoryEntry): PdfTemplateData => {
  const formTitle = entry.form?.title ?? "Unknown Form";
  const formSlug = entry.form?.slug ?? "";
  const formType = entry.form?.type ?? "";
  const formVersion = entry.form?.version ?? entry.formVersionSnapshot;

  const fields: PdfTemplateData["fields"] = [];
  if (formSlug) {
    fields.push({label: "Form Slug:", value: formSlug});
  }
  if (formType) {
    fields.push({label: "Form Type:", value: formType});
  }
  if (formVersion !== undefined) {
    fields.push({label: "Form Version:", value: String(formVersion)});
  }
  fields.push({label: "Decision:", value: entry.agreed ? "Agreed" : "Declined"});
  if (entry.agreedAt) {
    fields.push({label: "Agreed At:", value: formatDate(entry.agreedAt)});
  }
  if (entry.locale) {
    fields.push({label: "Locale:", value: entry.locale});
  }

  const checkboxEntries =
    entry.checkboxValues && typeof entry.checkboxValues === "object"
      ? Object.entries(entry.checkboxValues)
      : [];

  const checkboxes = checkboxEntries.map(([index, checked]) => ({
    checked: Boolean(checked),
    label: entry.form?.checkboxes?.[Number(index)]?.label ?? `Checkbox ${index}`,
  }));

  const auditTrail: PdfTemplateData["fields"] = [];
  if (entry.ipAddress) {
    auditTrail.push({label: "IP Address:", value: entry.ipAddress});
  }
  if (entry.userAgent) {
    auditTrail.push({label: "User Agent:", value: entry.userAgent});
  }
  if (entry.formVersionSnapshot !== undefined) {
    auditTrail.push({label: "Form Version:", value: String(entry.formVersionSnapshot)});
  }
  if (entry.signedAt) {
    auditTrail.push({label: "Signed At:", value: formatDate(entry.signedAt)});
  }

  return {
    auditTrail: auditTrail.length > 0 ? auditTrail : undefined,
    checkboxes: checkboxes.length > 0 ? checkboxes : undefined,
    contentSnapshot: entry.contentSnapshot,
    fields,
    formTitle,
    provisionalSignature: provisionalPdfSignature(historyProvisionalSection(entry)),
    responseId: entry._id,
    signature: entry.signature,
    title: "Consent Record",
  };
};

/** Printable HTML for one admin consent response. */
export const consentResponsePrintHtml = (response: ConsentResponseData): string =>
  buildConsentPdfHtml(buildConsentResponseTemplateData(response));

/** Printable HTML for one of the user's consent entries. */
export const consentHistoryPrintHtml = (entry: ConsentHistoryEntry): string =>
  buildConsentPdfHtml(buildConsentHistoryTemplateData(entry));
