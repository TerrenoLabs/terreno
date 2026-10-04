import {useBooleanFlagDetails} from "@openfeature/react-sdk";
import {canOpenAdminPage, selectBetterAuthUserId, useFeatureFlags} from "@terreno/rtk";
import {
  Badge,
  Banner,
  Box,
  Button,
  Card,
  Heading,
  Page,
  Spinner,
  TapToEdit,
  Text,
  TextField,
  useStoredState,
  useTheme,
} from "@terreno/ui";
import {useRouter} from "expo-router";
import type React from "react";
import {useCallback, useEffect, useMemo, useState} from "react";
import {useSelector} from "react-redux";
import {logout, useAppDispatch} from "@/store/index";
import {
  terrenoApi,
  useGetMeQuery,
  usePatchMeMutation,
  usePostAuthSendVerificationMutation,
  usePostCommsDevTestPushMutation,
} from "@/store/sdk";

const ProfileScreen: React.FC = () => {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const userId = useSelector(selectBetterAuthUserId);
  const {data: profileResponse, isLoading, refetch} = useGetMeQuery(undefined, {skip: !userId});
  const [updateProfile, {isLoading: isUpdating}] = usePatchMeMutation();
  const [sendVerification, {isLoading: isSendingVerification}] =
    usePostAuthSendVerificationMutation();
  const [sendTestPush, {isLoading: isSendingTestPush}] = usePostCommsDevTestPushMutation();
  const {setPrimitives, resetTheme} = useTheme();

  const {
    flags,
    getFlag,
    isLoading: isFeatureFlagsLoading,
    error: featureFlagsError,
  } = useFeatureFlags(terrenoApi, {skip: !userId, userId});
  const darkModeFlagDetails = useBooleanFlagDetails("dark-mode-toggle", false);
  const showDarkModeToggle = getFlag("dark-mode-toggle");
  const featureFlagEntries = useMemo(
    (): Array<{key: string; value: boolean | string | null}> =>
      Object.keys(flags)
        .sort((left, right) => left.localeCompare(right))
        .map((key) => ({key, value: flags[key]})),
    [flags]
  );

  const profile = profileResponse;

  const [name, setName] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [testPushMessage, setTestPushMessage] = useState<string | null>(null);
  const [testPushError, setTestPushError] = useState<string | null>(null);
  const [verificationMessage, setVerificationMessage] = useState<string | null>(null);
  const [verificationError, setVerificationError] = useState<string | null>(null);

  // API key management
  const [geminiApiKey, setGeminiApiKey] = useStoredState<string>("geminiApiKey", "");
  const [apiKeyInput, setApiKeyInput] = useState<string>("");
  const [apiKeySaved, setApiKeySaved] = useState<boolean>(false);

  // Copy the server name into local state without resetting an in-progress email edit.
  useEffect(() => {
    if (!profile) {
      return;
    }
    setName(profile.name || "");
  }, [profile?.name]);

  // Copy the server email into local state without resetting an in-progress name edit.
  useEffect(() => {
    if (!profile) {
      return;
    }
    setEmail(profile.email || "");
  }, [profile?.email]);

  // Sync API key input with stored value
  useEffect(() => {
    if (geminiApiKey) {
      setApiKeyInput(geminiApiKey);
    }
  }, [geminiApiKey]);

  const showSaveSuccess = useCallback((): void => {
    setSaveSuccess(true);
    refetch();
    setTimeout(() => {
      setSaveSuccess(false);
    }, 3000);
  }, [refetch]);

  const handleSaveName = useCallback(
    async (value: string): Promise<void> => {
      setSaveError(null);
      setSaveSuccess(false);
      try {
        await updateProfile({name: value}).unwrap();
        showSaveSuccess();
      } catch (err) {
        console.error("Error updating name:", err);
        setSaveError(
          (err as {data?: {message?: string}})?.data?.message || "Failed to update name"
        );
      }
    },
    [showSaveSuccess, updateProfile]
  );

  const handleSaveEmail = useCallback(
    async (value: string): Promise<void> => {
      setSaveError(null);
      setSaveSuccess(false);
      try {
        await updateProfile({email: value}).unwrap();
        showSaveSuccess();
      } catch (err) {
        console.error("Error updating email:", err);
        setSaveError(
          (err as {data?: {message?: string}})?.data?.message || "Failed to update email"
        );
      }
    },
    [showSaveSuccess, updateProfile]
  );

  const handleSavePassword = useCallback(
    async (value: string): Promise<void> => {
      if (!value) {
        return;
      }
      setSaveError(null);
      setSaveSuccess(false);
      try {
        await updateProfile({password: value}).unwrap();
        setPassword("");
        showSaveSuccess();
      } catch (err) {
        console.error("Error updating password:", err);
        setSaveError(
          (err as {data?: {message?: string}})?.data?.message || "Failed to update password"
        );
      }
    },
    [showSaveSuccess, updateProfile]
  );

  const handleLogout = useCallback((): void => {
    dispatch(logout());
  }, [dispatch]);

  const handleResendVerification = useCallback(async (): Promise<void> => {
    setVerificationError(null);
    setVerificationMessage(null);
    try {
      await sendVerification().unwrap();
      setVerificationMessage("Verification email sent. Check your inbox or the server console.");
    } catch (error: unknown) {
      console.error("Failed to send verification email", error);
      setVerificationError("Could not send a verification email.");
    }
  }, [sendVerification]);

  const handleSaveApiKey = useCallback((): void => {
    setGeminiApiKey(apiKeyInput.trim());
    setApiKeySaved(true);
    setTimeout(() => {
      setApiKeySaved(false);
    }, 3000);
  }, [apiKeyInput, setGeminiApiKey]);

  const handleClearApiKey = useCallback((): void => {
    setGeminiApiKey("");
    setApiKeyInput("");
    setApiKeySaved(false);
  }, [setGeminiApiKey]);

  const handleNavigateToAdmin = useCallback((): void => {
    router.push("/admin");
  }, [router]);

  const handleNavigateToMcp = useCallback((): void => {
    router.push("/settings/mcp");
  }, [router]);

  const handleNavigateToNotificationSettings = useCallback((): void => {
    router.push("/settings/notifications");
  }, [router]);

  const handleSendTestPush = useCallback(async (): Promise<void> => {
    setTestPushError(null);
    setTestPushMessage(null);
    try {
      const result = await sendTestPush({
        body: "Sent from the example app profile screen.",
        title: "Terreno test push",
      }).unwrap();
      if (result.tokenCount === 0) {
        setTestPushMessage("No registered push tokens for this account.");
        return;
      }
      setTestPushMessage(`Accepted ${result.accepted} of ${result.tokenCount} device token(s).`);
    } catch (error: unknown) {
      console.error("Failed to send test push", error);
      setTestPushError("Could not send a test push.");
    }
  }, [sendTestPush]);

  const handleEditRoles = useCallback((): void => {
    router.push("/admin/roles");
  }, [router]);

  const roles = useMemo(() => [...(profile?.roles ?? [])].sort(), [profile?.roles]);
  const isSuperAdmin = roles.includes("superadmin");
  const isAdmin = canOpenAdminPage({
    admin: profile?.admin,
    permissions: profile?.permissions,
  });

  if (isLoading) {
    return (
      <Page navigation={undefined}>
        <Box alignItems="center" flex="grow" justifyContent="center">
          <Spinner />
        </Box>
      </Page>
    );
  }

  return (
    <Page navigation={undefined} scroll>
      <Box padding={4}>
        <Box marginBottom={6}>
          <Heading size="xl">Profile</Heading>
        </Box>

        {profile?.emailVerified !== true && (
          <Box marginBottom={6} testID="profile-verify-email-banner">
            <Banner
              buttonIconName="envelope"
              buttonOnClick={handleResendVerification}
              buttonText={isSendingVerification ? "Sending…" : "Resend"}
              hasIcon
              status="warning"
              text="Verify your email to keep this account recoverable."
            />
            {verificationMessage && (
              <Box marginTop={2} testID="profile-verify-email-sent">
                <Text color="success">{verificationMessage}</Text>
              </Box>
            )}
            {verificationError && (
              <Box marginTop={2} testID="profile-verify-email-error">
                <Text color="error">{verificationError}</Text>
              </Box>
            )}
          </Box>
        )}

        <Card marginBottom={6}>
          <Box gap={4}>
            <Heading size="lg">Account Details</Heading>

            <TapToEdit
              disabled={isUpdating}
              editable={!isUpdating}
              onSave={handleSaveName}
              setValue={setName}
              testID="profile-name-input"
              title="Name"
              type="text"
              value={name}
            />

            <TapToEdit
              disabled={isUpdating}
              editable={!isUpdating}
              onSave={handleSaveEmail}
              setValue={setEmail}
              testID="profile-email-input"
              title="Email"
              type="email"
              value={email}
            />

            <TapToEdit
              disabled={isUpdating}
              editable={!isUpdating}
              helperText="Leave blank to keep current password"
              onSave={handleSavePassword}
              setValue={setPassword}
              testID="profile-password-input"
              title="New Password"
              type="password"
              value={password}
            />

            {saveSuccess && (
              <Box testID="profile-save-success">
                <Text color="success">Profile updated successfully!</Text>
              </Box>
            )}

            {saveError && (
              <Box testID="profile-save-error">
                <Text color="error">{saveError}</Text>
              </Box>
            )}
          </Box>
        </Card>

        <Card marginBottom={6} testID="profile-roles-card">
          <Box gap={4}>
            <Box alignItems="center" direction="row" justifyContent="between" wrap>
              <Heading size="lg">Roles</Heading>
              {isSuperAdmin && (
                <Button
                  iconName="pen"
                  onClick={handleEditRoles}
                  testID="profile-edit-roles-button"
                  text="Edit roles"
                  variant="outline"
                />
              )}
            </Box>
            {roles.length === 0 ? (
              <Text color="secondaryLight" testID="profile-roles-empty">
                No roles assigned.
              </Text>
            ) : (
              <Box direction="row" gap={2} testID="profile-roles-list" wrap>
                {roles.map((role) => (
                  <Badge key={role} value={role} />
                ))}
              </Box>
            )}
          </Box>
        </Card>

        <Card marginBottom={6}>
          <Box gap={4}>
            <Heading size="lg">Gemini API Key</Heading>
            <Text color="secondaryLight" size="sm">
              Paste your Gemini API key to enable AI chat and the admin prompt playground. The key
              is stored locally on your device.
            </Text>
            <TextField
              onChange={setApiKeyInput}
              placeholder="Enter your Gemini API key"
              testID="profile-gemini-key-input"
              title="API Key"
              type="password"
              value={apiKeyInput}
            />
            {apiKeySaved && (
              <Box testID="profile-gemini-saved-text">
                <Text color="success">API key saved!</Text>
              </Box>
            )}
            <Box direction="row" gap={2}>
              <Button
                disabled={!apiKeyInput.trim()}
                iconName="check"
                onClick={handleSaveApiKey}
                testID="profile-gemini-save-button"
                text="Save Key"
              />
              <Button
                disabled={!geminiApiKey}
                iconName="trash"
                onClick={handleClearApiKey}
                testID="profile-gemini-clear-button"
                text="Clear Key"
                variant="destructive"
              />
            </Box>
          </Box>
        </Card>

        {/* Dark mode toggle — gated by "dark-mode-toggle" feature flag */}
        {showDarkModeToggle && (
          <Card marginBottom={6} testID="profile-dark-mode-card">
            <Box gap={4}>
              <Heading size="lg">Appearance</Heading>
              <Box direction="row" gap={3}>
                <Button
                  iconName="sun"
                  onClick={() => resetTheme()}
                  text="Light"
                  variant="outline"
                />
                <Button
                  iconName="moon"
                  onClick={() =>
                    setPrimitives({
                      neutral000: "#1a1a2e",
                      neutral100: "#16213e",
                      neutral200: "#0f3460",
                      neutral800: "#e0e0e0",
                      neutral900: "#ffffff",
                    })
                  }
                  text="Dark"
                  variant="outline"
                />
              </Box>
            </Box>
          </Card>
        )}

        <Card marginBottom={6} testID="profile-feature-flags-card">
          <Box gap={3}>
            <Heading size="lg">Feature Flags</Heading>
            <Text color="secondaryLight" size="sm">
              OpenFeature sample: &quot;dark-mode-toggle&quot; → value{" "}
              {String(darkModeFlagDetails.value)} (reason:{" "}
              {String(darkModeFlagDetails.reason ?? "")})
            </Text>
            {isFeatureFlagsLoading && <Text color="secondaryLight">Loading feature flags...</Text>}
            {!isFeatureFlagsLoading && featureFlagsError && (
              <Text color="error">Failed to load feature flags</Text>
            )}
            {!isFeatureFlagsLoading && !featureFlagsError && featureFlagEntries.length === 0 && (
              <Text color="secondaryLight">No feature flags evaluated for this user.</Text>
            )}
            {!isFeatureFlagsLoading &&
              !featureFlagsError &&
              featureFlagEntries.map((flagEntry) => (
                <Box
                  alignItems="center"
                  direction="row"
                  justifyContent="between"
                  key={flagEntry.key}
                  paddingY={1}
                >
                  <Text>{flagEntry.key}</Text>
                  <Text color="secondaryLight">{String(flagEntry.value)}</Text>
                </Box>
              ))}
          </Box>
        </Card>

        {__DEV__ && (
          <Card marginBottom={6} testID="profile-test-push-card">
            <Box gap={4}>
              <Heading size="lg">Push notifications</Heading>
              <Text color="secondaryLight" size="sm">
                Native builds register an Expo push token after login. Send a test notification to
                this account&apos;s registered devices.
              </Text>
              {testPushMessage && (
                <Box testID="profile-test-push-success">
                  <Text color="success">{testPushMessage}</Text>
                </Box>
              )}
              {testPushError && (
                <Box testID="profile-test-push-error">
                  <Text color="error">{testPushError}</Text>
                </Box>
              )}
              <Button
                iconName="bell"
                loading={isSendingTestPush}
                onClick={handleSendTestPush}
                testID="profile-test-push-button"
                text="Send test push"
              />
            </Box>
          </Card>
        )}

        <Card marginBottom={6}>
          <Box gap={4}>
            <Heading size="lg">Session</Heading>
            <Text color="secondaryLight" testID="profile-logged-in-as">
              Logged in as {profile?.email}
            </Text>
            <Button
              iconName="right-from-bracket"
              onClick={handleLogout}
              testID="profile-logout-button"
              text="Logout"
              variant="destructive"
            />
            <Button
              iconName="bell"
              onClick={handleNavigateToNotificationSettings}
              testID="profile-notification-settings-button"
              text="Notification preferences"
              variant="secondary"
            />
            <Button
              iconName="plug"
              onClick={handleNavigateToMcp}
              testID="profile-mcp-button"
              text="MCP connections"
              variant="secondary"
            />
          </Box>
        </Card>

        {isAdmin && (
          <Card marginBottom={6}>
            <Box gap={4}>
              <Heading size="lg">Developer</Heading>
              <Button
                iconName="gear"
                onClick={handleNavigateToAdmin}
                testID="profile-admin-button"
                text="Admin Panel"
                variant="secondary"
              />
            </Box>
          </Card>
        )}
      </Box>
    </Page>
  );
};

export default ProfileScreen;
