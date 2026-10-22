import {baseUrl} from "@terreno/syncdb/config";
import {
  Box,
  Button,
  Card,
  Heading,
  Page,
  Spinner,
  Text,
  TextArea,
  TextField,
  useStoredState,
} from "@terreno/ui";
import type React from "react";
import {useCallback, useEffect, useState} from "react";
import {getSessionToken} from "@/lib/betterAuth";

interface GcsConfigStatus {
  bucketName: string | null;
  configured: boolean;
  hasCredentials: boolean;
  projectId: string | null;
}

const GcsSettingsScreen: React.FC = () => {
  const [bucketName, setBucketName] = useStoredState<string>("gcsBucketName", "");
  const [projectId, setProjectId] = useStoredState<string>("gcsProjectId", "");
  const [serviceAccountKey, setServiceAccountKey] = useStoredState<string>(
    "gcsServiceAccountKey",
    ""
  );

  const [bucketInput, setBucketInput] = useState<string>("");
  const [projectIdInput, setProjectIdInput] = useState<string>("");
  const [keyInput, setKeyInput] = useState<string>("");

  const [status, setStatus] = useState<GcsConfigStatus | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Sync inputs with stored values
  useEffect(() => {
    if (bucketName) {
      setBucketInput(bucketName);
    }
  }, [bucketName]);

  useEffect(() => {
    if (projectId) {
      setProjectIdInput(projectId);
    }
  }, [projectId]);

  useEffect(() => {
    if (serviceAccountKey) {
      setKeyInput(serviceAccountKey);
    }
  }, [serviceAccountKey]);

  const fetchStatus = useCallback(async () => {
    try {
      const token = await getSessionToken();
      const response = await fetch(`${baseUrl}/settings/gcs`, {
        headers: {Authorization: `Bearer ${token}`},
      });
      if (response.ok) {
        const result = await response.json();
        setStatus(result.data);
      }
    } catch (err) {
      console.error("Failed to fetch GCS status:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleSave = useCallback(async () => {
    setSaveMessage(null);
    setSaveError(null);

    if (!bucketInput.trim()) {
      setSaveError("Bucket name is required");
      return;
    }

    // Validate service account key JSON if provided
    if (keyInput.trim()) {
      try {
        JSON.parse(keyInput.trim());
      } catch {
        setSaveError("Service account key must be valid JSON");
        return;
      }
    }

    setIsSaving(true);
    try {
      const token = await getSessionToken();
      const body: Record<string, string> = {bucketName: bucketInput.trim()};
      if (projectIdInput.trim()) {
        body.projectId = projectIdInput.trim();
      }
      if (keyInput.trim()) {
        body.serviceAccountKey = keyInput.trim();
      }

      const response = await fetch(`${baseUrl}/settings/configureGcs`, {
        body: JSON.stringify(body),
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      });

      const result = await response.json();

      if (!response.ok) {
        setSaveError(result.title || result.detail || "Failed to configure GCS");
        return;
      }

      // Persist locally
      setBucketName(bucketInput.trim());
      setProjectId(projectIdInput.trim());
      setServiceAccountKey(keyInput.trim());

      setSaveMessage("GCS configured successfully");
      await fetchStatus();

      setTimeout(() => setSaveMessage(null), 3000);
    } catch (err) {
      console.error("Failed to save GCS config:", err);
      setSaveError("Failed to save configuration");
    } finally {
      setIsSaving(false);
    }
  }, [
    bucketInput,
    projectIdInput,
    keyInput,
    setBucketName,
    setProjectId,
    setServiceAccountKey,
    fetchStatus,
  ]);

  const handleClear = useCallback(async () => {
    setSaveMessage(null);
    setSaveError(null);
    setIsSaving(true);

    try {
      const token = await getSessionToken();
      await fetch(`${baseUrl}/settings/clearGcs`, {
        headers: {Authorization: `Bearer ${token}`},
        method: "POST",
      });

      setBucketName("");
      setProjectId("");
      setServiceAccountKey("");
      setBucketInput("");
      setProjectIdInput("");
      setKeyInput("");

      setSaveMessage("GCS configuration cleared");
      await fetchStatus();

      setTimeout(() => setSaveMessage(null), 3000);
    } catch (err) {
      console.error("Failed to clear GCS config:", err);
      setSaveError("Failed to clear configuration");
    } finally {
      setIsSaving(false);
    }
  }, [setBucketName, setProjectId, setServiceAccountKey, fetchStatus]);

  if (isLoading) {
    return (
      <Page backButton navigation={undefined}>
        <Box alignItems="center" flex="grow" justifyContent="center">
          <Spinner />
        </Box>
      </Page>
    );
  }

  return (
    <Page
      backButton
      navigation={undefined}
      scroll
      testID="gcs-settings-screen"
      title="Storage Settings"
    >
      <Box padding={4}>
        <Card marginBottom={6}>
          <Box gap={4}>
            <Heading size="lg">Google Cloud Storage</Heading>
            <Text color="secondaryLight" size="sm">
              Configure GCS to enable file uploads and document storage. You need a GCS bucket and
              optionally a service account key for authentication.
            </Text>

            <Box border={status?.configured ? "success" : "default"} padding={3} rounding="md">
              <Box alignItems="center" direction="row" gap={2}>
                <Text bold size="sm">
                  Status:
                </Text>
                <Text color={status?.configured ? "success" : "secondaryLight"} size="sm">
                  {status?.configured ? "Configured" : "Not configured"}
                </Text>
              </Box>
              {status?.bucketName && (
                <Box alignItems="center" direction="row" gap={2} marginTop={1}>
                  <Text bold size="sm">
                    Bucket:
                  </Text>
                  <Text size="sm">{status.bucketName}</Text>
                </Box>
              )}
            </Box>

            <TextField
              disabled={isSaving}
              onChange={setBucketInput}
              placeholder="my-app-uploads"
              testID="gcs-settings-bucket-input"
              title="Bucket Name"
              value={bucketInput}
            />

            <TextField
              disabled={isSaving}
              onChange={setProjectIdInput}
              placeholder="my-gcp-project"
              testID="gcs-settings-project-input"
              title="Project ID (optional)"
              value={projectIdInput}
            />

            <TextArea
              disabled={isSaving}
              onChange={setKeyInput}
              placeholder='{"type": "service_account", "project_id": "...", ...}'
              rows={6}
              testID="gcs-settings-key-input"
              title="Service Account Key JSON (optional)"
              value={keyInput}
            />
            <Text color="secondaryLight" size="sm">
              If running locally with gcloud CLI authenticated, you can leave the service account
              key empty to use Application Default Credentials.
            </Text>

            {saveMessage && (
              <Box>
                <Text color="success" testID="gcs-settings-success">
                  {saveMessage}
                </Text>
              </Box>
            )}

            {saveError && (
              <Box>
                <Text color="error" testID="gcs-settings-error">
                  {saveError}
                </Text>
              </Box>
            )}

            <Box direction="row" gap={2}>
              <Button
                disabled={!bucketInput.trim() || isSaving}
                iconName="cloud-arrow-up"
                loading={isSaving}
                onClick={handleSave}
                testID="gcs-settings-save-button"
                text="Save & Connect"
              />
              <Button
                disabled={!status?.configured || isSaving}
                iconName="trash"
                onClick={handleClear}
                testID="gcs-settings-clear-button"
                text="Clear"
                variant="destructive"
              />
            </Box>
          </Box>
        </Card>
      </Box>
    </Page>
  );
};

export default GcsSettingsScreen;
