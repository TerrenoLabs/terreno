import {describe, expect, it, mock} from "bun:test";
import SliderComponent from "@react-native-community/slider";
import {act, fireEvent} from "@testing-library/react-native";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import {ReviewScoreField} from "../widgets/aiObservability/review/ReviewScoreField";

mock.module("expo-router", () => ({
  router: {push: mock(() => undefined)},
}));

describe("ReviewScoreField", () => {
  it("renders boolean dimensions as Pass and Fail controls", async () => {
    const onChange = mock(() => undefined);
    const {getByTestId, getByText} = renderWithTheme(
      <ReviewScoreField
        dimension={{dataType: "boolean", key: "correct", required: true}}
        onChange={onChange}
      />
    );
    expect(getByTestId("ai-review-score-boolean-correct")).toBeTruthy();
    expect(getByText("Pass")).toBeTruthy();
    expect(getByText("Fail")).toBeTruthy();
    await act(async () => {
      fireEvent.press(getByTestId("ai-review-score-correct-pass"));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(onChange).toHaveBeenCalledWith(true);
    await act(async () => {
      fireEvent.press(getByTestId("ai-review-score-correct-fail"));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("renders numeric dimensions as a slider with range labels", () => {
    const onChange = mock(() => undefined);
    const {getByTestId, getByText, UNSAFE_getByType} = renderWithTheme(
      <ReviewScoreField
        dimension={{dataType: "numeric", key: "helpfulness", range: "0-1", required: true}}
        onChange={onChange}
        value={0.5}
      />
    );
    expect(getByTestId("ai-review-score-numeric-helpfulness")).toBeTruthy();
    expect(getByText("helpfulness")).toBeTruthy();
    expect(getByText("0")).toBeTruthy();
    expect(getByText("1")).toBeTruthy();
    fireEvent(UNSAFE_getByType(SliderComponent), "valueChange", 0.8);
    expect(onChange).toHaveBeenCalledWith(0.8);
  });

  it("renders categorical free-text when range has no pipe-separated options", () => {
    const onChange = mock(() => undefined);
    const {getAllByDisplayValue} = renderWithTheme(
      <ReviewScoreField
        dimension={{dataType: "categorical", key: "label", range: "", required: true}}
        onChange={onChange}
        value=""
      />
    );
    fireEvent.changeText(getAllByDisplayValue("")[0]!, "custom");
    expect(onChange).toHaveBeenCalledWith("custom");
  });

  it("defaults numeric slider to range minimum when value is unset", () => {
    const onChange = mock(() => undefined);
    const {getByTestId, UNSAFE_getByType} = renderWithTheme(
      <ReviewScoreField
        dimension={{dataType: "numeric", key: "score", range: "1-5", required: true}}
        onChange={onChange}
      />
    );
    expect(getByTestId("ai-review-score-numeric-score")).toBeTruthy();
    fireEvent(UNSAFE_getByType(SliderComponent), "valueChange", 3);
    expect(onChange).toHaveBeenCalledWith(3);
  });

  it("renders categorical dimensions as selectable pills", async () => {
    const onChange = mock(() => undefined);
    const {getByTestId, getByText} = renderWithTheme(
      <ReviewScoreField
        dimension={{
          dataType: "categorical",
          key: "tone",
          range: "safe|unsafe|unclear",
          required: true,
        }}
        onChange={onChange}
      />
    );
    expect(getByTestId("ai-review-score-categorical-tone")).toBeTruthy();
    expect(getByText("safe")).toBeTruthy();
    expect(getByText("unsafe")).toBeTruthy();
    expect(getByText("unclear")).toBeTruthy();
    await act(async () => {
      fireEvent.press(getByTestId("ai-review-score-tone-unsafe"));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(onChange).toHaveBeenCalledWith("unsafe");
  });
});
