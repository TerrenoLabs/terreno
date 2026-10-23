import {afterEach, beforeEach, describe, expect, it, mock} from "bun:test";
import {act, fireEvent, render, waitFor} from "@testing-library/react-native";
import {setStringAsync} from "expo-clipboard";
import type {ReactElement} from "react";
import {AccessibilityInfo, Platform, Share} from "react-native";

import {OtpField} from "../OtpField";
import {ThemeProvider} from "../Theme";
import {renderWithTheme} from "../test-utils";
import type {TwoFactorEnrollment} from "./securityTypes";
import {parseTotpDigits, parseTotpSecret, TwoFactorSettingsCard} from "./TwoFactorSettingsCard";

const SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
const ENROLLMENT: TwoFactorEnrollment = {
  backupCodes: ["aaaa-1111", "bbbb-2222", "cccc-3333"],
  totpURI: `otpauth://totp/Terreno:jo%40example.com?secret=${SECRET}&issuer=Terreno&digits=6&period=30`,
};
const NEW_CODES = ["dddd-4444", "eeee-5555"];

const announce = AccessibilityInfo.announceForAccessibility as ReturnType<typeof mock>;

const press = async (element: Parameters<typeof fireEvent.press>[0]): Promise<void> => {
  await act(async () => {
    fireEvent.press(element);
  });
};

const typeText = async (
  element: Parameters<typeof fireEvent.changeText>[0],
  text: string
): Promise<void> => {
  await act(async () => {
    fireEvent.changeText(element, text);
  });
};

const isDisabled = (element: {props: Record<string, unknown>}): boolean => {
  const state = element.props.accessibilityState as {disabled?: boolean} | undefined;
  return Boolean(state?.disabled);
};

const renderOffCard = (
  overrides: Partial<Parameters<typeof TwoFactorSettingsCard>[0]> = {}
): {
  onStartEnroll: ReturnType<typeof mock>;
  onVerify: ReturnType<typeof mock>;
  utils: ReturnType<typeof renderWithTheme>;
} => {
  const onStartEnroll = mock((_password?: string) => Promise.resolve(ENROLLMENT));
  const onVerify = mock((_code: string) => Promise.resolve());
  const utils = renderWithTheme(
    <TwoFactorSettingsCard
      enabled={false}
      onStartEnroll={onStartEnroll}
      onVerify={onVerify}
      {...overrides}
    />
  );
  return {onStartEnroll, onVerify, utils};
};

describe("parseTotpDigits", () => {
  it("reads the digits parameter from an otpauth URI", () => {
    expect(parseTotpDigits(ENROLLMENT.totpURI)).toBe(6);
    expect(parseTotpDigits("otpauth://totp/x?secret=A&digits=8")).toBe(8);
  });

  it("returns undefined when digits is missing or out of range", () => {
    expect(parseTotpDigits("otpauth://totp/x?secret=A")).toBeUndefined();
    expect(parseTotpDigits("otpauth://totp/x?digits=abc")).toBeUndefined();
    expect(parseTotpDigits("otpauth://totp/x?digits=40")).toBeUndefined();
  });
});

describe("parseTotpSecret", () => {
  it("reads the secret parameter from an otpauth URI", () => {
    expect(parseTotpSecret(ENROLLMENT.totpURI)).toBe(SECRET);
    expect(parseTotpSecret(`otpauth://totp/x?issuer=A&secret=${SECRET}`)).toBe(SECRET);
  });

  it("returns undefined when the URI has no secret", () => {
    expect(parseTotpSecret("otpauth://totp/x?issuer=A")).toBeUndefined();
    expect(parseTotpSecret("not a uri")).toBeUndefined();
  });
});

