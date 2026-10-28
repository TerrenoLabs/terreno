import type {TwoFactorChallengeSubmission} from "@terreno/ui";
import {TwoFactorChallengeScreen} from "@terreno/ui";
import {type ReactElement, useCallback, useState} from "react";

const noop = async (): Promise<void> => {};

// The demo shows these screens as previews on the catalog and the component page. Focusing the
// code cells on mount would scroll that page down to them, so the stories leave focus alone.

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
      accountLabel="ada@example.com"
      autoFocus={false}
      error={error}
      loading={loading}
      onCancel={() => {}}
      onSubmit={handleSubmit}
      trustDeviceDays={30}
    />
  );
};

export const TwoFactorChallengeScreenBackupCode: React.FC = (): ReactElement => {
  return (
    <TwoFactorChallengeScreen
      accountLabel="ada@example.com"
      autoFocus={false}
      initialKind="backup"
      onCancel={() => {}}
      onSubmit={noop}
      trustDeviceDays={30}
    />
  );
};

export const TwoFactorChallengeScreenError: React.FC = (): ReactElement => {
  return (
    <TwoFactorChallengeScreen
      accountLabel="ada@example.com"
      autoFocus={false}
      error="rejected"
      onCancel={() => {}}
      onSubmit={noop}
      trustDeviceDays={30}
    />
  );
};

export const TwoFactorChallengeScreenLoading: React.FC = (): ReactElement => {
  return <TwoFactorChallengeScreen autoFocus={false} loading onSubmit={noop} />;
};
