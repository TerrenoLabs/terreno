import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import {Picker} from "@react-native-picker/picker";
import {getCalendars} from "expo-localization";
import range from "lodash/range";
import {DateTime} from "luxon";
import type React from "react";
import {useEffect, useMemo, useState} from "react";
import {Platform, Pressable, type StyleProp, TextInput, type TextStyle, View} from "react-native";
import {Calendar} from "react-native-calendars";

import {Box} from "./Box";
import type {DateTimeActionSheetProps, IconName} from "./Common";
import {Heading} from "./Heading";
import {isMobileDevice} from "./MediaQuery";
import {Modal} from "./Modal";
import {SelectField} from "./SelectField";
import {useTheme} from "./Theme";
import {TimezonePicker} from "./TimezonePicker";

const TIME_PICKER_HEIGHT = 104;
const INPUT_HEIGHT = 40;

const hours = range(1, 13).map((n) => String(n));
// TODO: support limited picker minutes, e.g. 5 or 15 minute increments.
const minutes = range(0, 60).map((n) => String(n).padStart(2, "0"));
const minutesOptions = [...minutes, "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

const TimeInput = ({
  type,
  value,
  onChange,
}: {
  type: "hour" | "minute";
  value: number;
  onChange: (value: number) => void;
}): React.ReactElement => {
  const {theme} = useTheme();

  const defaultText = type === "minute" ? String(value).padStart(2, "0") : String(value);
  const [text, setText] = useState(defaultText);
  const [focused, setFocused] = useState(false);
  let error = false;
  if (type === "hour") {
    error = !hours.includes(String(Number(text)));
  } else if (type === "minute") {
    error = !minutesOptions.includes(String(Number(text)));
  }

  // Broken out because types don't think "outline" is a valid style.
  const textInputStyle: StyleProp<TextStyle> = {
    color: theme.text.primary,
    flex: 1,
    fontFamily: "text",
    height: INPUT_HEIGHT,
    paddingBottom: 4,
    paddingLeft: 0,
    paddingRight: 4,
    paddingTop: 4,
    width: "100%",
  };

  return (
    <View
      style={{
        alignItems: "center",
        backgroundColor: theme.surface.base,
        borderColor: error ? theme.border.error : theme.border.default,
        borderRadius: 5,
        borderWidth: focused ? 5 : 1,
        flexDirection: "row",
        height: INPUT_HEIGHT,
        justifyContent: "center",
        // Add padding so the border doesn't mess up layouts
        paddingHorizontal: focused ? 10 : 14,
        paddingVertical: focused ? 0 : 4,
        width: "100%",
      }}
    >
      <TextInput
        accessibilityHint="Enter a number"
        aria-label="Text input field"
        enterKeyHint="done"
        keyboardType="number-pad"
        onBlur={() => {
          setFocused(false);
        }}
        onChangeText={(t) => {
          setText(t);
          onChange(Number(t));
        }}
        onFocus={() => {
          setFocused(true);
        }}
        selectTextOnFocus
        style={
          {
            ...textInputStyle,
            outline: Platform.select({web: "none"}),
          } as StyleProp<TextStyle>
        }
        textContentType="none"
        underlineColorAndroid="transparent"
        value={text}
      />
    </View>
  );
};

const CalendarButton = ({
  iconName,
  onClick,
  accessibilityLabel,
  accessibilityHint,
}: {
  accessibilityLabel: string;
  accessibilityHint: string;
  iconName: IconName;
  onClick: () => void;
}) => {
  const {theme} = useTheme();
  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      aria-label={accessibilityLabel}
      aria-role="button"
      hitSlop={10}
      onPress={onClick}
    >
      <FontAwesome6
        color={theme.surface.secondaryDark}
        name={iconName}
        selectable={undefined}
        size={16}
      />
    </Pressable>
  );
};

