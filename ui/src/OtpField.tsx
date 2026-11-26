import type {FC} from "react";
import {memo, useCallback, useEffect, useMemo, useRef, useState} from "react";
import {
  Platform,
  type StyleProp,
  TextInput,
  type TextInputInstance,
  type TextInputKeyPressEvent,
  type TextInputProps,
  View,
} from "react-native";

import type {TextStyleWithOutline} from "./Common";
import {FieldError} from "./fieldElements/FieldError";
import {FieldHelperText} from "./fieldElements/FieldHelperText";
import {FieldTitle} from "./fieldElements/FieldTitle";
import {useTheme} from "./Theme";
import {useStableCallback} from "./useStableCallback";

const DEFAULT_LENGTH = 6;
const CELL_WIDTH = 48;
const CELL_HEIGHT = 56;

/**
 * Props for {@link OtpField}.
 */
export interface OtpFieldProps {
  /**
   * Number of digits in the code.
   * @default 6
   */
  length?: number;
  /**
   * The current code (digits only). Pass it with `onChange` to control the field; leave it out to
   * let the field keep its own state.
   */
  value?: string;
  /** Called with the digits entered so far whenever the code changes. */
  onChange?: (value: string) => void;
  /** Called once every cell holds a digit, after typing, pasting, or one-time-code autofill. */
  onComplete?: (code: string) => void;
  /** Called with the digits entered so far when the user presses Enter in a cell. */
  onEnter?: (code: string) => void;
  /** Label above the cells. */
  title?: string;
  /**
   * Accessible name for the group of cells.
   * @default "Verification code"
   */
  accessibilityLabel?: string;
  /** Helper text below the cells. */
  helperText?: string;
  /** Error text below the cells; the cells get an error border. */
  errorText?: string;
  /** Error border without rendering `errorText`, for a message the parent draws itself. */
  invalid?: boolean;
  /** Disables every cell. */
  disabled?: boolean;
  /** Focuses the first empty cell on mount. */
  autoFocus?: boolean;
  /**
   * Root testID. Cells are `${testID}-cell-${k}` with `k` from 1 to `length`.
   * @default "otp-field"
   */
  testID?: string;
}

// react-native-web writes `autoComplete` straight to the input's `autocomplete` attribute.
// Android's autofill hint for SMS codes is "sms-otp"; iOS and web use "one-time-code".
const ONE_TIME_CODE_PROPS = {
  autoComplete: Platform.select({android: "sms-otp", default: "one-time-code"}),
  textContentType: "oneTimeCode",
} as Pick<TextInputProps, "autoComplete" | "textContentType">;

const toDigits = (text: string): string => text.replace(/\D/g, "");

/**
 * Applies a cell's new text to the code. A single digit replaces that cell. A full-length run of
 * digits (paste or one-time-code autofill into any cell) replaces the whole code. A shorter run
 * fills forward from the cell. Empty text removes the cell's digit and closes the gap.
 */
const applyCellText = ({
  code,
  index,
  length,
  text,
}: {
  code: string;
  index: number;
  length: number;
  text: string;
}): {code: string; focusIndex: number} => {
  let incoming = toDigits(text);
  const previous = code[index];
  // A filled cell whose text was not selected receives its old digit plus the new one.
  if (previous && incoming.length === 2 && incoming.includes(previous)) {
    incoming = incoming.startsWith(previous) ? incoming.slice(1) : incoming.slice(0, 1);
  }
  // A full code pasted into a filled cell arrives with the cell's old digit in front of it.
  if (previous && incoming.length === length + 1 && incoming.startsWith(previous)) {
    incoming = incoming.slice(1);
  }

  if (incoming.length === 0) {
    if (text.length > 0) {
      // Non-digit input: ignore it and keep the cell as it was.
      return {code, focusIndex: index};
    }
    return {code: code.slice(0, index) + code.slice(index + 1), focusIndex: index};
  }

  if (incoming.length >= length) {
    const full = incoming.slice(0, length);
    return {code: full, focusIndex: length - 1};
  }

  const start = Math.min(index, code.length);
  const next = (code.slice(0, start) + incoming + code.slice(start + incoming.length)).slice(
    0,
    length
  );
  return {code: next, focusIndex: Math.min(start + incoming.length, length - 1)};
};

