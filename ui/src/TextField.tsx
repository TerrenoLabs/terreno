import {getCalendars} from "expo-localization";
import {type FC, useCallback, useEffect, useMemo, useRef, useState} from "react";
import {
  type DimensionValue,
  type KeyboardTypeOptions,
  Platform,
  Pressable,
  type StyleProp,
  TextInput,
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

  let borderColor = focused ? theme.border.focus : theme.border.dark;
  if (disabled) {
    borderColor = theme.border.activeNeutral;
  } else if (errorText) {
    borderColor = theme.border.error;
  }

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
      fontFamily: "text",
      fontSize: 16,
      gap: 10,
      height: calculatedHeight,
      paddingVertical: 0,
      width: "100%",
    };

    if (Platform.OS === "web") {
      style.outline = "none";
    }
    return style;
  }, [calculatedHeight, theme.text.primary]);

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
  valueRef.current = value;
  onChangeRef.current = onChange;

  const handleChangeText = useCallback((text: string): void => {
    const currentValue = valueRef.current ?? "";
    if (text === currentValue) {
      return;
    }

    const now = performance.now();
    const oscillationState = oscillationRef.current;
    if (
      shouldSuppressTextFieldOscillation({
        currentValue,
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

  const keyboardType = keyboardMap[type];
  const textContentType = textContentMap[type || "text"];

  return (
    <View
      style={{
        flexDirection: "column",
        width: "100%",
      }}
    >
      {Boolean(title) && <FieldTitle testID={fieldTestIDs.label} text={title!} />}
      {Boolean(errorText) && <FieldError testID={fieldTestIDs.error} text={errorText!} />}
      <View
        style={{
          backgroundColor: disabled ? theme.surface.neutralLight : theme.surface.base,
          borderColor,
          borderRadius: 4,
          borderWidth: focused ? 3 : 1,
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
            accessibilityHint="Enter text here"
            accessibilityState={{disabled}}
            aria-label="Text input field"
            autoCapitalize={type === "text" ? "sentences" : "none"}
            autoCorrect={shouldAutocorrect}
            blurOnSubmit={blurOnSubmit}
            enterKeyHint={returnKeyType}
            keyboardType={keyboardType as KeyboardTypeOptions}
            multiline={multiline}
            nativeID={id}
            numberOfLines={rows || 4}
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
            textContentType={textContentType}
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
