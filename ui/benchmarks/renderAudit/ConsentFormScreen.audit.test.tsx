import {describe, expect, it} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";

import {ConsentFormScreen} from "../../src/ConsentFormScreen";
import {renderWithTheme} from "../../src/test-utils";
import type {ConsentFormPublic} from "../../src/useConsentForms";
import {auditPropChanges, componentStat, createRenderAudit, formatReport} from "./renderAudit";

const form: ConsentFormPublic = {
  active: true,
  agreeButtonText: "I agree",
  allowDecline: true,
  captureSignature: false,
  checkboxes: Array.from({length: 8}, (_, index) => ({
    label: `I understand item ${index}`,
    required: index < 4,
  })),
  content: {en: "# Consent\n\nPlease read this.\n\n- one\n- two\n\nMore text here."},
  declineButtonText: "Decline",
  defaultLocale: "en",
  id: "consent-1",
  order: 0,
  required: false,
  requireScrollToBottom: false,
  slug: "consent",
  title: "Consent",
  type: "tos",
  version: 1,
};
const variables = {name: "Sam"};
const baseline = {
  form,
  isSubmitting: false,
  locale: "en",
  onAgree: (): void => {},
  onDecline: (): void => {},
  variables,
};

describe("ConsentFormScreen renders", () => {
  it("re-renders only the checkbox that was ticked", async () => {
    const audit = createRenderAudit({ignore: /^(ThemeProvider|TerrenoFontProvider)$/});
    let view: ReturnType<typeof renderWithTheme> | undefined;
    await auditPropChanges({
      audit,
      baseline,
      changes: {
        "new form object": {...baseline, form: {...form}},
        "new onAgree identity": {...baseline, onAgree: (): void => {}},
        "new onDecline identity": {...baseline, onDecline: (): void => {}},
        "new variables object": {...baseline, variables: {...variables}},
        submitting: {...baseline, isSubmitting: true},
      },
      mount: async (props): Promise<void> => {
        view = renderWithTheme(<ConsentFormScreen {...props} />);
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 400));
        });
      },
      update: (props): void => {
        view?.rerender(<ConsentFormScreen {...props} />);
      },
    });
    await audit.step("one checkbox ticked", async () => {
      await act(async () => {
        fireEvent.press(view!.getByTestId("consent-form-checkbox-2"));
      });
    });
    const report = audit.report();
    audit.dispose();
    view?.unmount();
    if (process.env.RENDER_AUDIT_PRINT) {
      console.info(`\n## ConsentFormScreen\n${formatReport(report, {limit: 16})}`);
    }
    expect(componentStat(report, "mount", "ConsentCheckboxRow")?.mounts).toBe(8);
    expect(componentStat(report, "one checkbox ticked", "ConsentCheckboxRow")?.updates).toBe(1);
    expect(componentStat(report, "same props", "ConsentCheckboxRow")).toBeUndefined();
    expect(componentStat(report, "new onAgree identity", "ConsentCheckboxRow")).toBeUndefined();
    expect(componentStat(report, "submitting", "ConsentCheckboxRow")).toBeUndefined();
  });
});