interface OtpCellProps {
  digit: string;
  disabled: boolean;
  hasError: boolean;
  index: number;
  isActive: boolean;
  isFocused: boolean;
  length: number;
  onBlur: (index: number) => void;
  onChangeText: (index: number, text: string) => void;
  onFocus: (index: number) => void;
  onKeyPress: (index: number, event: TextInputKeyPressEvent) => void;
  onRegisterRef: (index: number, ref: TextInputInstance | null) => void;
  onSubmit: () => void;
  testID: string;
}

// Memoized so typing a digit re-renders the cells whose digit, focus, or tab stop changed, not
// every cell.
const OtpCell: FC<OtpCellProps> = memo(
  ({
    digit,
    disabled,
    hasError,
    index,
    isActive,
    isFocused,
    length,
    onBlur,
    onChangeText,
    onFocus,
    onKeyPress,
    onRegisterRef,
    onSubmit,
    testID,
  }) => {
    const {theme} = useTheme();

    const handleBlur = useCallback((): void => {
      onBlur(index);
    }, [index, onBlur]);
    const handleChangeText = useCallback(
      (text: string): void => {
        onChangeText(index, text);
      },
      [index, onChangeText]
    );
    const handleFocus = useCallback((): void => {
      onFocus(index);
    }, [index, onFocus]);
    const handleKeyPress = useCallback(
      (event: TextInputKeyPressEvent): void => {
        onKeyPress(index, event);
      },
      [index, onKeyPress]
    );
    const handleRef = useCallback(
      (ref: TextInputInstance | null): void => {
        onRegisterRef(index, ref);
      },
      [index, onRegisterRef]
    );
    const accessibilityState = useMemo(() => ({disabled}), [disabled]);

    let borderColor = theme.field.border;
    let borderWidth = 1;
    if (hasError) {
      borderColor = theme.field.borderError;
      borderWidth = 2;
    }
    if (isFocused) {
      borderColor = theme.field.borderFocus;
      borderWidth = 3;
    }
    return (
      <TextInput
        {...ONE_TIME_CODE_PROPS}
        accessibilityLabel={`Digit ${index + 1} of ${length}`}
        accessibilityState={accessibilityState}
        aria-invalid={hasError}
        aria-label={`Digit ${index + 1} of ${length}`}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!disabled}
        enterKeyHint="done"
        inputMode="numeric"
        keyboardType="number-pad"
        nativeID={`${testID}-cell-${index + 1}`}
        onBlur={handleBlur}
        onChangeText={handleChangeText}
        onFocus={handleFocus}
        onKeyPress={handleKeyPress}
        onSubmitEditing={onSubmit}
        ref={handleRef}
        selectTextOnFocus
        style={
          {
            backgroundColor: disabled ? theme.field.backgroundDisabled : theme.field.background,
            borderColor,
            borderRadius: 4,
            borderWidth,
            color: theme.text.primary,
            fontSize: 24,
            fontWeight: "700",
            height: CELL_HEIGHT,
            padding: 0,
            textAlign: "center",
            width: CELL_WIDTH,
            ...(Platform.OS === "web" ? {outline: "none"} : {}),
          } as StyleProp<TextStyleWithOutline>
        }
        tabIndex={isActive ? 0 : -1}
        testID={`${testID}-cell-${index + 1}`}
        underlineColorAndroid="transparent"
        value={digit}
      />
    );
  }
);
OtpCell.displayName = "OtpCell";

/**
 * A one-time code input: one cell per digit, a numeric keyboard, paste and SMS / one-time-code
 * autofill of the whole code, and backspace that steps back a cell. `onComplete` fires when every
 * cell is filled.
 *
 * @example
 * ```tsx
 * <OtpField
 *   autoFocus
 *   onComplete={(code) => verifyTotp({code})}
 *   testID="two-factor-otp"
 * />
 * ```
 */
