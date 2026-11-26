import {describe, expect, it} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";

import {LoginScreen} from "../../src/login/LoginScreen";
import type {LoginAccountOption, LoginScreenProps} from "../../src/login/loginTypes";
import {renderWithTheme} from "../../src/test-utils";
import {auditPropChanges, componentStat, createRenderAudit, formatReport} from "./renderAudit";

const buildAccounts = (prefix: string, method: string): LoginAccountOption[] =>
  Array.from({length: 4}, (_, index) => ({
    email: `${prefix}${index}@example.com`,
    id: `${prefix}-${index}`,
    method,
    name: `${prefix} User ${index}`,
  }));

const currentSessions = buildAccounts("session", "email");
const rememberedAccounts = buildAccounts("remembered", "google");
const baseline: LoginScreenProps = {
  currentSessions,
  fields: [
    {label: "Email", name: "email", required: true, type: "email"},
    {label: "Password", name: "password", required: true, type: "password"},
  ],
  initialMethodsExpanded: true,
  lastUsedMethod: "google",
  onContinue: (): void => {},
  onForget: (): void => {},
  onSubmit: async (): Promise<void> => {},
  rememberedAccounts,
};

describe("LoginScreen renders", () => {
  it("does not re-render the account list while the user types", async () => {
    const audit = createRenderAudit({ignore: /^(ThemeProvider|TerrenoFontProvider)$/});
    let view: ReturnType<typeof renderWithTheme> | undefined;
    await auditPropChanges({
      audit,
      baseline,
      changes: {
        loading: {...baseline, loading: true},
        "new onContinue identity": {...baseline, onContinue: (): void => {}},
        "new onSubmit identity": {...baseline, onSubmit: async (): Promise<void> => {}},
        "new rememberedAccounts array": {...baseline, rememberedAccounts: [...rememberedAccounts]},
      },
      mount: (props): void => {
        view = renderWithTheme(<LoginScreen {...props} />);
      },
      update: (props): void => {
        view?.rerender(<LoginScreen {...props} />);
      },
    });
    await audit.step("type one character in email", async () => {
      await act(async () => {
        fireEvent.changeText(view!.getByTestId("login-screen-email-input"), "a");
      });
    });
    await audit.step("type one character in password", async () => {
      await act(async () => {
        fireEvent.changeText(view!.getByTestId("login-screen-password-input"), "s");
      });
    });
    const report = audit.report();
    audit.dispose();
    view?.unmount();
    if (process.env.RENDER_AUDIT_PRINT) {
      console.info(`\n## LoginScreen\n${formatReport(report, {limit: 14})}`);
    }
    expect(componentStat(report, "mount", "LoginAccountCard")?.mounts).toBe(8);
    expect(
      componentStat(report, "type one character in email", "LoginAccountList")
    ).toBeUndefined();
    expect(
      componentStat(report, "type one character in email", "LoginAccountCard")
    ).toBeUndefined();
    expect(
      componentStat(report, "type one character in password", "LoginAccountCard")
    ).toBeUndefined();
  });
});
