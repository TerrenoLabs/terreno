import {DateTime} from "luxon";
import type React from "react";

import {Badge} from "./Badge";
import {Box} from "./Box";
import {Button} from "./Button";
import {Card} from "./Card";
import type {BadgeProps} from "./Common";
import {Heading} from "./Heading";
import {Spinner} from "./Spinner";
import {Text} from "./Text";
import {
  type ProvisionalConsentApi,
  type ProvisionalConsentStatusRow,
  useProvisionalConsent,
} from "./useProvisionalConsent";

export interface ProvisionalConsentSignerProps {
  /** The consumer's RTK Query api, as passed to `ConsentNavigator`. */
  api: ProvisionalConsentApi;
  baseUrl?: string;
  /** The user whose consent forms are listed and signed on their behalf. */
  userId: string;
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

const errorMessage = (error: unknown): string => {
  const title = (error as {data?: {title?: unknown}} | undefined)?.data?.title;
  if (typeof title === "string" && title.length > 0) {
    return title;
  }
  return "Could not load consent forms.";
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
}) => {
  const {error, isLoading, refetch, statuses} = useProvisionalConsent({api, baseUrl, userId});

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
          <Text color="error">{errorMessage(error)}</Text>
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

  return (
    <Box gap={3} testID="provisional-consent-signer">
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
            </Box>
          </Card>
        );
      })}
    </Box>
  );
};
