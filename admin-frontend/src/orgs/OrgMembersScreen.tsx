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

export interface OrgMembersScreenProps {
  basePath?: string;
  organizationId: string;
  routeBase?: string;
}

interface MembershipUser {
  _id?: string;
  email?: string;
  name?: string;
}

interface OrgMembership {
  _id: string;
  roleName: "member" | "org-admin";
  status: "active" | "suspended";
  userId: MembershipUser | string;
}

const ACTION_COLUMN = "organizationMemberActions";
const COLUMNS: DataTableColumn[] = [
  {columnType: "text", sortable: false, title: "Member", width: 240},
  {columnType: "text", sortable: false, title: "Email", width: 240},
  {columnType: "text", sortable: false, title: "Role", width: 130},
  {columnType: "text", sortable: false, title: "Status", width: 120},
  {columnType: ACTION_COLUMN, sortable: false, title: "", width: 320},
];

const mutationErrorTitle = (error: unknown, fallback: string): string => {
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

const membershipUser = (membership: OrgMembership): MembershipUser => {
  if (typeof membership.userId === "string") {
    return {_id: membership.userId};
  }
  return membership.userId;
};

export const OrgMembersScreen: React.FC<OrgMembersScreenProps> = ({
  basePath,
  organizationId,
  routeBase = "/admin",
}) => {
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [attachError, setAttachError] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const {
    useMemberAttachMutation,
    useMemberRemoveMutation,
    useMemberUpdateMutation,
    useMembersQuery,
  } = useOrganizationsApi(basePath);
  const {data, error, isLoading} = useMembersQuery<OrgMembership>(organizationId);
  const memberships = normalizeListData<OrgMembership>(data);
  const [attachMember, {isLoading: isAttaching}] = useMemberAttachMutation();
  const [updateMember, {isLoading: isUpdating}] = useMemberUpdateMutation();
  const [removeMember, {isLoading: isRemoving}] = useMemberRemoveMutation();
  const handleInvite = useCallback((): void => {}, []);

  const handleDismiss = useCallback((): void => {
    setIsAddOpen(false);
    setEmail("");
    setAttachError(undefined);
  }, []);

  const handleAttach = useCallback(async (): Promise<void> => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setAttachError("Email is required.");
      return;
    }
    try {
      setAttachError(undefined);
      await attachMember({
        body: {email: normalizedEmail, roleName: "member"},
        id: organizationId,
      }).unwrap();
      handleDismiss();
    } catch (mutationError) {
      setAttachError(mutationErrorTitle(mutationError, "Could not add member."));
    }
  }, [attachMember, email, handleDismiss, organizationId]);

  const handleToggleRole = useCallback(
    async (membership: OrgMembership): Promise<void> => {
      try {
        setActionError(undefined);
        await updateMember({
          body: {roleName: membership.roleName === "org-admin" ? "member" : "org-admin"},
          id: organizationId,
          memberId: membership._id,
        }).unwrap();
      } catch (mutationError) {
        setActionError(mutationErrorTitle(mutationError, "Could not update member."));
      }
    },
    [organizationId, updateMember]
  );

  const handleRemove = useCallback(
    async (membership: OrgMembership): Promise<void> => {
      try {
        setActionError(undefined);
        await removeMember({
          body: {},
          id: organizationId,
          memberId: membership._id,
        }).unwrap();
      } catch (mutationError) {
        setActionError(mutationErrorTitle(mutationError, "Could not remove member."));
      }
    },
    [organizationId, removeMember]
  );

  const ActionsCell: React.FC<{
    cellData: DataTableCellData;
    column: DataTableColumn;
  }> = useCallback(
    ({cellData}) => {
      const membership = cellData.value as OrgMembership;
      return (
        <Box direction="row" gap={2}>
          <Button
            disabled={isUpdating}
            onClick={() => {
              void handleToggleRole(membership);
            }}
            size="sm"
            text={membership.roleName === "org-admin" ? "Make member" : "Make org-admin"}
            variant="outline"
          />
          <Button
            disabled={isRemoving}
            onClick={() => {
              void handleRemove(membership);
            }}
            size="sm"
            text="Remove"
            variant="ghost"
          />
        </Box>
      );
    },
    [handleRemove, handleToggleRole, isRemoving, isUpdating]
  );
  const customColumns: DataTableCustomComponentMap = useMemo(
    () => ({[ACTION_COLUMN]: ActionsCell}),
    [ActionsCell]
  );
  const rows = memberships.map((membership) => {
    const user = membershipUser(membership);
    return [
      {value: user.name ?? user.email ?? user._id ?? "Unknown user"},
      {value: user.email ?? ""},
      {value: membership.roleName},
      {value: membership.status},
      {value: membership},
    ];
  });

  return (
    <AdminScreenPage
      backHref={`${routeBase}/orgs/${organizationId}`}
      color="transparent"
      maxWidth="100%"
      padding={0}
      title="Organization members"
    >
      <Box gap={4} padding={4}>
        <Box direction="row" gap={2} justifyContent="end">
          <Button disabled onClick={handleInvite} text="Invite" variant="outline" />
          <Button
            onClick={() => setIsAddOpen(true)}
            testID="org-members-add"
            text="Add existing user"
          />
        </Box>
        <Text color="secondaryDark">Invitations will be available in a future release.</Text>
        {actionError ? (
          <Text color="error" testID="org-members-action-error">
            {actionError}
          </Text>
        ) : null}
        {isLoading ? (
          <Box alignItems="center" padding={6}>
            <Spinner />
          </Box>
        ) : error ? (
          <Text color="error">Could not load organization members.</Text>
        ) : rows.length === 0 ? (
          <Text color="secondaryDark">No members yet.</Text>
        ) : (
          <DataTable
            columns={COLUMNS}
            customColumnComponentMap={customColumns}
            data={rows}
            testID="org-members-table"
          />
        )}
      </Box>
      <Modal
        onDismiss={handleDismiss}
        primaryButtonDisabled={isAttaching}
        primaryButtonOnClick={handleAttach}
        primaryButtonText="Add member"
        secondaryButtonOnClick={handleDismiss}
        secondaryButtonText="Cancel"
        testID="org-members-add-modal"
        title="Add existing user"
        visible={isAddOpen}
      >
        <Box gap={2}>
          <TextField onChange={setEmail} testID="org-members-email" title="Email" value={email} />
          {attachError ? (
            <Text color="error" testID="org-members-attach-error">
              {attachError}
            </Text>
          ) : null}
        </Box>
      </Modal>
    </AdminScreenPage>
  );
};
