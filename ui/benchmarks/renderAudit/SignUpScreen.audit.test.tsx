import {describe, expect, it} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";

import {defaultPasswordRequirements} from "../../src/signUp/passwordPresets";
import {SignUpScreen} from "../../src/signUp/SignUpScreen";
import type {SignUpScreenProps} from "../../src/signUp/signUpTypes";
import {renderWithTheme} from "../../src/test-utils";
import {auditPropChanges, componentStat, createRenderAudit, formatReport} from "./renderAudit";

const fields: SignUpScreenProps["fields"] = [
  {label: "First name", name: "firstName", required: true, type: "text"},
  {label: "Last name", name: "lastName", required: true, type: "text"},
  {label: "Email", name: "email", required: true, type: "email"},
  {label: "Password", name: "password", required: true, type: "password"},
];
const oauthProviders: NonNullable<SignUpScreenProps["oauthProviders"]> = [
  {onPress: async (): Promise<void> => {}, provider: "google"},
  {onPress: async (): Promise<void> => {}, provider: "github"},
  {onPress: async (): Promise<void> => {}, provider: "apple"},
];
const onboardingPages: NonNullable<SignUpScreenProps["onboardingPages"]> = Array.from(
  {length: 8},
  (_, index) => ({subtitle: `Subtitle ${index}`, title: `Page ${index}`})
);
const baseline: SignUpScreenProps = {
  fields,
  oauthProviders,
  onboardingPages,
  onLoginPress: (): void => {},
  onSubmit: async (): Promise<void> => {},
  passwordRequirements: defaultPasswordRequirements,
};

describe("SignUpScreen renders", () => {
  it("re-renders only the field being typed in", async () => {
    const audit = createRenderAudit({ignore: /^(ThemeProvider|TerrenoFontProvider)$/});
    let view: ReturnType<typeof renderWithTheme> | undefined;
    await auditPropChanges({
      audit,
      baseline,
      changes: {
        loading: {...baseline, loading: true},
        "new fields array": {...baseline, fields: [...fields]},
        "new onSubmit identity": {...baseline, onSubmit: async (): Promise<void> => {}},
      },
      mount: (props): void => {
        view = renderWithTheme(<SignUpScreen {...props} />);
      },
      update: (props): void => {
        view?.rerender(<SignUpScreen {...props} />);
      },
    });
    await audit.step("type one character in email", async () => {
      await act(async () => {
        fireEvent.changeText(view!.getByTestId("signup-screen-email-input"), "a");
      });
    });
    await audit.step("type one character in password", async () => {
      await act(async () => {
        fireEvent.changeText(view!.getByTestId("signup-screen-password-input"), "s");
      });
    });
    const report = audit.report();
    audit.dispose();
    view?.unmount();
    if (process.env.RENDER_AUDIT_PRINT) {
      console.info(`\n## SignUpScreen\n${formatReport(report, {limit: 16})}`);
    }

    expect(componentStat(report, "mount", "SignUpField")?.mounts).toBe(4);
    for (const step of ["type one character in email", "type one character in password"]) {
      expect(componentStat(report, step, "SignUpField")?.updates).toBe(1);
      expect(componentStat(report, step, "Swiper")).toBeUndefined();
      expect(componentStat(report, step, "OAuthButtons")).toBeUndefined();
    }
    expect(
      componentStat(report, "type one character in email", "PasswordRequirements")
    ).toBeUndefined();
    expect(
      componentStat(report, "type one character in password", "PasswordRequirements")?.updates
    ).toBe(1);
    for (const step of ["same props", "new fields array", "new onSubmit identity"]) {
      expect(componentStat(report, step, "SignUpField")).toBeUndefined();
    }
  });
});
