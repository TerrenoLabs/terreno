import {Box, Button, NumberField, Page, Spinner, Text, TextField, useToast} from "@terreno/ui";
import {router} from "expo-router";
import React, {useCallback, useEffect, useState} from "react";
import {asJsonBody} from "./adminRpc";
import {resolveAdminBases} from "./types";
import {useAdminRpc, useAdminRpcMutation, useAdminRpcQuery} from "./useAdminRpc";

interface VersionConfigData {
  mobileRequiredVersion?: number;
  mobileWarningVersion?: number;
  /** How often clients poll for version updates, in minutes. */
  pollingIntervalMinutes?: number;
  requiredMessage?: string;
  updateUrl?: string | null;
  webRequiredVersion?: number;
  webWarningVersion?: number;
  warningMessage?: string;
}

interface AdminVersionConfigProps {
  /** @deprecated Use `apiBase`/`routeBase`. Kept as a backward-compatible alias. */
  baseUrl?: string;
  /** Base path where admin API requests are sent. Falls back to `baseUrl`. */
  apiBase?: string;
  /** Base path used for in-app navigation. Falls back to `baseUrl`. */
  routeBase?: string;
  /**
   * When true, renders a compact bordered panel without a surrounding {@link Page} or Back
   * button — for embedding on the admin home dashboard.
   */
  embedded?: boolean;
}

