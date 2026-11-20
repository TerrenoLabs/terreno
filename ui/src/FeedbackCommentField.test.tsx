import {describe, expect, it, jest} from "bun:test";
import {act, fireEvent, waitFor} from "@testing-library/react-native";

import {FeedbackCommentField} from "./FeedbackCommentField";
import {renderWithTheme} from "./test-utils";

// Typed node instead of `any` to satisfy the noExplicitAny lint rule.
const isDisabled = (node: {
  props: Record<string, unknown> & {accessibilityState?: {disabled?: boolean}};
}): boolean =>
  Boolean(
    node.props.disabled || node.props.accessibilityState?.disabled || node.props["aria-disabled"]
  );

describe("FeedbackCommentField", () => {
  it("renders the input and Send button", () => {
    const {getByTestId} = renderWithTheme(
      <FeedbackCommentField onSubmit={jest.fn()} testID="fc" />
    );
    expect(getByTestId("fc-input")).toBeTruthy();
    expect(getByTestId("fc-send")).toBeTruthy();
  });

  it("uses the placeholder prop, defaulting to 'Tell us more (optional)'", () => {
    const defaulted = renderWithTheme(<FeedbackCommentField onSubmit={jest.fn()} testID="fc" />);
    expect(defaulted.getByPlaceholderText("Tell us more (optional)")).toBeTruthy();
    const custom = renderWithTheme(
      <FeedbackCommentField onSubmit={jest.fn()} placeholder="Why?" testID="fc" />
    );
    expect(custom.getByPlaceholderText("Why?")).toBeTruthy();
  });

  it("submits the trimmed text once, then shows the sent state", async () => {
    const onSubmit = jest.fn();
    const {getByTestId, queryByTestId, getByText} = renderWithTheme(
      <FeedbackCommentField onSubmit={onSubmit} testID="fc" />
    );
    fireEvent.changeText(getByTestId("fc-input"), "  Too long  ");
    fireEvent.press(getByTestId("fc-send"));
    await waitFor(() => expect(getByTestId("fc-sent")).toBeTruthy());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("Too long");
    expect(getByText("Thanks for the feedback")).toBeTruthy();
    expect(queryByTestId("fc-input")).toBeNull();
  });

  it("disables Send for empty and whitespace-only text and does not submit", () => {
    const onSubmit = jest.fn();
    const {getByTestId} = renderWithTheme(<FeedbackCommentField onSubmit={onSubmit} testID="fc" />);
    expect(isDisabled(getByTestId("fc-send"))).toBe(true);
    fireEvent.press(getByTestId("fc-send"));
    fireEvent.changeText(getByTestId("fc-input"), "   ");
    expect(isDisabled(getByTestId("fc-send"))).toBe(true);
    fireEvent.press(getByTestId("fc-send"));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("enables Send once there is non-blank text", () => {
    const {getByTestId} = renderWithTheme(
      <FeedbackCommentField onSubmit={jest.fn()} testID="fc" />
    );
    fireEvent.changeText(getByTestId("fc-input"), "hi");
    expect(isDisabled(getByTestId("fc-send"))).toBe(false);
  });

  it("disables Send while a send is in flight and ignores a second press", async () => {
    let resolve: () => void = () => {};
    const onSubmit = jest.fn(
      () =>
        new Promise<void>((res) => {
          resolve = res;
        })
    );
    const {getByTestId} = renderWithTheme(<FeedbackCommentField onSubmit={onSubmit} testID="fc" />);
    fireEvent.changeText(getByTestId("fc-input"), "hello");
    fireEvent.press(getByTestId("fc-send"));
    await waitFor(() => expect(isDisabled(getByTestId("fc-send"))).toBe(true));
    fireEvent.press(getByTestId("fc-send"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve();
    });
    await waitFor(() => expect(getByTestId("fc-sent")).toBeTruthy());
  });

  it("keeps the input and text and re-enables Send when onSubmit rejects", async () => {
    const onSubmit = jest.fn().mockRejectedValue(new Error("nope"));
    const {getByTestId, queryByTestId} = renderWithTheme(
      <FeedbackCommentField onSubmit={onSubmit} testID="fc" />
    );
    fireEvent.changeText(getByTestId("fc-input"), "keep me");
    fireEvent.press(getByTestId("fc-send"));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(isDisabled(getByTestId("fc-send"))).toBe(false));
    expect(queryByTestId("fc-sent")).toBeNull();
    expect(getByTestId("fc-input").props.value).toBe("keep me");
  });

  it("shows the sent state instead of the input when sentComment is provided", () => {
    const {getByTestId, queryByTestId} = renderWithTheme(
      <FeedbackCommentField onSubmit={jest.fn()} sentComment="Too long" testID="fc" />
    );
    expect(getByTestId("fc-sent")).toBeTruthy();
    expect(queryByTestId("fc-input")).toBeNull();
    expect(queryByTestId("fc-send")).toBeNull();
  });
});
