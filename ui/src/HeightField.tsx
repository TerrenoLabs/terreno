import {type FC, useCallback, useEffect, useMemo, useRef, useState} from "react";
import {Platform, Pressable, type StyleProp, TextInput, View} from "react-native";

import type {ActionSheet} from "./ActionSheet";
import {Box} from "./Box";
import type {HeightFieldProps, TextStyleWithOutline} from "./Common";
import {FieldError} from "./fieldElements/FieldError";
import {FieldHelperText} from "./fieldElements/FieldHelperText";
import {FieldTitle} from "./fieldElements/FieldTitle";
import {HeightActionSheet} from "./HeightActionSheet";
import {isNarrowViewport} from "./MediaQuery";
import {SelectField} from "./SelectField";
import {Text} from "./Text";
import {useTheme} from "./Theme";
import {isNative} from "./Utilities";

// Height bounds in inches. Default range covers typical human heights (0–7ft 11in).
const DEFAULT_MIN_INCHES = 0;
const DEFAULT_MAX_INCHES = 95; // 7ft 11in

const inchesToFeetAndInches = (totalInches: string | undefined): {feet: string; inches: string} => {
  if (!totalInches) {
    return {feet: "", inches: ""};
  }
  const total = parseInt(totalInches, 10);
  if (Number.isNaN(total)) {
    return {feet: "", inches: ""};
  }
  const feet = Math.floor(total / 12);
  const inches = total % 12;
  return {feet: String(feet), inches: String(inches)};
};

const feetAndInchesToInches = (feet: string, inches: string): string => {
  const feetNum = parseInt(feet, 10) || 0;
  const inchesNum = parseInt(inches, 10) || 0;
  return String(feetNum * 12 + inchesNum);
};

const formatHeightDisplay = (totalInches: string | undefined): string => {
  if (!totalInches) {
    return "";
  }
  const {feet, inches} = inchesToFeetAndInches(totalInches);
  if (!feet && !inches) {
    return "";
  }
  return `${feet}ft ${inches}in`;
};

interface HeightSegmentProps {
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  onFocus: () => void;
  placeholder: string;
  label: string;
  disabled?: boolean;
  maxValue: number;
  inputRef?: (ref: TextInput | null) => void;
  error?: boolean;
  focused?: boolean;
}

const HeightSegment: FC<HeightSegmentProps> = ({
  value,
  onChange,
  onBlur,
  onFocus,
  placeholder,
  label,
  disabled,
  maxValue,
  inputRef,
  error,
  focused,
}) => {
  const {theme} = useTheme();

  const handleChange = useCallback(
    (text: string) => {
      const numericValue = text.replace(/[^0-9]/g, "");
      if (numericValue === "") {
        onChange("");
        return;
      }
      const num = parseInt(numericValue, 10);
      if (num <= maxValue) {
        onChange(numericValue);
      }
    },
    [onChange, maxValue]
  );

  let borderColor = focused ? theme.border.focus : theme.border.dark;
  if (disabled) {
    borderColor = theme.border.activeNeutral;
  } else if (error) {
    borderColor = theme.border.error;
  }

  return (
    <View style={{alignItems: "center", flexDirection: "row", gap: 4}}>
      <View
        style={{
          alignItems: "center",
          backgroundColor: disabled ? theme.surface.neutralLight : theme.surface.base,
          borderColor,
          borderRadius: 4,
          borderWidth: focused ? 3 : 1,
          flexDirection: "row",
          height: 40,
          justifyContent: "center",
          paddingHorizontal: focused ? 6 : 8,
          width: 50,
        }}
      >
        <TextInput
          accessibilityHint={`Enter ${label}`}
          aria-label={`${label} input`}
          editable={!disabled}
          inputMode="numeric"
          onBlur={onBlur}
          onChangeText={handleChange}
          onFocus={onFocus}
          placeholder={placeholder}
          placeholderTextColor={theme.text.secondaryLight}
          ref={inputRef}
          selectTextOnFocus
          style={
            {
              color: error ? theme.text.error : theme.text.primary,
              fontFamily: "text",
              fontSize: 16,
              textAlign: "center",
              width: "100%",
              ...(Platform.OS === "web" ? {outline: "none"} : {}),
            } as StyleProp<TextStyleWithOutline>
          }
          value={value}
        />
      </View>
      <Text>{label}</Text>
    </View>
  );
};

