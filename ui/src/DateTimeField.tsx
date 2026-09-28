import {FontAwesome6} from "@expo/vector-icons";
import {DateTime} from "luxon";
import React, {type FC, useCallback, useEffect, useMemo, useRef, useState} from "react";
import {Pressable, TextInput, View} from "react-native";

import type {ActionSheet} from "./ActionSheet";
import {Box} from "./Box";
import type {DateTimeFieldProps} from "./Common";
import {DateTimeActionSheet} from "./DateTimeActionSheet";
import {FieldError} from "./fieldElements/FieldError";
import {FieldHelperText} from "./fieldElements/FieldHelperText";
import {FieldTitle} from "./fieldElements/FieldTitle";
import {IconButton} from "./IconButton";
import {isMobileDevice} from "./MediaQuery";
import {SelectField} from "./SelectField";
import {Text} from "./Text";
import {useTheme} from "./Theme";
import {TimezonePicker} from "./TimezonePicker";
import {resolveFieldTestIDsFromProps} from "./testing/resolveTestId";

/** The state each segment index edits, per field type. */
const SEGMENT_NAMES = {
  date: ["month", "day", "year"],
  datetime: ["month", "day", "year", "hour", "minute"],
  time: ["hour", "minute"],
} as const;

interface SeparatorProps {
  type: "date" | "time";
}

/**
 * Visual separator rendered between date or time input segments.
 * Displays "/" for date fields (MM/DD/YYYY) and ":" for time fields (hh:mm).
 */
const Separator: FC<SeparatorProps> = ({type}) => {
  return (
    <View>
      <Text>{type === "time" ? ":" : "/"}</Text>
    </View>
  );
};

interface DateTimeSegmentProps {
  config: FieldConfig;
  disabled?: boolean;
  getFieldValue: (index: number) => string;
  handleFieldChange: (index: number, text: string, config: FieldConfig) => void;
  onBlur: (override?: {amPm?: "am" | "pm"; timezone?: string}) => void;
  onRef: (ref: TextInput | null, index: number) => void;
  index: number;
  error?: string;
}

/**
 * A single numeric input segment within a date or time field.
 * Each segment represents one part of the value (e.g. month, day, year, hour, minute).
 * Renders a fixed-width TextInput with centered text and numeric keyboard.
 * Used on desktop; on mobile, segments are replaced by {@link MobileTimeDisplay}.
 */
const DateTimeSegment: FC<DateTimeSegmentProps> = ({
  disabled,
  getFieldValue,
  handleFieldChange,
  onBlur,
  onRef,
  index,
  config,
  error,
}): React.ReactElement => {
  const {theme} = useTheme();
  return (
    <View
      style={{
        alignItems: "center",
        backgroundColor: "transparent",
        borderColor: error ? theme.border.error : "transparent",
        flexDirection: "row",
        flexShrink: 1,
        height: 40,
        overflow: "hidden",
        padding: 0,
        width: config.width,
      }}
    >
      <TextInput
        accessibilityHint={`Enter the ${config.placeholder}`}
        aria-label="Text input field"
        inputMode="numeric"
        onBlur={() => onBlur()}
        onChangeText={(text) => {
          handleFieldChange(index, text, config);
        }}
        placeholder={config.placeholder}
        readOnly={disabled}
        ref={(el) => onRef(el, index)}
        selectTextOnFocus
        style={{
          color: error ? theme.text.error : theme.text.primary,
          textAlign: "center",
          width: config.width - 2,
        }}
        value={getFieldValue(index)}
      />
    </View>
  );
};

interface DateTimeProps extends Omit<DateTimeSegmentProps, "index" | "config"> {
  fieldConfigs: FieldConfig[];
  type: "date" | "datetime" | "time";
  fieldErrors?: Record<number, string | undefined>;
}

/**
 * Groups three {@link DateTimeSegment} inputs for month, day, and year (MM/DD/YYYY).
 * Renders as a fixed-width (130px) row with "/" separators between segments.
 * Used in both date-only and datetime field types.
 */
const DateField: FC<DateTimeProps> = ({fieldErrors, ...segmentProps}) => {
  return (
    <View
      style={{
        alignItems: "center",
        flexDirection: "row",
        justifyContent: "space-between",
        width: 130,
      }}
    >
      <DateTimeSegment
        {...segmentProps}
        config={segmentProps.fieldConfigs[0]}
        error={fieldErrors?.[0]}
        index={0}
      />
      <Separator type="date" />
      <DateTimeSegment
        {...segmentProps}
        config={segmentProps.fieldConfigs[1]}
        error={fieldErrors?.[1]}
        index={1}
      />
      <Separator type="date" />
      <DateTimeSegment
        {...segmentProps}
        config={segmentProps.fieldConfigs[2]}
        error={fieldErrors?.[2]}
        index={2}
      />
    </View>
  );
};

