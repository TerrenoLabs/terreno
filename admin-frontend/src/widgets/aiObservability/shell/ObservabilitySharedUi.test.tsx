import {describe, expect, it, mock} from "bun:test";
import {Button} from "@terreno/ui";
import {act, fireEvent} from "@testing-library/react-native";
import React from "react";
import {renderWithTheme} from "../../../../../ui/src/test-utils";
import {AgreementMeter, MeterBar, ProgressMeter} from "./AgreementMeter";
import {ObservabilityPageHeader} from "./ObservabilityPageHeader";
import {ObservabilityEmptyState, ObservabilityErrorState} from "./ObservabilityStates";
import {ObservabilityStatusBadge} from "./ObservabilityStatusBadge";

const press = async (element: Parameters<typeof fireEvent.press>[0]): Promise<void> => {
  await act(async () => {
    fireEvent.press(element);
    await Promise.resolve();
  });
};

describe("ObservabilityPageHeader", () => {
  it("renders title, description, meta, and actions", () => {
    const {getByTestId, getByText} = renderWithTheme(
      <ObservabilityPageHeader
        actions={<Button onClick={() => {}} text="New batch" />}
        description="A fixed set of outputs people answer."
        meta={<ObservabilityStatusBadge status="done" />}
        title="Review batches"
      />
    );
    expect(getByTestId("observability-page-header-title")).toBeTruthy();
    expect(getByText("Review batches")).toBeTruthy();
    expect(getByText("A fixed set of outputs people answer.")).toBeTruthy();
    expect(getByText("Done")).toBeTruthy();
    expect(getByText("New batch")).toBeTruthy();
  });

  it("omits optional parts", () => {
    const {queryByTestId} = renderWithTheme(<ObservabilityPageHeader title="Traces" />);
    expect(queryByTestId("observability-page-header-description")).toBeNull();
    expect(queryByTestId("observability-page-header-actions")).toBeNull();
  });
});

describe("ObservabilityStatusBadge", () => {
  it("shows the shared label for a raw status", () => {
    const {getByText} = renderWithTheme(<ObservabilityStatusBadge status="in_progress" />);
    expect(getByText("In progress")).toBeTruthy();
  });

  it("accepts a label override", () => {
    const {getByText} = renderWithTheme(
      <ObservabilityStatusBadge label="Running 3 of 12" status="running" />
    );
    expect(getByText("Running 3 of 12")).toBeTruthy();
  });
});

describe("AgreementMeter", () => {
  it("shows percent, bar, and verdict", () => {
    const {getByTestId, getByText} = renderWithTheme(
      <AgreementMeter rate={0.97} testID="agreement" />
    );
    expect(getByText("97%")).toBeTruthy();
    expect(getByText("Matches")).toBeTruthy();
    expect(getByTestId("agreement-bar")).toBeTruthy();
  });

  it("drops the bar when compact", () => {
    const {getByText, queryByTestId} = renderWithTheme(
      <AgreementMeter compact rate={0.78} testID="agreement" />
    );
    expect(getByText("Close")).toBeTruthy();
    expect(queryByTestId("agreement-bar")).toBeNull();
  });

  it("says there is nothing to compare yet", () => {
    const {getByText} = renderWithTheme(<AgreementMeter rate={undefined} />);
    expect(getByText("No answers yet")).toBeTruthy();
  });
});

describe("ProgressMeter and MeterBar", () => {
  it("shows done of total", () => {
    const {getByText, getByTestId} = renderWithTheme(
      <ProgressMeter done={8} testID="progress" total={10} />
    );
    expect(getByText("8 of 10")).toBeTruthy();
    expect(getByTestId("progress-bar-fill")).toBeTruthy();
  });

  it("handles an empty total", () => {
    const {getByText} = renderWithTheme(<ProgressMeter done={0} total={0} />);
    expect(getByText("0 of 0")).toBeTruthy();
  });

  it("renders without a test id", () => {
    const {toJSON} = renderWithTheme(<MeterBar fraction={0.5} tone="success" />);
    expect(toJSON()).toBeTruthy();
  });
});

describe("ObservabilityEmptyState", () => {
  it("renders the next step and calls the action", async () => {
    const onAction = mock(() => {});
    const {getByTestId, getByText} = renderWithTheme(
      <ObservabilityEmptyState
        actionText="Go to traces"
        description="Pick traces and choose Add to dataset."
        iconName="database"
        onAction={onAction}
        title="No datasets yet"
      />
    );
    expect(getByText("No datasets yet")).toBeTruthy();
    await press(getByTestId("observability-empty-state-action"));
    expect(onAction).toHaveBeenCalled();
  });

  it("hides the button without an action", () => {
    const {queryByTestId} = renderWithTheme(
      <ObservabilityEmptyState description="Nothing here." iconName="inbox" title="Empty" />
    );
    expect(queryByTestId("observability-empty-state-action")).toBeNull();
  });
});

describe("ObservabilityErrorState", () => {
  it("shows the error and retries", async () => {
    const onRetry = mock(() => {});
    const {getByTestId, getByText} = renderWithTheme(
      <ObservabilityErrorState onRetry={onRetry} text="Could not load experiments." />
    );
    expect(getByText("Could not load experiments.")).toBeTruthy();
    await press(getByTestId("observability-error-state-retry"));
    expect(onRetry).toHaveBeenCalled();
  });

  it("hides retry without a handler", () => {
    const {queryByTestId} = renderWithTheme(<ObservabilityErrorState text="Failed." />);
    expect(queryByTestId("observability-error-state-retry")).toBeNull();
  });
});