export const OtpField: FC<OtpFieldProps> = ({
  length = DEFAULT_LENGTH,
  value,
  onChange,
  onComplete,
  onEnter,
  title,
  accessibilityLabel = "Verification code",
  helperText,
  errorText,
  invalid = false,
  disabled = false,
  autoFocus = false,
  testID = "otp-field",
}) => {
  const isControlled = value !== undefined;
  const [internalCode, setInternalCode] = useState("");
  const code = toDigits(isControlled ? value : internalCode).slice(0, length);
  // Roving tab stop: only the cell that takes the next digit is in the tab order, so Tab and
  // Shift+Tab leave the field instead of landing on a cell that hands focus back.
  const activeIndex = Math.min(code.length, length - 1);
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;

  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const inputRefs = useRef<(TextInputInstance | null)[]>([]);

  const focusCell = useCallback((index: number): void => {
    inputRefs.current[index]?.focus();
  }, []);

  // Focus the first empty cell on mount when asked, so the user can type or autofill at once.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount only; later focus follows typing.
  useEffect(() => {
    if (autoFocus) {
      focusCell(activeIndex);
    }
  }, []);

  const commit = (next: string): void => {
    activeIndexRef.current = Math.min(next.length, length - 1);
    if (next === code) {
      return;
    }
    if (!isControlled) {
      setInternalCode(next);
    }
    onChange?.(next);
    if (next.length === length) {
      onComplete?.(next);
    }
  };

  // Stable identities so a memoized cell re-renders only when its own digit or state changes.
  const handleChangeText = useStableCallback((index: number, text: string): void => {
    const result = applyCellText({code, index, length, text});
    commit(result.code);
    if (result.focusIndex !== index) {
      focusCell(result.focusIndex);
    }
  });

  const handleKeyPress = useStableCallback((index: number, event: TextInputKeyPressEvent): void => {
    if (event.nativeEvent.key !== "Backspace" || code[index] || index === 0) {
      return;
    }
    // Backspace in an empty cell deletes the previous digit and moves there.
    commit(code.slice(0, index - 1) + code.slice(index));
    focusCell(index - 1);
  });

  const handleFocus = useCallback(
    (index: number): void => {
      // Digits fill left to right: a tap past the active cell lands on that cell instead. Keyboard
      // focus never needs this, because only the active cell is a tab stop.
      if (index > activeIndexRef.current) {
        focusCell(activeIndexRef.current);
        return;
      }
      setFocusedIndex(index);
    },
    [focusCell]
  );

  const handleBlur = useCallback((index: number): void => {
    setFocusedIndex((current) => (current === index ? null : current));
  }, []);

  const handleSubmit = useStableCallback((): void => {
    onEnter?.(code);
  });

  const registerRef = useCallback((index: number, ref: TextInputInstance | null): void => {
    inputRefs.current[index] = ref;
  }, []);

  const hasError = Boolean(errorText) || invalid;

  return (
    <View style={{flexDirection: "column", gap: 4}}>
      {Boolean(title) && <FieldTitle testID={`${testID}-title`} text={title!} />}
      <View
        accessibilityLabel={accessibilityLabel}
        aria-label={accessibilityLabel}
        role="group"
        style={{flexDirection: "row", flexWrap: "wrap", gap: 8}}
        testID={testID}
      >
        {Array.from({length}, (_, index) => (
          <OtpCell
            digit={code[index] ?? ""}
            disabled={disabled}
            hasError={hasError}
            index={index}
            isActive={index === activeIndex}
            isFocused={focusedIndex === index}
            key={index}
            length={length}
            onBlur={handleBlur}
            onChangeText={handleChangeText}
            onFocus={handleFocus}
            onKeyPress={handleKeyPress}
            onRegisterRef={registerRef}
            onSubmit={handleSubmit}
            testID={testID}
          />
        ))}
      </View>
      {Boolean(errorText) && <FieldError testID={`${testID}-error`} text={errorText!} />}
      {Boolean(helperText) && <FieldHelperText testID={`${testID}-helper`} text={helperText!} />}
    </View>
  );
};
