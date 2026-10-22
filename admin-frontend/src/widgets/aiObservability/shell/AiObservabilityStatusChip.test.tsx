import {afterEach, describe, expect, it} from "bun:test";
import React from "react";
import {renderWithTheme} from "../../../../../ui/src/test-utils";
import {
  flushObservabilityRequests,
  ObservabilityTestProvider,
  stubObservabilityFetch,
} from "../../../testing/observabilityTestUtils";
import {AiObservabilityStatusChip} from "./AiObservabilityStatusChip";

const localOnStatus = {
  localOn: true,
  plugins: [],
  primaries: {
    datasets: "local",
    experiments: "local",
    prompts: "local",
    reviewQueue: "local",
  },
};

let restoreFetch: () => void = () => undefined;

afterEach(() => {
  restoreFetch();
});

describe("AiObservabilityStatusChip", () => {
  it("fetches plugin status through the admin client when no status is passed", async () => {
    const {calls, restore} = stubObservabilityFetch(() => ({body: {data: localOnStatus}}));
    restoreFetch = restore;
    const view = renderWithTheme(
      <ObservabilityTestProvider>
        <AiObservabilityStatusChip />
      </ObservabilityTestProvider>
    );
    expect(view.getByText("Checking observability…")).toBeTruthy();
    await flushObservabilityRequests();

    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      "GET /ai/observability/status",
    ]);
    expect(
      view.getByText("Local on · prompts:local · datasets:local · experiments:local")
    ).toBeTruthy();
  });

  it("shows unavailable when the status request fails", async () => {
    const {restore} = stubObservabilityFetch(() => ({body: {title: "Forbidden"}, status: 403}));
    restoreFetch = restore;
    const view = renderWithTheme(
      <ObservabilityTestProvider>
        <AiObservabilityStatusChip />
      </ObservabilityTestProvider>
    );
    await flushObservabilityRequests();
    expect(view.getByText("Observability unavailable")).toBeTruthy();
  });

  it("renders passed status without fetching", async () => {
    const {calls, restore} = stubObservabilityFetch();
    restoreFetch = restore;
    const view = renderWithTheme(
      <ObservabilityTestProvider>
        <AiObservabilityStatusChip status={localOnStatus} />
      </ObservabilityTestProvider>
    );
    await flushObservabilityRequests();
    expect(calls).toHaveLength(0);
    expect(
      view.getByText("Local on · prompts:local · datasets:local · experiments:local")
    ).toBeTruthy();
  });
});
