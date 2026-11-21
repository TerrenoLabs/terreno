import {
  Badge,
  Box,
  Button,
  CheckBox,
  Heading,
  Modal,
  SelectField,
  Spinner,
  Text,
  TextField,
} from "@terreno/ui";
import React, {useCallback, useMemo, useState} from "react";

import type {AdminScreenProps} from "./types";
import {resolveAdminBases} from "./types";
import {
  normalizeRoles,
  normalizeStatementDescriptions,
  normalizeStatements,
  type RbacRoleRow,
  type StatementDescriptions,
  useAdminRoles,
} from "./useAdminRoles";

/** One statement action the roles screen can show or hide. */
export interface RoleActionVisibilityArgs {
  action: string;
  resource: string;
}

/**
 * Return false to hide an action from the list and the editor.
 * Hidden actions already stored on a role are written back unchanged.
 */
export type RoleActionVisibility = (permission: RoleActionVisibilityArgs) => boolean;

export interface AdminRolesListProps extends AdminScreenProps {
  /**
   * Hides statement actions without removing them from a saved role.
   * The same verb can be a model grant on one resource and a named check on
   * another, so the predicate receives both. Omit to show every action.
   */
  isActionVisible?: RoleActionVisibility;
  /**
   * Show the colored action badges (read, update, delete, and the rest) on role cards
   * and the available-permissions list. When false, a described permission shows its
   * description and an undescribed one shows the action name as text. Defaults to true.
   */
  showActionBadges?: boolean;
}

interface RoleFormState {
  description: string;
  displayName: string;
  name: string;
  permissions: Record<string, string[]>;
}

const EMPTY_ROLE_FORM: RoleFormState = {
  description: "",
  displayName: "",
  name: "",
  permissions: {},
};

const STANDARD_ACCESS_ACTIONS = ["read", "write", "writeOwned"] as const;
const STANDARD_ACCESS_OPTIONS = [
  {label: "No access", value: "none"},
  {label: "Read only", value: "read"},
  {label: "Read + write owned", value: "writeOwned"},
  {label: "Read + write all", value: "write"},
];
const ADMIN_PAGE_RESOURCE = "admin";
const ADMIN_PAGE_ACTION = "access";

// Actions that only expose data; everything not listed here or in DELETE_ACTIONS mutates data.
const READ_ACTIONS = new Set(["access", "list", "read"]);
const DELETE_ACTIONS = new Set(["delete", "destroy", "remove"]);

type PermissionKind = "read" | "write" | "delete";

const PERMISSION_KIND_ORDER: Record<PermissionKind, number> = {delete: 2, read: 0, write: 1};

const PERMISSION_KIND_STATUS: Record<PermissionKind, "success" | "warning" | "error"> = {
  delete: "error",
  read: "success",
  write: "warning",
};

const permissionKind = (action: string): PermissionKind => {
  if (READ_ACTIONS.has(action) || action.startsWith("view")) {
    return "read";
  }
  if (DELETE_ACTIONS.has(action)) {
    return "delete";
  }
  return "write";
};

const sortActionsByKind = (actions: readonly string[]): string[] => {
  return [...actions].sort(
    (a, b) =>
      PERMISSION_KIND_ORDER[permissionKind(a)] - PERMISSION_KIND_ORDER[permissionKind(b)] ||
      a.localeCompare(b)
  );
};

// Actions modelRouter generates (CRUD) or the admin model access selector grants. Every other
// action was declared by the app or a plugin, so it is listed separately as a custom permission.
const MODEL_ROUTER_ACTIONS = new Set([
  "create",
  "delete",
  "list",
  "read",
  "update",
  "write",
  "writeOwned",
]);

type PermissionGroupKey = "custom" | "model";

const PERMISSION_GROUPS: readonly {key: PermissionGroupKey; label: string}[] = [
  {key: "custom", label: "Custom permissions"},
  {key: "model", label: "Model permissions"},
];

const isStatementActionVisible = ({
  action,
  isActionVisible,
  resource,
}: {
  action: string;
  isActionVisible?: RoleActionVisibility;
  resource: string;
}): boolean => {
  if (!isActionVisible) {
    return true;
  }
  return isActionVisible({action, resource});
};

