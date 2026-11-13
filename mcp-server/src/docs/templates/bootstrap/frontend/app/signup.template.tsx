import {useSession} from "@terreno/syncdb/auth";
import {SignUpScreen, simplePasswordRequirements} from "@terreno/ui";
import {useRouter} from "expo-router";
import type React from "react";
import {useCallback, useState} from "react";
import {betterAuthClient} from "@/lib/betterAuth";

const SignUp: React.FC = () => {
  const router = useRouter();
  const {refresh} = useSession();
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = useCallback(
    async (values: Record<string, string>): Promise<void> => {
      const {email, password, name} = values;
      setErrorMessage(undefined);
      setIsSubmitting(true);
      try {
        const result = await betterAuthClient.signUp.email({email, name, password});
        if (result.error) {
          setErrorMessage(result.error.message ?? "Sign up failed.");
          return;
        }
        // Resolve the new session now instead of waiting for the next session push.
        await refresh();
        router.replace("/(tabs)");
      } catch {
        setErrorMessage("Sign up failed. Please try again.");
      } finally {
        setIsSubmitting(false);
      }
    },
    [refresh, router]
  );

  return (
    <SignUpScreen
      error={errorMessage}
      fields={[
        {label: "Name", name: "name", required: true, type: "text"},
        {autoComplete: "off", label: "Email", name: "email", required: true, type: "email"},
        {label: "Password", name: "password", required: true, type: "password"},
      ]}
      loading={isSubmitting}
      onLoginPress={() => router.back()}
      onSubmit={handleSubmit}
      passwordRequirements={simplePasswordRequirements}
    />
  );
};

export default SignUp;
