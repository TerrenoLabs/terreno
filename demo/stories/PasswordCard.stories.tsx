import type {PasswordCardSubmission} from "@terreno/ui";
import {Box, PasswordCard} from "@terreno/ui";
import {type ReactElement, useCallback, useState} from "react";

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Accepts the current password "password123"; any other current password is rejected. */
export const PasswordCardChange: React.FC = (): ReactElement => {
  const handleSubmit = useCallback(async (values: PasswordCardSubmission): Promise<void> => {
    await wait(500);
    if (values.currentPassword !== "password123") {
      throw new Error("Your current password is incorrect.");
    }
  }, []);

  return (
    <Box maxWidth={560} width="100%">
      <PasswordCard hasPassword onSubmit={handleSubmit} />
    </Box>
  );
};

/** An OAuth-only user sets a first password, and the card switches to change mode. */
export const PasswordCardSet: React.FC = (): ReactElement => {
  const [hasPassword, setHasPassword] = useState(false);

  const handleSubmit = useCallback(async (): Promise<void> => {
    await wait(500);
    setHasPassword(true);
  }, []);

  return (
    <Box maxWidth={560} width="100%">
      <PasswordCard hasPassword={hasPassword} onSubmit={handleSubmit} />
    </Box>
  );
};

export const PasswordCardError: React.FC = (): ReactElement => {
  return (
    <Box maxWidth={560} width="100%">
      <PasswordCard
        error="Your current password is incorrect."
        hasPassword
        onSubmit={async (): Promise<void> => {}}
      />
    </Box>
  );
};

export const PasswordCardLoading: React.FC = (): ReactElement => {
  return (
    <Box maxWidth={560} width="100%">
      <PasswordCard hasPassword loading onSubmit={async (): Promise<void> => {}} />
    </Box>
  );
};
