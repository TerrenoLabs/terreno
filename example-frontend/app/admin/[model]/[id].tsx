import {AdminModelForm} from "@terreno/admin-frontend";
import {Box, Button, Card, Text, TextField, useToast} from "@terreno/ui";
import {useLocalSearchParams} from "expo-router";
import React, {useCallback, useMemo, useState} from "react";
import {useSetAdminUserPasswordMutation} from "@/store/sdk";

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
    <Card color="base" padding={4}>
      <Box gap={3}>
        <Text bold size="lg">
          Set Password
        </Text>
        <Text color="secondaryDark" size="sm">
          This updates the password immediately for this user.
        </Text>
        <TextField
          onChange={setPassword}
          placeholder="Enter a new password"
          title="New Password"
          type="password"
          value={password}
        />
        <TextField
          onChange={setConfirmPassword}
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
      </Box>
    </Card>
  );
};

const AdminEditScreen: React.FC = () => {
  const {model, id} = useLocalSearchParams<{model: string; id: string}>();
  const footerContent = useMemo((): React.ReactNode => {
    if (model?.toLowerCase() !== "user") {
      return undefined;
    }
    return <AdminUserPasswordCard userId={id} />;
  }, [id, model]);

  return (
    <AdminModelForm
      baseUrl={ADMIN_BASE_URL}
      footerContent={footerContent}
      itemId={id}
      mode="edit"
      modelName={model}
    />
  );
};

export default AdminEditScreen;
