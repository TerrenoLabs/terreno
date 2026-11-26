import {describe, expect, it} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";

import {
  GPTChat,
  type GPTChatHistory,
  type GPTChatMessage,
  type GPTChatProps,
} from "../../src/GPTChat";
import {renderWithTheme} from "../../src/test-utils";
import {auditPropChanges, componentStat, createRenderAudit, formatReport} from "./renderAudit";

const histories: GPTChatHistory[] = Array.from({length: 8}, (_, index) => ({
  id: `history-${index}`,
  prompts: [],
  title: `Chat ${index}`,
}));
const currentMessages: GPTChatMessage[] = Array.from({length: 10}, (_, index) => ({
  content: index % 2 === 0 ? `Question ${index}` : `Answer **${index}** with some text.`,
  id: `message-${index}`,
  role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
}));
const noop = (): void => {};
const baseline: GPTChatProps = {
  currentHistoryId: "history-1",
  currentMessages,
  histories,
  onCreateHistory: noop,
  onDeleteHistory: noop,
  onRateFeedback: noop,
  onSelectHistory: noop,
  onSubmit: noop,
  onUpdateTitle: noop,
  testID: "gpt-chat",
};
const streamedMessages = currentMessages.map((message, index) =>
  index === currentMessages.length - 1 ? {...message, content: `${message.content} More.`} : message
);

describe("GPTChat renders", () => {
  it("keeps the transcript and history list out of composer keystrokes", async () => {
    const audit = createRenderAudit({ignore: /^(ThemeProvider|TerrenoFontProvider)$/});
    let view: ReturnType<typeof renderWithTheme> | undefined;
    await auditPropChanges({
      audit,
      baseline,
      changes: {
        "last message streamed": {...baseline, currentMessages: streamedMessages},
        "new currentMessages array": {...baseline, currentMessages: [...currentMessages]},
        "new histories array": {...baseline, histories: [...histories]},
        "new onSelectHistory identity": {...baseline, onSelectHistory: (): void => {}},
        "new onSubmit identity": {...baseline, onSubmit: (): void => {}},
        "other history selected": {...baseline, currentHistoryId: "history-2"},
      },
      mount: (props): void => {
        view = renderWithTheme(<GPTChat {...props} />);
      },
      update: (props): void => {
        view?.rerender(<GPTChat {...props} />);
      },
    });
    await audit.step("composer keystroke", async () => {
      await act(async () => {
        fireEvent.changeText(view!.getByTestId("gpt-input"), "H");
      });
    });
    await audit.step("composer second keystroke", async () => {
      await act(async () => {
        fireEvent.changeText(view!.getByTestId("gpt-input"), "He");
      });
    });
    const report = audit.report();
    audit.dispose();
    view?.unmount();
    if (process.env.RENDER_AUDIT_PRINT) {
      console.info(`\n## GPTChat\n${formatReport(report, {limit: 25})}`);
    }
    for (const step of ["composer keystroke", "composer second keystroke"]) {
      expect(componentStat(report, step, "MessageList")).toBeUndefined();
      expect(componentStat(report, step, "ChatMessageRow")).toBeUndefined();
      expect(componentStat(report, step, "HistorySidebar")).toBeUndefined();
      expect(componentStat(report, step, "HistoryItemTitle")).toBeUndefined();
    }
    expect(componentStat(report, "last message streamed", "ChatMessageRow")?.updates).toBe(1);
    expect(componentStat(report, "last message streamed", "HistorySidebar")).toBeUndefined();
    expect(componentStat(report, "new currentMessages array", "ChatMessageRow")).toBeUndefined();
    expect(componentStat(report, "same props", "ChatMessageRow")).toBeUndefined();
    expect(componentStat(report, "same props", "HistoryItemTitle")).toBeUndefined();
  });
});
