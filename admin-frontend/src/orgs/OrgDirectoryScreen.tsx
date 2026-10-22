import {
  Box,
  Button,
  DataTable,
  type DataTableCellData,
  type DataTableColumn,
  type DataTableCustomComponentMap,
  Modal,
  Spinner,
  Text,
  TextField,
} from "@terreno/ui";
import React, {useCallback, useMemo, useState} from "react";
import {AdminScreenPage} from "../AdminScreenPage";
import {normalizeListData} from "./normalizeListData";
import {useOrganizationsApi} from "./useOrganizationsApi";
import {useOptionalOrgContext} from "./useOrgContext";

export interface OrganizationSummary {
  _id: string;
  disabled?: boolean;
  name: string;
  slug?: string;
}

export interface OrgDirectoryScreenProps {
  basePath?: string;
  isOperator: boolean;
  onEnterOrganization: (organization: OrganizationSummary) => void;
  routeBase?: string;
}

const ACTION_COLUMN = "organizationActions";
const COLUMNS: DataTableColumn[] = [
  {columnType: "text", sortable: false, title: "Name", width: 240},
  {columnType: "text", sortable: false, title: "Slug", width: 180},
  {columnType: "text", sortable: false, title: "Status", width: 120},
  {columnType: ACTION_COLUMN, sortable: false, title: "", width: 220},
];

export const OrgDirectoryScreen: React.FC<OrgDirectoryScreenProps> = ({
  basePath,
  isOperator,
  onEnterOrganization,
  routeBase = "/admin",
}) => {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [actionError, setActionError] = useState<string>();
  const {useCreateMutation, useListQuery, useUpdateMutation} = useOrganizationsApi(basePath);
  const {data, error, isLoading} = useListQuery<OrganizationSummary>(undefined, {
    skip: !isOperator,
  });
  const [createOrganization, {isLoading: isCreating}] = useCreateMutation();
  const [updateOrganization, {isLoading: isUpdating}] = useUpdateMutation();
  const organizations = normalizeListData<OrganizationSummary>(data);
  const orgContext = useOptionalOrgContext();
  const handleEnterOrganization = useCallback(
    (organization: OrganizationSummary): void => {
      orgContext?.selectOrganization(organization);
      onEnterOrganization(organization);
    },
    [onEnterOrganization, orgContext]
  );

  const handleDismissCreate = useCallback((): void => {
    setIsCreateOpen(false);
    setName("");
    setActionError(undefined);
  }, []);

  const handleCreate = useCallback(async (): Promise<void> => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setActionError("Organization name is required.");
      return;
    }
    try {
      await createOrganization({name: trimmedName}).unwrap();
      handleDismissCreate();
    } catch {
      setActionError("Could not create organization.");
    }
  }, [createOrganization, handleDismissCreate, name]);

  const handleSetDisabled = useCallback(
    async (organization: OrganizationSummary, disabled: boolean): Promise<void> => {
      try {
        setActionError(undefined);
        await updateOrganization({
          body: {disabled},
          id: organization._id,
        }).unwrap();
      } catch {
        setActionError(
          disabled ? "Could not disable organization." : "Could not re-enable organization."
        );
      }
    },
    [updateOrganization]
  );

  const ActionsCell: React.FC<{
    cellData: DataTableCellData;
    column: DataTableColumn;
  }> = useCallback(
    ({cellData}) => {
      const organization = cellData.value as OrganizationSummary;
      return (
        <Box direction="row" gap={2}>
          <Button
            onClick={() => handleEnterOrganization(organization)}
            size="sm"
            text="Open"
            variant="outline"
          />
          <Button
            disabled={isUpdating}
            onClick={() => {
              void handleSetDisabled(organization, !organization.disabled);
            }}
            size="sm"
            text={organization.disabled ? "Re-enable" : "Disable"}
            variant="ghost"
          />
        </Box>
      );
    },
    [handleEnterOrganization, handleSetDisabled, isUpdating]
  );

  const customColumns: DataTableCustomComponentMap = useMemo(
    () => ({[ACTION_COLUMN]: ActionsCell}),
    [ActionsCell]
  );
  const rows = organizations.map((organization) => [
    {value: organization.name},
    {value: organization.slug ?? ""},
    {value: organization.disabled ? "Disabled" : "Active"},
    {value: organization},
  ]);

  if (!isOperator) {
    return null;
  }

  return (
    <AdminScreenPage backHref={routeBase} color="transparent" padding={0} title="Organizations">
      <Box gap={4} padding={4}>
        <Box alignItems="center" direction="row" justifyContent="between">
          <Text color="secondaryDark">Manage organizations and enter tenant context.</Text>
          <Button
            onClick={() => setIsCreateOpen(true)}
            testID="org-directory-create"
            text="Create organization"
          />
        </Box>
        {actionError ? (
          <Text color="error" testID="org-directory-action-error">
            {actionError}
          </Text>
        ) : null}
        {isLoading ? (
          <Box alignItems="center" padding={6} testID="org-directory-loading">
            <Spinner />
          </Box>
        ) : error ? (
          <Text color="error" testID="org-directory-error">
            Could not load organizations.
          </Text>
        ) : rows.length === 0 ? (
          <Text color="secondaryDark" testID="org-directory-empty">
            No organizations yet.
          </Text>
        ) : (
          <DataTable
            columns={COLUMNS}
            customColumnComponentMap={customColumns}
            data={rows}
            testID="org-directory-table"
          />
        )}
      </Box>
      <Modal
        onDismiss={handleDismissCreate}
        primaryButtonDisabled={isCreating}
        primaryButtonOnClick={handleCreate}
        primaryButtonText="Create"
        secondaryButtonOnClick={handleDismissCreate}
        secondaryButtonText="Cancel"
        testID="org-directory-create-modal"
        title="Create organization"
        visible={isCreateOpen}
      >
        <TextField onChange={setName} testID="org-directory-name" title="Name" value={name} />
      </Modal>
    </AdminScreenPage>
  );
};
