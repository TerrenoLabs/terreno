import {describe, expect, it} from "bun:test";
import {
  createTextFieldOscillationState,
  isUserEditInputType,
  recordTextFieldOscillation,
  shouldSuppressTextFieldOscillation,
  TEXT_FIELD_OSCILLATION_WINDOW_MS,
} from "./textFieldOscillationGuard";

describe("textFieldOscillationGuard", () => {
  it("suppresses rapid A→B→A synthetic alternation", () => {
    const state = createTextFieldOscillationState();
    const valueA = "reachthreshold";
    const valueB = "reach threshold";
    let now = 1_000;

    expect(
      shouldSuppressTextFieldOscillation({currentValue: valueA, now, state, text: valueB})
    ).toBe(false);
    recordTextFieldOscillation({currentValue: valueA, now, state, text: valueB});

    now += 10;
    expect(
      shouldSuppressTextFieldOscillation({currentValue: valueB, now, state, text: valueA})
    ).toBe(true);

    now += 10;
    expect(
      shouldSuppressTextFieldOscillation({currentValue: valueB, now, state, text: valueA})
    ).toBe(true);
  });

  it("allows ordinary backspace and retype after the oscillation window", () => {
    const state = createTextFieldOscillationState();
    const hello = "hello";
    const hell = "hell";
    let now = 2_000;

    expect(shouldSuppressTextFieldOscillation({currentValue: hello, now, state, text: hell})).toBe(
      false
    );
    recordTextFieldOscillation({currentValue: hello, now, state, text: hell});

    now += TEXT_FIELD_OSCILLATION_WINDOW_MS + 1;
    expect(shouldSuppressTextFieldOscillation({currentValue: hell, now, state, text: hello})).toBe(
      false
    );
  });

  it("allows forward typing that does not revisit a recent prior value", () => {
    const state = createTextFieldOscillationState();
    let now = 3_000;

    expect(shouldSuppressTextFieldOscillation({currentValue: "h", now, state, text: "he"})).toBe(
      false
    );
    recordTextFieldOscillation({currentValue: "h", now, state, text: "he"});

    now += 5;
    expect(shouldSuppressTextFieldOscillation({currentValue: "he", now, state, text: "hel"})).toBe(
      false
    );
  });
});

describe("textFieldOscillationGuard user edits", () => {
  it("never suppresses a change the user typed, even an A→B→A typo fix", () => {
    const state = createTextFieldOscillationState();
    let now = 4_000;

    recordTextFieldOscillation({currentValue: "hello", now, state, text: "hellox"});
    now += 150;
    expect(
      shouldSuppressTextFieldOscillation({
        currentValue: "hellox",
        inputType: "deleteContentBackward",
        now,
        state,
        text: "hello",
      })
    ).toBe(false);
    // The same reversal without an input event is still treated as an oscillation.
    expect(
      shouldSuppressTextFieldOscillation({currentValue: "hellox", now, state, text: "hello"})
    ).toBe(true);
  });

  it("still suppresses a spellcheck replacement that reverses a recent change", () => {
    const state = createTextFieldOscillationState();
    let now = 5_000;

    recordTextFieldOscillation({
      currentValue: "reachthreshold",
      now,
      state,
      text: "reach threshold",
    });
    now += 10;
    expect(
      shouldSuppressTextFieldOscillation({
        currentValue: "reach threshold",
        inputType: "insertReplacementText",
        now,
        state,
        text: "reachthreshold",
      })
    ).toBe(true);
  });

  it("classifies typing, deleting, paste and undo as user edits", () => {
    for (const inputType of [
      "insertText",
      "insertFromPaste",
      "insertLineBreak",
      "deleteContentBackward",
      "deleteWordBackward",
      "historyUndo",
    ]) {
      expect(isUserEditInputType(inputType)).toBe(true);
    }
    for (const inputType of [undefined, "", "insertReplacementText", "insertCompositionText"]) {
      expect(isUserEditInputType(inputType)).toBe(false);
    }
  });
});