export const AdminVersionConfig: React.FC<AdminVersionConfigProps> = ({
  baseUrl,
  apiBase,
  routeBase,
  embedded,
}) => {
  const {apiBase: resolvedApiBase} = resolveAdminBases({apiBase, baseUrl, routeBase});
  const [formState, setFormState] = useState<VersionConfigData>({});
  const [isSaving, setIsSaving] = useState(false);
  const toast = useToast();

  const rpc = useAdminRpc();
  const {
    data,
    isLoading: isFetching,
    error: fetchError,
  } = useAdminRpcQuery<VersionConfigData>({
    rpc,
    url: `${resolvedApiBase}/version-config`,
  });
  const [rpcUpdate] = useAdminRpcMutation(rpc);
  const updateConfig = useCallback(
    (body: VersionConfigData) =>
      rpcUpdate({
        body: asJsonBody(body),
        method: "PUT",
        url: `${resolvedApiBase}/version-config`,
      }),
    [resolvedApiBase, rpcUpdate]
  );

  // Populate form state with fetched config data or defaults when the query completes
  useEffect(() => {
    if (isFetching || fetchError) {
      return;
    }
    const defaults = {
      mobileRequiredVersion: 0,
      mobileWarningVersion: 0,
      pollingIntervalMinutes: 1440,
      requiredMessage: "This version is no longer supported. Please update to continue.",
      updateUrl: "",
      warningMessage: "A new version is available. Please update for the best experience.",
      webRequiredVersion: 0,
      webWarningVersion: 0,
    };
    if (data) {
      setFormState({
        mobileRequiredVersion: data.mobileRequiredVersion ?? 0,
        mobileWarningVersion: data.mobileWarningVersion ?? 0,
        pollingIntervalMinutes: data.pollingIntervalMinutes ?? defaults.pollingIntervalMinutes,
        requiredMessage: data.requiredMessage ?? defaults.requiredMessage,
        updateUrl: data.updateUrl ?? "",
        warningMessage: data.warningMessage ?? defaults.warningMessage,
        webRequiredVersion: data.webRequiredVersion ?? 0,
        webWarningVersion: data.webWarningVersion ?? 0,
      });
    } else {
      setFormState(defaults);
    }
  }, [data, isFetching, fetchError]);

  const handleFieldChange = useCallback(
    (field: keyof VersionConfigData, value: string | number) => {
      setFormState((prev) => ({...prev, [field]: value}));
    },
    []
  );

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      const trimmedUpdateUrl = (formState.updateUrl ?? "").trim();
      await updateConfig({
        mobileRequiredVersion: Number(formState.mobileRequiredVersion) || 0,
        mobileWarningVersion: Number(formState.mobileWarningVersion) || 0,
        pollingIntervalMinutes: Math.max(1, Number(formState.pollingIntervalMinutes) || 1440),
        requiredMessage: formState.requiredMessage ?? "",
        updateUrl: trimmedUpdateUrl || null,
        warningMessage: formState.warningMessage ?? "",
        webRequiredVersion: Number(formState.webRequiredVersion) || 0,
        webWarningVersion: Number(formState.webWarningVersion) || 0,
      }).unwrap();
      toast.success("Version config saved");
    } catch (error) {
      toast.error("Failed to save version config");
      console.error("Failed to save version config:", error);
    } finally {
      setIsSaving(false);
    }
  }, [formState, updateConfig, toast]);

  const handleBack = useCallback(() => {
    router.back();
  }, []);

  if (isFetching) {
    if (embedded) {
      return (
        <Box padding={4} testID="admin-version-config-widget-loading">
          <Spinner />
        </Box>
      );
    }
    return (
      <Page color="transparent" maxWidth="100%" padding={0} title="Version Config">
        <Box alignItems="center" justifyContent="center" padding={6}>
          <Spinner />
        </Box>
      </Page>
    );
  }

  if (fetchError) {
    if (embedded) {
      return (
        <Box padding={3} testID="admin-version-config-widget-error">
          <Text color="error" size="sm">
            Version config unavailable.
          </Text>
        </Box>
      );
    }
    return (
      <Page color="transparent" maxWidth="100%" padding={0} title="Version Config">
        <Box alignItems="center" gap={4} justifyContent="center" padding={6}>
          <Text color="error">Failed to load version config. Please try again later.</Text>
          <Button onClick={handleBack} text="Back" variant="outline" />
        </Box>
      </Page>
    );
  }

  const formInner = (
    <>
      {!embedded ? (
        <Text color="secondaryDark" size="sm">
          Configure version thresholds for upgrade warnings and blocks. Use build numbers (e.g. from
          git rev-list --count HEAD). Set to 0 to disable.
        </Text>
      ) : (
        <Text bold size="sm">
          Client version thresholds
        </Text>
      )}

      <Box gap={2}>
        <Text bold size="md">
          Web
        </Text>
        <NumberField
          onChange={(v) => handleFieldChange("webWarningVersion", parseInt(v, 10) || 0)}
          title="Warning version (build number)"
          type="number"
          value={String(formState.webWarningVersion ?? 0)}
        />
        <NumberField
          onChange={(v) => handleFieldChange("webRequiredVersion", parseInt(v, 10) || 0)}
          title="Required version (build number)"
          type="number"
          value={String(formState.webRequiredVersion ?? 0)}
        />
      </Box>

      <Box gap={2}>
        <Text bold size="md">
          Mobile
        </Text>
        <NumberField
          onChange={(v) => handleFieldChange("mobileWarningVersion", parseInt(v, 10) || 0)}
          title="Warning version (build number)"
          type="number"
          value={String(formState.mobileWarningVersion ?? 0)}
        />
        <NumberField
          onChange={(v) => handleFieldChange("mobileRequiredVersion", parseInt(v, 10) || 0)}
          title="Required version (build number)"
          type="number"
          value={String(formState.mobileRequiredVersion ?? 0)}
        />
      </Box>

      <Box gap={2}>
        <Text bold size="md">
          Messages
        </Text>
        <TextField
          onChange={(v) => handleFieldChange("warningMessage", v)}
          title="Warning message"
          value={formState.warningMessage ?? ""}
        />
        <TextField
          onChange={(v) => handleFieldChange("requiredMessage", v)}
          title="Required (blocking) message"
          value={formState.requiredMessage ?? ""}
        />
      </Box>

      <Box gap={2}>
        <TextField
          onChange={(v) => handleFieldChange("updateUrl", v)}
          title="Update URL (optional, for mobile app store link)"
          value={formState.updateUrl ?? ""}
        />
      </Box>

      <Box gap={2}>
        <Text bold size="md">
          Polling
        </Text>
        <NumberField
          onChange={(v) => handleFieldChange("pollingIntervalMinutes", parseInt(v, 10) || 1440)}
          title="Update check interval (minutes)"
          type="number"
          value={String(formState.pollingIntervalMinutes ?? 1440)}
        />
        {!embedded ? (
          <Text color="secondaryDark" size="sm">
            How often clients check for updates in the background. Default: 1440 (24 hours).
            Minimum: 1.
          </Text>
        ) : null}
      </Box>

      <Box direction="row" gap={2}>
        {!embedded ? <Button onClick={handleBack} text="Back" variant="outline" /> : null}
        <Button loading={isSaving} onClick={handleSave} text="Save" variant="primary" />
      </Box>
    </>
  );

  if (embedded) {
    return (
      <Box border="default" gap={3} padding={3} rounding="md" testID="admin-version-config-widget">
        {formInner}
      </Box>
    );
  }

  return (
    <Page color="transparent" maxWidth="100%" padding={0} scroll title="Version Config">
      <Box gap={4} padding={4}>
        {formInner}
      </Box>
    </Page>
  );
};
