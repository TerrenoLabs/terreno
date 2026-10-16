import {afterEach, describe, expect, it, mock} from "bun:test";
import {renderHook} from "@testing-library/react-native";
import {
  agreementStatus,
  agreementVerdict,
  formatAnswer,
  formatPercent,
  previewText,
  unwrapBatchDetail,
  unwrapBatchList,
} from "./batchTypes";
import {type ReviewShortcutAction, useReviewShortcuts} from "./reviewShortcuts";
import {dimensionLabel, firstUnanswered} from "./reviewTypes";

describe("batchTypes", () => {
  it("formats agreement as a percent with a traffic-light status", () => {
    expect(formatPercent(31 / 32)).toBe("97%");
    expect(formatPercent(undefined)).toBe("—");
    expect(agreementStatus(0.95)).toBe("success");
    expect(agreementStatus(0.78)).toBe("warning");
    expect(agreementStatus(0.5)).toBe("error");
    expect(agreementStatus(undefined)).toBe("neutral");
    expect(agreementVerdict(0.9)).toBe("Matches humans");
    expect(agreementVerdict(undefined)).toBe("No human answers yet");
  });

  it("formats answers and previews", () => {
    expect(formatAnswer(true)).toBe("Yes");
    expect(formatAnswer(false)).toBe("No");
    expect(formatAnswer(undefined)).toBe("—");
    expect(previewText("a\n  b", 10)).toBe("a b");
    expect(previewText("x".repeat(20), 10)).toBe(`${"x".repeat(9)}…`);
  });

  it("unwraps list and detail payloads", () => {
    expect(unwrapBatchList({data: [{id: "b1"}]})).toEqual([{id: "b1"}] as never);
    expect(unwrapBatchList({})).toEqual([]);
    expect(unwrapBatchDetail({data: {id: "b1", items: [], judges: []}})?.id).toBe("b1");
    expect(unwrapBatchDetail({data: {id: "b1"}})).toBeUndefined();
  });
});

describe("review question helpers", () => {
  const originalDocument = (globalThis as {document?: unknown}).document;
  afterEach(() => {
    (globalThis as {document?: unknown}).document = originalDocument;
  });

  const dimensions = [
    {dataType: "boolean" as const, key: "a", question: "Is A true?", required: true},
    {dataType: "boolean" as const, key: "b", required: true},
  ];

  it("labels by question and finds the next unanswered question", () => {
    expect(dimensionLabel(dimensions[0] as never)).toBe("Is A true?");
    expect(dimensionLabel(dimensions[1] as never)).toBe("b");
    expect(firstUnanswered(dimensions, {})).toBe("a");
    expect(firstUnanswered(dimensions, {a: false})).toBe("b");
    expect(firstUnanswered(dimensions, {a: false, b: true})).toBeUndefined();
  });

  it("maps keys to shortcuts and ignores typing", () => {
    const listeners: Array<(event: unknown) => void> = [];
    (globalThis as {document?: unknown}).document = {
      addEventListener: (_type: string, listener: (event: unknown) => void) => {
        listeners.push(listener);
      },
      removeEventListener: () => undefined,
    };
    let removed = 0;
    (globalThis as {document?: {removeEventListener: () => void}}).document!.removeEventListener =
      () => {
        removed += 1;
      };
    const actions: ReviewShortcutAction[] = [];
    const hook = renderHook(() =>
      useReviewShortcuts({enabled: true, onAction: (action) => actions.push(action)})
    );
    const press = (event: Record<string, unknown>): void => {
      for (const listener of listeners) {
        listener({preventDefault: mock(() => {}), ...event});
      }
    };
    press({key: "y"});
    press({key: "N"});
    press({key: "1"});
    press({key: "Enter"});
    press({key: "s"});
    press({key: "x"});
    press({key: "y", metaKey: true});
    press({key: "y", target: {tagName: "TEXTAREA"}});
    press({key: "y", target: {tagName: "DIV"}});
    expect(actions).toEqual(["yes", "no", "yes", "submit", "skip", "yes"]);
    hook.unmount();
    expect(removed).toBe(1);
  });
});
