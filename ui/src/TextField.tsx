import {getCalendars} from "expo-localization";
import {type FC, useCallback, useEffect, useMemo, useRef, useState} from "react";
import {
  type DimensionValue,
  type KeyboardTypeOptions,
  Platform,
  Pressable,
  type StyleProp,
  TextInput,
  type TextInputChangeEvent,
  type TextInputProps,
  View,
} from "react-native";

import {AiSuggestionBox} from "./AiSuggestionBox";
import type {TextFieldProps, TextStyleWithOutline} from "./Common";
import {FieldError} from "./fieldElements/FieldError";
import {FieldHelperText} from "./fieldElements/FieldHelperText";
import {FieldTitle} from "./fieldElements/FieldTitle";
import {Icon} from "./Icon";
import {useTheme} from "./Theme";
import {resolveFieldTestIDsFromProps} from "./testing/resolveTestId";
import {
  createTextFieldOscillationState,
  recordTextFieldOscillation,
  shouldSuppressTextFieldOscillation,
} from "./textFieldOscillationGuard";

const keyboardMap: {[id: string]: string | undefined} = {
  date: "default",
  decimal: "decimal-pad",
  decimalRange: "decimal-pad",
  email: "email-address",
  height: "default",
  number: "number-pad",
  numberRange: "number-pad",
  password: "default",
  phoneNumber: "number-pad",
  search: "default",
  text: "default",
  url: Platform.select({
    android: "default",
    ios: "url",
  }),
  username: "default",
};

// Not an exhaustive list of all the textContent types, but the ones we use.
const textContentMap: {
  [id: string]: "none" | "emailAddress" | "password" | "username" | "URL" | undefined;
} = {
  date: "none",
  decimal: "none",
  decimalRange: "none",
  email: "emailAddress",
  height: "none",
  number: "none",
  password: "password",
  search: "none",
  text: "none",
  url: Platform.select({
    android: "none",
    ios: "URL",
  }),
  username: "username",
};

type TextFieldAutoComplete = NonNullable<TextFieldProps["autoComplete"]>;

/**
 * Native autofill hints for each `autoComplete` value. `autoComplete` goes to React Native, which
 * maps the web token to Android's autofill hint; `textContentType` is iOS's hint. "on" means "no
 * opinion", so the field falls back to the hint for its `type`.
 */
const NATIVE_AUTOFILL: Record<
  TextFieldAutoComplete,
  Pick<TextInputProps, "autoComplete" | "textContentType"> | undefined
> = {
  "current-password": {autoComplete: "current-password", textContentType: "password"},
  email: {autoComplete: "email", textContentType: "emailAddress"},
  "new-password": {autoComplete: "new-password", textContentType: "newPassword"},
  off: {autoComplete: "off", textContentType: "none"},
  on: undefined,
  "one-time-code": {autoComplete: "one-time-code", textContentType: "oneTimeCode"},
  username: {autoComplete: "username", textContentType: "username"},
  // Passkey autofill is web only; native platforms get the plain username hint.
  "username webauthn": {autoComplete: "username", textContentType: "username"},
};

/**
 * The input's autofill props: the raw token on web (react-native-web writes it to the
 * `autocomplete` attribute, which accepts token lists such as "username webauthn"), or the
 * Android and iOS hints on native.
 */
const getAutofillProps = ({
  autoComplete,
  type,
}: {
  autoComplete: TextFieldProps["autoComplete"];
  type: string;
}): Pick<TextInputProps, "autoComplete" | "textContentType"> => {
  const textContentType = textContentMap[type];
  if (Platform.OS === "web") {
    return {
      ...(autoComplete ? ({autoComplete} as unknown as Pick<TextInputProps, "autoComplete">) : {}),
      textContentType,
    };
  }
  const nativeHints = autoComplete ? NATIVE_AUTOFILL[autoComplete] : undefined;
  return nativeHints ?? {textContentType};
};

