import {type ConsentHistoryEntry, generateConsentHistoryPdf} from "@terreno/admin-frontend";
import {Box, Button, Card, Heading, Page, Text} from "@terreno/ui";
import {DateTime} from "luxon";
import type React from "react";
import {useCallback, useState} from "react";

const SAMPLE_ENTRY: ConsentHistoryEntry = {
  _id: "sample-pdf-test-001",
  agreed: true,
  agreedAt: DateTime.now().toISO() ?? "",
  checkboxValues: {"0": true, "1": false},
  contentSnapshot:
    "By agreeing to this form, you consent to the collection and processing of your data as described in our Privacy Policy. This includes the use of cookies and similar technologies for analytics and personalization purposes.",
  form: {
    captureSignature: false,
    checkboxes: [
      {label: "I agree to the Terms of Service", required: true},
      {label: "I want to receive marketing emails", required: false},
    ],
    slug: "sample-consent",
    title: "Sample Consent Form",
    type: "privacy",
    version: 1,
  },
  formVersionSnapshot: 1,
  ipAddress: "192.168.1.1",
  locale: "en-US",
  signedAt: DateTime.now().toISO() ?? "",
  userAgent: "Mozilla/5.0 (Example Browser)",
};

export const DocumentsPdfSection: React.FC = () => {
  const [status, setStatus] = useState<"idle" | "generating" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const handleGenerate = useCallback(async () => {
    setStatus("generating");
    setErrorMessage("");
    try {
      await generateConsentHistoryPdf(SAMPLE_ENTRY);
      setStatus("success");
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "Unknown error");
      console.error("Failed to generate PDF", err);
    }
  }, []);

  return (
    <Page maxWidth={800} scroll title="PDF Generation">
      <Box gap={4} padding={4} testID="pdf-screen">
        <Card padding={4}>
          <Box gap={3}>
            <Heading size="md">PDF Generation Test</Heading>
            <Text color="secondaryDark" size="sm">
              Generate a sample consent record PDF to test cross-platform PDF generation. On web,
              this downloads a PDF file. On mobile, this opens the share sheet with a PDF
              attachment.
            </Text>
          </Box>
        </Card>

        <Button
          loading={status === "generating"}
          onClick={handleGenerate}
          testID="pdf-generate-button"
          text="Generate Sample PDF"
        />

        {status === "success" && (
          <Box testID="pdf-status-text">
            <Text color="success" size="md">
              PDF generated successfully!
            </Text>
          </Box>
        )}

        {status === "error" && (
          <Box testID="pdf-status-text">
            <Text color="error" size="md">
              Failed to generate PDF: {errorMessage}
            </Text>
          </Box>
        )}

        <Card padding={4}>
          <Box gap={2}>
            <Heading size="sm">Sample Data Preview</Heading>
            <Text size="sm">Title: {SAMPLE_ENTRY.form?.title}</Text>
            <Text size="sm">Type: {SAMPLE_ENTRY.form?.type}</Text>
            <Text size="sm">Decision: Agreed</Text>
            <Text size="sm">Checkboxes: 2 (1 checked, 1 unchecked)</Text>
            <Text size="sm">Has content snapshot: Yes</Text>
            <Text size="sm">Has audit trail: Yes</Text>
          </Box>
        </Card>
      </Box>
    </Page>
  );
};
