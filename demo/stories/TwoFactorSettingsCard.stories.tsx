import type {TwoFactorEnrollment} from "@terreno/ui";
import {Box, TwoFactorSettingsCard} from "@terreno/ui";
import {type ReactElement, useCallback, useState} from "react";

/** The password and code the demo accepts. */
const DEMO_PASSWORD = "password";
const DEMO_CODE = "123456";

const DEMO_ENROLLMENT: TwoFactorEnrollment = {
  backupCodes: ["k3j9-x2mw", "p8q4-7ztn", "c5v1-h6rd", "m2b8-w9yf", "t4n7-a3ke", "r6s2-u8gq"],
  totpURI:
    "otpauth://totp/Terreno:jo%40example.com?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Terreno&digits=6&period=30",
};

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Rejects a wrong password the way a real screen would after Better Auth refuses it. */
const checkPassword = (password?: string): void => {
  if (password !== DEMO_PASSWORD) {
    throw new Error(`Invalid password. In this demo, the password is "${DEMO_PASSWORD}".`);
  }
};

/**
 * The full flow with a fake auth client: the password is "password" and the code is "123456".
 */
export const TwoFactorSettingsCardDemo: React.FC = (): ReactElement => {
  const [enabled, setEnabled] = useState(false);
  const [backupCodesRemaining, setBackupCodesRemaining] = useState<number | undefined>(undefined);

  // A real screen calls authClient.twoFactor.enable({password}) and returns its data.
  const handleStartEnroll = useCallback(async (password?: string): Promise<TwoFactorEnrollment> => {
    await wait(500);
    checkPassword(password);
    return DEMO_ENROLLMENT;
  }, []);

  // A real screen calls authClient.twoFactor.verifyTotp({code}).
  const handleVerify = useCallback(async (code: string): Promise<void> => {
    await wait(500);
    if (code !== DEMO_CODE) {
      throw new Error(`That code didn't work. In this demo, the code is ${DEMO_CODE}.`);
    }
    setEnabled(true);
    setBackupCodesRemaining(DEMO_ENROLLMENT.backupCodes.length);
  }, []);

  const handleRegenerate = useCallback(async (password?: string): Promise<string[]> => {
    await wait(500);
    checkPassword(password);
    setBackupCodesRemaining(DEMO_ENROLLMENT.backupCodes.length);
    return [...DEMO_ENROLLMENT.backupCodes].reverse();
  }, []);

  const handleDisable = useCallback(async (password?: string): Promise<void> => {
    await wait(500);
    checkPassword(password);
    setEnabled(false);
    setBackupCodesRemaining(undefined);
  }, []);

  return (
    <Box maxWidth={560} width="100%">
      <TwoFactorSettingsCard
        backupCodesRemaining={backupCodesRemaining}
        enabled={enabled}
        onDisable={handleDisable}
        onRegenerateBackupCodes={handleRegenerate}
        onStartEnroll={handleStartEnroll}
        onVerify={handleVerify}
      />
    </Box>
  );
};

/** Two-factor is on and the user is down to their last backup codes. */
export const TwoFactorSettingsCardLowCodes: React.FC = (): ReactElement => {
  return (
    <Box maxWidth={560} width="100%">
      <TwoFactorSettingsCard
        backupCodesRemaining={2}
        enabled
        onDisable={async (): Promise<void> => {}}
        onRegenerateBackupCodes={async (): Promise<string[]> => DEMO_ENROLLMENT.backupCodes}
        onStartEnroll={async (): Promise<TwoFactorEnrollment> => DEMO_ENROLLMENT}
        onVerify={async (): Promise<void> => {}}
      />
    </Box>
  );
};

/** A user who signed up with a social provider has no password to confirm. */
export const TwoFactorSettingsCardNeedsPassword: React.FC = (): ReactElement => {
  return (
    <Box maxWidth={560} width="100%">
      <TwoFactorSettingsCard
        enabled={false}
        hasPassword={false}
        onStartEnroll={async (): Promise<TwoFactorEnrollment> => DEMO_ENROLLMENT}
        onVerify={async (): Promise<void> => {}}
      />
    </Box>
  );
};

/** A server with `allowPasswordless`: enrollment skips the password step. */
export const TwoFactorSettingsCardPasswordless: React.FC = (): ReactElement => {
  return (
    <Box maxWidth={560} width="100%">
      <TwoFactorSettingsCard
        enabled={false}
        onStartEnroll={async (): Promise<TwoFactorEnrollment> => {
          await wait(400);
          return DEMO_ENROLLMENT;
        }}
        onVerify={async (): Promise<void> => {
          await wait(400);
        }}
        requirePassword={false}
      />
    </Box>
  );
};
