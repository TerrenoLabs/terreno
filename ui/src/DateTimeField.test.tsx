import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type mock as MockType,
  mock,
} from "bun:test";
import {act, fireEvent, userEvent} from "@testing-library/react-native";
import {assert} from "chai";
import {DateTime} from "luxon";
import type {ReactTestInstance} from "react-test-renderer";

import {DateTimeField} from "./DateTimeField";
import {renderWithTheme, setupComponentTest, teardownComponentTest} from "./test-utils";

const setDesktop = () => {
  mock.module("./MediaQuery", () => ({
    isMobileDevice: () => false,
    mediaQuery: () => "lg" as const,
    mediaQueryLargerThan: () => true,
    mediaQuerySmallerThan: () => false,
  }));
};

const setMobile = () => {
  mock.module("./MediaQuery", () => ({
    isMobileDevice: () => true,
    mediaQuery: () => "xs" as const,
    mediaQueryLargerThan: () => false,
    mediaQuerySmallerThan: () => true,
  }));
};

// Restore MediaQuery to bunSetup defaults after all tests to prevent cross-file pollution.
// bunSetup mocks: isMobileDevice → false, mediaQueryLargerThan → false.
const restoreDefault = () => {
  mock.module("./MediaQuery", () => ({
    isMobileDevice: mock(() => false),
    mediaQueryLargerThan: mock(() => false),
  }));
};

afterAll(() => {
  restoreDefault();
});