const CalendarHeader = ({
  addMonth,
  month,
}: {
  addMonth: (num: number) => void;
  month: Date[];
}): React.ReactElement => {
  const displayDate = DateTime.fromJSDate(month[0]).toFormat("MMM yyyy");
  return (
    <Box alignItems="center" direction="row" height={40} justifyContent="between" width="100%">
      <CalendarButton
        accessibilityHint="Decrease the year"
        accessibilityLabel="Previous year button"
        iconName="angles-left"
        onClick={() => {
          addMonth(-12);
        }}
      />
      <CalendarButton
        accessibilityHint="Decrease the month"
        accessibilityLabel="Previous month button"
        iconName="angle-left"
        onClick={() => {
          addMonth(-1);
        }}
      />
      <Heading size="lg">{displayDate}</Heading>
      <CalendarButton
        accessibilityHint="Increase the month"
        accessibilityLabel="Next month button"
        iconName="angle-right"
        onClick={() => {
          addMonth(1);
        }}
      />
      <CalendarButton
        accessibilityHint="Increase the year"
        accessibilityLabel="Next year button"
        iconName="angles-right"
        onClick={() => {
          addMonth(12);
        }}
      />
    </Box>
  );
};

interface TimeProps {
  type: DateTimeActionSheetProps["type"];
  timezone: string | undefined;
  setTimezone: (timezone?: string) => void;
  hour: number;
  setHour: (hour: number) => void;
  minute: number;
  setMinute: (minute: number) => void;
  amPm: "am" | "pm";
  setAmPm: (amPm: "am" | "pm") => void;
}

const MobileTime = ({
  type,
  timezone,
  setTimezone,
  hour,
  setHour,
  minute,
  setMinute,
  amPm,
  setAmPm,
}: TimeProps): React.ReactElement => {
  const {theme} = useTheme();
  // Match picker surface to the app theme. A fixed white background with `theme.text.primary`
  // (light in dark mode) produced invisible labels on Android; `itemStyle` is iOS-only and is
  // omitted on Android to avoid broken / blank spinner rendering on some OS versions.
  const pickerStyle = {
    backgroundColor: theme.surface.base,
    height: TIME_PICKER_HEIGHT,
    ...(Platform.OS === "android" ? {color: theme.text.primary} : {}),
  };
  const androidItemColor = Platform.OS === "android" ? (theme.text.primary as string) : undefined;

  return (
    <Box>
      <Box direction="row" width="100%">
        <Box paddingY={2} width="30%">
          <Picker
            itemStyle={
              Platform.OS === "ios"
                ? {
                    height: TIME_PICKER_HEIGHT,
                  }
                : undefined
            }
            onValueChange={(itemValue) => {
              const n = typeof itemValue === "number" ? itemValue : Number(itemValue);
              setHour(n);
            }}
            selectedValue={hour}
            style={pickerStyle}
          >
            {hours.map((n) => (
              <Picker.Item
                color={androidItemColor}
                key={String(n)}
                label={String(n)}
                value={Number(n)}
              />
            ))}
          </Picker>
        </Box>
        <Box paddingY={2} width="30%">
          <Picker
            itemStyle={
              Platform.OS === "ios"
                ? {
                    height: TIME_PICKER_HEIGHT,
                  }
                : undefined
            }
            onValueChange={(itemValue) => {
              const n = typeof itemValue === "number" ? itemValue : Number(itemValue);
              setMinute(n);
            }}
            selectedValue={minute}
            style={pickerStyle}
          >
            {minutes.map((n) => (
              <Picker.Item
                color={androidItemColor}
                key={String(n)}
                label={String(n)}
                value={Number(n)}
              />
            ))}
          </Picker>
        </Box>
        <Box paddingY={2} width="40%">
          <Picker
            itemStyle={
              Platform.OS === "ios"
                ? {
                    fontSize: 16,
                    height: TIME_PICKER_HEIGHT,
                  }
                : undefined
            }
            onValueChange={(itemValue) => setAmPm(itemValue as "am" | "pm")}
            selectedValue={amPm}
            style={pickerStyle}
          >
            <Picker.Item color={androidItemColor} key="am" label="am" value="am" />
            <Picker.Item color={androidItemColor} key="pm" label="pm" value="pm" />
          </Picker>
        </Box>
      </Box>
      {Boolean(type === "time" || type === "datetime") && (
        <Box paddingY={2}>
          <TimezonePicker hideTitle onChange={setTimezone} timezone={timezone} />
        </Box>
      )}
    </Box>
  );
};