/**
 * Groups two {@link DateTimeSegment} inputs for hour and minute (hh:mm).
 * Only used on desktop; on mobile, time is rendered as a read-only
 * {@link MobileTimeDisplay} that opens the {@link DateTimeActionSheet} on tap.
 *
 * The hour/minute field indices depend on the parent type:
 * - type="time": indices 0 (hour) and 1 (minute)
 * - type="datetime": indices 3 (hour) and 4 (minute), after the date segments
 */
const TimeField: FC<DateTimeProps> = ({type, onBlur, fieldErrors, ...segmentProps}) => {
  const hourIndex = type === "time" ? 0 : 3;
  const minuteIndex = type === "time" ? 1 : 4;
  return (
    <View style={{alignItems: "center", flexDirection: "row", width: 65}}>
      <DateTimeSegment
        {...segmentProps}
        config={segmentProps.fieldConfigs[hourIndex]}
        error={fieldErrors?.[hourIndex]}
        index={hourIndex}
        onBlur={onBlur}
      />
      <Separator type="time" />
      <DateTimeSegment
        {...segmentProps}
        config={segmentProps.fieldConfigs[minuteIndex]}
        error={fieldErrors?.[minuteIndex]}
        index={minuteIndex}
        onBlur={onBlur}
      />
    </View>
  );
};

/**
 * @param borderColor - Border color from the parent's computed border state (error, disabled, default).
 *   Only applied when {@link showBorder} is true.
 * @param showBorder - When true (default), renders as a standalone bordered field (for type="time").
 *   When false, renders borderless to embed inside the datetime container which provides its own border.
 */
interface MobileTimeDisplayProps {
  borderColor?: string;
  disabled?: boolean;
  displayText: string;
  onPress: () => void;
  placeholder: string;
  showBorder?: boolean;
}

/**
 * Read-only tappable time display used on mobile devices.
 * Shows the formatted time (e.g. "02:30 PM CDT") with a clock icon, matching the
 * Figma design system's mobile time field pattern.
 *
 * Tapping opens the {@link DateTimeActionSheet} for time selection via native pickers.
 *
 * Used in two contexts:
 * - **Standalone** (type="time"): Renders with its own border as the full field container.
 * - **Embedded** (type="datetime"): Renders borderless inside the datetime container,
 *   below the date row. The parent container provides the border.
 */
const MobileTimeDisplay: FC<MobileTimeDisplayProps> = ({
  borderColor,
  disabled,
  displayText,
  onPress,
  placeholder,
  showBorder = true,
}): React.ReactElement => {
  const {theme} = useTheme();
  const isPlaceholder = !displayText;

  return (
    <Pressable
      accessibilityHint="Tap to select a time"
      accessibilityLabel="Time picker"
      disabled={disabled}
      onPress={onPress}
      style={{
        alignItems: "center",
        flexDirection: "row",
        gap: 10,
        minHeight: 40,
        paddingHorizontal: showBorder ? 12 : 10,
        paddingVertical: showBorder ? 8 : 4,
        ...(showBorder
          ? {
              backgroundColor: disabled ? theme.surface.disabled : theme.surface.base,
              borderColor,
              borderRadius: 4,
              borderWidth: 1,
              maxWidth: 250,
            }
          : {}),
      }}
    >
      <Text color={isPlaceholder ? "secondaryLight" : "primary"} numberOfLines={1} size="md">
        {displayText || placeholder}
      </Text>
      <Box flex="grow" />
      <FontAwesome6
        color={disabled ? theme.text.secondaryLight : theme.text.primary}
        name="clock"
        size={16}
      />
    </Pressable>
  );
};

interface DateRowWithIconProps {
  disabled?: boolean;
  isMobile: boolean;
  isMobileDatetime: boolean;
  onOpenActionSheet: () => void;
  segmentProps: Omit<DateTimeProps, "type">;
  type: "date" | "datetime" | "time";
}

/**
 * Date section row showing MM/DD/YYYY {@link DateField} segments with a calendar icon.
 * On mobile, renders a non-interactive row (via pointerEvents) with a plain dark calendar icon
 * aligned to the right. On desktop date-only, renders an interactive {@link IconButton}.
 * For desktop datetime, no icon is shown here — it appears in {@link DesktopTimeSection} instead.
 */