interface WebTextInputRef {
  focus: () => void;
  selectionEnd: number | null;
  selectionStart: number | null;
  setSelectionRange: (start: number, end: number) => void;
}

export const TextField: FC<TextFieldProps> = ({
  title,
  disabled,
  helperText,
  errorText,
  errorPosition = "above",
  value,
  onChange,
  placeholder,
  blurOnSubmit = true,
  iconName,
  onIconClick,
  trimOnBlur = true,
  type = "text",
  showVisibilityToggle = true,
  autoComplete,
  inputRef,
  multiline,
  rows = 1,
  grow,
  maxHeight,
  returnKeyType,
  onBlur,
  onFocus,
  onEnter,
  onSubmitEditing,
  testID,
  testIDs,
  id,
  aiSuggestion,
  accessibilityLabel,
  mono = false,
}) => {
  const {theme} = useTheme();
  const fieldTestIDs = resolveFieldTestIDsFromProps({testID, testIDs});

  const calendar = getCalendars()[0];
  const localTimeZone = calendar?.timeZone;
  if (!localTimeZone) {
    console.warn("Could not automatically determine timezone.");
  }

  const [focused, setFocused] = useState(false);
  const [height, setHeight] = useState(rows * 40);
  const [isValueRevealed, setIsValueRevealed] = useState(false);
  const textInputRef = useRef<TextInput | null>(null);

  // Clear stale measured height so the next typed character starts at the default row height.
  useEffect(() => {
    if (grow && !value) {
      setHeight(rows * 40);
    }
  }, [grow, rows, value]);

  const isPasswordField = type === "password";
  const hasVisibilityToggle = isPasswordField && showVisibilityToggle;

  /**
   * Toggles password visibility without blurring the input. Refocuses when the field was focused so
   * trim-on-blur, parent blur handlers, and the native keyboard stay intact.
   */
  const handleVisibilityTogglePress = useCallback((): void => {
    if (disabled) {
      return;
    }
    const wasFocused = focused;
    const webInput =
      Platform.OS === "web" ? (textInputRef.current as unknown as WebTextInputRef | null) : null;
    const selection =
      webInput?.selectionStart !== null &&
      webInput?.selectionStart !== undefined &&
      webInput.selectionEnd !== null
        ? {end: webInput.selectionEnd, start: webInput.selectionStart}
        : undefined;
    setIsValueRevealed((previous) => !previous);
    if (wasFocused) {
      const refocusInput = (): void => {
        textInputRef.current?.focus();
        if (selection && webInput) {
          webInput.setSelectionRange(selection.start, selection.end);
        }
      };
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(refocusInput);
      } else {
        setTimeout(refocusInput, 0);
      }
    }
  }, [disabled, focused]);

  const preventVisibilityToggleBlur = useCallback((event: {preventDefault: () => void}): void => {
    event.preventDefault();
  }, []);
  const visibilityToggleWebProps =
    Platform.OS === "web" ? {onMouseDown: preventVisibilityToggleBlur} : {};

  let borderColor = focused ? theme.field.borderFocus : theme.field.border;
  if (disabled) {
    borderColor = theme.field.borderDisabled;
  } else if (errorText && !focused) {
    borderColor = theme.field.borderError;
  }
  const borderWidth = focused ? 3 : errorText ? 2 : 1;

  const calculatedHeight: DimensionValue = useMemo(() => {
    if (grow) {
      // React Native Web never reports a smaller content size, so an emptied field resets.
      const grownHeight = value ? Math.max(40, height) : rows * 40;
      return maxHeight ? Math.min(grownHeight, maxHeight) : grownHeight;
    } else if (multiline) {
      return height || "100%";
    } else {
      // iOS clips placeholder glyphs (descenders, cap height) when the box is ~fontSize tall;
      // single-line inputs need extra vertical room beyond 16px text.
      return Platform.OS === "ios" ? 24 : 22;
    }
  }, [grow, height, maxHeight, multiline, rows, value]);

  const defaultTextInputStyles = useMemo(() => {
    const style: StyleProp<TextStyleWithOutline> = {
      color: theme.text.primary,
      flex: 1,
      fontFamily: mono ? "monospace" : "text",
      fontSize: 16,
      gap: 10,
      height: calculatedHeight,
      letterSpacing: mono ? 2 : undefined,
      paddingVertical: 0,
      width: "100%",
    };

    if (Platform.OS === "web") {
      style.outline = "none";
    }
    return style;
  }, [calculatedHeight, mono, theme.text.primary]);

  if (["numberRange", "decimalRange", "height"].includes(type)) {
    console.warn(`${type} is not yet supported`);
  }

  // RN Web browser autocorrect/spellcheck fights controlled `value` and can oscillate
  // between variants (e.g. "reachthreshold" vs "reach threshold"), firing onChangeText forever.
  const shouldAutocorrect =
    Platform.OS !== "web" &&
    ["text", "textarea"].includes(type) &&
    (!autoComplete || autoComplete === "on");

  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const oscillationRef = useRef(createTextFieldOscillationState());
  // RN Web calls onChange with the DOM input event just before onChangeText, so this
  // carries the pending change's `inputType` across to handleChangeText.
  const pendingInputTypeRef = useRef<string | undefined>(undefined);
  valueRef.current = value;
  onChangeRef.current = onChange;

  const handleWebChange = useCallback((event: TextInputChangeEvent): void => {
    // On web, nativeEvent is the DOM InputEvent, which RN's types don't describe.
    const {inputType} = event.nativeEvent as {inputType?: unknown};
    pendingInputTypeRef.current = typeof inputType === "string" ? inputType : undefined;
  }, []);

  const handleChangeText = useCallback((text: string): void => {
    const inputType = pendingInputTypeRef.current;
    pendingInputTypeRef.current = undefined;
    const currentValue = valueRef.current ?? "";
    if (text === currentValue) {
      return;
    }

    const now = performance.now();
    const oscillationState = oscillationRef.current;
    if (
      shouldSuppressTextFieldOscillation({
        currentValue,
        inputType,
        now,
        state: oscillationState,
        text,
      })
    ) {
      return;
    }

    recordTextFieldOscillation({
      currentValue,
      now,
      state: oscillationState,
      text,
    });
    onChangeRef.current(text);
  }, []);

  const autofillProps = getAutofillProps({autoComplete, type: type || "text"});
  const keyboardType = keyboardMap[type];

  return (
    <View
      style={{
        flexDirection: "column",
        width: "100%",
      }}
    >
      {Boolean(title) && <FieldTitle testID={fieldTestIDs.label} text={title!} />}
      {Boolean(errorText) && errorPosition === "above" && (
        <FieldError testID={fieldTestIDs.error} text={errorText!} />
      )}
      <View
        style={{
          backgroundColor: disabled ? theme.field.backgroundDisabled : theme.field.background,
          borderColor,
          borderRadius: 4,
          borderWidth,
          flexDirection: "column",
          gap: aiSuggestion ? 10 : 0,
          overflow: "hidden",
          paddingHorizontal: focused ? 10 : 12,
          paddingVertical: focused ? 6 : 8,
        }}
      >
        {Boolean(aiSuggestion) && (
          <AiSuggestionBox
            testID={fieldTestIDs.input ? `${fieldTestIDs.input}-ai-suggestion` : undefined}
            {...aiSuggestion!}
          />
        )}
        <View
          style={{
            alignItems: "center",
            flexDirection: "row",
          }}
        >
          <TextInput
            {...(Platform.OS === "web" ? {spellCheck: false} : {})}
            {...autofillProps}
            accessibilityHint="Enter text here"
            accessibilityState={{disabled}}
            aria-describedby={errorText ? fieldTestIDs.error : undefined}
            aria-invalid={Boolean(errorText)}
            aria-label={accessibilityLabel ?? "Text input field"}
            autoCapitalize={type === "text" ? "sentences" : "none"}
            autoCorrect={shouldAutocorrect}
            blurOnSubmit={blurOnSubmit}
            enterKeyHint={returnKeyType}
            keyboardType={keyboardType as KeyboardTypeOptions}
            multiline={multiline}
            nativeID={id}
            numberOfLines={rows || 4}
            {...(Platform.OS === "web" ? {onChange: handleWebChange} : {})}
            onBlur={() => {
              if (disabled) {
                return;
              }
              let finalValue = value ?? "";

              if (trimOnBlur && value) {
                finalValue = finalValue.trim();
                if (finalValue !== value) {
                  onChange(finalValue);
                }
              }
              if (onBlur) {
                onBlur(finalValue);
              }
              setFocused(false);
            }}
            onChangeText={handleChangeText}
            onContentSizeChange={(event) => {
              if (!grow) {
                return;
              }
              setHeight(event.nativeEvent.contentSize.height);
            }}
            onFocus={() => {
              if (!disabled) {
                setFocused(true);
              }
              if (onFocus) {
                onFocus();
              }
            }}
            onSubmitEditing={() => {
              if (onEnter) {
                onEnter();
              }
              if (onSubmitEditing) {
                onSubmitEditing();
              }
            }}
            placeholder={placeholder}
            placeholderTextColor={theme.text.secondaryLight}
            readOnly={disabled}
            ref={(ref) => {
              textInputRef.current = ref;
              if (inputRef) {
                inputRef(ref);
              }
            }}
            secureTextEntry={isPasswordField && !isValueRevealed}
            style={defaultTextInputStyles}
            testID={fieldTestIDs.input}
            underlineColorAndroid="transparent"
            value={value}
          />
          {Boolean(iconName) && (
            <Pressable aria-role="button" onPress={onIconClick}>
              <Icon iconName={iconName!} size="md" />
            </Pressable>
          )}
          {hasVisibilityToggle && (
            <Pressable
              {...visibilityToggleWebProps}
              accessibilityLabel={isValueRevealed ? "Hide password" : "Show password"}
              accessibilityRole="button"
              accessibilityState={{disabled, expanded: isValueRevealed}}
              disabled={disabled}
              hitSlop={8}
              onPress={handleVisibilityTogglePress}
              // Fixed width keeps the input from reflowing: the eye-slash glyph is wider than the eye.
              style={{alignItems: "center", marginLeft: 8, width: 20}}
              testID={fieldTestIDs.visibilityToggle}
            >
              <Icon
                color={disabled ? "extraLight" : "link"}
                iconName={isValueRevealed ? "eye-slash" : "eye"}
                size="md"
              />
            </Pressable>
          )}
        </View>
      </View>
      {Boolean(errorText) && errorPosition === "below" && (
        <FieldError testID={fieldTestIDs.error} text={errorText!} />
      )}
      {Boolean(helperText) && <FieldHelperText testID={fieldTestIDs.helper} text={helperText!} />}
      {/* {type === "numberRange" && value && (
        <NumberPickerActionSheet
          actionSheetRef={numberRangeActionSheetRef}
          max={max || (min || 0) + 100}
          min={min || 0}
          value={value}
          onChange={(result) => onChange(result)}
        />
      )}
      {type === "decimalRange" && value && (
        <DecimalRangeActionSheet
          actionSheetRef={decimalRangeActionSheetRef}
          max={max || (min || 0) + 100}
          min={min || 0}
          value={value}
          onChange={(result) => onChange(result)}
        />
      )} */}
      {/* {type === "height" && (
        <HeightActionSheet
          actionSheetRef={weightActionSheetRef}
          value={value}
          onChange={(result) => {
            onChange(result);
          }}
        />
      )} */}
    </View>
  );
};
