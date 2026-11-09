import {type AdminFieldValue, AdminModelForm} from "@terreno/admin-frontend";
import {Card, FormContainer, Text, TextField, useToast} from "@terreno/ui";
import {useLocalSearchParams} from "expo-router";
import React, {useCallback, useMemo, useState} from "react";
import {useAdminUsersPasswordMutation} from "@/store/apiSdk";

const ADMIN_BASE_URL = "/admin";
const MIN_PASSWORD_LENGTH = 8;

interface UserPasswordState {
  password: string;
  confirmPassword: string;
}

const UserCreatePasswordCard: React.FC<{
  value: UserPasswordState;
  onChange: (value: UserPasswordState) => void;
}> = ({value, onChange}) => {
  const handlePasswordChange = useCallback(
    (password: string): void => {
      onChange({...value, password});
    },
    [onChange, value]
  );
  const handleConfirmPasswordChange = useCallback(
    (confirmPassword: string): void => {
      onChange({...value, confirmPassword});
    },
    [onChange, value]
  );

  return (
    <Card color="base" padding={4}>
      <FormContainer gap={3} testID="admin-user-create-password-form">
        <Text bold size="lg">
          Initial Password
        </Text>
        <Text color="secondaryDark" size="sm">
          Optional. Leave blank to create the user without setting a password here.
        </Text>
        <TextField
          accessibilityLabel="Password"
          autoComplete="new-password"
          onChange={handlePasswordChange}
          placeholder="Enter a password"
          title="Password"
          type="password"
          value={value.password}
        />
        <TextField
          accessibilityLabel="Confirm Password"
          autoComplete="new-password"
          onChange={handleConfirmPasswordChange}
          placeholder="Re-enter password"
          title="Confirm Password"
          type="password"
          value={value.confirmPassword}
        />
      </FormContainer>
    </Card>
  );
};

const AdminCreateScreen: React.FC = () => {
  const {model} = useLocalSearchParams<{model: string}>();
  const toast = useToast();
  const [passwordState, setPasswordState] = useState<UserPasswordState>({
    confirmPassword: "",
    password: "",
  });
  const [setPasswordForUser] = useAdminUsersPasswordMutation();
  const isUserModel = model?.toLowerCase() === "user";

  const footerContent = useMemo((): React.ReactNode => {
    if (!isUserModel) {
      return undefined;
    }
    return <UserCreatePasswordCard onChange={setPasswordState} value={passwordState} />;
  }, [isUserModel, passwordState]);

  const transformPayload = useCallback(
    ({
      payload,
    }: {
      mode: "create" | "edit";
      payload: Record<string, unknown>;
    }): Record<string, unknown> => {
      if (!isUserModel) {
        return payload;
      }
      if (!passwordState.password && !passwordState.confirmPassword) {
        return payload;
      }
      if (passwordState.password.length < MIN_PASSWORD_LENGTH) {
        throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      }
      if (passwordState.password !== passwordState.confirmPassword) {
        throw new Error("Passwords do not match");
      }
      return payload;
    },
    [isUserModel, passwordState.confirmPassword, passwordState.password]
  );

  const onSaveSuccess = useCallback(
    async ({result}: {result: AdminFieldValue}): Promise<void> => {
      if (!isUserModel || !passwordState.password) {
        return;
      }
      const createdUser = result as {_id?: string; data?: {_id?: string}};
      const userId = createdUser.data?._id ?? createdUser._id;
      if (!userId) {
        throw new Error("User created but missing ID for password setup");
      }
      await setPasswordForUser({body: {password: passwordState.password}, id: userId}).unwrap();
      setPasswordState({confirmPassword: "", password: ""});
      toast.success("User password set");
    },
    [isUserModel, passwordState.password, setPasswordForUser, toast]
  );

  return (
    <AdminModelForm
      baseUrl={ADMIN_BASE_URL}
      footerContent={footerContent}
      mode="create"
      modelName={model}
      onSaveSuccess={onSaveSuccess}
      transformPayload={transformPayload}
    />
  );
};

export default AdminCreateScreen;