describe("TwoFactorSettingsCard", () => {
  describe("when two-factor is off", () => {
    it("shows Off and a Turn on button, and hides the enrolled actions", () => {
      const {utils} = renderOffCard({
        onDisable: mock(() => Promise.resolve()),
        onRegenerateBackupCodes: mock(() => Promise.resolve(NEW_CODES)),
      });
      expect(utils.getByTestId("two-factor-settings-card-status").props.children).toBe("Off");
      expect(utils.getByTestId("two-factor-settings-card-enable")).toBeTruthy();
      expect(utils.queryByTestId("two-factor-settings-card-regenerate")).toBeNull();
      expect(utils.queryByTestId("two-factor-settings-card-disable")).toBeNull();
    });

    it("walks through password, QR code, verify and backup codes in order", async () => {
      const {onStartEnroll, onVerify, utils} = renderOffCard();
      const {getByTestId, queryByTestId} = utils;

      await press(getByTestId("two-factor-settings-card-enable"));
      expect(getByTestId("two-factor-settings-card-step").props.children).toBe("Step 1 of 4");
      await typeText(getByTestId("two-factor-settings-card-password"), "hunter22");
      await press(getByTestId("two-factor-settings-card-password-submit"));
      expect(onStartEnroll).toHaveBeenCalledWith("hunter22");

      // Step 2: scan the QR code, or type the secret.
      expect(getByTestId("two-factor-settings-card-step").props.children).toBe("Step 2 of 4");
      expect(getByTestId("two-factor-settings-card-qr")).toBeTruthy();
      expect(getByTestId("two-factor-settings-card-secret").props.children).toBe(
        "JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP"
      );
      expect(queryByTestId("two-factor-settings-card-otp")).toBeNull();
      await press(getByTestId("two-factor-settings-card-next"));

      // Step 3: a full code submits itself.
      expect(getByTestId("two-factor-settings-card-step").props.children).toBe("Step 3 of 4");
      await typeText(getByTestId("two-factor-settings-card-otp-cell-1"), "123456");
      expect(onVerify).toHaveBeenCalledWith("123456");

      // Step 4: the backup codes.
      await waitFor(() => {
        expect(getByTestId("two-factor-settings-card-step").props.children).toBe("Step 4 of 4");
      });
      ENROLLMENT.backupCodes.forEach((code, index) => {
        expect(
          getByTestId(`two-factor-settings-card-backup-code-${index + 1}`).props.children
        ).toBe(code);
      });
    });

    it("gates Finish on 'I saved these' and returns to the card when finished", async () => {
      const {utils} = renderOffCard();
      const {getByTestId, queryByTestId} = utils;
      await press(getByTestId("two-factor-settings-card-enable"));
      await typeText(getByTestId("two-factor-settings-card-password"), "hunter22");
      await press(getByTestId("two-factor-settings-card-password-submit"));
      await press(getByTestId("two-factor-settings-card-next"));
      await typeText(getByTestId("two-factor-settings-card-otp-cell-1"), "123456");
      await waitFor(() => {
        expect(getByTestId("two-factor-settings-card-finish")).toBeTruthy();
      });

      const saved = getByTestId("two-factor-settings-card-saved");
      expect(saved.props.role).toBe("checkbox");
      expect(saved.props.accessibilityLabel).toBe("I saved these backup codes");
      expect(isDisabled(getByTestId("two-factor-settings-card-finish"))).toBe(true);
      // The step offers no way out but Finish, so the codes can't be skipped.
      expect(queryByTestId("two-factor-settings-card-cancel")).toBeNull();

      await press(saved);
      expect(isDisabled(getByTestId("two-factor-settings-card-finish"))).toBe(false);
      await press(saved);
      expect(isDisabled(getByTestId("two-factor-settings-card-finish"))).toBe(true);
      await press(saved);
      await press(getByTestId("two-factor-settings-card-finish"));
      expect(queryByTestId("two-factor-settings-card-backup-code-1")).toBeNull();
      expect(getByTestId("two-factor-settings-card-enable")).toBeTruthy();
    });

    it("keeps showing the backup codes after enabled flips to true", async () => {
      const onStartEnroll = mock(() => Promise.resolve(ENROLLMENT));
      const onVerify = mock(() => Promise.resolve());
      const {getByTestId, rerender} = renderWithTheme(
        <TwoFactorSettingsCard enabled={false} onStartEnroll={onStartEnroll} onVerify={onVerify} />
      );
      await press(getByTestId("two-factor-settings-card-enable"));
      await typeText(getByTestId("two-factor-settings-card-password"), "hunter22");
      await press(getByTestId("two-factor-settings-card-password-submit"));
      await press(getByTestId("two-factor-settings-card-next"));
      await typeText(getByTestId("two-factor-settings-card-otp-cell-1"), "123456");
      await waitFor(() => {
        expect(getByTestId("two-factor-settings-card-backup-code-1")).toBeTruthy();
      });
      rerender(<TwoFactorSettingsCard enabled onStartEnroll={onStartEnroll} onVerify={onVerify} />);
      expect(getByTestId("two-factor-settings-card-backup-code-1")).toBeTruthy();
    });

    it("asks for the password before calling onStartEnroll", async () => {
      const {onStartEnroll, utils} = renderOffCard();
      await press(utils.getByTestId("two-factor-settings-card-enable"));
      await press(utils.getByTestId("two-factor-settings-card-password-submit"));
      expect(onStartEnroll).not.toHaveBeenCalled();
      expect(utils.getByText("Enter your password.")).toBeTruthy();
    });

    it("shows a rejected enrollment on the password step", async () => {
      const {utils} = renderOffCard({
        onStartEnroll: mock(() => Promise.reject(new Error("Invalid password"))),
      });
      const {getByTestId} = utils;
      await press(getByTestId("two-factor-settings-card-enable"));
      await typeText(getByTestId("two-factor-settings-card-password"), "wrong");
      await press(getByTestId("two-factor-settings-card-password-submit"));
      await waitFor(() => {
        expect(getByTestId("two-factor-settings-card-error")).toBeTruthy();
      });
      expect(getByTestId("two-factor-settings-card-error").props.role).toBe("alert");
      expect(utils.getByText("Invalid password")).toBeTruthy();
      expect(getByTestId("two-factor-settings-card-step").props.children).toBe("Step 1 of 4");
    });

    it("shows a rejected code, clears it, and stays on the verify step", async () => {
      const onVerify = mock(() => Promise.reject(new Error("Invalid code")));
      const {utils} = renderOffCard({onVerify});
      const {getByTestId} = utils;
      await press(getByTestId("two-factor-settings-card-enable"));
      await typeText(getByTestId("two-factor-settings-card-password"), "hunter22");
      await press(getByTestId("two-factor-settings-card-password-submit"));
      await press(getByTestId("two-factor-settings-card-next"));
      await typeText(getByTestId("two-factor-settings-card-otp-cell-1"), "999999");
      await waitFor(() => {
        expect(utils.getByText("Invalid code")).toBeTruthy();
      });
      expect(getByTestId("two-factor-settings-card-step").props.children).toBe("Step 3 of 4");
      expect(getByTestId("two-factor-settings-card-otp-cell-1").props.value).toBe("");
      expect(isDisabled(getByTestId("two-factor-settings-card-verify"))).toBe(true);
    });

    it("cancels enrollment from any step before the codes without verifying", async () => {
      const {onStartEnroll, onVerify, utils} = renderOffCard();
      const {getByTestId, queryByTestId} = utils;
      await press(getByTestId("two-factor-settings-card-enable"));
      await press(getByTestId("two-factor-settings-card-cancel"));
      expect(queryByTestId("two-factor-settings-card-step")).toBeNull();
      expect(onStartEnroll).not.toHaveBeenCalled();

      await press(getByTestId("two-factor-settings-card-enable"));
      await typeText(getByTestId("two-factor-settings-card-password"), "hunter22");
      await press(getByTestId("two-factor-settings-card-password-submit"));
      await press(getByTestId("two-factor-settings-card-next"));
      await press(getByTestId("two-factor-settings-card-back"));
      expect(getByTestId("two-factor-settings-card-step").props.children).toBe("Step 2 of 4");
      await press(getByTestId("two-factor-settings-card-cancel"));
      expect(queryByTestId("two-factor-settings-card-step")).toBeNull();
      expect(onVerify).not.toHaveBeenCalled();

      // Starting again asks for the password again.
      await press(getByTestId("two-factor-settings-card-enable"));
      expect(getByTestId("two-factor-settings-card-password").props.value).toBe("");
    });

    it("skips the password step when requirePassword is false", async () => {
      const {onStartEnroll, utils} = renderOffCard({requirePassword: false});
      await press(utils.getByTestId("two-factor-settings-card-enable"));
      expect(onStartEnroll).toHaveBeenCalledWith(undefined);
      expect(utils.queryByTestId("two-factor-settings-card-password")).toBeNull();
      expect(utils.getByTestId("two-factor-settings-card-step").props.children).toBe("Step 1 of 3");
      expect(utils.getByTestId("two-factor-settings-card-qr")).toBeTruthy();
    });

    it("asks a user without a password to set one first", () => {
      const {utils} = renderOffCard({hasPassword: false});
      expect(isDisabled(utils.getByTestId("two-factor-settings-card-enable"))).toBe(true);
      expect(utils.getByTestId("two-factor-settings-card-needs-password")).toBeTruthy();
    });

    it("lets a user without a password enroll when the server allows passwordless", () => {
      const {utils} = renderOffCard({hasPassword: false, requirePassword: false});
      expect(isDisabled(utils.getByTestId("two-factor-settings-card-enable"))).toBe(false);
      expect(utils.queryByTestId("two-factor-settings-card-needs-password")).toBeNull();
    });

    it("takes the code length from the totpURI when digits is not passed", async () => {
      const {onVerify, utils} = renderOffCard({
        onStartEnroll: mock(() =>
          Promise.resolve({
            backupCodes: ENROLLMENT.backupCodes,
            totpURI: `otpauth://totp/x?secret=${SECRET}&digits=8`,
          })
        ),
        requirePassword: false,
      });
      await press(utils.getByTestId("two-factor-settings-card-enable"));
      await press(utils.getByTestId("two-factor-settings-card-next"));
      expect(utils.getByTestId("two-factor-settings-card-otp-cell-8")).toBeTruthy();
      expect(utils.getByText("Enter the 8-digit code your authenticator app shows.")).toBeTruthy();
      await typeText(utils.getByTestId("two-factor-settings-card-otp-cell-1"), "123456");
      expect(onVerify).not.toHaveBeenCalled();
      await typeText(utils.getByTestId("two-factor-settings-card-otp-cell-1"), "12345678");
      expect(onVerify).toHaveBeenCalledWith("12345678");
    });

    it("uses 6 digits when the totpURI has no digits parameter", async () => {
      const {utils} = renderOffCard({
        onStartEnroll: mock(() =>
          Promise.resolve({backupCodes: [], totpURI: `otpauth://totp/x?secret=${SECRET}`})
        ),
        requirePassword: false,
      });
      await press(utils.getByTestId("two-factor-settings-card-enable"));
      await press(utils.getByTestId("two-factor-settings-card-next"));
      expect(utils.getByTestId("two-factor-settings-card-otp-cell-6")).toBeTruthy();
      expect(utils.queryByTestId("two-factor-settings-card-otp-cell-7")).toBeNull();
    });

    it("does not verify a partial code, and Verify submits a full one", async () => {
      const {onVerify, utils} = renderOffCard({requirePassword: false});
      await press(utils.getByTestId("two-factor-settings-card-enable"));
      await press(utils.getByTestId("two-factor-settings-card-next"));
      await typeText(utils.getByTestId("two-factor-settings-card-otp-cell-1"), "123");
      expect(onVerify).not.toHaveBeenCalled();
      expect(isDisabled(utils.getByTestId("two-factor-settings-card-verify"))).toBe(true);
      await press(utils.getByTestId("two-factor-settings-card-verify"));
      expect(onVerify).not.toHaveBeenCalled();

      // A code that fills the field without onComplete (for example, a value set by the app)
      // is submitted by the Verify button.
      await act(async () => {
        utils.UNSAFE_getByType(OtpField).props.onChange("654321");
      });
      expect(isDisabled(utils.getByTestId("two-factor-settings-card-verify"))).toBe(false);
      await press(utils.getByTestId("two-factor-settings-card-verify"));
      expect(onVerify).toHaveBeenCalledTimes(1);
      expect(onVerify).toHaveBeenCalledWith("654321");
      await waitFor(() => {
        expect(utils.getByTestId("two-factor-settings-card-backup-code-1")).toBeTruthy();
      });
    });

    it("announces each step on native, and not on first render", async () => {
      announce.mockClear();
      const {utils} = renderOffCard();
      expect(announce).not.toHaveBeenCalled();
      await press(utils.getByTestId("two-factor-settings-card-enable"));
      expect(announce).toHaveBeenLastCalledWith(
        "Step 1 of 4. Enter your password to turn on two-factor authentication."
      );
      await typeText(utils.getByTestId("two-factor-settings-card-password"), "hunter22");
      await press(utils.getByTestId("two-factor-settings-card-password-submit"));
      expect(announce.mock.calls.at(-1)?.[0]).toStartWith("Step 2 of 4. Scan this QR code");
      await press(utils.getByTestId("two-factor-settings-card-next"));
      expect(announce).toHaveBeenLastCalledWith(
        "Step 3 of 4. Enter the 6-digit code your authenticator app shows."
      );
      await typeText(utils.getByTestId("two-factor-settings-card-otp-cell-1"), "123456");
      await waitFor(() => {
        expect(announce).toHaveBeenLastCalledWith(
          "Two-factor authentication is on. Save your backup codes."
        );
      });
      await press(utils.getByTestId("two-factor-settings-card-saved"));
      await press(utils.getByTestId("two-factor-settings-card-finish"));
      expect(announce).toHaveBeenLastCalledWith("Two-factor authentication is on.");
    });

    it("moves focus to each step's heading on web, and to the field on input steps", async () => {
      const originalOS = Platform.OS;
      Platform.OS = "web";
      announce.mockClear();
      const focused: string[] = [];
      const createNodeMock = (element: ReactElement): {focus: () => void} => ({
        focus: (): void => {
          focused.push((element.props as {testID?: string}).testID ?? "");
        },
      });
      try {
        const {getByTestId} = render(
          <TwoFactorSettingsCard
            enabled={false}
            onStartEnroll={mock(() => Promise.resolve(ENROLLMENT))}
            onVerify={mock(() => Promise.resolve())}
          />,
          {createNodeMock, wrapper: ThemeProvider}
        );
        expect(focused).toEqual([]);
        await press(getByTestId("two-factor-settings-card-enable"));
        expect(focused.at(-1)).toBe("two-factor-settings-card-password");
        await typeText(getByTestId("two-factor-settings-card-password"), "hunter22");
        await press(getByTestId("two-factor-settings-card-password-submit"));
        expect(focused.at(-1)).toBe("two-factor-settings-card-step-heading");
        expect(getByTestId("two-factor-settings-card-step-heading").props.tabIndex).toBe(-1);
        await press(getByTestId("two-factor-settings-card-next"));
        expect(focused.at(-1)).toBe("two-factor-settings-card-otp-cell-1");
        await typeText(getByTestId("two-factor-settings-card-otp-cell-1"), "123456");
        await waitFor(() => {
          expect(focused.at(-1)).toBe("two-factor-settings-card-step-heading");
        });
        expect(getByTestId("two-factor-settings-card-backup-code-1")).toBeTruthy();
        // Web moves focus instead; react-native-web's announceForAccessibility does nothing.
        expect(announce).not.toHaveBeenCalled();
      } finally {
        Platform.OS = originalOS;
      }
    });

    it("honors a custom code length", async () => {
      const {onVerify, utils} = renderOffCard({digits: 8, requirePassword: false});
      await press(utils.getByTestId("two-factor-settings-card-enable"));
      await press(utils.getByTestId("two-factor-settings-card-next"));
      expect(utils.getByTestId("two-factor-settings-card-otp-cell-8")).toBeTruthy();
      await typeText(utils.getByTestId("two-factor-settings-card-otp-cell-1"), "12345678");
      expect(onVerify).toHaveBeenCalledWith("12345678");
    });
  });

  describe("copy and download", () => {
    const originalOS = Platform.OS;

    beforeEach(() => {
      (setStringAsync as ReturnType<typeof mock>).mockClear();
      (Share.share as ReturnType<typeof mock>).mockClear();
    });

    afterEach(() => {
      Platform.OS = originalOS;
    });

    const openCodes = async (): Promise<ReturnType<typeof renderWithTheme>> => {
      const {utils} = renderOffCard({requirePassword: false});
      await press(utils.getByTestId("two-factor-settings-card-enable"));
      return utils;
    };

    it("copies the secret and announces it", async () => {
      const utils = await openCodes();
      announce.mockClear();
      await press(utils.getByTestId("two-factor-settings-card-copy-secret"));
      expect(setStringAsync).toHaveBeenCalledWith(SECRET);
      await waitFor(() => {
        expect(utils.getByText("Copied")).toBeTruthy();
      });
      const status = utils.getByTestId("two-factor-settings-card-copy-secret-status");
      expect(status.props["aria-live"]).toBe("polite");
      expect(status.props.accessibilityLiveRegion).toBe("polite");
      // VoiceOver ignores live regions, so iOS (the test platform) announces it too.
      expect(announce).toHaveBeenCalledWith("Copied");
    });

    it("copies every backup code, one per line", async () => {
      const utils = await openCodes();
      await press(utils.getByTestId("two-factor-settings-card-next"));
      await typeText(utils.getByTestId("two-factor-settings-card-otp-cell-1"), "123456");
      await waitFor(() => {
        expect(utils.getByTestId("two-factor-settings-card-copy-codes")).toBeTruthy();
      });
      await press(utils.getByTestId("two-factor-settings-card-copy-codes"));
      expect(setStringAsync).toHaveBeenCalledWith(ENROLLMENT.backupCodes.join("\n"));
    });

    it("reports a failed copy", async () => {
      (setStringAsync as ReturnType<typeof mock>).mockImplementationOnce(() =>
        Promise.reject(new Error("denied"))
      );
      const utils = await openCodes();
      await press(utils.getByTestId("two-factor-settings-card-copy-secret"));
      await waitFor(() => {
        expect(utils.getByText("Couldn't copy")).toBeTruthy();
      });
      expect(announce).toHaveBeenLastCalledWith("Couldn't copy");
    });

    it("shares the backup codes on native", async () => {
      const utils = await openCodes();
      await press(utils.getByTestId("two-factor-settings-card-next"));
      await typeText(utils.getByTestId("two-factor-settings-card-otp-cell-1"), "123456");
      await waitFor(() => {
        expect(utils.getByTestId("two-factor-settings-card-download-codes")).toBeTruthy();
      });
      expect(utils.getByText("Share")).toBeTruthy();
      expect(utils.queryByText("Download")).toBeNull();
      await press(utils.getByTestId("two-factor-settings-card-download-codes"));
      const [content] = (Share.share as ReturnType<typeof mock>).mock.calls[0] as [
        {message: string},
      ];
      expect(content.message).toContain(ENROLLMENT.backupCodes.join("\n"));
    });

    it("downloads the backup codes as a text file on web", async () => {
      const clicked: {download?: string; href?: string}[] = [];
      const originalDocument = globalThis.document;
      const originalCreate = URL.createObjectURL;
      const originalRevoke = URL.revokeObjectURL;
      const blobs: Blob[] = [];
      URL.createObjectURL = ((blob: Blob): string => {
        blobs.push(blob);
        return "blob:codes";
      }) as typeof URL.createObjectURL;
      // The card revokes the URL later, once the browser has read the blob.
      URL.revokeObjectURL = ((): void => {}) as typeof URL.revokeObjectURL;
      const anchor = {
        click(): void {
          clicked.push({download: anchor.download, href: anchor.href});
        },
        download: "",
        href: "",
        remove: mock(() => {}),
        style: {} as Record<string, string>,
      };
      (globalThis as {document?: unknown}).document = {
        body: {appendChild: mock(() => {})},
        createElement: mock(() => anchor),
      };
      try {
        Platform.OS = "web";
        const utils = await openCodes();
        await press(utils.getByTestId("two-factor-settings-card-next"));
        await typeText(utils.getByTestId("two-factor-settings-card-otp-cell-1"), "123456");
        await waitFor(() => {
          expect(utils.getByTestId("two-factor-settings-card-download-codes")).toBeTruthy();
        });
        expect(utils.getByText("Download")).toBeTruthy();
        expect(
          utils.getByTestId("two-factor-settings-card-download-codes").props.accessibilityLabel
        ).toBe("Download backup codes");
        await press(utils.getByTestId("two-factor-settings-card-download-codes"));
        expect(clicked).toEqual([{download: "two-factor-backup-codes.txt", href: "blob:codes"}]);
        expect(await blobs[0].text()).toContain(ENROLLMENT.backupCodes.join("\n"));
        expect(Share.share).not.toHaveBeenCalled();
      } finally {
        (globalThis as {document?: unknown}).document = originalDocument;
        URL.createObjectURL = originalCreate;
        URL.revokeObjectURL = originalRevoke;
      }
    });
  });

  describe("when two-factor is on", () => {
    const renderOnCard = (
      overrides: Partial<Parameters<typeof TwoFactorSettingsCard>[0]> = {}
    ): {
      onDisable: ReturnType<typeof mock>;
      onRegenerateBackupCodes: ReturnType<typeof mock>;
      utils: ReturnType<typeof renderWithTheme>;
    } => {
      const onDisable = mock((_password?: string) => Promise.resolve());
      const onRegenerateBackupCodes = mock((_password?: string) => Promise.resolve(NEW_CODES));
      const utils = renderWithTheme(
        <TwoFactorSettingsCard
          enabled
          onDisable={onDisable}
          onRegenerateBackupCodes={onRegenerateBackupCodes}
          onStartEnroll={mock(() => Promise.resolve(ENROLLMENT))}
          onVerify={mock(() => Promise.resolve())}
          {...overrides}
        />
      );
      return {onDisable, onRegenerateBackupCodes, utils};
    };

    it("shows On with new-codes and turn-off actions instead of Turn on", () => {
      const {utils} = renderOnCard();
      expect(utils.getByTestId("two-factor-settings-card-status").props.children).toBe("On");
      expect(utils.queryByTestId("two-factor-settings-card-enable")).toBeNull();
      expect(utils.getByTestId("two-factor-settings-card-regenerate")).toBeTruthy();
      expect(utils.getByTestId("two-factor-settings-card-disable")).toBeTruthy();
    });

    it("regenerates backup codes after the password and shows the new ones", async () => {
      const {onRegenerateBackupCodes, utils} = renderOnCard();
      const {getByTestId, queryByTestId} = utils;
      await press(getByTestId("two-factor-settings-card-regenerate"));
      await typeText(getByTestId("two-factor-settings-card-password"), "hunter22");
      await press(getByTestId("two-factor-settings-card-password-submit"));
      expect(onRegenerateBackupCodes).toHaveBeenCalledWith("hunter22");
      await waitFor(() => {
        expect(getByTestId("two-factor-settings-card-backup-code-1").props.children).toBe(
          NEW_CODES[0]
        );
      });
      expect(getByTestId("two-factor-settings-card-backup-code-2").props.children).toBe(
        NEW_CODES[1]
      );
      expect(queryByTestId("two-factor-settings-card-backup-code-3")).toBeNull();
      expect(isDisabled(getByTestId("two-factor-settings-card-finish"))).toBe(true);
      await press(getByTestId("two-factor-settings-card-saved"));
      await press(getByTestId("two-factor-settings-card-finish"));
      expect(queryByTestId("two-factor-settings-card-backup-code-1")).toBeNull();
      expect(getByTestId("two-factor-settings-card-regenerate")).toBeTruthy();
    });

    it("shows a rejected regenerate on the password step", async () => {
      const {utils} = renderOnCard({
        onRegenerateBackupCodes: mock(() => Promise.reject({message: "Invalid password"})),
      });
      await press(utils.getByTestId("two-factor-settings-card-regenerate"));
      await typeText(utils.getByTestId("two-factor-settings-card-password"), "wrong");
      await press(utils.getByTestId("two-factor-settings-card-password-submit"));
      await waitFor(() => {
        expect(utils.getByText("Invalid password")).toBeTruthy();
      });
      expect(utils.getByTestId("two-factor-settings-card-password")).toBeTruthy();
    });

    const confirmTurnOff = async (utils: ReturnType<typeof renderWithTheme>): Promise<void> => {
      await press(utils.getByTestId("two-factor-settings-card-disable"));
      await typeText(utils.getByTestId("two-factor-settings-card-password"), "hunter22");
      await press(utils.getByTestId("two-factor-settings-card-password-submit"));
    };

    it("turns off only after the password and a destructive confirm", async () => {
      const {onDisable, utils} = renderOnCard();
      await confirmTurnOff(utils);
      expect(utils.getByTestId("two-factor-settings-card-confirm")).toBeTruthy();
      expect(onDisable).not.toHaveBeenCalled();

      await press(utils.getByTestId("two-factor-settings-card-confirm-submit"));
      expect(onDisable).toHaveBeenCalledWith("hunter22");
      await waitFor(() => {
        expect(utils.queryByTestId("two-factor-settings-card-password")).toBeNull();
      });
    });

    it("keeps two-factor on when the turn-off confirm is cancelled", async () => {
      const {onDisable, utils} = renderOnCard();
      await confirmTurnOff(utils);
      await press(utils.getByTestId("two-factor-settings-card-confirm-cancel"));
      expect(utils.queryByTestId("two-factor-settings-card-confirm")).toBeNull();
      expect(onDisable).not.toHaveBeenCalled();
      expect(utils.getByTestId("two-factor-settings-card-password")).toBeTruthy();

      await press(utils.getByTestId("two-factor-settings-card-cancel"));
      expect(utils.getByTestId("two-factor-settings-card-status").props.children).toBe("On");
    });

    it("shows a rejected turn-off and keeps the password step", async () => {
      const {utils} = renderOnCard({
        onDisable: mock(() => Promise.reject(new Error("Invalid password"))),
      });
      await press(utils.getByTestId("two-factor-settings-card-disable"));
      await typeText(utils.getByTestId("two-factor-settings-card-password"), "wrong");
      await press(utils.getByTestId("two-factor-settings-card-password-submit"));
      await press(utils.getByTestId("two-factor-settings-card-confirm-submit"));
      await waitFor(() => {
        expect(utils.getByText("Invalid password")).toBeTruthy();
      });
      expect(utils.getByTestId("two-factor-settings-card-password")).toBeTruthy();
    });

    it("goes straight to the confirm when requirePassword is false", async () => {
      const {onDisable, utils} = renderOnCard({requirePassword: false});
      await press(utils.getByTestId("two-factor-settings-card-disable"));
      expect(utils.queryByTestId("two-factor-settings-card-password")).toBeNull();
      await press(utils.getByTestId("two-factor-settings-card-confirm-submit"));
      expect(onDisable).toHaveBeenCalledWith(undefined);
    });

    it("shows how many backup codes are left, with a warning when fewer than 3", () => {
      const {utils} = renderOnCard({backupCodesRemaining: 8});
      expect(
        utils.getByTestId("two-factor-settings-card-backup-codes-remaining").props.children
      ).toBe("8 backup codes left");
      expect(utils.queryByTestId("two-factor-settings-card-backup-codes-low")).toBeNull();

      const low = renderOnCard({backupCodesRemaining: 1}).utils;
      expect(
        low.getByTestId("two-factor-settings-card-backup-codes-remaining").props.children
      ).toBe("1 backup code left");
      expect(low.getByTestId("two-factor-settings-card-backup-codes-low")).toBeTruthy();
    });

    it("disables new codes and turn off for a user without a password", () => {
      const {utils} = renderOnCard({hasPassword: false});
      expect(isDisabled(utils.getByTestId("two-factor-settings-card-regenerate"))).toBe(true);
      expect(isDisabled(utils.getByTestId("two-factor-settings-card-disable"))).toBe(true);
      expect(utils.getByTestId("two-factor-settings-card-needs-password")).toBeTruthy();
    });

    it("hides actions whose callbacks are not passed", () => {
      const {utils} = renderOnCard({onDisable: undefined, onRegenerateBackupCodes: undefined});
      expect(utils.queryByTestId("two-factor-settings-card-regenerate")).toBeNull();
      expect(utils.queryByTestId("two-factor-settings-card-disable")).toBeNull();
    });

    it("shows the error prop as an alert and disables actions when disabled", () => {
      const {utils} = renderOnCard({disabled: true, error: "Couldn't load your account."});
      expect(utils.getByTestId("two-factor-settings-card-error").props.role).toBe("alert");
      expect(isDisabled(utils.getByTestId("two-factor-settings-card-regenerate"))).toBe(true);
      expect(isDisabled(utils.getByTestId("two-factor-settings-card-disable"))).toBe(true);
    });
  });
});
