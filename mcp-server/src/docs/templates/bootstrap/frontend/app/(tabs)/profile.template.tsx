import {Box, Button, Card, Heading, Page, Spinner, TapToEdit, Text, TextField} from "@terreno/ui";
import type React from "react";
import {useCallback, useEffect, useMemo, useState} from "react";
import {signOut} from "@/lib/betterAuth";
import {logout, syncBetterAuthSession, useAppDispatch} from "@/store/index";
import {useGetMeQuery, usePatchMeMutation} from "@/store/sdk";

const ProfileScreen: React.FC = () => {
  const dispatch = useAppDispatch();
  const {data: profile, isLoading} = useGetMeQuery();
  const [updateProfile] = usePatchMeMutation();
  const [name, setName] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [currentPassword, setCurrentPassword] = useState<string>("");
  const [saveError, setSaveError] = useState<string | null>(null);

  const user = profile?.data;

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

  const handleLogout = useCallback(async (): Promise<void> => {
    await signOut();
    dispatch(logout());
    await syncBetterAuthSession(dispatch);
  }, [dispatch]);

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