const shownPermissions = ({
  isActionVisible,
  permissions,
}: {
  isActionVisible?: RoleActionVisibility;
  permissions: Record<string, readonly string[]>;
}): Record<string, readonly string[]> => {
  if (!isActionVisible) {
    return permissions;
  }
  const result: Record<string, readonly string[]> = {};
  for (const [resource, actions] of Object.entries(permissions)) {
    const visible = actions.filter((action) =>
      isStatementActionVisible({action, isActionVisible, resource})
    );
    if (visible.length > 0) {
      result[resource] = visible;
    }
  }
  return result;
};

const groupPermissions = (
  permissions: Record<string, readonly string[]>
): Record<PermissionGroupKey, [string, string[]][]> => {
  const grouped: Record<PermissionGroupKey, [string, string[]][]> = {custom: [], model: []};
  const resources = Object.keys(permissions).sort((a, b) => a.localeCompare(b));
  for (const resource of resources) {
    const actions = permissions[resource] ?? [];
    const customActions = actions.filter((action) => !MODEL_ROUTER_ACTIONS.has(action));
    const modelActions = actions.filter((action) => MODEL_ROUTER_ACTIONS.has(action));
    if (customActions.length > 0) {
      grouped.custom.push([resource, customActions]);
    }
    if (modelActions.length > 0) {
      grouped.model.push([resource, modelActions]);
    }
  }
  return grouped;
};

export const descriptionFor = (
  descriptions: StatementDescriptions,
  resource: string,
  action: string
): string | undefined => {
  const description = descriptions[resource]?.[action]?.trim();
  if (!description) {
    return undefined;
  }
  return description;
};

export interface PermissionActionLabelProps {
  action: string;
  description?: string;
  showActionBadges: boolean;
  testID: string;
}

export const PermissionActionLabel: React.FC<PermissionActionLabelProps> = ({
  action,
  description,
  showActionBadges,
  testID,
}) => {
  if (!showActionBadges) {
    return (
      <Text color="secondaryDark" size="sm" testID={testID}>
        {description ?? action}
      </Text>
    );
  }
  return (
    <Box alignItems="center" direction="row" gap={1}>
      <Badge
        status={PERMISSION_KIND_STATUS[permissionKind(action)]}
        testID={testID}
        value={action}
      />
      {description ? (
        <Text color="secondaryDark" size="sm" testID={`${testID}-description`}>
          {description}
        </Text>
      ) : null}
    </Box>
  );
};

/**
 * Custom permissions first, then model permissions. Each group has one row per resource with
 * color-coded action badges (read green, write amber, delete red), unless badges are hidden.
 */
