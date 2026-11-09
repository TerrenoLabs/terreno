/** RN Web controlled inputs can fire rapid synthetic A↔B onChangeText after typing stops. */
export const TEXT_FIELD_OSCILLATION_WINDOW_MS = 500;

/**
 * DOM `InputEvent.inputType`s that come from the user's own keys, paste, drop or undo.
 * A change carrying one of these is a real edit and is never suppressed: typing a
 * character and backspacing it within the window is a typo fix, not an oscillation.
 * Spellcheck replacement (`insertReplacementText`), IME composition and changes with no
 * input event at all stay guarded.
 */
const USER_EDIT_INPUT_TYPE =
  /^(insertText|insertFromPaste|insertFromDrop|insertLineBreak|insertParagraph|delete|history)/;

export const isUserEditInputType = (inputType: string | undefined): boolean =>
  Boolean(inputType && USER_EDIT_INPUT_TYPE.test(inputType));

export interface TextFieldOscillationState {
  priorText: string | null;
  priorTime: number;
  lastText: string | null;
  lastTime: number;
}

export const createTextFieldOscillationState = (): TextFieldOscillationState => ({
  lastText: null,
  lastTime: 0,
  priorText: null,
  priorTime: 0,
});

export const resetTextFieldOscillationState = (state: TextFieldOscillationState): void => {
  state.priorText = null;
  state.priorTime = 0;
  state.lastText = null;
  state.lastTime = 0;
};

const isOscillationHistoryStale = ({
  now,
  state,
  windowMs,
}: {
  now: number;
  state: TextFieldOscillationState;
  windowMs: number;
}): boolean => state.lastTime > 0 && now - state.lastTime > windowMs;

/** True when `text` completes a rapid prior → last → prior reversal (A→B→A). */
export const shouldSuppressTextFieldOscillation = ({
  currentValue,
  inputType,
  now,
  state,
  text,
  windowMs = TEXT_FIELD_OSCILLATION_WINDOW_MS,
}: {
  currentValue: string;
  /** The DOM input event's `inputType`, on web; see `isUserEditInputType`. */
  inputType?: string;
  now: number;
  state: TextFieldOscillationState;
  text: string;
  windowMs?: number;
}): boolean => {
  if (isUserEditInputType(inputType)) {
    return false;
  }

  if (isOscillationHistoryStale({now, state, windowMs})) {
    resetTextFieldOscillationState(state);
    return false;
  }

  const {priorText, priorTime, lastText, lastTime} = state;
  if (priorText === null || lastText === null) {
    return false;
  }

  return (
    text === priorText &&
    text !== lastText &&
    text !== currentValue &&
    now - priorTime <= windowMs &&
    now - lastTime <= windowMs
  );
};

export const recordTextFieldOscillation = ({
  currentValue,
  now,
  state,
  text,
  windowMs = TEXT_FIELD_OSCILLATION_WINDOW_MS,
}: {
  currentValue: string;
  now: number;
  state: TextFieldOscillationState;
  text: string;
  windowMs?: number;
}): void => {
  if (isOscillationHistoryStale({now, state, windowMs})) {
    resetTextFieldOscillationState(state);
  }

  state.priorText = currentValue;
  state.priorTime = state.lastTime > 0 ? state.lastTime : now;
  state.lastText = text;
  state.lastTime = now;
};
