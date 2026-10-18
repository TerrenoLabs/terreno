import {Box, Button, SelectField, Spinner, Text} from "@terreno/ui";
import type {Href} from "expo-router";
import {router} from "expo-router";
import React, {useCallback, useEffect} from "react";
import {normalizeListData} from "./normalizeListData";
import type {OrganizationSummary} from "./OrgDirectoryScreen";
import {sortOrganizations} from "./sortOrganizations";
import {useOrganizationsApi} from "./useOrganizationsApi";
import {useOrgContext} from "./useOrgContext";

export interface OrgSwitcherProps {
  basePath?: string;
  routeBase?: string;
}

const isForbiddenMineQuery = (error: unknown): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }
  return (error as {status?: number}).status === 403;
};

export const OrgSwitcher: React.FC<OrgSwitcherProps> = ({basePath, routeBase = "/admin"}) => {
  const {organization, selectOrganization} = useOrgContext();
  const {useMineQuery} = useOrganizationsApi(basePath);
  const {data, error, isLoading} = useMineQuery<OrganizationSummary>();
  const organizations = normalizeListData<OrganizationSummary>(data);

  const handleChange = useCallback(
    (organizationId: string): void => {
      const nextOrganization = organizations.find((candidate) => candidate._id === organizationId);
      if (!nextOrganization) {
        return;
      }
      selectOrganization(nextOrganization);
      const prefix = routeBase.endsWith("/") ? routeBase.slice(0, -1) : routeBase;
      router.push(`${prefix}/orgs/${nextOrganization._id}` as Href);
    },
    [organizations, routeBase, selectOrganization]
  );

  // Deterministic default: pick the first org from /orgs/mine so org-scoped admin REST
  // has X-Organization-Id before home widgets mount (multi-org operators included).
  useEffect(() => {
    if (organization || organizations.length === 0) {
      return;
    }
    selectOrganization(sortOrganizations(organizations)[0]);
  }, [organization, organizations, selectOrganization]);

  if (isLoading) {
    return <Spinner size="sm" />;
  }
  if (error) {
    if (isForbiddenMineQuery(error)) {
      return null;
    }
    return (
      <Text color="error" size="sm">
        Organizations unavailable
      </Text>
    );
  }
  if (organizations.length === 0) {
    return null;
  }
  if (organizations.length === 1) {
    return (
      <Box gap={1} testID="org-switcher-single">
        <Text bold color="inverted" size="sm">
          Organization
        </Text>
        <Button
          onClick={() => handleChange(organizations[0]._id)}
          testID="org-switcher-single-open"
          text={organizations[0].name}
          variant="outline"
        />
      </Box>
    );
  }
  return (
    <Box gap={1}>
      <Text bold color="inverted" size="sm">
        Organization
      </Text>
      <SelectField
        onChange={handleChange}
        options={organizations.map((candidate) => ({
          label: candidate.name,
          value: candidate._id,
        }))}
        placeholder="Select organization"
        testID="org-switcher"
        value={organization?._id ?? ""}
      />
    </Box>
  );
};