// TODO: Support a typeahead dropdown for time picker, similar to Google Calendar on the web.
const WebTime = ({
  type,
  timezone,
  setTimezone,
  hour,
  setHour,
  minute,
  setMinute,
  amPm,
  setAmPm,
}: TimeProps) => {
  return (
    <Box direction="row" justifyContent="center" width="100%">
      <Box width={60}>
        <TimeInput onChange={(v) => setHour(v)} type="hour" value={hour} />
      </Box>
      <Box
        alignItems="center"
        height={INPUT_HEIGHT}
        justifyContent="center"
        marginLeft={2}
        marginRight={2}
      >
        <Heading size="md">:</Heading>
      </Box>
      <Box marginRight={2} width={60}>
        <TimeInput onChange={(v) => setMinute(v)} type="minute" value={minute} />
      </Box>

      <Box marginRight={2} width={60}>
        <SelectField
          onChange={(result) => {
            setAmPm(result as "am" | "pm");
          }}
          options={[
            {label: "am", value: "am"},
            {label: "pm", value: "pm"},
          ]}
          value={amPm}
        />
      </Box>
      {Boolean(type === "time" || type === "datetime") && (
        <Box>
          <TimezonePicker hideTitle onChange={setTimezone} timezone={timezone} />
        </Box>
      )}
    </Box>
  );
};

const DateCalendar = ({
  type,
  onChange,
  onDismiss,
  date,
  setDate,
  timezone,
}: {
  type: DateTimeActionSheetProps["type"];
  date: string;
  timezone: string | undefined;
  setDate: (date: string) => void;
  onChange: DateTimeActionSheetProps["onChange"];
  onDismiss: DateTimeActionSheetProps["onDismiss"];
}): React.ReactElement => {
  const {theme} = useTheme();

  const markedDates: {
    [id: string]: {
      selected: boolean;
      selectedColor: string;
      customStyles?: {container?: {backgroundColor?: string; borderRadius?: number}};
    };
  } = {};

  // Check if the date is T00:00:00.000Z (it should be), otherwise treat it as a date in the
  // current timezone.
  const dt = DateTime.fromISO(date);
  let dateString: string;
  if (dt.hour === 0 && dt.minute === 0 && dt.second === 0) {
    dateString = dt.toISO()!;
  } else {
    dateString = dt.setZone().toISO()!;
  }

  if (date) {
    let displayDate: string;
    if (type === "date") {
      displayDate = DateTime.fromISO(dateString).toUTC().toFormat("yyyy-MM-dd");
    } else if (timezone) {
      displayDate = DateTime.fromISO(dateString).setZone(timezone).toFormat("yyyy-MM-dd");
    } else {
      displayDate = DateTime.fromISO(dateString).toFormat("yyyy-MM-dd");
    }
    markedDates[displayDate] = {
      customStyles: {
        container: {
          backgroundColor: theme.surface.secondaryDark,
          borderRadius: 4,
        },
      },
      selected: true,
      selectedColor: theme.text.primary,
    };
  }
  return (
    <Box width="100%">
      <Box marginBottom={4} width="100%">
        <Calendar
          customHeader={CalendarHeader}
          initialDate={dateString}
          markedDates={markedDates}
          markingType="custom"
          onDayPress={(day: {dateString: string}) => {
            setDate(day.dateString);
            // If type is just date, we can shortcut and close right away.
            // time and datetime need to wait for the primary button.
            if (type === "date") {
              onChange(day.dateString);
              onDismiss();
            }
          }}
          theme={{
            dayTextColor: theme.text.primary,
            textDayFontFamily: "text",
            textDayFontSize: 16,
            textDayFontWeight: "400",
            todayTextColor: theme.text.accent,
          }}
        />
      </Box>
    </Box>
  );
};