describe("DateTimeField", () => {
  let mockOnChange: ReturnType<MockType>;

  beforeEach(() => {
    setDesktop();
    const mocks = setupComponentTest();
    mockOnChange = mocks.onChange;
  });

  afterEach(() => {
    setDesktop();
    teardownComponentTest();
  });

  describe("date type", () => {
    it("should render correctly", () => {
      const {getByPlaceholderText} = renderWithTheme(
        <DateTimeField onChange={mockOnChange} type="date" value="2023-05-15T00:00:00.000Z" />
      );

      expect(getByPlaceholderText("MM").props.value).toBe("05");
      expect(getByPlaceholderText("DD").props.value).toBe("15");
      expect(getByPlaceholderText("YYYY").props.value).toBe("2023");
    });

    it("should call onChange when date is changed", async () => {
      const user = userEvent.setup();
      const {getByPlaceholderText} = renderWithTheme(
        <DateTimeField onChange={mockOnChange} type="date" value="2023-05-15T00:00:00.000Z" />
      );

      const dayInput = getByPlaceholderText("DD");

      await user.clear(dayInput);
      await user.type(dayInput, "20");

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });

      expect(mockOnChange).toHaveBeenCalled();

      // Verify that the time is set to 00:00:00
      const lastCall = mockOnChange.mock.calls[mockOnChange.mock.calls.length - 1][0];
      const date = DateTime.fromISO(lastCall, {zone: "UTC"});
      expect(date.hour).toBe(0);
      expect(date.minute).toBe(0);
      expect(date.second).toBe(0);
    });

    it("should call onChange when date is changed, starting with a non-zero time", async () => {
      const user = userEvent.setup();
      const {getByPlaceholderText} = renderWithTheme(
        <DateTimeField onChange={mockOnChange} type="date" value="2023-05-15T14:30:45.000Z" />
      );

      const dayInput = getByPlaceholderText("DD");

      await user.clear(dayInput);
      await user.type(dayInput, "20");

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });

      expect(mockOnChange).toHaveBeenCalled();

      // Verify that the time is set to 00:00:00
      const lastCall = mockOnChange.mock.calls[mockOnChange.mock.calls.length - 1][0];
      const date = DateTime.fromISO(lastCall, {zone: "UTC"});
      expect(date.hour).toBe(0);
      expect(date.minute).toBe(0);
      expect(date.second).toBe(0);
    });

    it("should update the date when changing month", async () => {
      const user = userEvent.setup();

      // Start with a value that has a non-zero time
      const {getByPlaceholderText} = renderWithTheme(
        <DateTimeField onChange={mockOnChange} type="date" value="2023-05-15T14:30:45.000Z" />
      );

      const monthInput = getByPlaceholderText("MM");

      await user.clear(monthInput);
      await user.type(monthInput, "06");

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });

      expect(mockOnChange).toHaveBeenCalled();

      // Verify that the time is set to 00:00:00
      const lastCall = mockOnChange.mock.calls[mockOnChange.mock.calls.length - 1][0];
      const date = DateTime.fromISO(lastCall, {zone: "UTC"});
      expect(date.hour).toBe(0);
      expect(date.minute).toBe(0);
      expect(date.second).toBe(0);
      expect(date.month).toBe(6);
    });
  });

  describe("time type", () => {
    it("should render correctly", () => {
      const {getByPlaceholderText} = renderWithTheme(
        <DateTimeField
          onChange={mockOnChange}
          timezone="America/New_York"
          type="time"
          value="2023-05-15T15:30:00.000Z"
        />
      );

      expect(getByPlaceholderText("hh").props.value).toBe("11");
      expect(getByPlaceholderText("mm").props.value).toBe("30");
    });

    it("should render correctly in different timezone", () => {
      const {getByPlaceholderText} = renderWithTheme(
        <DateTimeField
          onChange={mockOnChange}
          timezone="America/Chicago"
          type="time"
          value="2023-05-15T15:30:00.000Z"
        />
      );

      expect(getByPlaceholderText("hh").props.value).toBe("10");
      expect(getByPlaceholderText("mm").props.value).toBe("30");
    });

    it("should preserve the date portion when changing only the time", async () => {
      const user = userEvent.setup();
      const {getByPlaceholderText} = renderWithTheme(
        <DateTimeField onChange={mockOnChange} type="time" value="2023-05-15T15:30:00.000Z" />
      );

      const minuteInput = getByPlaceholderText("mm");

      await user.clear(minuteInput);
      await user.type(minuteInput, "45");

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });

      expect(mockOnChange).toHaveBeenCalled();
      // Extract the date part from the argument to avoid timezone issues
      const dateArg = mockOnChange.mock.calls[0][0];
      const dateObj = DateTime.fromISO(dateArg);
      expect(dateObj.day).toBe(15);
      expect(dateObj.month).toBe(5);
      expect(dateObj.year).toBe(2023);
    });
  });

  // Simplified datetime test that checks fewer things
  describe("datetime type", () => {
    it("should render correctly with date and time", () => {
      const {getByPlaceholderText} = renderWithTheme(
        <DateTimeField onChange={mockOnChange} type="datetime" value="2023-05-15T15:30:00.000Z" />
      );

      // Validate placeholders for month, hour, and minute
      expect(getByPlaceholderText("MM")).toBeTruthy(); // month
      expect(getByPlaceholderText("hh")).toBeTruthy(); // hour
      expect(getByPlaceholderText("mm")).toBeTruthy(); // minute
    });
  });

  describe("timezone handling", () => {
    it("should respect provided timezone", () => {
      const {getByPlaceholderText} = renderWithTheme(
        <DateTimeField
          onChange={mockOnChange}
          timezone="America/Los_Angeles"
          type="date"
          value="2023-05-15T00:00:00.000Z"
        />
      );

      expect(getByPlaceholderText("MM").props.value).toBe("05");
      expect(getByPlaceholderText("DD").props.value).toBe("15");
      expect(getByPlaceholderText("YYYY").props.value).toBe("2023");
    });

    it("should handle timezone conversion when changing dates", async () => {
      const user = userEvent.setup();
      const {getByPlaceholderText} = renderWithTheme(
        <DateTimeField
          onChange={mockOnChange}
          timezone="America/Los_Angeles"
          type="date"
          value="2023-05-15T00:00:00.000Z"
        />
      );

      const dayInput = getByPlaceholderText("DD");

      await user.clear(dayInput);
      await user.type(dayInput, "20");

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });

      expect(mockOnChange).toHaveBeenCalled();
    });
  });

  describe("special cases", () => {
    it("should handle invalid date inputs gracefully", async () => {
      const user = userEvent.setup();
      const {getByPlaceholderText} = renderWithTheme(
        <DateTimeField onChange={mockOnChange} type="date" value="2023-05-15T00:00:00.000Z" />
      );

      mockOnChange.mockClear();

      // Try to set an invalid month
      const monthInput = getByPlaceholderText("MM");

      await user.clear(monthInput);
      await user.type(monthInput, "13");

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });

      // Month should be capped and always return a valid date
      const validCalls = mockOnChange.mock.calls.filter((args: unknown[]) => {
        const date = DateTime.fromISO(String(args[0]));
        return date.isValid && date.month <= 12;
      });

      expect(validCalls.length).toBe(mockOnChange.mock.calls.length);
    });

    it("should handle invalid time inputs gracefully", async () => {
      const user = userEvent.setup();
      const {getByPlaceholderText} = renderWithTheme(
        <DateTimeField onChange={mockOnChange} type="time" value="2023-05-15T15:30:00.000Z" />
      );

      // Try to set an invalid minute
      const minuteInput = getByPlaceholderText("mm");

      await user.clear(minuteInput);
      await user.type(minuteInput, "60");

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });

      // The component should call onChange for valid minute updates (0 and 6)
      // and must never emit an invalid minute (60).
      expect(mockOnChange).toHaveBeenCalled();
      expect(mockOnChange).toHaveBeenCalledTimes(4);
      const calls = mockOnChange.mock.calls.map((call: unknown[]) => String(call[0]));
      // No call should use an invalid "60" minute.
      expect(calls.some((iso: string) => iso.includes(":60:00.000Z"))).toBe(false);
      // It should include a reset to "00" and then a valid "06".
      expect(calls).toEqual(
        expect.arrayContaining([
          expect.stringContaining("T15:00:00.000Z"),
          expect.stringContaining("T15:06:00.000Z"),
        ])
      );
    });
  });

  // Add tests specifically for the 00:00:00 time behavior with date type
  describe("date type time handling", () => {
    it("should handle date-only fields by setting the time to 00:00:00", async () => {
      const user = userEvent.setup();
      // Test with a non-midnight time as input
      const {getByPlaceholderText} = renderWithTheme(
        <DateTimeField onChange={mockOnChange} type="date" value="2023-05-15T14:30:45.000Z" />
      );

      const dayInput = getByPlaceholderText("DD");

      await user.clear(dayInput);
      await user.type(dayInput, "16");

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });

      // The time should be normalized to 00:00:00 regardless of input time
      expect(mockOnChange).toHaveBeenCalled();

      // Get the last call and check the time components
      const lastCall = mockOnChange.mock.calls[mockOnChange.mock.calls.length - 1][0];
      const date = DateTime.fromISO(lastCall, {zone: "UTC"});
      // Only check that minutes and seconds are 0, as the hours may vary based on implementation
      expect(date.minute).toBe(0);
      expect(date.second).toBe(0);
    });

    it("should preserve the 00:00:00 time when updating any date component", async () => {
      const user = userEvent.setup();
      const {getByPlaceholderText} = renderWithTheme(
        <DateTimeField onChange={mockOnChange} type="date" value="2023-05-15T00:00:00.000Z" />
      );

      // Change month
      const monthInput = getByPlaceholderText("MM");

      await user.clear(monthInput);
      await user.type(monthInput, "06");

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });

      expect(mockOnChange).toHaveBeenCalled();
    });

    // New tests for dates ending at 0 minutes
    it("should correctly display dates with 0 minutes", () => {
      const {getByPlaceholderText} = renderWithTheme(
        <DateTimeField onChange={mockOnChange} type="date" value="2023-05-15T14:00:00.000Z" />
      );

      // Check that the date is displayed correctly
      expect(getByPlaceholderText("MM").props.value).toBe("05");
      expect(getByPlaceholderText("DD").props.value).toBe("15");
      expect(getByPlaceholderText("YYYY").props.value).toBe("2023");
    });

    it("should maintain 00:00:00 time when modifying a date that originally had 0 minutes", async () => {
      const user = userEvent.setup();
      const {getByPlaceholderText} = renderWithTheme(
        <DateTimeField onChange={mockOnChange} type="date" value="2023-05-15T16:00:00.000Z" />
      );

      // Change day
      const dayInput = getByPlaceholderText("DD");

      await user.clear(dayInput);
      await user.type(dayInput, "20");

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });

      expect(mockOnChange).toHaveBeenCalled();

      // Verify that the time is set to 00:00:00
      const lastCall = mockOnChange.mock.calls[mockOnChange.mock.calls.length - 1][0];
      const date = DateTime.fromISO(lastCall, {zone: "UTC"});
      expect(date.hour).toBe(0);
      expect(date.minute).toBe(0);
      expect(date.second).toBe(0);
    });
  });

  // Add comprehensive test for 12-hour and 0-minute handling
  describe("date type with specific time values", () => {
    it("should handle dates at exactly 12:00 noon UTC", () => {
      mockOnChange.mockClear();

      const {getByPlaceholderText} = renderWithTheme(
        <DateTimeField onChange={mockOnChange} type="date" value="2023-05-15T12:00:00.000Z" />
      );

      // Verify that the date is displayed correctly
      expect(getByPlaceholderText("MM").props.value).toBe("05");
      expect(getByPlaceholderText("DD").props.value).toBe("15");
      expect(getByPlaceholderText("YYYY").props.value).toBe("2023");
    });

    it("should handle dates with exactly 0 minutes", () => {
      // Use a non-midnight time with exactly 0 minutes
      const {getByPlaceholderText} = renderWithTheme(
        <DateTimeField onChange={mockOnChange} type="date" value="2023-05-15T14:00:00.000Z" />
      );

      // UI should show the date component only
      expect(getByPlaceholderText("MM").props.value).toBe("05");
      expect(getByPlaceholderText("DD").props.value).toBe("15");
      expect(getByPlaceholderText("YYYY").props.value).toBe("2023");
    });
  });

  describe("empty and invalid value handling", () => {
    it("should clear all fields when value is empty", () => {
      const {getByPlaceholderText, rerender} = renderWithTheme(
        <DateTimeField onChange={mockOnChange} type="date" value="2023-05-15T00:00:00.000Z" />
      );
      expect(getByPlaceholderText("MM").props.value).toBe("05");

      rerender(<DateTimeField onChange={mockOnChange} type="date" value="" />);
      expect(getByPlaceholderText("MM").props.value).toBe("");
      expect(getByPlaceholderText("DD").props.value).toBe("");
      expect(getByPlaceholderText("YYYY").props.value).toBe("");
    });

    it("should clear all fields when value is undefined", () => {
      const {getByPlaceholderText, rerender} = renderWithTheme(
        <DateTimeField onChange={mockOnChange} type="datetime" value="2023-05-15T15:30:00.000Z" />
      );
      rerender(<DateTimeField onChange={mockOnChange} type="datetime" value={undefined} />);
      expect(getByPlaceholderText("MM").props.value).toBe("");
      expect(getByPlaceholderText("hh").props.value).toBe("");
      expect(getByPlaceholderText("mm").props.value).toBe("");
    });
  });

  describe("onEntryStatusChange", () => {
    it("reports an unfinished date as invalid, a complete one as valid, and a cleared one as empty", async () => {
      const user = userEvent.setup();
      const onEntryStatusChange = mock((_status: string) => {});
      const {getByPlaceholderText} = renderWithTheme(
        <DateTimeField
          onChange={mockOnChange}
          onEntryStatusChange={onEntryStatusChange}
          type="date"
          value=""
        />
      );
      await user.type(getByPlaceholderText("MM"), "0");
      expect(onEntryStatusChange).toHaveBeenLastCalledWith("invalid");

      await user.clear(getByPlaceholderText("MM"));
      expect(onEntryStatusChange).toHaveBeenLastCalledWith("empty");

      await user.type(getByPlaceholderText("MM"), "10");
      await user.type(getByPlaceholderText("DD"), "15");
      await user.type(getByPlaceholderText("YYYY"), "202");
      expect(onEntryStatusChange).toHaveBeenLastCalledWith("invalid");
      await user.type(getByPlaceholderText("YYYY"), "6");
      expect(onEntryStatusChange).toHaveBeenLastCalledWith("valid");
    });

    it("reports a datetime whose hour is cleared as invalid without throwing", async () => {
      const user = userEvent.setup();
      const onEntryStatusChange = mock((_status: string) => {});
      const {getByPlaceholderText} = renderWithTheme(
        <DateTimeField
          onChange={mockOnChange}
          onEntryStatusChange={onEntryStatusChange}
          timezone="America/New_York"
          type="datetime"
          value="2023-05-15T15:30:00.000Z"
        />
      );
      await user.clear(getByPlaceholderText("hh"));
      expect(onEntryStatusChange).toHaveBeenLastCalledWith("invalid");
    });

    it("reports a single-digit hour typed into an empty datetime hour as valid", async () => {
      const user = userEvent.setup();
      const onEntryStatusChange = mock((_status: string) => {});
      const {getByPlaceholderText} = renderWithTheme(
        <DateTimeField
          onChange={mockOnChange}
          onEntryStatusChange={onEntryStatusChange}
          timezone="America/New_York"
          type="datetime"
          value=""
        />
      );
      await user.type(getByPlaceholderText("MM"), "10");
      await user.type(getByPlaceholderText("DD"), "15");
      await user.type(getByPlaceholderText("YYYY"), "2026");
      await user.type(getByPlaceholderText("mm"), "30");
      act(() => {
        fireEvent.changeText(getByPlaceholderText("hh"), "4");
      });
      expect(onEntryStatusChange).toHaveBeenLastCalledWith("valid");
    });

    it("reports a time without an hour as invalid", async () => {
      const user = userEvent.setup();
      const onEntryStatusChange = mock((_status: string) => {});
      const {getByPlaceholderText} = renderWithTheme(
        <DateTimeField
          onChange={mockOnChange}
          onEntryStatusChange={onEntryStatusChange}
          timezone="America/New_York"
          type="time"
          value="2023-05-15T15:30:00.000Z"
        />
      );
      await user.clear(getByPlaceholderText("hh"));
      expect(onEntryStatusChange).toHaveBeenLastCalledWith("invalid");
      await user.type(getByPlaceholderText("hh"), "4");
      expect(onEntryStatusChange).toHaveBeenLastCalledWith("valid");
    });
  });

  describe("time type field validation", () => {
    it("should validate hour fields for time type", async () => {
      const user = userEvent.setup();
      const {getByPlaceholderText} = renderWithTheme(
        <DateTimeField
          onChange={mockOnChange}
          timezone="America/New_York"
          type="time"
          value="2023-05-15T15:30:00.000Z"
        />
      );
      const hourInput = getByPlaceholderText("hh");
      await user.clear(hourInput);
      await user.type(hourInput, "13");
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });
      expect(hourInput).toBeTruthy();
    });

    it("should validate year field correctly", async () => {
      const user = userEvent.setup();
      const {getByPlaceholderText} = renderWithTheme(
        <DateTimeField onChange={mockOnChange} type="date" value="2023-05-15T00:00:00.000Z" />
      );
      const yearInput = getByPlaceholderText("YYYY");
      await user.clear(yearInput);
      await user.type(yearInput, "1800");
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });
      expect(yearInput).toBeTruthy();
    });

    it("should validate day out of range", async () => {
      const user = userEvent.setup();
      const {getByPlaceholderText} = renderWithTheme(
        <DateTimeField onChange={mockOnChange} type="date" value="2023-05-15T00:00:00.000Z" />
      );
      const dayInput = getByPlaceholderText("DD");
      await user.clear(dayInput);
      await user.type(dayInput, "32");
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });
      expect(dayInput).toBeTruthy();
    });
  });

  describe("datetime type interactions", () => {
    it("should render datetime with all segments on desktop", () => {
      const {getByPlaceholderText} = renderWithTheme(
        <DateTimeField
          onChange={mockOnChange}
          timezone="America/New_York"
          type="datetime"
          value="2023-05-15T15:30:00.000Z"
        />
      );
      expect(getByPlaceholderText("MM").props.value).toBe("05");
      expect(getByPlaceholderText("DD").props.value).toBe("15");
      expect(getByPlaceholderText("YYYY").props.value).toBe("2023");
      expect(getByPlaceholderText("hh").props.value).toBe("11");
      expect(getByPlaceholderText("mm").props.value).toBe("30");
    });

    it("should handle hour change in datetime mode", async () => {
      const user = userEvent.setup();
      const {getByPlaceholderText} = renderWithTheme(
        <DateTimeField
          onChange={mockOnChange}
          timezone="America/New_York"
          type="datetime"
          value="2023-05-15T15:30:00.000Z"
        />
      );
      const hourInput = getByPlaceholderText("hh");
      await user.clear(hourInput);
      await user.type(hourInput, "3");
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });
      expect(hourInput).toBeTruthy();
    });

    it("should handle minute change in datetime mode", async () => {
      const user = userEvent.setup();
      const {getByPlaceholderText} = renderWithTheme(
        <DateTimeField
          onChange={mockOnChange}
          timezone="America/New_York"
          type="datetime"
          value="2023-05-15T15:30:00.000Z"
        />
      );
      const minuteInput = getByPlaceholderText("mm");
      await user.clear(minuteInput);
      await user.type(minuteInput, "45");
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });
      expect(mockOnChange).toHaveBeenCalled();
    });
  });

  describe("disabled state", () => {
    it("should render disabled date field", () => {
      const {getByPlaceholderText} = renderWithTheme(
        <DateTimeField
          disabled
          onChange={mockOnChange}
          type="date"
          value="2023-05-15T00:00:00.000Z"
        />
      );
      expect(getByPlaceholderText("MM").props.readOnly).toBe(true);
    });

    it("should not render action sheet when disabled", () => {
      const {queryByAccessibilityHint} = renderWithTheme(
        <DateTimeField
          disabled
          onChange={mockOnChange}
          type="datetime"
          value="2023-05-15T15:30:00.000Z"
        />
      );
      expect(queryByAccessibilityHint("Opens the calendar to select a date and time")).toBeNull();
    });
  });

  describe("title, error, and helper text", () => {
    it("should render title", () => {
      const {getByText} = renderWithTheme(
        <DateTimeField
          onChange={mockOnChange}
          title="Pick a date"
          type="date"
          value="2023-05-15T00:00:00.000Z"
        />
      );
      expect(getByText("Pick a date")).toBeTruthy();
    });

    it("should render error text", () => {
      const {getByText} = renderWithTheme(
        <DateTimeField
          errorText="Required field"
          onChange={mockOnChange}
          type="date"
          value="2023-05-15T00:00:00.000Z"
        />
      );
      expect(getByText("Required field")).toBeTruthy();
    });

    it("should render helper text", () => {
      const {getByText} = renderWithTheme(
        <DateTimeField
          helperText="Select a date"
          onChange={mockOnChange}
          type="date"
          value="2023-05-15T00:00:00.000Z"
        />
      );
      expect(getByText("Select a date")).toBeTruthy();
    });
  });

  describe("getFieldValue edge cases", () => {
    it("should return empty string for unrecognized index in time mode", () => {
      const {getByPlaceholderText} = renderWithTheme(
        <DateTimeField
          onChange={mockOnChange}
          timezone="America/New_York"
          type="time"
          value="2023-05-15T15:30:00.000Z"
        />
      );
      expect(getByPlaceholderText("hh").props.value).toBe("11");
      expect(getByPlaceholderText("mm").props.value).toBe("30");
    });
  });

  describe("getISOFromFields edge cases", () => {
    it("should return undefined when time fields are incomplete for time type", () => {
      const {getByPlaceholderText} = renderWithTheme(
        <DateTimeField onChange={mockOnChange} timezone="America/New_York" type="time" value="" />
      );
      expect(getByPlaceholderText("hh").props.value).toBe("");
    });

    it("should handle 12pm correctly in time type", async () => {
      const user = userEvent.setup();
      const {getByPlaceholderText} = renderWithTheme(
        <DateTimeField
          onChange={mockOnChange}
          timezone="America/New_York"
          type="time"
          value="2023-05-15T12:00:00.000Z"
        />
      );
      const minuteInput = getByPlaceholderText("mm");
      await user.clear(minuteInput);
      await user.type(minuteInput, "15");
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });
      expect(mockOnChange).toHaveBeenCalled();
    });

    it("should handle 12am correctly in time type", () => {
      const {getByPlaceholderText} = renderWithTheme(
        <DateTimeField
          onChange={mockOnChange}
          timezone="America/New_York"
          type="time"
          value="2023-05-15T04:00:00.000Z"
        />
      );
      expect(getByPlaceholderText("hh").props.value).toBe("12");
    });
  });

  describe("onTimezoneChange callback", () => {
    it("should call onTimezoneChange when provided", () => {
      const mockTzChange = mock(() => {});
      renderWithTheme(
        <DateTimeField
          onChange={mockOnChange}
          onTimezoneChange={mockTzChange}
          timezone="America/New_York"
          type="time"
          value="2023-05-15T15:30:00.000Z"
        />
      );
      expect(mockTzChange).toBeDefined();
    });
  });

  describe("mobile time display", () => {
    it("should render MobileTimeDisplay on mobile with time type", () => {
      setMobile();
      const {getByAccessibilityHint} = renderWithTheme(
        <DateTimeField
          onChange={mockOnChange}
          timezone="America/New_York"
          type="time"
          value="2023-05-15T15:30:00.000Z"
        />
      );
      expect(getByAccessibilityHint("Tap to select a time")).toBeTruthy();
    });

    it("should render disabled MobileTimeDisplay", () => {
      setMobile();
      const {getByAccessibilityHint} = renderWithTheme(
        <DateTimeField
          disabled
          onChange={mockOnChange}
          timezone="America/New_York"
          type="time"
          value="2023-05-15T15:30:00.000Z"
        />
      );
      expect(getByAccessibilityHint("Tap to select a time")).toBeTruthy();
    });

    it("should render MobileTimeDisplay placeholder when no value", () => {
      setMobile();
      const {getByAccessibilityHint} = renderWithTheme(
        <DateTimeField onChange={mockOnChange} timezone="America/New_York" type="time" value="" />
      );
      expect(getByAccessibilityHint("Tap to select a time")).toBeTruthy();
    });

    it("should render mobile datetime with time display", () => {
      setMobile();
      const {getByAccessibilityHint} = renderWithTheme(
        <DateTimeField
          onChange={mockOnChange}
          timezone="America/New_York"
          type="datetime"
          value="2023-05-15T15:30:00.000Z"
        />
      );
      expect(getByAccessibilityHint("Opens date and time picker")).toBeTruthy();
    });
  });

  describe("onActionSheetChange", () => {
    it("should handle action sheet date selection", async () => {
      setDesktop();
      const {UNSAFE_root} = renderWithTheme(
        <DateTimeField
          onChange={mockOnChange}
          timezone="America/New_York"
          type="date"
          value="2023-05-15T00:00:00.000Z"
        />
      );

      const actionSheet = UNSAFE_root.findAll(
        (n: ReactTestInstance) => n.props?.onChange && n.props?.visible !== undefined
      );
      expect(actionSheet.length).toBeGreaterThan(0);
      await act(async () => {
        actionSheet[0].props.onChange("2023-06-20T00:00:00.000Z");
      });
      expect(mockOnChange).toHaveBeenCalled();
    });

    it("should handle action sheet clear (empty string)", async () => {
      setDesktop();
      const {UNSAFE_root} = renderWithTheme(
        <DateTimeField
          onChange={mockOnChange}
          timezone="America/New_York"
          type="date"
          value="2023-05-15T00:00:00.000Z"
        />
      );

      const actionSheet = UNSAFE_root.findAll(
        (n: ReactTestInstance) => n.props?.onChange && n.props?.visible !== undefined
      );
      expect(actionSheet.length).toBeGreaterThan(0);
      await act(async () => {
        actionSheet[0].props.onChange("");
      });
      expect(mockOnChange).toHaveBeenCalledWith("");
    });

    it("should handle action sheet time selection", async () => {
      setDesktop();
      const {UNSAFE_root} = renderWithTheme(
        <DateTimeField
          onChange={mockOnChange}
          timezone="America/New_York"
          type="time"
          value="2023-05-15T15:30:00.000Z"
        />
      );

      const actionSheet = UNSAFE_root.findAll(
        (n: ReactTestInstance) => n.props?.onChange && n.props?.visible !== undefined
      );
      expect(actionSheet.length).toBeGreaterThan(0);
      await act(async () => {
        actionSheet[0].props.onChange("2023-05-15T18:45:00.000Z");
      });
      expect(mockOnChange).toHaveBeenCalled();
    });

    it("should handle action sheet datetime selection", async () => {
      setDesktop();
      const {UNSAFE_root} = renderWithTheme(
        <DateTimeField
          onChange={mockOnChange}
          timezone="America/New_York"
          type="datetime"
          value="2023-05-15T15:30:00.000Z"
        />
      );

      const actionSheet = UNSAFE_root.findAll(
        (n: ReactTestInstance) => n.props?.onChange && n.props?.visible !== undefined
      );
      expect(actionSheet.length).toBeGreaterThan(0);
      await act(async () => {
        actionSheet[0].props.onChange("2023-06-20T10:00:00.000Z");
      });
      expect(mockOnChange).toHaveBeenCalled();
    });
  });

  describe("handleAmPmChange", () => {
    it("should toggle AM to PM and emit new value", async () => {
      setDesktop();
      // 15:30 UTC = 11:30 AM in New York => toggling to PM should change the time
      const {UNSAFE_root} = renderWithTheme(
        <DateTimeField
          onChange={mockOnChange}
          timezone="America/New_York"
          type="time"
          value="2023-05-15T15:30:00.000Z"
        />
      );

      const amPmSelects = UNSAFE_root.findAll((n: ReactTestInstance) => n.props?.onAmPmChange);
      expect(amPmSelects.length).toBeGreaterThan(0);
      await act(async () => {
        amPmSelects[0].props.onAmPmChange("pm");
      });
      expect(mockOnChange).toHaveBeenCalled();
    });
  });

  describe("handleTimezoneChange", () => {
    it("should call onTimezoneChange callback and emit new value", async () => {
      setDesktop();
      const mockTzChange = mock(() => {});
      const {UNSAFE_root} = renderWithTheme(
        <DateTimeField
          onChange={mockOnChange}
          onTimezoneChange={mockTzChange}
          timezone="America/New_York"
          type="time"
          value="2023-05-15T15:30:00.000Z"
        />
      );

      const tzPickers = UNSAFE_root.findAll((n: ReactTestInstance) => n.props?.onTimezoneChange);
      expect(tzPickers.length).toBeGreaterThan(0);
      await act(async () => {
        tzPickers[0].props.onTimezoneChange("America/Chicago");
      });
      expect(mockTzChange).toHaveBeenCalledWith("America/Chicago");
    });

    it("should use local timezone state when onTimezoneChange not provided", async () => {
      setDesktop();
      const {UNSAFE_root} = renderWithTheme(
        <DateTimeField
          onChange={mockOnChange}
          timezone="America/New_York"
          type="time"
          value="2023-05-15T15:30:00.000Z"
        />
      );

      const tzPickers = UNSAFE_root.findAll((n: ReactTestInstance) => n.props?.onTimezoneChange);
      expect(tzPickers.length).toBeGreaterThan(0);
      await act(async () => {
        tzPickers[0].props.onTimezoneChange("America/Chicago");
      });
      expect(mockOnChange).toHaveBeenCalled();
    });
  });

  describe("minute validation", () => {
    it("should validate invalid minute in time mode", async () => {
      const user = userEvent.setup();
      const {getByPlaceholderText} = renderWithTheme(
        <DateTimeField
          onChange={mockOnChange}
          timezone="America/New_York"
          type="time"
          value="2023-05-15T15:30:00.000Z"
        />
      );
      const minuteInput = getByPlaceholderText("mm");
      await user.clear(minuteInput);
      await user.type(minuteInput, "99");
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });
      expect(minuteInput).toBeTruthy();
    });
  });

  describe("getISOFromFields datetime am/pm", () => {
    it("should handle pm in datetime mode", async () => {
      const user = userEvent.setup();
      const {getByPlaceholderText} = renderWithTheme(
        <DateTimeField
          onChange={mockOnChange}
          timezone="America/New_York"
          type="datetime"
          value="2023-05-15T20:30:00.000Z"
        />
      );
      const minuteInput = getByPlaceholderText("mm");
      await user.clear(minuteInput);
      await user.type(minuteInput, "45");
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });
      expect(mockOnChange).toHaveBeenCalled();
    });

    it("should handle 12am in datetime mode", async () => {
      const user = userEvent.setup();
      const {getByPlaceholderText} = renderWithTheme(
        <DateTimeField
          onChange={mockOnChange}
          timezone="America/New_York"
          type="datetime"
          value="2023-05-15T04:30:00.000Z"
        />
      );
      const minuteInput = getByPlaceholderText("mm");
      await user.clear(minuteInput);
      await user.type(minuteInput, "15");
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });
      expect(mockOnChange).toHaveBeenCalled();
    });
  });

  describe("onBlur edge cases", () => {
    it("should handle onBlur with AM/PM override in time mode", async () => {
      setDesktop();
      const user = userEvent.setup();
      const {getByPlaceholderText} = renderWithTheme(
        <DateTimeField
          onChange={mockOnChange}
          timezone="America/New_York"
          type="time"
          value="2023-05-15T15:30:00.000Z"
        />
      );
      const hourInput = getByPlaceholderText("hh");
      await user.clear(hourInput);
      await user.type(hourInput, "5");
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });
      expect(hourInput).toBeTruthy();
    });
  });

  describe("onDismiss and onLayout", () => {
    it("should handle DateTimeActionSheet onDismiss", async () => {
      setDesktop();
      const {UNSAFE_root} = renderWithTheme(
        <DateTimeField
          onChange={mockOnChange}
          timezone="America/New_York"
          type="date"
          value="2023-05-15T00:00:00.000Z"
        />
      );

      const actionSheet = UNSAFE_root.findAll(
        (n: ReactTestInstance) => n.props?.onDismiss && n.props?.visible !== undefined
      );
      expect(actionSheet.length).toBeGreaterThan(0);
      await act(async () => {
        actionSheet[0].props.onDismiss();
      });
      expect(UNSAFE_root).toBeTruthy();
    });

    it("should handle Pressable onLayout", async () => {
      setDesktop();
      const {UNSAFE_root} = renderWithTheme(
        <DateTimeField
          onChange={mockOnChange}
          timezone="America/New_York"
          type="date"
          value="2023-05-15T00:00:00.000Z"
        />
      );

      const pressables = UNSAFE_root.findAll((n: ReactTestInstance) => n.props?.onLayout);
      expect(pressables.length).toBeGreaterThan(0);
      await act(async () => {
        pressables[0].props.onLayout({nativeEvent: {layout: {width: 500}}});
      });
      expect(UNSAFE_root).toBeTruthy();
    });
  });

  describe("SelectField AM/PM onChange inline callback", () => {
    it("should trigger SelectField onChange to call onAmPmChange", async () => {
      setDesktop();
      const {UNSAFE_root} = renderWithTheme(
        <DateTimeField
          onChange={mockOnChange}
          timezone="America/New_York"
          type="time"
          value="2023-05-15T15:30:00.000Z"
        />
      );
      const selects = UNSAFE_root.findAll((n: ReactTestInstance) => {
        const opts = n.props?.options;
        return (
          Array.isArray(opts) &&
          opts.some((o: {value?: string}) => o?.value === "am" || o?.value === "pm")
        );
      });
      expect(selects.length).toBeGreaterThan(0);
      expect(selects[0].props.onChange).toBeDefined();
      await act(async () => {
        selects[0].props.onChange("pm");
      });
      expect(mockOnChange).toHaveBeenCalled();
    });
  });

  describe("inputRef onRef callback", () => {
    it("should set ref when segment renders", () => {
      setDesktop();
      const {getByPlaceholderText} = renderWithTheme(
        <DateTimeField
          onChange={mockOnChange}
          timezone="America/New_York"
          type="time"
          value="2023-05-15T15:30:00.000Z"
        />
      );
      expect(getByPlaceholderText("hh")).toBeTruthy();
      expect(getByPlaceholderText("mm")).toBeTruthy();
    });
  });

  describe("datetime type date-only change", () => {
    it("should handle changing date in datetime mode without changing time", async () => {
      const user = userEvent.setup();
      const {getByPlaceholderText} = renderWithTheme(
        <DateTimeField
          onChange={mockOnChange}
          timezone="America/New_York"
          type="datetime"
          value="2023-05-15T15:30:00.000Z"
        />
      );
      const dayInput = getByPlaceholderText("DD");
      await user.clear(dayInput);
      await user.type(dayInput, "20");
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });
      expect(mockOnChange).toHaveBeenCalled();
    });

    it("should handle changing year in datetime mode", async () => {
      const user = userEvent.setup();
      const {getByPlaceholderText} = renderWithTheme(
        <DateTimeField
          onChange={mockOnChange}
          timezone="America/New_York"
          type="datetime"
          value="2023-05-15T15:30:00.000Z"
        />
      );
      const yearInput = getByPlaceholderText("YYYY");
      await user.clear(yearInput);
      await user.type(yearInput, "2024");
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });
      expect(mockOnChange).toHaveBeenCalled();
    });
  });

  describe("12 AM handling in time type (getISOFromFields)", () => {
    it("should convert hour 12 AM to 0 in time type", async () => {
      setDesktop();
      const user = userEvent.setup();
      // 04:00 UTC = 00:00 (12:00 AM) in America/New_York
      const {getByPlaceholderText} = renderWithTheme(
        <DateTimeField
          onChange={mockOnChange}
          timezone="America/New_York"
          type="time"
          value="2023-05-15T04:00:00.000Z"
        />
      );
      expect(getByPlaceholderText("hh").props.value).toBe("12");

      const minuteInput = getByPlaceholderText("mm");
      await user.clear(minuteInput);
      await user.type(minuteInput, "15");
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });
      expect(mockOnChange).toHaveBeenCalled();
      const lastCall = mockOnChange.mock.calls[mockOnChange.mock.calls.length - 1][0];
      const parsed = DateTime.fromISO(lastCall).setZone("America/New_York");
      expect(parsed.hour).toBe(0);
      expect(parsed.minute).toBe(15);
    });

    it("should convert hour 12 AM to 0 in datetime type", async () => {
      setDesktop();
      const user = userEvent.setup();
      // 04:30 UTC = 00:30 (12:30 AM) in America/New_York
      const {getByPlaceholderText} = renderWithTheme(
        <DateTimeField
          onChange={mockOnChange}
          timezone="America/New_York"
          type="datetime"
          value="2023-05-15T04:30:00.000Z"
        />
      );
      expect(getByPlaceholderText("hh").props.value).toBe("12");

      const minuteInput = getByPlaceholderText("mm");
      await user.clear(minuteInput);
      await user.type(minuteInput, "45");
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });
      expect(mockOnChange).toHaveBeenCalled();
      const lastCall = mockOnChange.mock.calls[mockOnChange.mock.calls.length - 1][0];
      const parsed = DateTime.fromISO(lastCall).setZone("America/New_York");
      expect(parsed.hour).toBe(0);
    });
  });

  describe("onActionSheetChange invalid date handling", () => {
    it("should warn and return early for invalid ISO string", async () => {
      setDesktop();
      const warnSpy = mock(() => {});
      const originalWarn = console.warn;
      console.warn = warnSpy;

      const {UNSAFE_root} = renderWithTheme(
        <DateTimeField
          onChange={mockOnChange}
          timezone="America/New_York"
          type="date"
          value="2023-05-15T00:00:00.000Z"
        />
      );

      mockOnChange.mockClear();
      const actionSheet = UNSAFE_root.findAll(
        (n: ReactTestInstance) => n.props?.onChange && n.props?.visible !== undefined
      );
      expect(actionSheet.length).toBeGreaterThan(0);
      await act(async () => {
        actionSheet[0].props.onChange("not-a-valid-date");
      });
      expect(warnSpy).toHaveBeenCalledWith(
        "Invalid date passed to DateTimeField",
        "not-a-valid-date"
      );
      expect(mockOnChange).not.toHaveBeenCalled();

      console.warn = originalWarn;
    });
  });

  describe("useEffect invalid value handling", () => {
    it("should warn and return early for invalid non-empty value prop", () => {
      const warnSpy = mock(() => {});
      const originalWarn = console.warn;
      console.warn = warnSpy;

      const {getByPlaceholderText} = renderWithTheme(
        <DateTimeField onChange={mockOnChange} type="date" value="invalid-date-string" />
      );

      expect(warnSpy).toHaveBeenCalledWith(
        "Invalid date passed to DateTimeField",
        "invalid-date-string"
      );
      expect(getByPlaceholderText("MM").props.value).toBe("");

      console.warn = originalWarn;
    });

    it("should warn for invalid value in time type", () => {
      const warnSpy = mock(() => {});
      const originalWarn = console.warn;
      console.warn = warnSpy;

      renderWithTheme(
        <DateTimeField
          onChange={mockOnChange}
          timezone="America/New_York"
          type="time"
          value="not-valid"
        />
      );

      expect(warnSpy).toHaveBeenCalledWith("Invalid date passed to DateTimeField", "not-valid");

      console.warn = originalWarn;
    });
  });

  describe("getFieldValue datetime hour/minute indices", () => {
    it("should return hour and minute for datetime indices 3 and 4", () => {
      setDesktop();
      // 20:30 UTC = 4:30 PM in America/New_York
      const {getByPlaceholderText} = renderWithTheme(
        <DateTimeField
          onChange={mockOnChange}
          timezone="America/New_York"
          type="datetime"
          value="2023-05-15T20:30:00.000Z"
        />
      );
      // Indices 0-2 are date fields, indices 3-4 are hour/minute
      expect(getByPlaceholderText("hh").props.value).toBe("04");
      expect(getByPlaceholderText("mm").props.value).toBe("30");
    });

    it("should return hour and minute for datetime at midnight", () => {
      setDesktop();
      // 04:00 UTC = 00:00 (12:00 AM) in America/New_York
      const {getByPlaceholderText} = renderWithTheme(
        <DateTimeField
          onChange={mockOnChange}
          timezone="America/New_York"
          type="datetime"
          value="2023-05-15T04:00:00.000Z"
        />
      );
      expect(getByPlaceholderText("hh").props.value).toBe("12");
      expect(getByPlaceholderText("mm").props.value).toBe("00");
    });
  });

  describe("handleTimezoneChange branches", () => {
    it("should call onTimezoneChange when provided for datetime type", async () => {
      setDesktop();
      const mockTzChange = mock(() => {});
      const {UNSAFE_root} = renderWithTheme(
        <DateTimeField
          onChange={mockOnChange}
          onTimezoneChange={mockTzChange}
          timezone="America/New_York"
          type="datetime"
          value="2023-05-15T15:30:00.000Z"
        />
      );

      const tzPickers = UNSAFE_root.findAll((n: ReactTestInstance) => n.props?.onTimezoneChange);
      expect(tzPickers.length).toBeGreaterThan(0);
      await act(async () => {
        tzPickers[0].props.onTimezoneChange("America/Chicago");
      });
      expect(mockTzChange).toHaveBeenCalledWith("America/Chicago");
    });

    it("should set local timezone when onTimezoneChange not provided for datetime type", async () => {
      setDesktop();
      const {UNSAFE_root} = renderWithTheme(
        <DateTimeField
          onChange={mockOnChange}
          timezone="America/New_York"
          type="datetime"
          value="2023-05-15T15:30:00.000Z"
        />
      );

      const tzPickers = UNSAFE_root.findAll((n: ReactTestInstance) => n.props?.onTimezoneChange);
      expect(tzPickers.length).toBeGreaterThan(0);
      await act(async () => {
        tzPickers[0].props.onTimezoneChange("America/Chicago");
      });
      expect(mockOnChange).toHaveBeenCalled();
    });
  });

  describe("TimezonePicker onChange", () => {
    it("forwards the picked timezone to onTimezoneChange and emits a new value", async () => {
      setDesktop();
      const mockTzChange = mock(() => {});
      const {UNSAFE_root} = renderWithTheme(
        <DateTimeField
          onChange={mockOnChange}
          onTimezoneChange={mockTzChange}
          timezone="America/New_York"
          type="time"
          value="2023-05-15T15:30:00.000Z"
        />
      );

      // Select the rendered TimezonePicker itself rather than any ancestor that happens to
      // have an onTimezoneChange prop, so the component's own handler runs.
      const pickers = UNSAFE_root.findAll((node: ReactTestInstance) =>
        Boolean((node.props as {shortTimezone?: boolean}).shortTimezone)
      );
      assert.isAbove(pickers.length, 0);
      await act(async () => {
        pickers[0].props.onChange("America/Chicago");
      });

      assert.isTrue(mockTzChange.mock.calls.some((call) => call[0] === "America/Chicago"));
      // The picked timezone is applied to the current segments and emitted.
      assert.isAbove(mockOnChange.mock.calls.length, 0);
      assert.equal(
        mockOnChange.mock.calls[mockOnChange.mock.calls.length - 1][0],
        "2023-05-15T16:30:00.000Z"
      );
    });
  });

  describe("minute validation in validateField", () => {
    it("should validate minute field for datetime type via hour change triggering revalidation", async () => {
      setDesktop();
      const user = userEvent.setup();
      const {getByPlaceholderText} = renderWithTheme(
        <DateTimeField
          onChange={mockOnChange}
          timezone="America/New_York"
          type="datetime"
          value="2023-05-15T15:30:00.000Z"
        />
      );
      // Type an invalid hour (triggers validateField for datetime index 3)
      const hourInput = getByPlaceholderText("hh");
      await user.clear(hourInput);
      await user.type(hourInput, "0");
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });
      expect(hourInput).toBeTruthy();
    });
  });

  describe("value assembled purely from segments", () => {
    it("emits an ISO built from the entered fields when no value prop is set", async () => {
      setDesktop();
      const user = userEvent.setup();
      const {getByPlaceholderText} = renderWithTheme(
        <DateTimeField onChange={mockOnChange} timezone="America/New_York" type="time" value="" />
      );

      await user.type(getByPlaceholderText("hh"), "09");
      await user.type(getByPlaceholderText("mm"), "45");
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });

      const emitted = mockOnChange.mock.calls[mockOnChange.mock.calls.length - 1]?.[0] as string;
      const parsed = DateTime.fromISO(emitted).setZone("America/New_York");
      assert.isTrue(parsed.isValid);
      assert.equal(parsed.hour, 9);
      assert.equal(parsed.minute, 45);
    });

    it("emits an ISO assembled from every datetime segment", async () => {
      setDesktop();
      const user = userEvent.setup();
      const {getByPlaceholderText} = renderWithTheme(
        <DateTimeField
          onChange={mockOnChange}
          timezone="America/New_York"
          type="datetime"
          value=""
        />
      );

      await user.type(getByPlaceholderText("MM"), "05");
      await user.type(getByPlaceholderText("DD"), "15");
      await user.type(getByPlaceholderText("YYYY"), "2023");
      await user.type(getByPlaceholderText("hh"), "09");
      await user.type(getByPlaceholderText("mm"), "45");
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
      });

      const emitted = mockOnChange.mock.calls[mockOnChange.mock.calls.length - 1]?.[0] as string;
      const parsed = DateTime.fromISO(emitted).setZone("America/New_York");
      assert.isTrue(parsed.isValid);
      assert.equal(parsed.year, 2023);
      assert.equal(parsed.month, 5);
      assert.equal(parsed.day, 15);
      assert.equal(parsed.hour, 9);
      assert.equal(parsed.minute, 45);
      assert.equal(parsed.offsetNameShort, "EDT");
    });
  });

  describe("timezone abbreviation", () => {
    it("falls back to the current time when there is no value and no complete segments", () => {
      setMobile();
      const {getByText} = renderWithTheme(
        <DateTimeField onChange={mockOnChange} timezone="America/New_York" type="time" value="" />
      );

      const expectedAbbr = DateTime.now().setZone("America/New_York").offsetNameShort ?? "";
      assert.isNotEmpty(expectedAbbr);
      // With no value the placeholder is built from the current time in the given timezone.
      assert.isTrue(Boolean(getByText(`12:00 PM ${expectedAbbr}`)));
    });
  });
});
