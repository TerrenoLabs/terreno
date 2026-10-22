import {Box, Button, Card, Heading, Page, Spinner, TapToEdit, Text} from "@terreno/ui";
import type React from "react";
import {useCallback, useEffect, useState} from "react";
import {signOut} from "@/lib/betterAuth";
import {logout, syncBetterAuthSession, useAppDispatch} from "@/store/index";
import {useGetMeQuery, usePatchMeMutation} from "@/store/sdk";

const ProfileScreen: React.FC = () => {
  const dispatch = useAppDispatch();
  const {data: profile, isLoading} = useGetMeQuery();
  const [updateProfile] = usePatchMeMutation();
  const [name, setName] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
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

  const handleSaveEmail = useCallback(
    async (value: string): Promise<void> => {
      setSaveError(null);
      try {
        await updateProfile({email: value}).unwrap();
      } catch (err) {
        console.error("Error updating email:", err);
        setSaveError("Failed to update email");
      }
    },
    [updateProfile]
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
            <TapToEdit
              autoComplete="new-password"
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
