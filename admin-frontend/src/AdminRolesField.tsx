import {Badge, Box, IconButton, SelectField, Spinner, Text} from "@terreno/ui";
import React, {useCallback, useMemo} from "react";
import type {AdminFieldWidgetProps} from "./types";
import {resolveAdminBases} from "./types";
import {normalizeRoles, useAdminRoles} from "./useAdminRoles";

const roleNamesFromValue = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((roleName): roleName is string => typeof roleName === "string");
};

/**
 * User-role editor backed by the RBAC role collection.
 *
 * Existing assignments remain visible and removable while the select only offers roles that
 * are not already assigned.
 */
export const AdminRolesField: React.FC<AdminFieldWidgetProps> = ({
  apiBase,
  baseUrl,
  errorText,
  fieldConfig,
  onChange,
  readOnly,
  value,
}) => {
  const {apiBase: resolvedApiBase} = resolveAdminBases({apiBase, baseUrl});
  const {useListRolesQuery} = useAdminRoles(resolvedApiBase);
  const {data, error, isLoading} = useListRolesQuery();
  const roles = normalizeRoles(data);
  const selectedRoleNames = roleNamesFromValue(value);
  const selectedRoleSet = useMemo(() => new Set(selectedRoleNames), [selectedRoleNames]);
  const roleLabels = useMemo(
    () => new Map(roles.map((role) => [role.name, role.displayName])),
    [roles]
  );
  const availableOptions = useMemo(
    () =>
      roles
        .filter((role) => !selectedRoleSet.has(role.name))
        .map((role) => ({label: role.displayName || role.name, value: role.name})),
    [roles, selectedRoleSet]
  );

  const handleAddRole = useCallback(
    (roleName: string): void => {
      if (!roleName || selectedRoleSet.has(roleName)) {
        return;
      }
      onChange([...selectedRoleNames, roleName]);
    },
    [onChange, selectedRoleNames, selectedRoleSet]
  );

  const handleRemoveRole = useCallback(
    (roleName: string): void => {
      onChange(selectedRoleNames.filter((selectedRoleName) => selectedRoleName !== roleName));
    },
    [onChange, selectedRoleNames]
  );

  return (
    <Box gap={2} testID="admin-field-roles">
      <Text bold color="primary">
        Roles
      </Text>
      {selectedRoleNames.length === 0 ? (
        <Text color="secondaryDark" size="sm">
          No roles assigned.
        </Text>
      ) : (
        <Box gap={1}>
          {selectedRoleNames.map((roleName) => (
            <Box
              alignItems="center"
              direction="row"
              gap={2}
              justifyContent="between"
              key={roleName}
              testID={`admin-field-roles-selected-${roleName}`}
            >
              <Badge value={roleLabels.get(roleName) ?? roleName} />
              {!readOnly ? (
                <IconButton
                  accessibilityHint={`Removes the ${roleLabels.get(roleName) ?? roleName} role`}
                  accessibilityLabel={`Remove ${roleLabels.get(roleName) ?? roleName}`}
                  iconName="xmark"
                  onClick={() => handleRemoveRole(roleName)}
                  testID={`admin-field-roles-remove-${roleName}`}
                  variant="muted"
                />
              ) : null}
            </Box>
          ))}
        </Box>
      )}
      {isLoading ? (
        <Box alignItems="center" padding={2} testID="admin-field-roles-loading">
          <Spinner />
        </Box>
      ) : null}
      {error ? (
        <Text color="error" size="sm" testID="admin-field-roles-load-error">
          Failed to load available roles.
        </Text>
      ) : null}
      {!readOnly && !isLoading && !error ? (
        <SelectField
          disabled={availableOptions.length === 0}
          errorText={errorText}
          helperText={
            availableOptions.length === 0
              ? "All available roles are assigned."
              : fieldConfig.description
          }
          onChange={handleAddRole}
          options={availableOptions}
          placeholder="Select a role to add"
          testID="admin-field-roles-add"
          title="Add role"
          value=""
        />
      ) : null}
    </Box>
  );
};
