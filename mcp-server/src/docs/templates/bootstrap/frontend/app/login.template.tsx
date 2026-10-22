import {useSession} from "@terreno/syncdb/auth";
import {baseUrl} from "@terreno/syncdb/config";
import {LoginScreen} from "@terreno/ui";
import {useRouter} from "expo-router";
import type React from "react";
import {useCallback, useState} from "react";
import {betterAuthClient} from "@/lib/betterAuth";

const Login: React.FC = () => {
  const router = useRouter();
  const {refresh} = useSession();
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = useCallback(
    async (values: Record<string, string>): Promise<void> => {
      const {email, password} = values;
      setErrorMessage(undefined);
      setIsSubmitting(true);
      try {
        const result = await betterAuthClient.signIn.email({email, password});
        if (result.error) {
          setErrorMessage(result.error.message ?? "Sign in failed.");
          return;
        }
        // Resolve the new session now instead of waiting for the next session push.
        await refresh();
        router.replace("/(tabs)");
      } catch (error: unknown) {
        console.error("[login] Sign in threw", {baseUrl, error});
        setErrorMessage("Sign in failed. Please try again.");
      } finally {
        setIsSubmitting(false);
      }
    },
    [refresh, router]
  );

  return (
    <LoginScreen
      error={errorMessage}
      fields={[
        {autoComplete: "off", label: "Email", name: "email", required: true, type: "email"},
        {label: "Password", name: "password", required: true, type: "password"},
      ]}
      loading={isSubmitting}
      onSignUpPress={() => router.push("/signup")}
      onSubmit={handleSubmit}
      title="Welcome"
    />
  );
};

export default Login;
