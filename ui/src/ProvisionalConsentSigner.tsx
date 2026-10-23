import {DateTime} from "luxon";
import type React from "react";
import {useCallback, useState} from "react";

import {Badge} from "./Badge";
import {Box} from "./Box";
import {Button} from "./Button";
import {Card} from "./Card";
import type {BadgeProps} from "./Common";
import {Heading} from "./Heading";
import {MarkdownView} from "./MarkdownView";
import {Modal} from "./Modal";
import {buildConsentPdfHtml, printConsentHtml} from "./pdfHtmlTemplate";
import {Spinner} from "./Spinner";
import {Text} from "./Text";
import {TextField} from "./TextField";
import {applyConsentVariables, detectLocale, resolveConsentLocale} from "./useConsentForms";
import {
  type ProvisionalConsentResponse,
  type ProvisionalConsentStatusRow,
  useProvisionalConsent,
} from "./useProvisionalConsent";

export interface ProvisionalConsentSignerProps {
  /** The consumer's RTK Query api, as passed to `ConsentNavigator`. */
  api: unknown;
  baseUrl?: string;
  /** The user whose consent forms are listed and signed on their behalf. */
  userId: string;
  /** Called with the stored response after a provisional signature succeeds. */
  onSigned?: (response: ProvisionalConsentResponse) => void;
  /** Called with the server error when signing fails. */
  onError?: (error: unknown) => void;
  /** Values for `{{name}}` placeholders in form content. */
  variables?: Record<string, string>;
}

interface SignedSummary {
  formId: string;
  formTitle: string;
  signerName: string;
  signedAt: string;
  /** The just-signed form as a provisional row, for printing before statuses refetch. */
  row: ProvisionalConsentStatusRow;
}

const STATUS_BADGE: Record<ProvisionalConsentStatusRow["status"], BadgeProps["status"]> = {
  declined: "error",
  pending: "warning",
  provisional: "info",
  signed: "success",
};

/** " on <date>", or nothing when the date is missing or unparseable. */
const onDate = (iso?: string): string => {
  const date = iso ? DateTime.fromISO(iso) : undefined;
  if (!date?.isValid) {
    return "";
  }
  return ` on ${date.toLocaleString(DateTime.DATETIME_MED)}`;
};

/** The status line for a row, e.g. "Signed provisionally by Dana Rivera on Oct 20, 2026, 3:30 PM". */
const provisionalConsentStatusLabel = (row: ProvisionalConsentStatusRow): string => {
  if (row.status === "provisional") {
    const signer = row.provisional?.signedBy;
    const signerName = signer?.name || signer?.email || "staff";
    return `Signed provisionally by ${signerName}${onDate(row.provisional?.signedAt)}`;
  }
  if (row.status === "signed") {
    return `Signed by user${onDate(row.respondedAt)}`;
  }
  if (row.status === "declined") {
    return `Declined by user${onDate(row.respondedAt)}`;
  }
  return "Pending";
};

const errorMessage = (error: unknown, fallback: string): string => {
  const title = (error as {data?: {title?: unknown}} | undefined)?.data?.title;
  if (typeof title === "string" && title.length > 0) {
    return title;
  }
  return fallback;
};

const signerNameOf = (response: ProvisionalConsentResponse): string => {
  const signer = response.provisionalSignedBy;
  if (signer && typeof signer === "object") {
    return signer.name || signer.email || "staff";
  }
  return "staff";
};

// Only pending forms can be signed on the user's behalf: the user's own answer always decides
// the status, so a provisional signature on a declined form would change nothing.
const CAN_SIGN_STATUSES = new Set<ProvisionalConsentStatusRow["status"]>(["pending"]);

const contentFor = (
  row: ProvisionalConsentStatusRow,
  variables?: Record<string, string>
): string => {
  const locale = resolveConsentLocale(row.form, detectLocale());
  return applyConsentVariables(
    row.form.content[locale] ?? row.form.content[row.form.defaultLocale] ?? "",
    variables
  );
};

/** Printable HTML for a row: the form content, its status, and any provisional signature. */
const rowPrintHtml = (
  row: ProvisionalConsentStatusRow,
  variables?: Record<string, string>
): string => {
  const signer = row.provisional?.signedBy;
  return buildConsentPdfHtml({
    contentSnapshot: contentFor(row, variables),
    fields: [
      {label: "Status:", value: provisionalConsentStatusLabel(row)},
      {label: "Form Version:", value: String(row.form.version)},
    ],
    formTitle: row.form.title,
    provisionalSignature: row.provisional
      ? {
          note: row.provisional.note,
          signedAt: row.provisional.signedAt,
          signedByName: signer?.name || signer?.email || "Staff",
        }
      : undefined,
    responseId: row.provisional?.responseId,
    title: "Consent Record",
  });
};

