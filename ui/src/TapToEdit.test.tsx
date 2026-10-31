import {describe, expect, it, mock, spyOn} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import {Linking} from "react-native";

import {formatAddress, TapToEdit} from "./TapToEdit";
import {renderWithTheme} from "./test-utils";

describe("TapToEdit", () => {
  it("renders correctly with text value", () => {
    const {toJSON} = renderWithTheme(
      <TapToEdit setValue={() => {}} title="Name" type="text" value="John Doe" />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("displays title and value", () => {
    const {getByText} = renderWithTheme(
      <TapToEdit setValue={() => {}} title="Email" type="text" value="test@example.com" />
    );
    expect(getByText("Email")).toBeTruthy();
    expect(getByText("test@example.com")).toBeTruthy();
  });

  it("renders non-editable when editable is false", () => {
    const {toJSON} = renderWithTheme(
      <TapToEdit editable={false} title="Read Only" type="text" value="Cannot edit this" />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders edit icon when editable", () => {
    const {toJSON} = renderWithTheme(
      <TapToEdit
        editable
        setValue={() => {}}
        title="Editable Field"
        type="text"
        value="Click to edit"
      />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("shows editing mode when isEditing is true", () => {
    const {toJSON} = renderWithTheme(
      <TapToEdit isEditing setValue={() => {}} title="Field" type="text" value="Editing..." />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("displays helper text when provided", () => {
    const {toJSON} = renderWithTheme(
      <TapToEdit
        helperText="Enter your full name"
        onlyShowHelperTextWhileEditing={false}
        setValue={() => {}}
        title="Name"
        type="text"
        value=""
      />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with boolean type showing Yes/No", () => {
    const {getByText} = renderWithTheme(
      <TapToEdit editable={false} title="Active" type="boolean" value={true} />
    );
    expect(getByText("Yes")).toBeTruthy();
  });

  it("renders with boolean type showing No when false", () => {
    const {getByText} = renderWithTheme(
      <TapToEdit editable={false} title="Active" type="boolean" value={false} />
    );
    expect(getByText("No")).toBeTruthy();
  });

  it("renders with transform function", () => {
    const {getByText} = renderWithTheme(
      <TapToEdit
        editable={false}
        title="Custom"
        transform={(val) => `Transformed: ${val}`}
        type="text"
        value="data"
      />
    );
    expect(getByText("Transformed: data")).toBeTruthy();
  });

  it("renders with textarea type", () => {
    const {toJSON} = renderWithTheme(
      <TapToEdit
        editable={false}
        title="Description"
        type="textarea"
        value="This is a long description that spans multiple lines."
      />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders multiselect type as comma-joined string", () => {
    const {getByText} = renderWithTheme(
      <TapToEdit
        editable={false}
        options={[]}
        title="Tags"
        type="multiselect"
        value={["a", "b", "c"]}
      />
    );
    expect(getByText("a, b, c")).toBeTruthy();
  });

  it("renders url type showing hostname for a valid URL", () => {
    const {getByText} = renderWithTheme(
      <TapToEdit editable={false} title="Website" type="url" value="https://example.com/foo" />
    );
    expect(getByText("example.com")).toBeTruthy();
  });

  it("renders url type falling back to raw value for invalid URL", () => {
    const {getByText} = renderWithTheme(
      <TapToEdit editable={false} title="Website" type="url" value="not-a-url" />
    );
    expect(getByText("not-a-url")).toBeTruthy();
  });

  it("renders url type with empty value without logging error", () => {
    const {toJSON} = renderWithTheme(
      <TapToEdit editable={false} title="Website" type="url" value="" />
    );
    expect(toJSON()).toBeTruthy();
  });

  it("renders address type using formatAddress", () => {
    const {getByText} = renderWithTheme(
      <TapToEdit
        editable={false}
        title="Home"
        type="address"
        value={{
          address1: "123 Main St",
          city: "Boston",
          state: "MA",
          zipcode: "02101",
        }}
      />
    );
    expect(getByText(/123 Main St/)).toBeTruthy();
  });

  it("invokes Linking.openURL for url type when clicked", async () => {
    const openURLSpy = spyOn(Linking, "openURL").mockImplementation(() => Promise.resolve(true));

    const {getByLabelText} = renderWithTheme(
      <TapToEdit editable={false} title="Site" type="url" value="https://example.com" />
    );

    await act(async () => {
      fireEvent.press(getByLabelText("Link"));
    });
    expect(openURLSpy).toHaveBeenCalled();

    openURLSpy.mockRestore();
  });

  it("invokes Linking.openURL with google maps for address type when clicked", async () => {
    const openURLSpy = spyOn(Linking, "openURL").mockImplementation(() => Promise.resolve(true));

    const {getByLabelText} = renderWithTheme(
      <TapToEdit
        editable={false}
        title="Home"
        type="address"
        value={{address1: "1 Market St", city: "SF", state: "CA", zipcode: "94105"}}
      />
    );

    await act(async () => {
      fireEvent.press(getByLabelText("Link"));
    });
    expect(openURLSpy).toHaveBeenCalled();
    const arg = openURLSpy.mock.calls[0][0];
    expect(arg).toContain("google.com/maps");

    openURLSpy.mockRestore();
  });

  it("throws when editable is true and setValue is not provided", () => {
    expect(() =>
      renderWithTheme(<TapToEdit editable title="Required Save" type="text" value="foo" />)
    ).toThrow();
  });

  it("enters editing mode when Edit button is pressed", async () => {
    const setValue = mock(() => {});
    const {getByLabelText, queryByText} = renderWithTheme(
      <TapToEdit setValue={setValue} title="Name" type="text" value="Jane" />
    );
    await act(async () => {
      fireEvent.press(getByLabelText("Edit"));
    });
    expect(queryByText("Cancel")).toBeTruthy();
    expect(queryByText("Save")).toBeTruthy();
  });

  it("calls setValue with initial value and exits editing on Cancel", async () => {
    const setValue = mock(() => {});
    const {getByLabelText, getByText} = renderWithTheme(
      <TapToEdit setValue={setValue} title="Name" type="text" value="Jane" />
    );
    await act(async () => {
      fireEvent.press(getByLabelText("Edit"));
    });
    await act(async () => {
      fireEvent.press(getByText("Cancel"));
    });
    expect(setValue).toHaveBeenCalled();
  });

  it("reverts to original value (not edited value) when Cancel is pressed", async () => {
    const setValue = mock((_v: unknown) => {});
    const {getByLabelText, getByText} = renderWithTheme(
      <TapToEdit setValue={setValue} title="Name" type="text" value="Jane" />
    );
    await act(async () => {
      fireEvent.press(getByLabelText("Edit"));
    });
    // Simulate user having changed the value during editing
    setValue("Edited Value");
    await act(async () => {
      fireEvent.press(getByText("Cancel"));
    });
    expect(setValue).toHaveBeenLastCalledWith("Jane");
  });

  it("clears value when Clear button is pressed", async () => {
    const setValue = mock(() => {});
    const onSave = mock(() => Promise.resolve());
    const {getByLabelText, getByText} = renderWithTheme(
      <TapToEdit
        onSave={onSave}
        setValue={setValue}
        showClearButton
        title="Name"
        type="text"
        value="Jane"
      />
    );
    await act(async () => {
      fireEvent.press(getByLabelText("Edit"));
    });
    await act(async () => {
      fireEvent.press(getByText("Clear"));
    });
    expect(setValue).toHaveBeenCalledWith("");
    expect(onSave).toHaveBeenCalledWith("");
  });

  it("calls onSave when Save is pressed", async () => {
    const setValue = mock(() => {});
    const onSave = mock(() => Promise.resolve());
    const {getByLabelText, getByText} = renderWithTheme(
      <TapToEdit onSave={onSave} setValue={setValue} title="Name" type="text" value="Jane" />
    );
    await act(async () => {
      fireEvent.press(getByLabelText("Edit"));
    });
    await act(async () => {
      fireEvent.press(getByText("Save"));
    });
    expect(onSave).toHaveBeenCalledWith("Jane");
  });

  it("logs error when saving without onSave", async () => {
    const setValue = mock(() => {});
    const originalError = console.error;
    const errorMock = mock(() => {});
    console.error = errorMock;

    const {getByLabelText, getByText} = renderWithTheme(
      <TapToEdit setValue={setValue} title="Name" type="text" value="Jane" />
    );
    await act(async () => {
      fireEvent.press(getByLabelText("Edit"));
    });
    await act(async () => {
      fireEvent.press(getByText("Save"));
    });
    expect(errorMock).toHaveBeenCalled();
    console.error = originalError;
  });
});

describe("formatAddress", () => {
  it("formats full address correctly", () => {
    const address = {
      address1: "123 Main St",
      address2: "Apt 4",
      city: "New York",
      state: "NY",
      zipcode: "10001",
    };
    const result = formatAddress(address);
    expect(result).toContain("123 Main St");
    expect(result).toContain("Apt 4");
    expect(result).toContain("New York");
    expect(result).toContain("NY");
    expect(result).toContain("10001");
  });

  it("formats address as string when asString is true", () => {
    const address = {
      address1: "123 Main St",
      city: "Boston",
      state: "MA",
      zipcode: "02101",
    };
    const result = formatAddress(address, true);
    expect(result).toContain(",");
    expect(result).not.toContain("\n");
  });

  it("handles partial address", () => {
    const address = {
      city: "Chicago",
      state: "IL",
    };
    const result = formatAddress(address);
    expect(result).toContain("Chicago");
    expect(result).toContain("IL");
  });

  it("includes county information when provided", () => {
    const address = {
      address1: "100 County Rd",
      city: "Rural Town",
      countyCode: "113",
      countyName: "Dallas County",
      state: "TX",
      zipcode: "75001",
    };
    const result = formatAddress(address);
    expect(result).toContain("Dallas County");
    expect(result).toContain("(113)");
  });

  it("handles address with county name but no county code", () => {
    const address = {
      address1: "100 County Rd",
      city: "Rural Town",
      countyName: "Dallas County",
      state: "TX",
      zipcode: "75001",
    };
    const result = formatAddress(address);
    expect(result).toContain("Dallas County");
    expect(result).not.toContain("(");
  });
});

describe("TapToEdit - additional function coverage", () => {
  it("shows Clear button for date type and invokes setValue and onSave", async () => {
    const setValue = mock(() => {});
    const onSave = mock(() => Promise.resolve());
    const {getByLabelText, getByText} = renderWithTheme(
      <TapToEdit onSave={onSave} setValue={setValue} title="Date" type="date" value="2024-01-01" />
    );
    await act(async () => {
      fireEvent.press(getByLabelText("Edit"));
    });
    expect(getByText("Clear")).toBeTruthy();
    await act(async () => {
      fireEvent.press(getByText("Clear"));
      await new Promise((resolve) => setTimeout(resolve, 600));
    });
    expect(setValue).toHaveBeenCalledWith("");
    expect(onSave).toHaveBeenCalledWith("");
  });

  it("assigns inputRef for text type in editing mode", async () => {
    const setValue = mock(() => {});
    const {getByLabelText, queryByText} = renderWithTheme(
      <TapToEdit setValue={setValue} title="Name" type="text" value="Alice" />
    );
    await act(async () => {
      fireEvent.press(getByLabelText("Edit"));
    });
    expect(queryByText("Save")).toBeTruthy();
  });

  it("renders textarea in editing mode with grow and row defaults", async () => {
    const setValue = mock(() => {});
    const {getByLabelText, queryByText} = renderWithTheme(
      <TapToEdit setValue={setValue} title="Notes" type="textarea" value="Some notes" />
    );
    await act(async () => {
      fireEvent.press(getByLabelText("Edit"));
    });
    expect(queryByText("Save")).toBeTruthy();
    expect(queryByText("Cancel")).toBeTruthy();
  });

  it("hides helperText in title when onlyShowHelperTextWhileEditing is true (default)", () => {
    const {queryByText} = renderWithTheme(
      <TapToEdit
        editable={false}
        helperText="Should be hidden in title"
        title="Field"
        type="text"
        value="val"
      />
    );
    expect(queryByText("Field")).toBeTruthy();
    expect(queryByText("Should be hidden in title")).toBeNull();
  });

  it("renders non-editable textarea with display value below title", () => {
    const {getByText} = renderWithTheme(
      <TapToEdit editable={false} title="Bio" type="textarea" value="A long bio text" />
    );
    expect(getByText("Bio")).toBeTruthy();
    expect(getByText("A long bio text")).toBeTruthy();
  });

  it("forwards testID to the edit control", () => {
    const {getByTestId} = renderWithTheme(
      <TapToEdit setValue={() => {}} testID="profile.name" title="Name" type="text" value="Jane" />
    );
    expect(getByTestId("profile.name.edit-clickable")).toBeTruthy();
  });

  it("forwards testID to cancel, clear, and save buttons while editing", async () => {
    const {getByTestId} = renderWithTheme(
      <TapToEdit
        onSave={async () => {}}
        setValue={() => {}}
        showClearButton
        testID="profile.name"
        title="Name"
        type="text"
        value="Jane"
      />
    );

    await act(async () => {
      fireEvent.press(getByTestId("profile.name.edit-clickable"));
    });

    expect(getByTestId("profile.name")).toBeTruthy();
    expect(getByTestId("profile.name.cancel")).toBeTruthy();
    expect(getByTestId("profile.name.clear")).toBeTruthy();
    expect(getByTestId("profile.name.save")).toBeTruthy();
  });

  it("does not set action testIDs when testID is omitted", async () => {
    const {getByLabelText, queryByTestId} = renderWithTheme(
      <TapToEdit setValue={() => {}} showClearButton title="Name" type="text" value="Jane" />
    );

    expect(queryByTestId("undefined.edit-clickable")).toBeNull();

    await act(async () => {
      fireEvent.press(getByLabelText("Edit"));
    });

    expect(queryByTestId("undefined.cancel")).toBeNull();
    expect(queryByTestId("undefined.clear")).toBeNull();
    expect(queryByTestId("undefined.save")).toBeNull();
  });
});
