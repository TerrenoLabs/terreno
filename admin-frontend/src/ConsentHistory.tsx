import {
  Badge,
  Box,
  Button,
  Card,
  Icon,
  IconButton,
  MarkdownView,
  Page,
  printConsentHtml,
  Spinner,
  Text,
} from "@terreno/ui";
import {DateTime} from "luxon";
import React, {useCallback, useState} from "react";
import {Image, Pressable} from "react-native";

import {consentHistoryPrintHtml} from "./consentPdfTemplates";
import {generateConsentHistoryPdf} from "./generateConsentHistoryPdf";
import {provisionalSignerName} from "./pdfUtils";
import type {ConsentHistoryEntry} from "./useConsentHistory";
import {useConsentHistory} from "./useConsentHistory";

interface ConsentHistoryProps {
  baseUrl?: string;
  title?: string;
}

const formatDate = (value: unknown): string => {
  if (!value) {
    return "";
  }
  const dt = DateTime.fromISO(String(value));
  if (!dt.isValid) {
    return String(value);
  }
  return dt.toLocaleString(DateTime.DATETIME_MED);
};

const ConsentHistoryItem: React.FC<{entry: ConsentHistoryEntry}> = ({entry}) => {
  const [expanded, setExpanded] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  const toggle = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  const handleDownload = useCallback(async () => {
    setIsDownloading(true);
    try {
      await generateConsentHistoryPdf(entry);
    } catch (err) {
      console.error("Failed to generate PDF", err);
    } finally {
      setIsDownloading(false);
    }
  }, [entry]);

  const [isPrinting, setIsPrinting] = useState(false);

  const handlePrint = useCallback(async () => {
    setIsPrinting(true);
    try {
      await printConsentHtml({html: consentHistoryPrintHtml(entry)});
    } catch (err) {
      console.error("Failed to print consent record", err);
    } finally {
      setIsPrinting(false);
    }
  }, [entry]);

  const formTitle = entry.form?.title ?? "Unknown Form";
  const formType = entry.form?.type ?? "";

  const checkboxEntries =
    entry.checkboxValues && typeof entry.checkboxValues === "object"
      ? Object.entries(entry.checkboxValues)
      : [];

  return (
    <Card padding={0} testID={`consent-history-item-${entry._id}`}>
      <Pressable onPress={toggle} testID={`consent-history-item-toggle-${entry._id}`}>
        <Box direction="row" gap={3} padding={4}>
          <Box flex="grow" gap={1}>
            <Box alignItems="center" direction="row" gap={2}>
              <Text bold size="md">
                {formTitle}
              </Text>
              {formType ? <Badge status="neutral" value={formType} /> : null}
            </Box>
            <Box alignItems="center" direction="row" gap={2}>
              <Badge
                status={entry.agreed ? "success" : "error"}
                value={entry.agreed ? "Agreed" : "Declined"}
              />
              <Text color="secondaryDark" size="sm">
                {formatDate(entry.agreedAt)}
              </Text>
            </Box>
            {Boolean(entry.provisional) && (
              <Box
                alignItems="center"
                direction="row"
                gap={2}
                testID={`consent-history-provisional-${entry._id}`}
              >
                <Badge status="info" value="Provisional" />
                {entry.voidedAt ? <Badge status="error" value="Voided" /> : null}
                <Text color="secondaryDark" size="sm">
                  {`Signed on your behalf by ${provisionalSignerName(entry.provisionalSignedBy)}`}
                </Text>
              </Box>
            )}
          </Box>
          <Box alignItems="center" justifyContent="center">
            <Icon
              color="secondaryDark"
              iconName={expanded ? "chevron-up" : "chevron-down"}
              size="sm"
            />
          </Box>
        </Box>
      </Pressable>

      {expanded && (
        <Box gap={3} padding={4} testID={`consent-history-item-details-${entry._id}`}>
          <Box alignItems="center" direction="row" justifyContent="between">
            <Box color="disabled" flex="grow" height={1} />
            <Box direction="row" gap={2} marginLeft={2}>
              <IconButton
                accessibilityLabel="Print"
                iconName="print"
                loading={isPrinting}
                onClick={handlePrint}
                testID={`consent-history-print-${entry._id}`}
                tooltipText="Print"
              />
              <IconButton
                accessibilityLabel="Download PDF"
                iconName="download"
                loading={isDownloading}
                onClick={handleDownload}
                testID={`consent-history-download-${entry._id}`}
                tooltipText="Download PDF"
              />
            </Box>
          </Box>

          {entry.form?.version !== undefined && (
            <Box alignItems="center" direction="row" gap={2}>
              <Text color="secondaryDark" size="sm">
                Version:
              </Text>
              <Text size="sm">{entry.form.version}</Text>
            </Box>
          )}

          {entry.locale && (
            <Box alignItems="center" direction="row" gap={2}>
              <Text color="secondaryDark" size="sm">
                Locale:
              </Text>
              <Text size="sm">{entry.locale}</Text>
            </Box>
          )}

          {entry.signedAt && (
            <Box alignItems="center" direction="row" gap={2}>
              <Text color="secondaryDark" size="sm">
                Signed:
              </Text>
              <Text size="sm">{formatDate(entry.signedAt)}</Text>
            </Box>
          )}

          {entry.ipAddress && (
            <Box alignItems="center" direction="row" gap={2}>
              <Text color="secondaryDark" size="sm">
                IP Address:
              </Text>
              <Text size="sm">{entry.ipAddress}</Text>
            </Box>
          )}

          {checkboxEntries.length > 0 && (
            <Box gap={2}>
              <Text bold color="secondaryDark" size="sm">
                Checkboxes
              </Text>
              {checkboxEntries.map(([index, checked]) => {
                const label = entry.form?.checkboxes?.[Number(index)]?.label;
                return (
                  <Box alignItems="center" direction="row" gap={2} key={index}>
                    <Badge
                      status={checked ? "success" : "neutral"}
                      value={checked ? "Yes" : "No"}
                    />
                    <Text size="sm">{label ?? `Checkbox ${index}`}</Text>
                  </Box>
                );
              })}
            </Box>
          )}

          {entry.signature && (
            <Box gap={2}>
              <Text bold color="secondaryDark" size="sm">
                Signature
              </Text>
              <Box border="default" padding={2} rounding="sm">
                <Image
                  accessibilityLabel="Your signature"
                  accessible
                  resizeMode="contain"
                  source={{uri: entry.signature}}
                  style={{height: 80, width: "100%"}}
                  testID={`consent-history-signature-${entry._id}`}
                />
              </Box>
            </Box>
          )}

          {entry.contentSnapshot && (
            <Box gap={2}>
              <Text bold color="secondaryDark" size="sm">
                Form Content
              </Text>
              <Box border="default" padding={3} rounding="sm">
                <MarkdownView>{entry.contentSnapshot}</MarkdownView>
              </Box>
            </Box>
          )}
        </Box>
      )}
    </Card>
  );
};

export const ConsentHistory: React.FC<ConsentHistoryProps> = ({baseUrl, title = "My Consents"}) => {
  const {entries, isLoading, error, refetch} = useConsentHistory(baseUrl);

  if (isLoading) {
    return (
      <Page maxWidth={800} title={title}>
        <Box alignItems="center" justifyContent="center" padding={6}>
          <Spinner />
        </Box>
      </Page>
    );
  }

  if (error) {
    return (
      <Page maxWidth={800} title={title}>
        <Box alignItems="center" direction="column" gap={3} padding={6}>
          <Text color="error" size="lg">
            Failed to load consent history
          </Text>
          <Button onClick={refetch} text="Retry" />
        </Box>
      </Page>
    );
  }

  if (entries.length === 0) {
    return (
      <Page maxWidth={800} title={title}>
        <Box alignItems="center" padding={6}>
          <Text color="secondaryDark">No consent records found.</Text>
        </Box>
      </Page>
    );
  }

  return (
    <Page maxWidth={800} scroll title={title}>
      <Box gap={3} padding={4} testID="consent-history-list">
        {entries.map((entry) => (
          <ConsentHistoryItem entry={entry} key={entry._id} />
        ))}
      </Box>
    </Page>
  );
};
