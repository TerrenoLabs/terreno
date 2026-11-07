import {Box, Button, Card, Spinner, Text, TextField} from "@terreno/ui";
import type {Href} from "expo-router";
import {router} from "expo-router";
import React, {useCallback, useEffect, useState} from "react";
import {AdminScreenPage} from "../AdminScreenPage";
import type {OrganizationSummary} from "./OrgDirectoryScreen";
import {type OrganizationSettings, organizationSettingsOf} from "./organizationSettings";
import {useOrganizationsApi} from "./useOrganizationsApi";
import {organizationMatchesRoute} from "./useOrgContext";

export interface OrgSettingsScreenProps {
  basePath?: string;
  organizationId: string;
  routeBase?: string;
}

interface OrganizationDetail extends OrganizationSummary {
  settings?: OrganizationSettings;
}

const errorTitle = (error: unknown, fallback: string): string => {
  if (typeof error !== "object" || error === null) {
    return fallback;
  }
  const data = (error as {data?: unknown}).data;
  if (typeof data !== "object" || data === null) {
    return fallback;
  }
  const title = (data as {title?: unknown}).title;
  return typeof title === "string" ? title : fallback;
};

export const OrgSettingsScreen: React.FC<OrgSettingsScreenProps> = ({
  basePath,
  organizationId,
  routeBase = "/admin",
}) => {
  const {useReadQuery, useUpdateMutation} = useOrganizationsApi(basePath);
  const {data, error, isLoading} = useReadQuery(organizationId);
  const loadedOrganization = (data?.data ?? data) as OrganizationDetail | undefined;
  const isStaleOrganization =
    loadedOrganization !== undefined &&
    !organizationMatchesRoute(loadedOrganization, organizationId);
  const organization = organizationMatchesRoute(loadedOrganization, organizationId)
    ? loadedOrganization
    : undefined;
  const [name, setName] = useState("");
  const [settingsText, setSettingsText] = useState("{}");
  const [saveError, setSaveError] = useState<string>();
  const [updateOrganization, {isLoading: isSaving}] = useUpdateMutation();

  // Reconcile editable fields when the route-scoped organization response changes.
  useEffect(() => {
    if (!organization) {
      return;
    }
    setName(organization.name);
    setSettingsText(JSON.stringify(organizationSettingsOf(organization), null, 2));
  }, [organization, organizationId]);

  const handleSave = useCallback(async (): Promise<void> => {
    let settings: OrganizationSettings;
    try {
      const parsed = JSON.parse(settingsText) as unknown;
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        setSaveError("Settings must be a JSON object.");
        return;
      }
      settings = parsed as OrganizationSettings;
    } catch {
      setSaveError("Settings must be valid JSON.");
      return;
    }
    try {
      setSaveError(undefined);
      await updateOrganization({
        body: {name: name.trim(), settings},
        id: organizationId,
      }).unwrap();
    } catch (mutationError) {
      setSaveError(errorTitle(mutationError, "Could not save organization settings."));
    }
  }, [name, organizationId, settingsText, updateOrganization]);
  const handleOpenMembers = useCallback((): void => {
    router.push(`${routeBase}/orgs/${organizationId}/members` as Href);
  }, [organizationId, routeBase]);

  if (isLoading || isStaleOrganization) {
    return (
      <Box alignItems="center" padding={6}>
        <Spinner />
      </Box>
    );
  }
  if (error || !organization) {
    return <Text color="error">{errorTitle(error, "Could not load organization settings.")}</Text>;
  }

  return (
    <AdminScreenPage
      backHref={`${routeBase}/orgs`}
      color="transparent"
      padding={0}
      title={`${organization.name} settings`}
    >
      <Box gap={4} padding={4}>
        <Card gap={3} padding={4}>
          <TextField onChange={setName} testID="org-settings-name" title="Name" value={name} />
          <TextField
            multiline
            onChange={setSettingsText}
            testID="org-settings-json"
            title="Settings (JSON)"
            value={settingsText}
          />
          {saveError ? (
            <Text color="error" testID="org-settings-error">
              {saveError}
            </Text>
          ) : null}
          <Button
            loading={isSaving}
            onClick={() => {
              void handleSave();
            }}
            testID="org-settings-save"
            text="Save settings"
          />
        </Card>
        <Card gap={2} padding={4}>
          <Text bold>Members</Text>
          <Text color="secondaryDark">Manage organization roles and access.</Text>
          <Button onClick={handleOpenMembers} text="Manage members" variant="outline" />
        </Card>
        <Card gap={2} padding={4}>
          <Text bold>Billing</Text>
          <Text color="secondaryDark">Billing is not available yet.</Text>
        </Card>
      </Box>
    </AdminScreenPage>
  );
};
