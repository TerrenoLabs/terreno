import {describe, expect, it, jest} from "bun:test";
import {fireEvent, waitFor} from "@testing-library/react-native";

import {ThumbsUpDownFeedback} from "./ThumbsUpDownFeedback";
import {renderWithTheme} from "./test-utils";

describe("ThumbsUpDownFeedback", () => {
  it("renders both options", () => {
    const {getByTestId} = renderWithTheme(
      <ThumbsUpDownFeedback onChange={jest.fn()} testID="feedback" />
    );
    expect(getByTestId("feedback-positive")).toBeTruthy();
    expect(getByTestId("feedback-negative")).toBeTruthy();
  });

  it("calls onChange with the pressed value", () => {
    const onChange = jest.fn();
    const {getByTestId} = renderWithTheme(
      <ThumbsUpDownFeedback onChange={onChange} testID="feedback" />
    );
    fireEvent.press(getByTestId("feedback-negative"));
    expect(onChange).toHaveBeenCalledWith("negative");
  });

  it("clears the selection when pressing the selected option", () => {
    const onChange = jest.fn();
    const {getByTestId} = renderWithTheme(
      <ThumbsUpDownFeedback onChange={onChange} testID="feedback" value="positive" />
    );
    fireEvent.press(getByTestId("feedback-positive"));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it("exposes the selection and custom labels to assistive technology", () => {
    const {getByTestId} = renderWithTheme(
      <ThumbsUpDownFeedback
        negativeAccessibilityLabel="Not helpful"
        onChange={jest.fn()}
        positiveAccessibilityLabel="Helpful"
        testID="feedback"
        value="negative"
      />
    );
    const positive = getByTestId("feedback-positive");
    const negative = getByTestId("feedback-negative");
    expect(positive.props.accessibilityLabel).toBe("Helpful");
    expect(negative.props.accessibilityLabel).toBe("Not helpful");
    expect(positive.props.accessibilityState.selected).toBe(false);
    expect(negative.props.accessibilityState.selected).toBe(true);
    // react-native-web ignores accessibilityState, so the flat aria prop is what reaches the DOM.
    expect(positive.props["aria-checked"]).toBe(false);
    expect(negative.props["aria-checked"]).toBe(true);
  });

  it("activates on the spacebar, which react-native-web only handles for buttons", async () => {
    const onChange = jest.fn();
    const preventDefault = jest.fn();
    const {getByTestId} = renderWithTheme(
      <ThumbsUpDownFeedback onChange={onChange} testID="feedback" />
    );
    await getByTestId("feedback-positive").props.onKeyDown({key: " ", preventDefault});
    expect(preventDefault).toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith("positive");
  });

  it("ignores auto-repeat from a held spacebar", async () => {
    const onChange = jest.fn();
    const preventDefault = jest.fn();
    const {getByTestId} = renderWithTheme(
      <ThumbsUpDownFeedback onChange={onChange} testID="feedback" />
    );
    await getByTestId("feedback-positive").props.onKeyDown({
      key: " ",
      preventDefault,
      repeat: true,
    });
    expect(preventDefault).toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("ignores other keys so react-native-web keeps handling enter", async () => {
    const onChange = jest.fn();
    const preventDefault = jest.fn();
    const {getByTestId} = renderWithTheme(
      <ThumbsUpDownFeedback onChange={onChange} testID="feedback" />
    );
    await getByTestId("feedback-positive").props.onKeyDown({key: "Enter", preventDefault});
    expect(preventDefault).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not call onChange when disabled", () => {
    const onChange = jest.fn();
    const {getByTestId} = renderWithTheme(
      <ThumbsUpDownFeedback disabled onChange={onChange} testID="feedback" />
    );
    fireEvent.press(getByTestId("feedback-positive"));
    expect(onChange).not.toHaveBeenCalled();
  });
  describe("comment field", () => {
    it("does not render a comment input without onCommentSubmit", () => {
      const {getByTestId, queryByTestId} = renderWithTheme(
        <ThumbsUpDownFeedback onChange={jest.fn()} testID="feedback" value="negative" />
      );
      expect(getByTestId("feedback-negative")).toBeTruthy();
      expect(queryByTestId("feedback-comment-input")).toBeNull();
      expect(queryByTestId("feedback-comment-send")).toBeNull();
    });

    it("hides the input with no value and shows it once negative is selected", () => {
      const onCommentSubmit = jest.fn();
      const {getByTestId, queryByTestId, rerender} = renderWithTheme(
        <ThumbsUpDownFeedback
          onChange={jest.fn()}
          onCommentSubmit={onCommentSubmit}
          testID="feedback"
        />
      );
      expect(queryByTestId("feedback-comment-input")).toBeNull();
      rerender(
        <ThumbsUpDownFeedback
          onChange={jest.fn()}
          onCommentSubmit={onCommentSubmit}
          testID="feedback"
          value="negative"
        />
      );
      expect(getByTestId("feedback-comment-input")).toBeTruthy();
      expect(getByTestId("feedback-comment-send")).toBeTruthy();
    });

    it("shows the input for positive too", () => {
      const {getByTestId} = renderWithTheme(
        <ThumbsUpDownFeedback
          onChange={jest.fn()}
          onCommentSubmit={jest.fn()}
          testID="feedback"
          value="positive"
        />
      );
      expect(getByTestId("feedback-comment-input")).toBeTruthy();
    });

    it("uses the default and custom placeholder", () => {
      const a = renderWithTheme(
        <ThumbsUpDownFeedback
          onChange={jest.fn()}
          onCommentSubmit={jest.fn()}
          testID="feedback"
          value="negative"
        />
      );
      expect(a.getByPlaceholderText("Tell us more (optional)")).toBeTruthy();
      const b = renderWithTheme(
        <ThumbsUpDownFeedback
          commentPlaceholder="What went wrong?"
          onChange={jest.fn()}
          onCommentSubmit={jest.fn()}
          testID="feedback"
          value="negative"
        />
      );
      expect(b.getByPlaceholderText("What went wrong?")).toBeTruthy();
    });

    it("sends the trimmed comment once, then shows the sent state", async () => {
      const onCommentSubmit = jest.fn();
      const {getByTestId, queryByTestId, getByText} = renderWithTheme(
        <ThumbsUpDownFeedback
          onChange={jest.fn()}
          onCommentSubmit={onCommentSubmit}
          testID="feedback"
          value="negative"
        />
      );
      fireEvent.changeText(getByTestId("feedback-comment-input"), "  Too long  ");
      fireEvent.press(getByTestId("feedback-comment-send"));
      await waitFor(() => expect(getByTestId("feedback-comment-sent")).toBeTruthy());
      expect(onCommentSubmit).toHaveBeenCalledTimes(1);
      expect(onCommentSubmit).toHaveBeenCalledWith("Too long");
      expect(getByText("Thanks for the feedback")).toBeTruthy();
      expect(queryByTestId("feedback-comment-input")).toBeNull();
    });

    it("does not send empty or whitespace text", () => {
      const onCommentSubmit = jest.fn();
      const {getByTestId} = renderWithTheme(
        <ThumbsUpDownFeedback
          onChange={jest.fn()}
          onCommentSubmit={onCommentSubmit}
          testID="feedback"
          value="negative"
        />
      );
      fireEvent.press(getByTestId("feedback-comment-send"));
      fireEvent.changeText(getByTestId("feedback-comment-input"), "   ");
      fireEvent.press(getByTestId("feedback-comment-send"));
      expect(onCommentSubmit).not.toHaveBeenCalled();
    });

    it("keeps the input and text when onCommentSubmit rejects", async () => {
      const onCommentSubmit = jest.fn().mockRejectedValue(new Error("nope"));
      const {getByTestId, queryByTestId} = renderWithTheme(
        <ThumbsUpDownFeedback
          onChange={jest.fn()}
          onCommentSubmit={onCommentSubmit}
          testID="feedback"
          value="negative"
        />
      );
      fireEvent.changeText(getByTestId("feedback-comment-input"), "keep me");
      fireEvent.press(getByTestId("feedback-comment-send"));
      await waitFor(() => expect(onCommentSubmit).toHaveBeenCalledTimes(1));
      expect(queryByTestId("feedback-comment-sent")).toBeNull();
      expect(getByTestId("feedback-comment-input").props.value).toBe("keep me");
    });

    it("hides the input when the selection is cleared", () => {
      const onCommentSubmit = jest.fn();
      const {queryByTestId, getByTestId, rerender} = renderWithTheme(
        <ThumbsUpDownFeedback
          onChange={jest.fn()}
          onCommentSubmit={onCommentSubmit}
          testID="feedback"
          value="negative"
        />
      );
      expect(getByTestId("feedback-comment-input")).toBeTruthy();
      rerender(
        <ThumbsUpDownFeedback
          onChange={jest.fn()}
          onCommentSubmit={onCommentSubmit}
          testID="feedback"
        />
      );
      expect(queryByTestId("feedback-comment-input")).toBeNull();
    });

    it("shows the sent state, not the input, when comment is already sent", () => {
      const {getByTestId, queryByTestId} = renderWithTheme(
        <ThumbsUpDownFeedback
          comment="Too long"
          onChange={jest.fn()}
          onCommentSubmit={jest.fn()}
          testID="feedback"
          value="negative"
        />
      );
      expect(getByTestId("feedback-comment-sent")).toBeTruthy();
      expect(queryByTestId("feedback-comment-input")).toBeNull();
    });
  });
});