const DateRowWithIcon: FC<DateRowWithIconProps> = ({
  disabled,
  isMobile,
  isMobileDatetime,
  onOpenActionSheet,
  segmentProps,
  type,
}): React.ReactElement => {
  const {theme} = useTheme();

  return (
    <View
      style={{
        alignItems: "center",
        flexDirection: "row",
        pointerEvents: isMobileDatetime ? "none" : "auto",
      }}
    >
      <DateField {...segmentProps} type={type} />
      {isMobile && <Box flex="grow" />}
      {!disabled && isMobile && (
        <Pressable
          accessibilityHint="Opens the calendar to select a date"
          accessibilityLabel="Show calendar"
          hitSlop={10}
          onPress={onOpenActionSheet}
          style={{paddingHorizontal: 10, paddingVertical: 8}}
        >
          <FontAwesome6 color={theme.text.primary} name="calendar" size={16} />
        </Pressable>
      )}
      {!disabled && !isMobile && type === "date" && (
        <IconButton
          accessibilityHint="Opens the calendar to select a date"
          accessibilityLabel="Show calendar"
          iconName="calendar"
          onClick={onOpenActionSheet}
          variant="navigation"
        />
      )}
    </View>
  );
};

interface DesktopTimeSectionProps {
  amPm: "am" | "pm";
  disabled?: boolean;
  isMobile: boolean;
  onAmPmChange: (amPm: "am" | "pm") => void;
  onOpenActionSheet: () => void;
  onTimezoneChange: (tz: string) => void;
  segmentProps: Omit<DateTimeProps, "type">;
  timezone: string;
  type: "date" | "datetime" | "time";
}

/**
 * Desktop time editing controls rendered in a horizontal row.
 * Contains editable {@link TimeField} segments (hh:mm), an AM/PM {@link SelectField},
 * a {@link TimezonePicker}, and for datetime type, an {@link IconButton} that opens
 * the {@link DateTimeActionSheet}.
 *
 * Only rendered on desktop; on mobile, time is shown via {@link MobileTimeDisplay}.
 */
const DesktopTimeSection: FC<DesktopTimeSectionProps> = ({
  amPm,
  disabled,
  isMobile,
  onAmPmChange,
  onOpenActionSheet,
  onTimezoneChange,
  segmentProps,
  timezone,
  type,
}): React.ReactElement => {
  return (
    <View style={{alignItems: "center", flexDirection: "row"}}>
      <TimeField {...segmentProps} type={type} />
      <Box direction="column" marginLeft={2} marginRight={2} width={60}>
        <SelectField
          disabled={disabled}
          onChange={(result) => onAmPmChange(result as "am" | "pm")}
          options={[
            {label: "am", value: "am"},
            {label: "pm", value: "pm"},
          ]}
          requireValue
          value={amPm}
        />
      </Box>
      <Box direction="column" width={70}>
        <TimezonePicker
          disabled={disabled}
          hideTitle
          onChange={onTimezoneChange}
          shortTimezone
          timezone={timezone}
        />
      </Box>
      {!disabled && type === "datetime" && !isMobile && (
        <Box marginLeft={2}>
          <IconButton
            accessibilityHint="Opens the calendar to select a date and time"
            accessibilityLabel="Show calendar"
            iconName="calendar"
            onClick={onOpenActionSheet}
            variant="navigation"
          />
        </Box>
      )}
    </View>
  );
};

/** Configuration for a single {@link DateTimeSegment} input. */
interface FieldConfig {
  /** Maximum character length (e.g. 2 for MM/DD/hh/mm, 4 for YYYY). */
  maxLength: number;
  /** Placeholder text shown when the segment is empty (e.g. "MM", "DD", "YYYY", "hh", "mm"). */
  placeholder: string;
  /** Fixed pixel width of the segment container. */
  width: number;
}

/**
 * A versatile date/time input field that adapts its rendering based on device type and field mode.
 *
 * Supports three modes via the `type` prop:
 * - **"date"**: Date-only input (MM/DD/YYYY). Values stored as UTC midnight ISO strings.
 * - **"time"**: Time-only input (hh:mm AM/PM + timezone). Values stored as UTC ISO strings.
 * - **"datetime"**: Combined date and time input with timezone support.
 *
 * ## Desktop Behavior
 * Renders editable {@link DateTimeSegment} inputs for each part of the date/time, with
 * AM/PM {@link SelectField}, {@link TimezonePicker}, and a calendar/clock {@link IconButton}
 * that opens the {@link DateTimeActionSheet}.
 *
 * ## Mobile Behavior (type="datetime")
 * On mobile when `type="datetime"`, date segments remain visible but non-editable. Time
 * segments are replaced with a {@link MobileTimeDisplay} showing the formatted time
 * (e.g. "02:30 PM CDT"). Tapping anywhere on the field opens the
 * {@link DateTimeActionSheet} with native picker wheels for selection. This follows the
 * Figma design system's mobile pattern.
 *
 * All values are emitted as UTC ISO 8601 strings via the `onChange` callback.
 */
