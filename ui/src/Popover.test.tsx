import {describe, expect, it, jest} from "bun:test";
import {fireEvent, waitFor} from "@testing-library/react-native";

import {Popover} from "./Popover";
import {Text} from "./Text";
import {findByHostType, renderWithTheme} from "./test-utils";

describe("Popover", () => {
  it("renders the title, date and body when loaded", () => {
    const {getByTestId, getByText} = renderWithTheme(
      <Popover
        onClose={jest.fn()}
        subtitle="11/20/2026"
        testID="popover"
        text="Summary of Patient History."
        title="Document Title"
      />
    );
    expect(getByTestId("popover-title")).toBeTruthy();
    expect(getByTestId("popover-subtitle")).toBeTruthy();
    expect(getByText("Summary of Patient History.")).toBeTruthy();
  });

  it("prefers children over text for the body", () => {
    const {getByText, queryByText} = renderWithTheme(
      <Popover onClose={jest.fn()} text="Plain summary">
        <Text>Rich body</Text>
      </Popover>
    );
    expect(getByText("Rich body")).toBeTruthy();
    expect(queryByText("Plain summary")).toBeNull();
  });

  it("calls onClose when the close button is pressed", () => {
    const onClose = jest.fn();
    const {getByLabelText} = renderWithTheme(<Popover onClose={onClose} title="Doc" />);
    fireEvent.press(getByLabelText("Close document"));
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onOpen from the footer action", () => {
    const onOpen = jest.fn();
    const {getByTestId} = renderWithTheme(
      <Popover onClose={jest.fn()} onOpen={onOpen} testID="popover" title="Doc" />
    );
    fireEvent.press(getByTestId("popover-open"));
    expect(onOpen).toHaveBeenCalled();
  });

  it("passes feedback selections through", () => {
    const onFeedbackChange = jest.fn();
    const {getByTestId} = renderWithTheme(
      <Popover
        onClose={jest.fn()}
        onFeedbackChange={onFeedbackChange}
        testID="popover"
        title="Doc"
      />
    );
    fireEvent.press(getByTestId("popover-feedback-positive"));
    expect(onFeedbackChange).toHaveBeenCalledWith("positive");
  });

  it("hides the footer when there are no footer actions", () => {
    const {queryByTestId} = renderWithTheme(
      <Popover onClose={jest.fn()} testID="popover" title="Doc" />
    );
    expect(queryByTestId("popover-open")).toBeNull();
    expect(queryByTestId("popover-feedback")).toBeNull();
  });

  it("shows the loading header instead of the document while loading", () => {
    const {getByTestId, queryByTestId} = renderWithTheme(
      <Popover onClose={jest.fn()} status="loading" testID="popover" title="Doc" />
    );
    expect(getByTestId("popover-loading-text")).toBeTruthy();
    expect(queryByTestId("popover-title")).toBeNull();
  });

  it("shows a retryable error message when loading fails", async () => {
    const onRetry = jest.fn();
    const {getByTestId} = renderWithTheme(
      <Popover onClose={jest.fn()} onRetry={onRetry} status="error" testID="popover" title="Doc" />
    );
    expect(getByTestId("popover-error-title")).toBeTruthy();
    fireEvent.press(getByTestId("popover-retry"));
    await waitFor(() => {
      expect(onRetry).toHaveBeenCalled();
    });
  });

  it("hides the retry button when there is no retry handler", () => {
    const {queryByTestId} = renderWithTheme(
      <Popover onClose={jest.fn()} status="error" testID="popover" />
    );
    expect(queryByTestId("popover-retry")).toBeNull();
  });

  it("lets the body fill the card instead of pinning its content height", () => {
    const {getByTestId} = renderWithTheme(
      <Popover
        height={240}
        onClose={jest.fn()}
        testID="popover"
        text={"Summary of patient history. ".repeat(40)}
        title="Doc"
      />
    );
    const scrollView = getByTestId("popover-content");
    expect(scrollView.props.style).toEqual(
      expect.objectContaining({flexBasis: 0, flexGrow: 1, flexShrink: 1, minHeight: 0})
    );
    const content = findByHostType(scrollView, "View");
    expect(content.props.style?.height).toBeUndefined();
  });

  it("defaults to the 480x480 design size", () => {
    const {getByTestId} = renderWithTheme(
      <Popover onClose={jest.fn()} testID="popover" title="Doc" />
    );
    expect(getByTestId("popover").props.style).toEqual(
      expect.objectContaining({height: 480, width: 480})
    );
  });

  it("keeps the same height in every status", () => {
    const heights = (["loaded", "loading", "error"] as const).map((status) => {
      const {getByTestId} = renderWithTheme(
        <Popover height={280} onClose={jest.fn()} status={status} testID={status} title="Doc" />
      );
      return getByTestId(status).props.style.height;
    });
    expect(heights).toEqual([280, 280, 280]);
  });

  it("drops the header and footer in the error status", () => {
    const {queryByTestId} = renderWithTheme(
      <Popover
        onClose={jest.fn()}
        onOpen={jest.fn()}
        status="error"
        subtitle="11/20/2026"
        testID="popover"
        title="Doc"
      />
    );
    expect(queryByTestId("popover-title")).toBeNull();
    expect(queryByTestId("popover-subtitle")).toBeNull();
    expect(queryByTestId("popover-open")).toBeNull();
  });
});
