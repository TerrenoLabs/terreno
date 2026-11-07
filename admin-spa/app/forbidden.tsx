import {useSession} from "@terreno/syncdb/auth";
import {Box, Button, Heading, Text} from "@terreno/ui";
import {useRouter} from "expo-router";
import React, {useCallback, useState} from "react";

const ForbiddenScreen: React.FC = () => {
  const router = useRouter();
  const {logout} = useSession();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = useCallback(async (): Promise<void> => {
    setIsSigningOut(true);
    try {
      // logout() signs out of Better Auth, drops cached requests, and clears the session.
      await logout();
      router.replace("/login");
    } catch (error) {
      console.error("Forbidden: sign-out failed", error);
    } finally {
      setIsSigningOut(false);
    }
  }, [logout, router]);

  return (
    <Box
      alignItems="center"
      color="base"
      flex="grow"
      gap={4}
      justifyContent="center"
      padding={6}
      testID="admin-spa-forbidden-screen"
    >
      <Heading align="center" size="lg">
        Admins only
      </Heading>
      <Text align="center" color="secondaryDark">
        You must be an admin to access this page.
      </Text>
      <Button
        loading={isSigningOut}
        onClick={handleSignOut}
        testID="admin-spa-forbidden-signout"
        text="Sign out"
        variant="secondary"
      />
    </Box>
  );
};

export default ForbiddenScreen;