// For mobile, renders all components in an action sheet. For web, renders all components in a
// modal. For mobile:
// If type is "time", renders a spinner picker for time picker on both platforms.
// If type is "date", renders our custom calendar on both platforms.
// If type is "datetime",renders a spinner picker for time picker and our custom calendar on both
// platforms.
// For web, renders a simplistic text box for time picker and a calendar for date picker
// in a modal.
// In the future, web time picker should be a typeahead dropdown like Google calendar.
export const DateTimeActionSheet = ({
  type = "datetime",
  value,
  onChange,
  visible,
  onDismiss,
  timezone: tz,
}: DateTimeActionSheetProps) => {
  const calendar = getCalendars()[0];
  const originalTimezone = (tz || calendar?.timeZone) ?? undefined;
  const [timezone, setTimezone] = useState<string | undefined>(originalTimezone);
  if (!timezone) {
    console.error(
      "Could not automatically determine timezone and none was provided to DateTimeActionSheet."
    );
  }

  if (typeof value !== "string" && typeof value !== "undefined") {
    console.error(`Datetime only accepts string or undefined value, not ${typeof value}: $value`);
  }

  // Accept ISO 8601, HH:mm, or hh:mm A formats. We may want only HH:mm or hh:mm A for type=time

  const [hour, setHour] = useState<number>(0);
  const [minute, setMinute] = useState<number>(0);
  const [amPm, setAmPm] = useState<"am" | "pm">("am");
  const [date, setDate] = useState<string>("");

  // If the value changes in the props, update the state for the date and time.
  useEffect(() => {
    let datetime: DateTime;
    if (value) {
      if (type === "date") {
        datetime = DateTime.fromISO(value).toUTC().set({millisecond: 0, second: 0});
      } else {
        datetime = DateTime.fromISO(value)
          .setZone(originalTimezone)
          .set({millisecond: 0, second: 0});
      }
    } else {
      datetime = DateTime.now().setZone(originalTimezone).set({millisecond: 0, second: 0});
    }
    if (!datetime.isValid) {
      console.warn(`Invalid date/time value: $value`);
      return;
    }

    let h = datetime.hour % 12;
    if (h === 0) {
      h = 12;
    }
    setHour(h);
    setMinute(datetime.minute);
    setAmPm(datetime.toFormat("a") === "AM" ? "am" : "pm");
    setDate(datetime.toISO() ?? "");
    // Reset timezone when the sent date changes.
    setTimezone(originalTimezone);
  }, [value, originalTimezone, type]);

  // TODO Support 24 hour time for time picker.
  // Note: do not call this if waiting on a state change.
  const sendOnChange = () => {
    let militaryHour = hour;

    if (amPm === "am" && hour === 12) {
      militaryHour = 0;
    } else if (amPm === "pm" && hour !== 12) {
      militaryHour = Number(hour) + 12;
    }

    // For type="date" the date state is always UTC midnight — parse it in UTC, not the component
    // timezone, to avoid shifting the date when converting back to UTC.
    const dateTime = DateTime.fromISO(date, {zone: type === "date" ? "UTC" : timezone});

    if (type === "date") {
      const v = dateTime.set({hour: 0, millisecond: 0, minute: 0, second: 0}).toUTC().toISO();
      if (!v || !DateTime.fromISO(v).isValid) {
        throw new Error(`Invalid date: ${date}`);
      }
      onChange(v);
    } else if (type === "time") {
      const v = dateTime
        .set({hour: militaryHour, millisecond: 0, minute, second: 0})
        .toUTC()
        .toISO();
      if (!v || !DateTime.fromISO(v).isValid) {
        throw new Error(`Invalid date: ${date}`);
      }
      onChange(v);
    } else if (type === "datetime") {
      const v = dateTime
        .set({hour: militaryHour, millisecond: 0, minute, second: 0})
        .toUTC()
        .toISO();
      if (!v || !DateTime.fromISO(v).isValid) {
        throw new Error(`Invalid date: ${date}`);
      }
      onChange(v);
    }
    onDismiss();
  };

  const sendClear = () => {
    onChange("");
    onDismiss();
  };

  const dateProps = useMemo(
    () => ({
      date,
      onChange,
      onDismiss,
      setDate,
      timezone,
      type,
    }),
    [date, type, onChange, onDismiss, timezone]
  );

  const timeProps = useMemo(
    () => ({
      amPm,
      hour,
      minute,
      setAmPm,
      setHour,
      setMinute,
      setTimezone,
      timezone,
      type,
    }),
    [type, timezone, hour, minute, amPm]
  );

  return (
    <Modal
      onDismiss={onDismiss}
      primaryButtonOnClick={sendOnChange}
      primaryButtonText="Save"
      secondaryButtonOnClick={sendClear}
      secondaryButtonText="Clear"
      size="sm"
      visible={visible}
    >
      <View style={{display: "flex", justifyContent: "center", width: "100%"}}>
        {Boolean(type === "date") && <DateCalendar {...dateProps} />}
        {Boolean(type === "time" && isMobileDevice()) && <MobileTime {...timeProps} />}
        {Boolean(type === "time" && !isMobileDevice()) && <WebTime {...timeProps} />}
        {Boolean(type === "datetime") && (
          <Box>
            <Box marginBottom={2}>
              <DateCalendar {...dateProps} />
            </Box>
            {isMobileDevice() ? <MobileTime {...timeProps} /> : <WebTime {...timeProps} />}
          </Box>
        )}
      </View>
    </Modal>
  );
};
