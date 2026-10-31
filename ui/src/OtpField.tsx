import type {FC, ReactElement} from "react";
import {useCallback, useEffect, useRef, useState} from "react";
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
  const {theme} = useTheme();
  const isControlled = value !== undefined;
  const [internalCode, setInternalCode] = useState("");
  const code = toDigits(isControlled ? value : internalCode).slice(0, length);
  // Roving tab stop: only the cell that takes the next digit is in the tab order, so Tab and
  // Shift+Tab leave the field instead of landing on a cell that hands focus back.
  const activeIndex = Math.min(code.length, length - 1);

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

  const commit = useCallback(
    (next: string): void => {
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
    },
    [code, isControlled, length, onChange, onComplete]
  );

  const handleChangeText = useCallback(
    (index: number, text: string): void => {
      const result = applyCellText({code, index, length, text});
      commit(result.code);
      if (result.focusIndex !== index) {
        focusCell(result.focusIndex);
      }
    },
    [code, commit, focusCell, length]
  );

  const handleKeyPress = useCallback(
    (index: number, event: TextInputKeyPressEvent): void => {
      if (event.nativeEvent.key !== "Backspace" || code[index] || index === 0) {
        return;
      }
      // Backspace in an empty cell deletes the previous digit and moves there.
      commit(code.slice(0, index - 1) + code.slice(index));
      focusCell(index - 1);
    },
    [code, commit, focusCell]
  );

  const handleFocus = useCallback(
    (index: number): void => {
      // Digits fill left to right: a tap past the active cell lands on that cell instead. Keyboard
      // focus never needs this, because only the active cell is a tab stop.
      if (index > activeIndex) {
        focusCell(activeIndex);
        return;
      }
      setFocusedIndex(index);
    },
    [activeIndex, focusCell]
  );

  const handleBlur = useCallback((index: number): void => {
    setFocusedIndex((current) => (current === index ? null : current));
  }, []);

  const renderCell = (index: number): ReactElement => {
    const isFocused = focusedIndex === index;
    let borderColor = theme.border.dark;
    let borderWidth = 1;
    if (errorText || invalid) {
      borderColor = theme.border.error;
      borderWidth = 2;
    }
    if (isFocused) {
      borderColor = theme.border.focus;
      borderWidth = 3;
    }
    return (
      <TextInput
        {...ONE_TIME_CODE_PROPS}
        accessibilityLabel={`Digit ${index + 1} of ${length}`}
        accessibilityState={{disabled}}
        aria-invalid={Boolean(errorText) || invalid}
        aria-label={`Digit ${index + 1} of ${length}`}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!disabled}
        enterKeyHint="done"
        inputMode="numeric"
        key={index}
        keyboardType="number-pad"
        nativeID={`${testID}-cell-${index + 1}`}
        onBlur={() => handleBlur(index)}
        onChangeText={(text: string) => handleChangeText(index, text)}
        onFocus={() => handleFocus(index)}
        onKeyPress={(event: TextInputKeyPressEvent) => handleKeyPress(index, event)}
        onSubmitEditing={() => onEnter?.(code)}
        ref={(ref) => {
          inputRefs.current[index] = ref;
        }}
        selectTextOnFocus
        style={
          {
            backgroundColor: disabled ? theme.surface.neutralLight : theme.surface.base,
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
        tabIndex={index === activeIndex ? 0 : -1}
        testID={`${testID}-cell-${index + 1}`}
        underlineColorAndroid="transparent"
        value={code[index] ?? ""}
      />
    );
  };

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
        {Array.from({length}, (_, index) => renderCell(index))}
      </View>
      {Boolean(errorText) && <FieldError testID={`${testID}-error`} text={errorText!} />}
      {Boolean(helperText) && <FieldHelperText testID={`${testID}-helper`} text={helperText!} />}
    </View>
  );
};