export const DateTimeField: FC<DateTimeFieldProps> = ({
  type,
  title,
  value,
  onChange,
  onEntryStatusChange,
  timezone: providedTimezone,
  onTimezoneChange,
  errorText,
  disabled,
  helperText,
  testID,
  testIDs,
}): React.ReactElement => {
  const {theme} = useTheme();
  const fieldTestIDs = resolveFieldTestIDsFromProps({testID, testIDs});
  const dateActionSheetRef: React.RefObject<ActionSheet | null> = React.createRef();
  const [amPm, setAmPm] = useState<"am" | "pm">("am");
  const [showDate, setShowDate] = useState(false);
  const [month, setMonth] = useState("");
  const [day, setDay] = useState("");
  const [year, setYear] = useState("");
  const [hour, setHour] = useState("");
  const [minute, setMinute] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<number, string | undefined>>({});
  const [localTimezone, setLocalTimezone] = useState(
    providedTimezone ?? DateTime.local().zoneName ?? "UTC"
  );

  const breakpoint = 395; // Breakpoint for switching to action sheet
  let minimumWidth = 230; // Minimum width for the field container
  if (type === "date") {
    minimumWidth = 200;
  }

  let maximumWidth = breakpoint; // Maximum width for the field container
  if (["date", "time"].includes(type)) {
    maximumWidth = minimumWidth + 10;
  }

  const [parentWidth, setParentWidth] = useState<number | null>(null);
  const parentIsLessThanBreakpointOrIsMobile =
    (parentWidth !== null && parentWidth < breakpoint) || isMobileDevice();

  // We need to store the pending value in a ref because the state changes don't trigger
  // immediately, so onBlur may use stale values.
  const pendingValueRef = useRef<
    | {
        amPm?: "am" | "pm";
        timezone?: string;
        minute?: string;
        month?: string;
        day?: string;
        year?: string;
        hour?: string;
      }
    | undefined
  >(undefined);

  // Use provided timezone if available, otherwise use local
  const timezone = providedTimezone ?? localTimezone;
  const inputRefs = useRef<(TextInput | null)[]>([]);

  let borderColor = theme.border.dark;
  if (disabled) {
    borderColor = theme.border.activeNeutral;
  } else if (errorText || Object.values(fieldErrors).some((error) => error !== undefined)) {
    borderColor = theme.border.error;
  }

  /** Builds the ordered array of {@link FieldConfig} for each input segment based on the field type. */
  const getFieldConfigs = useCallback((): FieldConfig[] => {
    const configs: FieldConfig[] = [];
    if (type === "date" || type === "datetime") {
      configs.push(
        {maxLength: 2, placeholder: "MM", width: 40},
        {maxLength: 2, placeholder: "DD", width: 30},
        {maxLength: 4, placeholder: "YYYY", width: 50}
      );
    }
    if (type === "time" || type === "datetime") {
      configs.push(
        {maxLength: 2, placeholder: "hh", width: 30},
        {maxLength: 2, placeholder: "mm", width: 30}
      );
    }
    return configs;
  }, [type]);

  // Set the inputRefs array to the correct length
  useEffect(() => {
    const configs = getFieldConfigs();
    inputRefs.current = configs.map(() => null);
  }, [getFieldConfigs]);

  /** Validates a single segment value and returns an error message if invalid, or undefined if valid. */
  const validateField = useCallback(
    (fieldIndex: number, fieldValue: string): string | undefined => {
      if (!fieldValue) return undefined;

      if (type === "date" || type === "datetime") {
        if (fieldIndex === 0) {
          // Month
          const monthNum = parseInt(fieldValue, 10);
          if (Number.isNaN(monthNum) || monthNum < 1 || monthNum > 12) {
            return "Month must be between 1 and 12";
          }
        } else if (fieldIndex === 1) {
          // Day
          const dayNum = parseInt(fieldValue, 10);
          if (Number.isNaN(dayNum) || dayNum < 1 || dayNum > 31) {
            return "Day must be between 1 and 31";
          }
        } else if (fieldIndex === 2) {
          // Year
          const yearNum = parseInt(fieldValue, 10);
          if (Number.isNaN(yearNum) || yearNum < 1900 || yearNum > 2100) {
            return "Year must be between 1900 and 2100";
          }
        }
      }

      // Minutes are not validated here: handleFieldChange validates them before this is reached.
      if (type === "time" || type === "datetime") {
        if (fieldIndex === (type === "time" ? 0 : 3)) {
          // Hour
          const hourNum = parseInt(fieldValue, 10);
          if (Number.isNaN(hourNum) || hourNum < 1 || hourNum > 12) {
            return "Hour must be between 1 and 12";
          }
        }
      }

      return undefined;
    },
    [type]
  );

  /**
   * Assembles the current segment state (month, day, year, hour, minute, amPm, timezone)
   * into a UTC ISO 8601 string. Accepts optional overrides for fields that haven't
   * been committed to state yet (e.g. during mid-edit or AM/PM toggle).
   * Returns undefined if required fields are missing.
   */
  const getISOFromFields = useCallback(
    (override?: {
      amPm?: "am" | "pm";
      timezone?: string;
      minute?: string;
      month?: string;
      day?: string;
      year?: string;
      hour?: string;
    }): string | undefined => {
      const ampPmVal = override?.amPm ?? amPm;
      const minuteVal = override?.minute ?? minute;
      const monthVal = override?.month ?? month;
      const dayVal = override?.day ?? day;
      const yearVal = override?.year ?? year;
      const hourVal = override?.hour ?? hour;
      let date: DateTime;
      if (type === "datetime") {
        if (!monthVal || !dayVal || !yearVal || !hourVal || !minuteVal) {
          return undefined;
        }
        let hourNum = parseInt(hourVal, 10);
        if (Number.isNaN(hourNum)) {
          return undefined;
        }
        if (ampPmVal === "pm" && hourNum !== 12) {
          hourNum += 12;
        } else if (ampPmVal === "am" && hourNum === 12) {
          hourNum = 0;
        }
        date = DateTime.fromObject(
          {
            day: parseInt(dayVal, 10),
            hour: hourNum,
            millisecond: 0,
            minute: parseInt(minuteVal, 10),
            month: parseInt(monthVal, 10),
            second: 0,
            year: parseInt(yearVal, 10),
          },
          {
            zone: override?.timezone ?? timezone,
          }
        );
      } else if (type === "date") {
        if (!monthVal || !dayVal || !yearVal) {
          return undefined;
        }
        date = DateTime.fromObject(
          {
            day: parseInt(dayVal, 10),
            hour: 0,
            millisecond: 0,
            minute: 0,
            month: parseInt(monthVal, 10),
            second: 0,
            year: parseInt(yearVal, 10),
          },
          {
            zone: "UTC",
          }
        );
      } else {
        if (!hourVal || !minuteVal) {
          return undefined;
        }
        let hourNum = parseInt(hourVal, 10);
        if (Number.isNaN(hourNum)) {
          return undefined;
        }
        if (ampPmVal === "pm" && hourNum !== 12) {
          hourNum += 12;
        } else if (ampPmVal === "am" && hourNum === 12) {
          hourNum = 0;
        }
        date = DateTime.fromObject(
          {
            hour: hourNum,
            millisecond: 0,
            minute: parseInt(minuteVal, 10),
            second: 0,
          },
          {
            zone: override?.timezone ?? timezone,
          }
        );
      }

      if (date.isValid) {
        // Always return UTC ISO string
        return date.toUTC().toISO() ?? undefined;
      }
      return undefined;
    },
    [amPm, month, day, year, hour, minute, timezone, type]
  );

  /**
   * Tells `onEntryStatusChange` what the segments hold after a typed change: nothing, an entry
   * that is unfinished or has a segment error, or a complete value. A minute of "00" alone counts
   * as empty, because clearing the minute segment resets it to "00".
   */
  const reportEntryStatus = useCallback(
    (
      override: {day?: string; hour?: string; minute?: string; month?: string; year?: string},
      errors: Record<number, string | undefined>
    ): void => {
      if (!onEntryStatusChange) {
        return;
      }
      const next = {day, hour, minute, month, year, ...override};
      const dateParts = type === "time" ? [] : [next.month, next.day, next.year];
      const timeParts = type === "date" ? [] : [next.hour];
      const hasMinute = type !== "date" && next.minute !== "" && next.minute !== "00";
      if (![...dateParts, ...timeParts].some(Boolean) && !hasMinute) {
        onEntryStatusChange("empty");
        return;
      }
      const hasError = Object.values(errors).some((error) => error !== undefined);
      onEntryStatusChange(!hasError && getISOFromFields(override) ? "valid" : "invalid");
    },
    [onEntryStatusChange, day, hour, minute, month, year, type, getISOFromFields]
  );

  /**
   * Handles text changes in any {@link DateTimeSegment} input.
   * Strips non-numeric characters, validates the value, updates local state,
   * and emits the ISO value via onChange when all required fields are complete.
   * Auto-advances focus to the next segment when the current one is full.
   */
  const handleFieldChange = useCallback(
    (index: number, text: string, config: FieldConfig) => {
      const numericValue = text.replace(/[^0-9]/g, "");

      // For minutes, just ensure it's at most 2 digits and valid (0-59)
      if ((type === "time" && index === 1) || (type === "datetime" && index === 4)) {
        // For minutes, keep only the last two digits entered.
        // If the user deletes everything, set the value to "00"
        // so it's always a valid time and easier to edit.
        // This lets users freely edit or clear the minute field without breaking the time format.
        const finalValue = numericValue === "" ? "00" : numericValue.slice(-2);
        const minuteNum = parseInt(finalValue, 10);

        // Update the minute state so the UI reflects the latest input,
        // even if it's temporarily invalid
        // This allows the user to freely edit or clear the field.
        setMinute(finalValue);

        const isValidMinute = !Number.isNaN(minuteNum) && minuteNum >= 0 && minuteNum <= 59;
        reportEntryStatus(
          {minute: finalValue},
          {...fieldErrors, [index]: isValidMinute ? undefined : "Minute must be between 0 and 59"}
        );

        // Only update ref and result if it's a valid minute value
        if (isValidMinute) {
          pendingValueRef.current = {minute: finalValue};
          setFieldErrors((prev) => ({...prev, [index]: undefined}));

          // Pass the new minute value directly to getISOFromFields
          const result = getISOFromFields({minute: finalValue});
          if (result) {
            const currentValueUTC = value ? DateTime.fromISO(value).toUTC().toISO() : undefined;
            if (result !== currentValueUTC) {
              onChange(result);
            }
          }
        } else {
          setFieldErrors((prev) => ({...prev, [index]: "Minute must be between 0 and 59"}));
        }

        // The minute segment is always last, so there is nothing to advance focus to.
        return;
      }

      // For other fields, handle leading zeros
      const finalValue =
        numericValue.length > config.maxLength
          ? numericValue.slice(-config.maxLength)
          : numericValue;

      const error = validateField(index, finalValue);
      setFieldErrors((prev) => ({...prev, [index]: error}));
      const segmentName = SEGMENT_NAMES[type][index];
      if (segmentName) {
        reportEntryStatus({[segmentName]: finalValue}, {...fieldErrors, [index]: error});
      }

      if (type === "date" || type === "datetime") {
        if (index === 0) {
          setMonth(finalValue);
          pendingValueRef.current = {month: finalValue};
        }
        if (index === 1) {
          setDay(finalValue);
          pendingValueRef.current = {day: finalValue};
        }
        if (index === 2) {
          setYear(finalValue);
          pendingValueRef.current = {year: finalValue};
        }
      }

      if (type === "time") {
        if (index === 0) {
          setHour(finalValue);
          pendingValueRef.current = {hour: finalValue};
        }
      }

      if (type === "datetime") {
        if (index === 3) {
          setHour(finalValue);
          pendingValueRef.current = {hour: finalValue};
        }
      }

      // If date parts are complete and valid, emit ISO immediately (don't wait for blur)
      if ((type === "date" || type === "datetime") && !error) {
        const monthVal = index === 0 ? finalValue : month;
        const dayVal = index === 1 ? finalValue : day;
        const yearVal = index === 2 ? finalValue : year;
        const monthComplete = monthVal?.length === 2;
        const dayComplete = dayVal?.length === 2;
        const yearComplete = yearVal?.length === 4;
        const haveAllDateParts = monthComplete && dayComplete && yearComplete;
        if (haveAllDateParts) {
          const result = getISOFromFields({day: dayVal, month: monthVal, year: yearVal});
          if (result) {
            const currentValueUTC = value ? DateTime.fromISO(value).toUTC().toISO() : undefined;
            if (result !== currentValueUTC) {
              onChange(result);
            }
          }
        }
      }

      // Auto-advance to next field if current field is full
      const configs = getFieldConfigs();
      if (finalValue.length === config.maxLength && index < configs.length - 1) {
        inputRefs.current[index + 1]?.focus();
      }
    },
    [
      type,
      getFieldConfigs,
      getISOFromFields,
      onChange,
      value,
      validateField,
      month,
      day,
      year,
      fieldErrors,
      reportEntryStatus,
    ]
  );

  /**
   * Callback from the {@link DateTimeActionSheet}. Parses the selected ISO value,
   * syncs it into the local segment state (month, day, year, hour, minute, amPm),
   * normalizes it to UTC, and emits via onChange. An empty string clears the field.
   */
  const onActionSheetChange = useCallback(
    (inputDate: string) => {
      // Handle clear case - empty string should clear the field
      if (!inputDate || inputDate === "") {
        onChange("");
        onEntryStatusChange?.("empty");
        setShowDate(false);
        return;
      }

      const parsedDate = DateTime.fromISO(inputDate);
      if (!parsedDate.isValid) {
        console.warn("Invalid date passed to DateTimeField", inputDate);
        return;
      }
      setAmPm(parsedDate.hour >= 12 ? "pm" : "am");

      if (type === "date" || type === "datetime") {
        // type="date" values are UTC midnight — parse in UTC to extract the correct calendar date.
        const displayDate =
          type === "date" ? DateTime.fromISO(inputDate, {zone: "UTC"}) : parsedDate;
        setMonth(displayDate.month.toString().padStart(2, "0"));
        setDay(displayDate.day.toString().padStart(2, "0"));
        setYear(displayDate.year.toString());
      }

      if (type === "time" || type === "datetime") {
        let hourNum = parsedDate.hour % 12;
        hourNum = hourNum === 0 ? 12 : hourNum;
        setHour(hourNum.toString().padStart(2, "0"));
        setMinute(parsedDate.minute.toString().padStart(2, "0"));
      }

      // Normalize emitted value to ISO (UTC for date-only)
      const normalized =
        type === "date"
          ? DateTime.fromISO(inputDate, {zone: "UTC"})
              .startOf("day")
              .set({millisecond: 0, second: 0})
              .toISO()
          : parsedDate.set({millisecond: 0, second: 0}).toUTC().toISO();
      onChange(normalized ?? "");
      onEntryStatusChange?.("valid");
      setShowDate(false);
    },
    [onChange, onEntryStatusChange, type]
  );

  /**
   * Called when a segment input loses focus. Assembles the current field state
   * (plus any pending overrides) into an ISO string and emits it if changed.
   */
  const onBlur = useCallback(
    (override?: {amPm?: "am" | "pm"}) => {
      const iso = getISOFromFields({...override, ...pendingValueRef.current});
      // Compare in UTC to avoid timezone issues
      const currentValueUTC = value ? DateTime.fromISO(value).toUTC().toISO() : undefined;
      if (iso && iso !== currentValueUTC) {
        onChange(iso);
      }
      reportEntryStatus({...pendingValueRef.current}, fieldErrors);

      // Clear the pending value after processing
      pendingValueRef.current = undefined;
    },
    [getISOFromFields, onChange, value, reportEntryStatus, fieldErrors]
  );

  // Handle external value changes
  useEffect(() => {
    if (!value) {
      setMonth("");
      setDay("");
      setYear("");
      setHour("");
      setMinute("");
      setAmPm("am");
      return;
    }

    // Handle dates which should have 00:00:00.000Z as the time component, ignore timezones.
    let parsedDate = DateTime.fromISO(value);
    if (type === "date") {
      parsedDate = parsedDate.setZone("UTC");
    } else {
      parsedDate = parsedDate.setZone(timezone);
    }
    if (!parsedDate.isValid) {
      console.warn("Invalid date passed to DateTimeField", value);
      return;
    }
    setAmPm(parsedDate.hour >= 12 ? "pm" : "am");

    if (type === "date" || type === "datetime") {
      setMonth(parsedDate.month.toString().padStart(2, "0"));
      setDay(parsedDate.day.toString().padStart(2, "0"));
      setYear(parsedDate.year.toString());
    }

    if (type === "time" || type === "datetime") {
      let hourNum = parsedDate.hour % 12;
      hourNum = hourNum === 0 ? 12 : hourNum;
      setHour(hourNum.toString().padStart(2, "0"));
      setMinute(parsedDate.minute.toString().padStart(2, "0"));
    }
  }, [value, type, timezone]);

  /** Returns the current display string for a given segment index from local state. */
  const getFieldValue = useCallback(
    (index: number): string => {
      if (type === "date" || type === "datetime") {
        if (index === 0) return month;
        if (index === 1) return day;
        if (index === 2) return year;
      }

      if (type === "time") {
        if (index === 0) return hour;
        if (index === 1) return minute;
      }

      if (type === "datetime") {
        if (index === 3) return hour;
        if (index === 4) return minute;
      }

      return "";
    },
    [type, month, day, year, hour, minute]
  );

  const fieldConfigs = getFieldConfigs();

  const segmentProps = {
    disabled,
    fieldConfigs,
    fieldErrors,
    getFieldValue,
    handleFieldChange,
    onBlur,
    onRef: (el: TextInput | null, i: number) => (inputRefs.current[i] = el),
  };

  const isMobile = isMobileDevice();
  const isMobileTimeOnly = isMobile && type === "time";
  const isMobileDatetime = isMobile && type === "datetime";
  const showDateSection = type === "date" || type === "datetime";
  const showDesktopTime = !isMobile && (type === "time" || type === "datetime");
  const timezoneAbbr = useMemo((): string => {
    if (value) {
      const parsed = DateTime.fromISO(value);
      if (parsed.isValid) {
        return parsed.setZone(timezone).offsetNameShort ?? "";
      }
    }
    const iso = getISOFromFields();
    if (iso) {
      const parsed = DateTime.fromISO(iso);
      if (parsed.isValid) {
        return parsed.setZone(timezone).offsetNameShort ?? "";
      }
    }
    return DateTime.now().setZone(timezone).offsetNameShort ?? "";
  }, [value, getISOFromFields, timezone]);
  const mobileTimeDisplayText =
    hour && minute ? `${hour}:${minute} ${amPm.toUpperCase()} ${timezoneAbbr}` : "";
  const mobileTimePlaceholder = `12:00 PM ${timezoneAbbr}`;

  /** Handles AM/PM toggle from the SelectField, recomputes and emits the ISO value. */
  const handleAmPmChange = useCallback(
    (newAmPm: "am" | "pm"): void => {
      setAmPm(newAmPm);
      const iso = getISOFromFields({amPm: newAmPm});
      const currentValueUTC = value ? DateTime.fromISO(value).toUTC().toISO() : undefined;
      if (iso && iso !== currentValueUTC) {
        onChange(iso);
      }
    },
    [getISOFromFields, value, onChange]
  );

  /** Handles timezone changes from the TimezonePicker, recomputes and emits the ISO value. */
  const handleTimezoneChange = useCallback(
    (tz: string): void => {
      if (onTimezoneChange) {
        onTimezoneChange(tz);
      } else {
        setLocalTimezone(tz);
      }
      const iso = getISOFromFields({timezone: tz});
      const currentValueUTC = value ? DateTime.fromISO(value).toUTC().toISO() : undefined;
      if (iso && iso !== currentValueUTC) {
        onChange(iso);
      }
    },
    [getISOFromFields, value, onChange, onTimezoneChange]
  );

  const openActionSheet = useCallback((): void => {
    setShowDate(true);
  }, []);

  return (
    <>
      {Boolean(title) && <FieldTitle testID={fieldTestIDs.label} text={title as string} />}
      {Boolean(errorText) && <FieldError testID={fieldTestIDs.error} text={errorText as string} />}

      {isMobileTimeOnly && (
        <MobileTimeDisplay
          borderColor={borderColor}
          disabled={disabled}
          displayText={mobileTimeDisplayText}
          onPress={openActionSheet}
          placeholder={mobileTimePlaceholder}
        />
      )}

      {!isMobileTimeOnly && (
        <Pressable
          {...(isMobileDatetime && {
            accessibilityHint: "Opens date and time picker",
            accessibilityLabel: "Date and time picker",
            accessibilityRole: "button" as const,
          })}
          disabled={!isMobileDatetime || disabled}
          onLayout={(e) => setParentWidth(e.nativeEvent.layout.width)}
          onPress={openActionSheet}
          style={{
            alignItems: parentIsLessThanBreakpointOrIsMobile ? "stretch" : "center",
            backgroundColor: theme.surface.base,
            borderColor,
            borderRadius: 4,
            borderWidth: 1,
            flexDirection: parentIsLessThanBreakpointOrIsMobile ? "column" : "row",
            maxWidth: isMobileDatetime ? 250 : maximumWidth,
            minHeight: 40,
            minWidth: isMobileDatetime ? 200 : minimumWidth,
            paddingHorizontal: 6,
          }}
          testID={fieldTestIDs.input}
        >
          {showDateSection && (
            <DateRowWithIcon
              disabled={disabled}
              isMobile={parentIsLessThanBreakpointOrIsMobile}
              isMobileDatetime={isMobileDatetime}
              onOpenActionSheet={openActionSheet}
              segmentProps={segmentProps}
              type={type}
            />
          )}

          {isMobileDatetime && (
            <View style={{pointerEvents: "none"}}>
              <MobileTimeDisplay
                disabled={disabled}
                displayText={mobileTimeDisplayText}
                onPress={openActionSheet}
                placeholder={mobileTimePlaceholder}
                showBorder={false}
              />
            </View>
          )}

          {showDesktopTime && (
            <DesktopTimeSection
              amPm={amPm}
              disabled={disabled}
              isMobile={parentIsLessThanBreakpointOrIsMobile}
              onAmPmChange={handleAmPmChange}
              onOpenActionSheet={openActionSheet}
              onTimezoneChange={handleTimezoneChange}
              segmentProps={segmentProps}
              timezone={timezone}
              type={type}
            />
          )}
        </Pressable>
      )}

      {!disabled && (
        <DateTimeActionSheet
          actionSheetRef={dateActionSheetRef}
          onChange={onActionSheetChange}
          onDismiss={() => setShowDate(false)}
          timezone={timezone}
          type={type}
          value={value}
          visible={showDate}
        />
      )}
      {Boolean(helperText) && (
        <FieldHelperText testID={fieldTestIDs.helper} text={helperText as string} />
      )}
    </>
  );
};
