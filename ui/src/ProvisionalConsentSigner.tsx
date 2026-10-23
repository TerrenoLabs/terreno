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
import {Spinner} from "./Spinner";
import {Text} from "./Text";
import {TextField} from "./TextField";
import {applyConsentVariables, detectLocale, resolveConsentLocale} from "./useConsentForms";
import {
  type ProvisionalConsentApi,
  type ProvisionalConsentResponse,
  type ProvisionalConsentStatusRow,
  useProvisionalConsent,
} from "./useProvisionalConsent";

export interface ProvisionalConsentSignerProps {
  /** The consumer's RTK Query api, as passed to `ConsentNavigator`. */
  api: ProvisionalConsentApi;
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

const CAN_SIGN_STATUSES = new Set<ProvisionalConsentStatusRow["status"]>(["pending", "declined"]);

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
  const {error, isLoading, isSigning, refetch, sign, statuses} = useProvisionalConsent({
    api,
    baseUrl,
    userId,
  });
  const [openFormId, setOpenFormId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [signed, setSigned] = useState<SignedSummary | null>(null);

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
      setSigned({
        formId: rowFormId(openRow),
        formTitle: openRow.form.title,
        signedAt: response.agreedAt,
        signerName: signerNameOf(response),
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

  if (openRow && locale) {
    const content = applyConsentVariables(
      openRow.form.content[locale] ?? openRow.form.content[openRow.form.defaultLocale] ?? "",
      variables
    );
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
          <Text>
            {`${signed.formTitle} signed provisionally by ${signed.signerName}${onDate(
              signed.signedAt
            )}`}
          </Text>
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
              {CAN_SIGN_STATUSES.has(row.status) && (
                <Box alignSelf="start">
                  <Button
                    onClick={() => handleOpen(formId)}
                    testID={`provisional-consent-open-${formId}`}
                    text="Sign on behalf"
                    variant="outline"
                  />
                </Box>
              )}
            </Box>
          </Card>
        );
      })}
    </Box>
  );
};
