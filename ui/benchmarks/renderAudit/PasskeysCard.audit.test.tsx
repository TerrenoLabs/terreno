import {describe, expect, it} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";

import {PasskeysCard} from "../../src/security/PasskeysCard";
import type {AccountPasskey, PasskeysCardProps} from "../../src/security/securityTypes";
import {renderWithTheme} from "../../src/test-utils";
import {auditPropChanges, componentStat, createRenderAudit, formatReport} from "./renderAudit";

const passkeys: AccountPasskey[] = Array.from({length: 8}, (_, index) => ({
  backedUp: index % 2 === 0,
  createdAt: "2026-03-03T12:00:00.000Z",
  id: `pk-${index}`,
  name: `Passkey ${index}`,
}));
const baseline: PasskeysCardProps = {
  onAdd: async (): Promise<void> => {},
  onRemove: async (): Promise<void> => {},
  onRename: async (): Promise<void> => {},
  passkeys,
};

describe("PasskeysCard renders", () => {
  it("does not re-render the passkey rows while a name is typed", async () => {
    const audit = createRenderAudit({ignore: /^(ThemeProvider|TerrenoFontProvider)$/});
    let view: ReturnType<typeof renderWithTheme> | undefined;
    await auditPropChanges({
      audit,
      baseline,
      changes: {
        "new onRemove identity": {...baseline, onRemove: async (): Promise<void> => {}},
        "new onRename identity": {...baseline, onRename: async (): Promise<void> => {}},
        "new passkeys array": {...baseline, passkeys: [...passkeys]},
        "one passkey renamed": {
          ...baseline,
          passkeys: passkeys.map((passkey, index) =>
            index === 3 ? {...passkey, name: "Work laptop"} : passkey
          ),
        },
      },
      mount: (props): void => {
        view = renderWithTheme(<PasskeysCard {...props} />);
      },
      update: (props): void => {
        view?.rerender(<PasskeysCard {...props} />);
      },
    });
    await audit.step("open rename dialog", async () => {
      await act(async () => {
        fireEvent.press(view!.getByTestId("passkeys-card-rename-pk-3"));
      });
    });
    await audit.step("type one character in rename dialog", async () => {
      await act(async () => {
        fireEvent.changeText(view!.getByTestId("passkeys-card-rename-dialog-name"), "Passkey 3x");
      });
    });
    const report = audit.report();
    audit.dispose();
    view?.unmount();
    if (process.env.RENDER_AUDIT_PRINT) {
      console.info(`\n## PasskeysCard\n${formatReport(report, {limit: 14})}`);
    }
    expect(componentStat(report, "mount", "PasskeyRow")?.mounts).toBe(8);
    expect(componentStat(report, "same props", "PasskeyRow")).toBeUndefined();
    expect(componentStat(report, "new passkeys array", "PasskeyRow")).toBeUndefined();
    expect(componentStat(report, "new onRename identity", "PasskeyRow")).toBeUndefined();
    expect(componentStat(report, "one passkey renamed", "PasskeyRow")?.updates).toBe(1);
    expect(componentStat(report, "open rename dialog", "PasskeyRow")).toBeUndefined();
    expect(
      componentStat(report, "type one character in rename dialog", "PasskeyRow")
    ).toBeUndefined();
  });
});
