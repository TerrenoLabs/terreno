import {describe, expect, it} from "bun:test";
import type {FormAskInput} from "@terreno/blocks";
import {act, fireEvent} from "@testing-library/react-native";

import {AskCard, type AskCardProps} from "../../src/asks/AskCard";
import type {ChatAsk} from "../../src/asks/askTypes";
import {renderWithTheme} from "../../src/test-utils";
import {auditPropChanges, componentStat, createRenderAudit, formatReport} from "./renderAudit";

const buildInput = (): FormAskInput => ({
  fields: Array.from({length: 8}, (_, index) => ({
    id: `field${index}`,
    label: `Field ${index}`,
    type: "text" as const,
  })),
  prompt: "Fill in the details.",
  title: "Details",
});
const buildAsk = (): ChatAsk =>
  ({input: buildInput(), kind: "form", status: "pending", toolCallId: "call_1"}) as ChatAsk;

const handleSubmit = async (): Promise<void> => {};
const baseline: AskCardProps = {ask: buildAsk(), onSubmit: handleSubmit};

describe("AskForm renders", () => {
  it("re-renders only the field the user typed in", async () => {
    const audit = createRenderAudit({ignore: /^(ThemeProvider|TerrenoFontProvider)$/});
    let view: ReturnType<typeof renderWithTheme> | undefined;
    await auditPropChanges({
      audit,
      baseline,
      changes: {
        "new onSubmit identity": {...baseline, onSubmit: async (): Promise<void> => {}},
      },
      mount: (props): void => {
        view = renderWithTheme(<AskCard {...props} />);
      },
      update: (props): void => {
        view?.rerender(<AskCard {...props} />);
      },
    });
    await audit.step("type in one field", () => {
      act(() => {
        fireEvent.changeText(view!.getByTestId("ask-card-field-field3"), "hello");
      });
    });
    await audit.step("type again in the same field", () => {
      act(() => {
        fireEvent.changeText(view!.getByTestId("ask-card-field-field3"), "hello!");
      });
    });
    const report = audit.report();
    audit.dispose();
    view?.unmount();
    if (process.env.RENDER_AUDIT_PRINT) {
      console.info(`\n## AskForm\n${formatReport(report, {limit: 14})}`);
    }

    // The memoized control reports under its inner function's name.
    expect(componentStat(report, "type in one field", "FormFieldControlBase")?.updates).toBe(1);
    expect(
      componentStat(report, "type again in the same field", "FormFieldControlBase")?.updates
    ).toBe(1);
    expect(componentStat(report, "new onSubmit identity", "FormFieldControlBase")).toBeUndefined();
    expect(componentStat(report, "same props", "FormFieldControlBase")).toBeUndefined();
  });
});
