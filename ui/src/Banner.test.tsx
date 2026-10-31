import {beforeEach, describe, expect, it, mock} from "bun:test";
import {act, fireEvent, render, waitFor} from "@testing-library/react-native";
import React from "react";

import {Banner, BannerButton, hideBanner} from "./Banner";
import {ThemeContext} from "./Theme";
import {renderWithTheme} from "./test-utils";
import {Unifier} from "./Unifier";

describe("Banner", () => {
  beforeEach(() => {
    Unifier.storage.getItem = mock(() => Promise.resolve(null));
    Unifier.storage.setItem = mock(() => Promise.resolve());
  });
  it("renders correctly with default props", () => {
    const {toJSON} = renderWithTheme(<Banner id="test-banner" text="Test message" />);
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders text content correctly", () => {
    const {getByText} = renderWithTheme(<Banner id="test-banner" text="Important notice" />);
    expect(getByText("Important notice")).toBeTruthy();
  });

  it("renders with info status (default)", () => {
    const {toJSON} = renderWithTheme(<Banner id="test-banner" status="info" text="Info message" />);
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with alert status", () => {
    const {toJSON} = renderWithTheme(
      <Banner id="test-banner" status="alert" text="Alert message" />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with warning status", () => {
    const {toJSON} = renderWithTheme(
      <Banner id="test-banner" status="warning" text="Warning message" />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders with icon when hasIcon is true", () => {
    const {toJSON} = renderWithTheme(<Banner hasIcon id="test-banner" text="With icon" />);
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders dismissible banner with dismiss button", () => {
    const {getByLabelText} = renderWithTheme(
      <Banner dismissible id="test-banner" text="Dismissible" />
    );
    expect(getByLabelText("Dismiss")).toBeTruthy();
  });

  it("hides banner when dismiss button is clicked", async () => {
    const {getByLabelText, queryByText} = renderWithTheme(
      <Banner dismissible id="test-dismiss-banner" text="Dismissible banner" />
    );

    await act(async () => {
      fireEvent.press(getByLabelText("Dismiss"));
    });

    await waitFor(() => {
      expect(queryByText("Dismissible banner")).toBeNull();
    });
  });

  it("renders with button", async () => {
    const handleClick = mock(() => Promise.resolve());
    const {getByText, toJSON} = renderWithTheme(
      <Banner
        buttonOnClick={handleClick}
        buttonText="Action"
        id="test-banner"
        text="Banner with button"
      />
    );
    expect(toJSON()).toMatchSnapshot();
    expect(getByText("Action")).toBeTruthy();
  });

  it("renders with button and icon", () => {
    const handleClick = mock(() => Promise.resolve());
    const {toJSON} = renderWithTheme(
      <Banner
        buttonIconName="arrow-right"
        buttonOnClick={handleClick}
        buttonText="Go"
        id="test-banner"
        text="Banner with button and icon"
      />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("calls buttonOnClick when button is pressed", async () => {
    const handleClick = mock(() => Promise.resolve());
    const {getByText} = renderWithTheme(
      <Banner buttonOnClick={handleClick} buttonText="Click me" id="test-banner" text="Banner" />
    );

    await act(async () => {
      fireEvent.press(getByText("Click me"));
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    await waitFor(() => {
      expect(handleClick).toHaveBeenCalled();
    });
  });

  it("invokes buttonOnClick when icon button is pressed", async () => {
    const handleClick = mock(() => Promise.resolve());
    const {getByText} = renderWithTheme(
      <Banner
        buttonIconName="arrow-right"
        buttonOnClick={handleClick}
        buttonText="Go"
        id="test-icon-banner"
        text="Banner"
      />
    );

    await act(async () => {
      fireEvent.press(getByText("Go"));
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    await waitFor(() => {
      expect(handleClick).toHaveBeenCalled();
    });
  });

  // Tests for optional id prop
  it("renders without id prop", () => {
    const {getByText} = renderWithTheme(<Banner text="No id banner" />);
    expect(getByText("No id banner")).toBeTruthy();
  });

  it("renders without id and without dismissible", () => {
    const {getByText, queryByLabelText} = renderWithTheme(<Banner text="Simple banner no id" />);
    expect(getByText("Simple banner no id")).toBeTruthy();
    expect(queryByLabelText("Dismiss")).toBeNull();
  });

  it("hides dismissible banner without id when dismissed", async () => {
    const {getByLabelText, queryByText} = renderWithTheme(
      <Banner dismissible text="Ephemeral banner" />
    );

    await act(async () => {
      fireEvent.press(getByLabelText("Dismiss"));
    });

    await waitFor(() => {
      expect(queryByText("Ephemeral banner")).toBeNull();
    });
  });

  it("does not persist dismissal to storage when id is omitted", async () => {
    const setItemMock = Unifier.storage.setItem as ReturnType<typeof mock>;
    setItemMock.mockClear();

    const {getByLabelText} = renderWithTheme(<Banner dismissible text="No persist banner" />);

    await act(async () => {
      fireEvent.press(getByLabelText("Dismiss"));
    });

    await waitFor(() => {
      expect(setItemMock).not.toHaveBeenCalled();
    });
  });

  it("hides banner when storage already has the dismissed flag", async () => {
    const getItemMock = Unifier.storage.getItem as ReturnType<typeof mock>;
    getItemMock.mockReturnValueOnce(Promise.resolve("true"));

    const {queryByText} = renderWithTheme(
      <Banner dismissible id="stored-banner" text="Previously dismissed" />
    );

    await waitFor(() => {
      expect(queryByText("Previously dismissed")).toBeNull();
    });
  });

  it("exercises the async .then path in useEffect", async () => {
    const getItemMock = Unifier.storage.getItem as ReturnType<typeof mock>;
    getItemMock.mockReturnValueOnce(Promise.resolve(null));

    const {queryByText} = renderWithTheme(
      <Banner dismissible id="flush-banner" text="Flush banner" />
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(queryByText("Flush banner")).toBeTruthy();
  });

  it("renders button without icon name (text-only button path)", async () => {
    const handleClick = mock(() => Promise.resolve());
    const {getByText} = renderWithTheme(
      <Banner
        buttonOnClick={handleClick}
        buttonText="TextOnly"
        id="textonly-banner"
        text="Banner"
      />
    );
    expect(getByText("TextOnly")).toBeTruthy();

    await act(async () => {
      fireEvent.press(getByText("TextOnly"));
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    await waitFor(() => {
      expect(handleClick).toHaveBeenCalled();
    });
  });

  it("covers catch block when buttonOnClick rejects", async () => {
    const handleClick = mock(() => Promise.reject(new Error("boom")));
    const {UNSAFE_root} = renderWithTheme(
      <Banner buttonOnClick={handleClick} buttonText="Fail" id="catch-banner" text="Banner" />
    );

    const pressable = UNSAFE_root.findAll(
      (node) => node.props?.["aria-label"] === "Fail" && typeof node.props?.onPress === "function"
    )[0];

    try {
      await act(async () => {
        await pressable.props.onPress();
      });
    } catch (_e) {
      // Expected: catch block in BannerButton re-throws
    }

    expect(handleClick).toHaveBeenCalled();
  });

  it("hideBanner persists the banner id to storage", async () => {
    const setItemMock = Unifier.storage.setItem as ReturnType<typeof mock>;
    setItemMock.mockClear();

    await hideBanner("my-banner");
    expect(setItemMock).toHaveBeenCalledWith("@TerrenoUI:my-banner", "true");
  });

  it("renders with button loading state", () => {
    const handleClick = mock(() => Promise.resolve());
    const {toJSON} = renderWithTheme(
      <Banner
        buttonOnClick={handleClick}
        buttonText="Loading"
        id="test-banner"
        text="Banner loading"
      />
    );
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders banner with dismissible=true and no id (non-persistent dismiss)", async () => {
    const {getByLabelText, queryByText} = renderWithTheme(
      <Banner dismissible text="Non persistent" />
    );
    expect(queryByText("Non persistent")).toBeTruthy();
    await act(async () => {
      fireEvent.press(getByLabelText("Dismiss"));
    });
    await waitFor(() => {
      expect(queryByText("Non persistent")).toBeNull();
    });
  });

  it("BannerButton returns null when theme is not available", () => {
    const nullThemeContext = {
      resetTheme: () => {},
      setPrimitives: () => {},
      setTheme: () => {},
      theme: null,
    };
    const {toJSON} = render(
      <ThemeContext.Provider value={nullThemeContext as never}>
        <BannerButton buttonOnClick={() => {}} buttonText="Test" />
      </ThemeContext.Provider>
    );
    expect(toJSON()).toBeNull();
  });
});