const PermissionRows: React.FC<{
  descriptions: StatementDescriptions;
  permissions: Record<string, readonly string[]>;
  showActionBadges: boolean;
  testIDPrefix: string;
}> = ({descriptions, permissions, showActionBadges, testIDPrefix}) => {
  const grouped = groupPermissions(permissions);
  const groups = PERMISSION_GROUPS.filter((group) => grouped[group.key].length > 0);
  if (groups.length === 0) {
    return null;
  }
  return (
    <Box gap={3}>
      {groups.map((group) => (
        <Box gap={1} key={group.key} testID={`${testIDPrefix}-${group.key}`}>
          <Text color="secondaryDark" size="sm">
            {group.label}
          </Text>
          {grouped[group.key].map(([resource, actions]) => (
            <Box
              alignItems={showActionBadges ? "center" : "start"}
              direction="row"
              gap={2}
              key={resource}
              testID={`${testIDPrefix}-${group.key}-${resource}`}
              wrap
            >
              <Box minWidth={240}>
                <Text bold size="sm">
                  {resource}
                </Text>
              </Box>
              <Box direction={showActionBadges ? "row" : "column"} gap={1} wrap>
                {sortActionsByKind(actions).map((action) => (
                  <PermissionActionLabel
                    action={action}
                    description={descriptionFor(descriptions, resource, action)}
                    key={action}
                    showActionBadges={showActionBadges}
                    testID={`${testIDPrefix}-${resource}-${action}`}
                  />
                ))}
              </Box>
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  );
};

const editorActionsForResource = ({
  actions,
  hasStandardAccess,
  resource,
}: {
  actions: readonly string[];
  hasStandardAccess: boolean;
  resource: string;
}): readonly string[] => {
  const withoutStandard = hasStandardAccess
    ? actions.filter(
        (action) =>
          !STANDARD_ACCESS_ACTIONS.includes(action as (typeof STANDARD_ACCESS_ACTIONS)[number])
      )
    : actions;
  if (resource === ADMIN_PAGE_RESOURCE) {
    return withoutStandard.filter((action) => action !== ADMIN_PAGE_ACTION);
  }
  return withoutStandard;
};

const standardAccessValue = (actions: string[]): string => {
  if (actions.includes("write")) {
    return "write";
  }
  if (actions.includes("writeOwned")) {
    return "writeOwned";
  }
  if (actions.includes("read")) {
    return "read";
  }
  return "none";
};

const clonePermissions = (permissions?: Record<string, string[]>): Record<string, string[]> => {
  return Object.fromEntries(
    Object.entries(permissions ?? {}).map(([resource, actions]) => [resource, [...actions]])
  );
};

export const AdminRolesList: React.FC<AdminRolesListProps> = ({
  apiBase,
  baseUrl,
  isActionVisible,
  showActionBadges = true,
}) => {
  const {apiBase: resolvedApiBase} = resolveAdminBases({apiBase, baseUrl});
  const {useCreateRoleMutation, useListRolesQuery, useListStatementsQuery, useUpdateRoleMutation} =
    useAdminRoles(resolvedApiBase);
  const {data, error, isLoading, refetch} = useListRolesQuery();
  const {
    data: statementsData,
    error: statementsError,
    isLoading: areStatementsLoading,
  } = useListStatementsQuery();
  const [createRole, {isLoading: isCreating}] = useCreateRoleMutation();
  const [updateRole, {isLoading: isUpdating}] = useUpdateRoleMutation();
  const roles = normalizeRoles(data);
  const statements = normalizeStatements(statementsData);
  const statementDescriptions = useMemo(
    () => normalizeStatementDescriptions(statementsData),
    [statementsData]
  );
  const resources = useMemo(() => Object.keys(statements).sort(), [statements]);
  const hasAdminPageStatement =
    statements[ADMIN_PAGE_RESOURCE]?.includes(ADMIN_PAGE_ACTION) ?? false;
  const [editingRole, setEditingRole] = useState<RbacRoleRow | null>(null);
  const [form, setForm] = useState<RoleFormState>(EMPTY_ROLE_FORM);
  const [isFormVisible, setIsFormVisible] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const isSaving = isCreating || isUpdating;

  const handleCreate = useCallback((): void => {
    setEditingRole(null);
    setForm(EMPTY_ROLE_FORM);
    setSaveError(null);
    setIsFormVisible(true);
  }, []);

  const handleEdit = useCallback((role: RbacRoleRow): void => {
    setEditingRole(role);
    setForm({
      description: role.description ?? "",
      displayName: role.displayName,
      name: role.name,
      permissions: clonePermissions(role.permissions),
    });
    setSaveError(null);
    setIsFormVisible(true);
  }, []);

  const handleDismiss = useCallback((): void => {
    setIsFormVisible(false);
    setSaveError(null);
  }, []);

  const handleFieldChange = useCallback(
    (field: "description" | "displayName" | "name", value: string): void => {
      setForm((current) => ({...current, [field]: value}));
    },
    []
  );

  const handlePermissionToggle = useCallback((resource: string, action: string): void => {
    setForm((current) => {
      const currentActions = current.permissions[resource] ?? [];
      const isSelected = currentActions.includes(action);
      const nextActions = isSelected
        ? currentActions.filter((item) => item !== action)
        : [...currentActions, action].sort();
      const permissions = {...current.permissions};
      if (nextActions.length === 0) {
        Reflect.deleteProperty(permissions, resource);
      } else {
        permissions[resource] = nextActions;
      }
      return {...current, permissions};
    });
  }, []);

  const handleStandardAccessChange = useCallback((resource: string, value: string): void => {
    setForm((current) => {
      const customActions = (current.permissions[resource] ?? []).filter(
        (action) =>
          !STANDARD_ACCESS_ACTIONS.includes(action as (typeof STANDARD_ACCESS_ACTIONS)[number])
      );
      const standardActions = value === "none" ? [] : value === "read" ? ["read"] : ["read", value];
      const nextActions = [...customActions, ...standardActions];
      const permissions = {...current.permissions};
      if (nextActions.length === 0) {
        Reflect.deleteProperty(permissions, resource);
      } else {
        permissions[resource] = nextActions;
      }
      return {...current, permissions};
    });
  }, []);

  const handleSave = useCallback(async (): Promise<void> => {
    const name = form.name.trim();
    const displayName = form.displayName.trim();
    if (!name || !displayName) {
      setSaveError("Name and display name are required.");
      return;
    }
    setSaveError(null);
    try {
      if (editingRole) {
        await updateRole({
          changes: {
            description: form.description.trim() === "" ? null : form.description.trim(),
            displayName,
            permissions: form.permissions,
          },
          roleName: editingRole.name,
        }).unwrap();
      } else {
        await createRole({
          description: form.description.trim() || undefined,
          displayName,
          name,
          permissions: form.permissions,
        }).unwrap();
      }
      setIsFormVisible(false);
      refetch?.();
    } catch (saveFailure: unknown) {
      const data = (saveFailure as {data?: {detail?: string; title?: string}})?.data;
      setSaveError(data?.detail ?? data?.title ?? "Failed to save role.");
    }
  }, [createRole, editingRole, form, refetch, updateRole]);

  if (isLoading) {
    return (
      <Box alignItems="center" padding={4} testID="admin-roles-loading">
        <Spinner />
      </Box>
    );
  }

  if (error) {
    return (
      <Box padding={4} testID="admin-roles-error">
        <Text color="error">Failed to load roles.</Text>
      </Box>
    );
  }

  return (
    <Box direction="column" flex="grow" minHeight={0} testID="admin-roles-list">
      <Box
        alignItems="center"
        direction="row"
        gap={2}
        justifyContent="between"
        paddingX={4}
        paddingY={3}
      >
        <Heading size="lg">Roles</Heading>
        <Button
          iconName="plus"
          onClick={handleCreate}
          testID="admin-roles-add-button"
          text="Add role"
        />
      </Box>
      {/* Scrolls the role cards and permission vocabulary so a long list cannot push the
          "Add role" action out of reach. */}
      <Box flex="grow" minHeight={0} scroll testID="admin-roles-scroll">
        <Box direction="column" gap={3} paddingX={4} paddingY={2}>
          {roles.length === 0 ? (
            <Text>No roles found.</Text>
          ) : (
            roles.map((role) => (
              <Box
                border="default"
                direction="column"
                gap={2}
                key={role.name}
                padding={3}
                rounding="md"
                testID={`admin-roles-item-${role.name}`}
              >
                <Box alignItems="center" direction="row" gap={2} justifyContent="between">
                  <Box alignItems="center" direction="row" gap={2}>
                    <Text bold size="md">
                      {role.displayName}
                    </Text>
                    {role.isLocked ? <Badge secondary status="info" value="locked" /> : null}
                    {role.isSealed ? <Badge secondary status="warning" value="sealed" /> : null}
                  </Box>
                  <Button
                    disabled={role.isSealed}
                    iconName="pen"
                    onClick={() => handleEdit(role)}
                    testID={`admin-roles-edit-${role.name}`}
                    text="Edit"
                    variant="outline"
                  />
                </Box>
                <Text color="secondaryLight" size="sm">
                  {role.name}
                </Text>
                {role.description ? <Text size="sm">{role.description}</Text> : null}
                <PermissionRows
                  descriptions={statementDescriptions}
                  permissions={shownPermissions({
                    isActionVisible,
                    permissions: role.permissions ?? {},
                  })}
                  showActionBadges={showActionBadges}
                  testIDPrefix={`admin-roles-item-${role.name}-permission`}
                />
              </Box>
            ))
          )}

          <Box border="default" gap={2} padding={3} rounding="md" testID="admin-permissions-list">
            <Heading size="md">Available permissions</Heading>
            {areStatementsLoading ? <Spinner /> : null}
            {statementsError ? <Text color="error">Failed to load permissions.</Text> : null}
            {!areStatementsLoading && !statementsError ? (
              <PermissionRows
                descriptions={statementDescriptions}
                permissions={shownPermissions({isActionVisible, permissions: statements})}
                showActionBadges={showActionBadges}
                testIDPrefix="admin-permissions"
              />
            ) : null}
          </Box>
        </Box>
      </Box>

      <Modal
        onDismiss={handleDismiss}
        primaryButtonDisabled={isSaving}
        primaryButtonOnClick={handleSave}
        primaryButtonText={editingRole ? "Save role" : "Create role"}
        secondaryButtonOnClick={handleDismiss}
        secondaryButtonText="Cancel"
        size="lg"
        testID="admin-role-modal"
        testIDs={{primaryButton: "admin-role-save-button"}}
        title={editingRole ? `Edit ${editingRole.displayName}` : "Add role"}
        visible={isFormVisible}
      >
        <Box gap={3} testID="admin-role-form">
          {saveError ? (
            <Text color="error" testID="admin-role-save-error">
              {saveError}
            </Text>
          ) : null}
          <Box gap={4} maxHeight={360} overflow="scroll" padding={2}>
            <TextField
              disabled={Boolean(editingRole)}
              onChange={(value) => handleFieldChange("name", value)}
              testID="admin-role-name"
              title="Name"
              value={form.name}
            />
            <TextField
              onChange={(value) => handleFieldChange("displayName", value)}
              testID="admin-role-display-name"
              title="Display name"
              value={form.displayName}
            />
            <TextField
              onChange={(value) => handleFieldChange("description", value)}
              testID="admin-role-description"
              title="Description"
              value={form.description}
            />
            <Box gap={2} testID="admin-role-permissions">
              <Heading size="sm">Permissions</Heading>
              {hasAdminPageStatement &&
              isStatementActionVisible({
                action: ADMIN_PAGE_ACTION,
                isActionVisible,
                resource: ADMIN_PAGE_RESOURCE,
              }) ? (
                <Box gap={2} testID="admin-role-page-access">
                  <Heading size="sm">Admin page</Heading>
                  <Text>
                    This is the only permission that opens the admin panel. Model and tool
                    permissions do not apply until it is granted.
                  </Text>
                  <Box
                    accessibilityHint="Toggles whether this role can open the admin page"
                    accessibilityLabel="Allow access to the admin page"
                    alignItems="center"
                    direction="row"
                    gap={1}
                    onClick={() => handlePermissionToggle(ADMIN_PAGE_RESOURCE, ADMIN_PAGE_ACTION)}
                    testID={`admin-role-permission-${ADMIN_PAGE_RESOURCE}-${ADMIN_PAGE_ACTION}`}
                  >
                    <CheckBox
                      selected={
                        form.permissions[ADMIN_PAGE_RESOURCE]?.includes(ADMIN_PAGE_ACTION) ?? false
                      }
                    />
                    <Text>Allow access to the admin page</Text>
                  </Box>
                </Box>
              ) : null}
              {resources.map((resource) => {
                const actions = (statements[resource] ?? []).filter((action) =>
                  isStatementActionVisible({action, isActionVisible, resource})
                );
                if (actions.length === 0) {
                  return null;
                }
                const hasStandardAccess = STANDARD_ACCESS_ACTIONS.every((action) =>
                  actions.includes(action)
                );
                const customActions = editorActionsForResource({
                  actions,
                  hasStandardAccess,
                  resource,
                });
                if (!hasStandardAccess && customActions.length === 0) {
                  return null;
                }
                return (
                  <Box gap={1} key={resource}>
                    <Text bold>{resource}</Text>
                    {hasStandardAccess ? (
                      <SelectField
                        onChange={(value: string) => handleStandardAccessChange(resource, value)}
                        options={STANDARD_ACCESS_OPTIONS}
                        testID={`admin-role-access-${resource}`}
                        title="Access level"
                        value={standardAccessValue(form.permissions[resource] ?? [])}
                      />
                    ) : null}
                    <Box direction="row" gap={3} wrap>
                      {customActions.map((action) => {
                        const isSelected = form.permissions[resource]?.includes(action) ?? false;
                        const description = descriptionFor(statementDescriptions, resource, action);
                        return (
                          <Box
                            accessibilityHint={`Toggles the ${action} permission for ${resource}`}
                            accessibilityLabel={`${resource} ${action}`}
                            alignItems="center"
                            direction="row"
                            gap={1}
                            key={`${resource}:${action}`}
                            onClick={() => handlePermissionToggle(resource, action)}
                            testID={`admin-role-permission-${resource}-${action}`}
                          >
                            <CheckBox selected={isSelected} />
                            <Box>
                              <Text>{action}</Text>
                              {description ? (
                                <Text
                                  color="secondaryDark"
                                  size="sm"
                                  testID={`admin-role-permission-${resource}-${action}-description`}
                                >
                                  {description}
                                </Text>
                              ) : null}
                            </Box>
                          </Box>
                        );
                      })}
                    </Box>
                  </Box>
                );
              })}
            </Box>
          </Box>
        </Box>
      </Modal>
    </Box>
  );
};
