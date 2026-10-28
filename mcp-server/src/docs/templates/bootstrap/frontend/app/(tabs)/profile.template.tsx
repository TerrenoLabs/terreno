import {useSession} from "@terreno/syncdb/auth";
import {Box, Button, Card, Heading, Page, Spinner, TapToEdit, Text, TextField} from "@terreno/ui";
import type React from "react";
import {useCallback, useEffect, useMemo, useState} from "react";
import {useGetAuthMeQuery, usePatchAuthMeMutation} from "@/store/apiSdk";

const ProfileScreen: React.FC = () => {
  const {logout} = useSession();
  const {data: user, isLoading} = useGetAuthMeQuery();
  const [updateProfile] = usePatchAuthMeMutation();
  const [name, setName] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [currentPassword, setCurrentPassword] = useState<string>("");
  const [saveError, setSaveError] = useState<string | null>(null);

  // Copy the server name into local state without resetting an in-progress email edit.
  useEffect(() => {
    if (!user) {
      return;
    }
    setName(user.name || "");
  }, [user?.name]);

  // Copy the server email into local state without resetting an in-progress name edit.
  useEffect(() => {
    if (!user) {
      return;
    }
    setEmail(user.email || "");
  }, [user?.email]);

  // logout signs syncDb out, then Better Auth, and clears cached API responses.
  const handleLogout = useCallback(async (): Promise<void> => {
    await logout();
  }, [logout]);

  const handleSaveName = useCallback(
    async (value: string): Promise<void> => {
      setSaveError(null);
      try {
        await updateProfile({name: value}).unwrap();
      } catch (err) {
        console.error("Error updating name:", err);
        setSaveError("Failed to update name");
      }
    },
    [updateProfile]
  );

  // Changing the email needs the current password; an unchanged or re-cased email does not.
  const isEmailChanged = useMemo(
    (): boolean => email.trim().toLowerCase() !== (user?.email ?? "").trim().toLowerCase(),
    [email, user?.email]
  );

  const handleSaveEmail = useCallback(
    async (value: string): Promise<void> => {
      setSaveError(null);
      try {
        const body = isEmailChanged ? {currentPassword, email: value} : {email: value};
        await updateProfile(body).unwrap();
        setCurrentPassword("");
      } catch (err) {
        console.error("Error updating email:", err);
        setSaveError(
          (err as {data?: {message?: string}})?.data?.message || "Failed to update email"
        );
      }
    },
    [currentPassword, isEmailChanged, updateProfile]
  );

  const handleSavePassword = useCallback(
    async (value: string): Promise<void> => {
      if (!value) {
        return;
      }
      setSaveError(null);
      try {
        await updateProfile({password: value}).unwrap();
        setPassword("");
      } catch (err) {
        console.error("Error updating password:", err);
        setSaveError("Failed to update password");
      }
    },
    [updateProfile]
  );

  if (isLoading) {
    return (
      <Page navigation={undefined} title="Profile">
        <Box alignItems="center" flex="grow" justifyContent="center" padding={4}>
          <Spinner />
        </Box>
      </Page>
    );
  }

  return (
    <Page navigation={undefined} scroll title="Profile">
      <Box gap={4} padding={4}>
        <Heading>Profile</Heading>
        <Card>
          <Box gap={4}>
            <TapToEdit
              onSave={handleSaveName}
              setValue={setName}
              title="Name"
              type="text"
              value={name}
            />
            <TapToEdit
              onSave={handleSaveEmail}
              setValue={setEmail}
              title="Email"
              type="email"
              value={email}
            />
            {isEmailChanged && (
              <TextField
                helperText="Enter your current password to change your email"
                onChange={setCurrentPassword}
                testID="profile-current-password-input"
                title="Current password"
                type="password"
                value={currentPassword}
              />
            )}
            <TapToEdit
              helperText="Leave blank to keep your current password"
              onSave={handleSavePassword}
              setValue={setPassword}
              title="New Password"
              type="password"
              value={password}
            />
            {saveError && <Text color="error">{saveError}</Text>}
          </Box>
        </Card>
        <Box marginTop={4}>
          <Button fullWidth onClick={handleLogout} text="Logout" variant="outline" />
        </Box>
      </Box>
    </Page>
  );
};

export default ProfileScreen;