const printRow = async (
  row: ProvisionalConsentStatusRow,
  variables?: Record<string, string>
): Promise<void> => {
  try {
    await printConsentHtml({html: rowPrintHtml(row, variables)});
  } catch (printError) {
    console.warn("[ProvisionalConsentSigner] Printing failed", {printError});
  }
};

const rowFormId = (row: ProvisionalConsentStatusRow): string => row.form.id ?? row.form._id ?? "";

/**
 * Lists a user's consent forms with their status so staff can record consent on the user's
 * behalf. Requires `consentResponse:signOnBehalf` (or `user.admin` without RBAC) on the server.
 */
export const ProvisionalConsentSigner: React.FC<ProvisionalConsentSignerProps> = ({
  api,
  baseUrl,
  userId,
  onSigned,
  onError,
  variables,
}) => {
  const {error, isLoading, isSigning, isVoiding, refetch, sign, statuses, voidSignature} =
    useProvisionalConsent({
      api,
      baseUrl,
      userId,
    });
  const [openFormId, setOpenFormId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [signed, setSigned] = useState<SignedSummary | null>(null);
  const [voidRow, setVoidRow] = useState<ProvisionalConsentStatusRow | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voidError, setVoidError] = useState<string | null>(null);

  const openRow = statuses.find((row) => rowFormId(row) === openFormId);
  const locale = openRow ? resolveConsentLocale(openRow.form, detectLocale()) : undefined;
  const isNoteBlank = note.trim().length === 0;

  const handleOpen = useCallback((formId: string): void => {
    setOpenFormId(formId);
    setNote("");
    setSubmitError(null);
    setSigned(null);
  }, []);

  const handleCancel = useCallback((): void => {
    setOpenFormId(null);
    setSubmitError(null);
  }, []);

  const handleSubmit = useCallback(async (): Promise<void> => {
    if (!openRow || isNoteBlank) {
      return;
    }
    setSubmitError(null);
    try {
      const response = await sign({consentFormId: rowFormId(openRow), locale, note: note.trim()});
      const signerName = signerNameOf(response);
      setSigned({
        formId: rowFormId(openRow),
        formTitle: openRow.form.title,
        row: {
          form: openRow.form,
          isConsented: true,
          provisional: {
            note: response.provisionalNote ?? note.trim(),
            responseId: response._id,
            signedAt: response.agreedAt,
            signedBy: {id: "", name: signerName},
          },
          respondedAt: response.agreedAt,
          status: "provisional",
        },
        signedAt: response.agreedAt,
        signerName,
      });
      setOpenFormId(null);
      setNote("");
      onSigned?.(response);
    } catch (signError) {
      console.warn("[ProvisionalConsentSigner] Provisional signature failed", {signError});
      setSubmitError(errorMessage(signError, "Could not sign the form."));
      onError?.(signError);
    }
  }, [isNoteBlank, locale, note, onError, onSigned, openRow, sign]);

  const handleOpenVoid = useCallback((row: ProvisionalConsentStatusRow): void => {
    setVoidRow(row);
    setVoidReason("");
    setVoidError(null);
  }, []);

  const handleCloseVoid = useCallback((): void => {
    setVoidRow(null);
    setVoidError(null);
  }, []);

  const handleVoid = useCallback(async (): Promise<void> => {
    const responseId = voidRow?.provisional?.responseId;
    if (!responseId || voidReason.trim().length === 0) {
      return;
    }
    setVoidError(null);
    try {
      await voidSignature({reason: voidReason.trim(), responseId});
    } catch (voidFailure) {
      console.warn("[ProvisionalConsentSigner] Voiding failed", {voidFailure});
      setVoidError(errorMessage(voidFailure, "Could not void the signature."));
      onError?.(voidFailure);
      return;
    }
    setVoidRow(null);
    setSigned(null);
    await refetch();
  }, [onError, refetch, voidReason, voidRow, voidSignature]);

  if (isLoading) {
    return (
      <Box alignItems="center" padding={4} testID="provisional-consent-signer">
        <Box testID="provisional-consent-loading">
          <Spinner />
        </Box>
      </Box>
    );
  }

  if (error) {
    return (
      <Box gap={3} padding={4} testID="provisional-consent-signer">
        <Box testID="provisional-consent-error">
          <Text color="error">{errorMessage(error, "Could not load consent forms.")}</Text>
        </Box>
        <Box width={160}>
          <Button
            onClick={() => refetch()}
            testID="provisional-consent-retry-button"
            text="Retry"
            variant="outline"
          />
        </Box>
      </Box>
    );
  }

  if (openRow) {
    const content = contentFor(openRow, variables);
    return (
      <Box gap={3} testID="provisional-consent-signer">
        <Heading size="md">{openRow.form.title}</Heading>
        <Card testID="provisional-consent-form-content">
          <MarkdownView>{content}</MarkdownView>
        </Card>
        <TextField
          helperText="Required. How and from whom consent was obtained."
          multiline
          onChange={setNote}
          rows={4}
          testID="provisional-consent-note-input"
          title="Note"
          value={note}
        />
        {Boolean(submitError) && (
          <Text color="error" testID="provisional-consent-submit-error">
            {submitError}
          </Text>
        )}
        <Box direction="row" gap={3}>
          <Button
            disabled={isNoteBlank}
            loading={isSigning}
            onClick={handleSubmit}
            testID="provisional-consent-submit-button"
            text="Sign provisionally"
          />
          <Button
            onClick={handleCancel}
            testID="provisional-consent-cancel-button"
            text="Cancel"
            variant="muted"
          />
        </Box>
      </Box>
    );
  }

  return (
    <Box gap={3} testID="provisional-consent-signer">
      {signed && (
        <Card testID="provisional-consent-success">
          <Box gap={2}>
            <Text>
              {`${signed.formTitle} signed provisionally by ${signed.signerName}${onDate(
                signed.signedAt
              )}`}
            </Text>
            <Box alignSelf="start">
              <Button
                iconName="print"
                onClick={() => printRow(signed.row, variables)}
                testID="provisional-consent-success-print"
                text="Print"
                variant="outline"
              />
            </Box>
          </Box>
        </Card>
      )}
      {statuses.length === 0 && (
        <Text color="secondaryDark" testID="provisional-consent-empty">
          No consent forms apply to this user.
        </Text>
      )}
      {statuses.map((row) => {
        const formId = rowFormId(row);
        return (
          <Card key={formId} testID={`provisional-consent-row-${formId}`}>
            <Box gap={2}>
              <Heading size="sm">{row.form.title}</Heading>
              <Box alignSelf="start">
                <Badge
                  status={STATUS_BADGE[row.status]}
                  testID={`provisional-consent-status-${formId}`}
                  value={provisionalConsentStatusLabel(row)}
                />
              </Box>
              <Box direction="row" gap={2} wrap>
                {CAN_SIGN_STATUSES.has(row.status) && (
                  <Button
                    onClick={() => handleOpen(formId)}
                    testID={`provisional-consent-open-${formId}`}
                    text="Sign on behalf"
                    variant="outline"
                  />
                )}
                {row.status !== "pending" && (
                  <Button
                    iconName="print"
                    onClick={() => printRow(row, variables)}
                    testID={`provisional-consent-print-${formId}`}
                    text="Print"
                    variant="outline"
                  />
                )}
                {row.status === "provisional" && (
                  <Button
                    onClick={() => handleOpenVoid(row)}
                    testID={`provisional-consent-void-${formId}`}
                    text="Void"
                    variant="destructive"
                  />
                )}
              </Box>
            </Box>
          </Card>
        );
      })}
      <Modal
        onDismiss={handleCloseVoid}
        primaryButtonDisabled={voidReason.trim().length === 0 || isVoiding}
        primaryButtonOnClick={handleVoid}
        primaryButtonText="Void signature"
        secondaryButtonOnClick={handleCloseVoid}
        secondaryButtonText="Cancel"
        size="md"
        testID="provisional-consent-void-modal"
        text={
          voidRow
            ? `The provisional signature on ${voidRow.form.title} will no longer count as consent. The record is kept.`
            : undefined
        }
        title="Void provisional signature"
        visible={Boolean(voidRow)}
      >
        <Box gap={2}>
          <TextField
            helperText="Required. Why this signature was made in error."
            multiline
            onChange={setVoidReason}
            rows={3}
            testID="provisional-consent-void-reason-input"
            title="Reason"
            value={voidReason}
          />
          {Boolean(voidError) && (
            <Text color="error" testID="provisional-consent-void-error">
              {voidError}
            </Text>
          )}
        </Box>
      </Modal>
    </Box>
  );
};
