import {AdminModelForm, UserSecurityLink} from "@terreno/admin-frontend";
import {Box, Button, Card, FormContainer, Text, TextField, useToast} from "@terreno/ui";
import {useLocalSearchParams} from "expo-router";
import React, {useCallback, useMemo, useState} from "react";
import {adminApi, useGetMeQuery, useSetAdminUserPasswordMutation} from "@/store/sdk";
import {canManageUserSecurity} from "@/utils/userSecurityAccess";

const ADMIN_BASE_URL = "/admin";
const MIN_PASSWORD_LENGTH = 8;

interface AdminUserPasswordCardProps {
  userId?: string;
}

const AdminUserPasswordCard: React.FC<AdminUserPasswordCardProps> = ({userId}) => {
  const toast = useToast();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [setPasswordForUser, {isLoading}] = useSetAdminUserPasswordMutation();

  const handleSetPassword = useCallback(async (): Promise<void> => {
    if (!userId) {
      toast.error("User ID is missing");
      return;
    }
    if (!password || password.length < MIN_PASSWORD_LENGTH) {
      toast.error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      return;
    }
    if (password !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }

    try {
      await setPasswordForUser({id: userId, password}).unwrap();
      setPassword("");
      setConfirmPassword("");
      toast.success("Password updated");
    } catch (error) {
      toast.catch(error, "Failed to update password");
    }
  }, [confirmPassword, password, setPasswordForUser, toast, userId]);

  return (
    <Card color="base" padding={4} testID="admin-user-password-card">
      <FormContainer gap={3} onSubmit={handleSetPassword} testID="admin-user-password-form">
        <Text bold size="lg">
          Set Password
        </Text>
        <Text color="secondaryDark" size="sm">
          This updates the password immediately for this user.
        </Text>
        <TextField
          accessibilityLabel="New Password"
          autoComplete="new-password"
          onChange={setPassword}
          placeholder="Enter a new password"
          title="New Password"
          type="password"
          value={password}
        />
        <TextField
          accessibilityLabel="Confirm Password"
          autoComplete="new-password"
          onChange={setConfirmPassword}
          onEnter={handleSetPassword}
          placeholder="Re-enter the new password"
          title="Confirm Password"
          type="password"
          value={confirmPassword}
        />
        <Box alignItems="start">
          <Button
            loading={isLoading}
            onClick={handleSetPassword}
            text="Set Password"
            variant="primary"
          />
        </Box>
      </FormContainer>
    </Card>
  );
};

const AdminEditScreen: React.FC = () => {
  const {model, id} = useLocalSearchParams<{model: string; id: string}>();
  const {data: profile} = useGetMeQuery();
  // Recovery routes refuse self-targeting (D9); staff manage their own account from their own
  // security screen.
  const isOwnRecord = Boolean(id) && (profile?._id === id || profile?.id === id);
  const canOpenSecurity =
    !isOwnRecord &&
    canManageUserSecurity({admin: profile?.admin, permissions: profile?.permissions});
  // The set-password action is admin-only (Permissions.IsAdmin); operators who can open a user
  // record for security work would only see it fail.
  const canSetPassword = Boolean(profile?.admin);
  const footerContent = useMemo((): React.ReactNode => {
    if (model?.toLowerCase() !== "user") {
      return undefined;
    }
    return (
      <Box gap={4}>
        {canOpenSecurity && id ? <UserSecurityLink routeBase={ADMIN_BASE_URL} userId={id} /> : null}
        {canSetPassword ? <AdminUserPasswordCard userId={id} /> : null}
      </Box>
    );
  }, [canOpenSecurity, canSetPassword, id, model]);

  return (
    <AdminModelForm
      api={adminApi}
      baseUrl={ADMIN_BASE_URL}
      footerContent={footerContent}
      itemId={id}
      mode="edit"
      modelName={model}
    />
  );
};

export default AdminEditScreen;
