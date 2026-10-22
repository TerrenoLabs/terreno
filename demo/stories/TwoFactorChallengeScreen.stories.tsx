import type {TwoFactorChallengeSubmission} from "@terreno/ui";
import {TwoFactorChallengeScreen} from "@terreno/ui";
import {type ReactElement, useCallback, useState} from "react";

const noop = async (): Promise<void> => {};

/** Accepts "123456" or any backup code; every other TOTP code shows the error state. */
export const TwoFactorChallengeScreenDemo: React.FC = (): ReactElement => {
  const [error, setError] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback(async (values: TwoFactorChallengeSubmission): Promise<void> => {
    setLoading(true);
    await new Promise((resolve) => setTimeout(resolve, 400));
    setLoading(false);
    if (values.kind === "totp" && values.code !== "123456") {
      setError("That code didn't work. Check your authenticator app and try again.");
      return;
    }
    setError(undefined);
  }, []);

  return (
    <TwoFactorChallengeScreen
      error={error}
      loading={loading}
      onCancel={() => {}}
      onSubmit={handleSubmit}
      trustDeviceDays={30}
    />
  );
};

export const TwoFactorChallengeScreenBackupCode: React.FC = (): ReactElement => {
  return <TwoFactorChallengeScreen initialKind="backup" onSubmit={noop} />;
};

export const TwoFactorChallengeScreenError: React.FC = (): ReactElement => {
  return (
    <TwoFactorChallengeScreen
      error="That code didn't work. Check your authenticator app and try again."
      onCancel={() => {}}
      onSubmit={noop}
      trustDeviceDays={30}
    />
  );
};

export const TwoFactorChallengeScreenLoading: React.FC = (): ReactElement => {
  return <TwoFactorChallengeScreen loading onSubmit={noop} />;
};