export const HeightField: FC<HeightFieldProps> = ({
  title,
  disabled,
  helperText,
  errorText,
  value,
  onChange,
  testID,
  min,
  max,
}) => {
  const {theme} = useTheme();
  const actionSheetRef = useRef<ActionSheet | null>(null);
  const isMobileOrNative = isNarrowViewport() || isNative();

  const minInches = min ?? DEFAULT_MIN_INCHES;
  const maxInches = max ?? DEFAULT_MAX_INCHES;
  const minFeet = Math.floor(minInches / 12);
  const maxFeet = Math.floor(maxInches / 12);
  const isAndroid = Platform.OS === "android";

  const {feet: initialFeet, inches: initialInches} = inchesToFeetAndInches(value);
  const [feet, setFeet] = useState(initialFeet);
  const [inches, setInches] = useState(initialInches);
  const [focusedSegment, setFocusedSegment] = useState<"feet" | "inches" | null>(null);

  // Sync local state when value prop changes
  useEffect(() => {
    const {feet: newFeet, inches: newInches} = inchesToFeetAndInches(value);
    setFeet(newFeet);
    setInches(newInches);
  }, [value]);

  const handleFeetChange = useCallback(
    (newFeet: string) => {
      setFeet(newFeet);
      if (newFeet || inches) {
        const totalInches = feetAndInchesToInches(newFeet, inches);
        onChange(totalInches);
      } else {
        onChange("");
      }
    },
    [inches, onChange]
  );

  const handleInchesChange = useCallback(
    (newInches: string) => {
      setInches(newInches);
      if (feet || newInches) {
        const totalInches = feetAndInchesToInches(feet, newInches);
        onChange(totalInches);
      } else {
        onChange("");
      }
    },
    [feet, onChange]
  );

  const handleBlur = useCallback(() => {
    setFocusedSegment(null);
    if (feet || inches) {
      const totalInches = feetAndInchesToInches(feet, inches);
      onChange(totalInches);
    }
  }, [feet, inches, onChange]);

  const handleActionSheetChange = useCallback(
    (newValue: string) => {
      onChange(newValue);
    },
    [onChange]
  );

  const openActionSheet = useCallback(() => {
    if (disabled) {
      return;
    }
    actionSheetRef.current?.setModalVisible(true);
  }, [disabled]);

  // Generate select options for Android picker
  const feetOptions = useMemo(
    () =>
      Array.from({length: maxFeet - minFeet + 1}, (_, i) => ({
        label: `${minFeet + i} ft`,
        value: String(minFeet + i),
      })),
    [minFeet, maxFeet]
  );
  const inchesOptions = useMemo(
    () =>
      Array.from({length: 12}, (_, i) => ({
        label: `${i} in`,
        value: String(i),
      })),
    []
  );

  let borderColor = theme.border.dark;
  if (disabled) {
    borderColor = theme.border.activeNeutral;
  } else if (errorText) {
    borderColor = theme.border.error;
  }

  if (isAndroid) {
    return (
      <View style={{flexDirection: "column", width: "100%"}} testID={testID}>
        {Boolean(title) && <FieldTitle text={title!} />}
        {Boolean(errorText) && <FieldError text={errorText!} />}
        <Box direction="row" gap={2}>
          <Box flex="grow">
            <SelectField
              disabled={disabled}
              onChange={handleFeetChange}
              options={feetOptions}
              placeholder="ft"
              value={feet}
            />
          </Box>
          <Box flex="grow">
            <SelectField
              disabled={disabled}
              onChange={handleInchesChange}
              options={inchesOptions}
              placeholder="in"
              value={inches}
            />
          </Box>
        </Box>
        {Boolean(helperText) && <FieldHelperText text={helperText!} />}
      </View>
    );
  }

  if (isMobileOrNative) {
    const formattedHeight = formatHeightDisplay(value);
    const hasValidHeight = Boolean(formattedHeight);

    return (
      <View style={{flexDirection: "column", width: "100%"}} testID={testID}>
        {Boolean(title) && <FieldTitle text={title!} />}
        {Boolean(errorText) && <FieldError text={errorText!} />}
        <Pressable
          accessibilityHint="Tap to select height"
          accessibilityLabel="Height selector"
          accessibilityRole="button"
          disabled={disabled}
          onPress={openActionSheet}
        >
          <View
            style={{
              alignItems: "center",
              backgroundColor: disabled ? theme.surface.neutralLight : theme.surface.base,
              borderColor,
              borderRadius: 4,
              borderWidth: 1,
              flexDirection: "row",
              minHeight: 40,
              paddingHorizontal: 12,
              paddingVertical: 8,
            }}
          >
            <Text color={hasValidHeight ? "primary" : "secondaryLight"}>
              {hasValidHeight ? formattedHeight : "Select height"}
            </Text>
          </View>
        </Pressable>
        {Boolean(helperText) && <FieldHelperText text={helperText!} />}
        <HeightActionSheet
          actionSheetRef={actionSheetRef}
          max={maxInches}
          min={minInches}
          onChange={handleActionSheetChange}
          title={title}
          value={value || "60"}
        />
      </View>
    );
  }

  return (
    <View style={{flexDirection: "column", width: "100%"}} testID={testID}>
      {Boolean(title) && <FieldTitle text={title!} />}
      {Boolean(errorText) && <FieldError text={errorText!} />}
      <Box direction="row" gap={4}>
        <HeightSegment
          disabled={disabled}
          error={Boolean(errorText)}
          focused={focusedSegment === "feet"}
          label="ft"
          maxValue={maxFeet}
          onBlur={handleBlur}
          onChange={handleFeetChange}
          onFocus={() => setFocusedSegment("feet")}
          placeholder="0"
          value={feet}
        />
        <HeightSegment
          disabled={disabled}
          error={Boolean(errorText)}
          focused={focusedSegment === "inches"}
          label="in"
          maxValue={11}
          onBlur={handleBlur}
          onChange={handleInchesChange}
          onFocus={() => setFocusedSegment("inches")}
          placeholder="0"
          value={inches}
        />
      </Box>
      {Boolean(helperText) && <FieldHelperText text={helperText!} />}
    </View>
  );
};
