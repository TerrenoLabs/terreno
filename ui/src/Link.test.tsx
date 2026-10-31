import {describe, expect, it, mock, spyOn} from "bun:test";
import {fireEvent} from "@testing-library/react-native";
import {Linking} from "react-native";

import type {LinkProps} from "./Common";
import {Link} from "./Link";
import {renderWithTheme} from "./test-utils";

describe("Link", () => {
  it("renders correctly with href", () => {
    const {toJSON} = renderWithTheme(<Link href="https://example.com" text="Click me" />);
    expect(toJSON()).toMatchSnapshot();
  });

  it("renders text correctly", () => {
    const {getByText} = renderWithTheme(<Link href="https://example.com" text="Test Link" />);
    expect(getByText("Test Link")).toBeTruthy();
  });

  it("calls onClick when provided", () => {
    const handleClick = mock(() => {});
    const {getByText} = renderWithTheme(<Link onClick={handleClick} text="Clickable" />);

    fireEvent.press(getByText("Clickable"));
    expect(handleClick).toHaveBeenCalled();
  });

  it("opens URL when href is provided and pressed", () => {
    const openURLSpy = spyOn(Linking, "openURL").mockImplementation(() => Promise.resolve(true));

    const {getByText} = renderWithTheme(<Link href="https://example.com" text="External Link" />);

    fireEvent.press(getByText("External Link"));
    expect(openURLSpy).toHaveBeenCalledWith("https://example.com");

    openURLSpy.mockRestore();
  });

  it("prefers onClick over href when both are provided", () => {
    const handleClick = mock(() => {});
    const openURLSpy = spyOn(Linking, "openURL").mockImplementation(() => Promise.resolve(true));

    // LinkProps forbids href with onClick; untyped callers can still pass both.
    const bothActionProps = {
      href: "https://example.com",
      onClick: handleClick,
      text: "Both",
    } as unknown as LinkProps;
    const {getByText} = renderWithTheme(<Link {...bothActionProps} />);

    fireEvent.press(getByText("Both"));
    expect(handleClick).toHaveBeenCalled();
    expect(openURLSpy).not.toHaveBeenCalled();

    openURLSpy.mockRestore();
  });

  it("logs error when neither href nor onClick provided", () => {
    const consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});

    // LinkProps requires href or onClick; untyped callers can still omit both.
    const noActionProps = {text: "No action"} as unknown as LinkProps;
    renderWithTheme(<Link {...noActionProps} />);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Link component requires either href or onClick prop"
    );

    consoleErrorSpy.mockRestore();
  });
});
