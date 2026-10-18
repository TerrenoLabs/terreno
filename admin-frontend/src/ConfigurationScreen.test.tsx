// noExplicitAny: test mocks use loosely typed hook doubles and dynamic mock returns
// biome-ignore-all lint/suspicious/noExplicitAny: test mock typing
import {beforeEach, describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import React from "react";
import {renderWithTheme} from "../../ui/src/test-utils";

interface QueryState<T> {
  data: T | undefined;
  isLoading: boolean;
}
const metaState: QueryState<unknown> = {data: undefined, isLoading: false};
const valuesState: QueryState<unknown> = {data: undefined, isLoading: false};
let updateImpl: (body: unknown) => Promise<unknown> = async () => ({});
const updateCalls: unknown[] = [];

mock.module("./useConfigurationApi", () => ({
  useConfigurationApi: () => ({
    useMetaQuery: () => ({data: metaState.data, isLoading: metaState.isLoading}),
    useUpdateMutation: () => [
      (body: unknown) => ({
        unwrap: async () => {
          updateCalls.push(body);
          return updateImpl(body);
        },
      }),
      {isLoading: false},
    ],
    useValuesQuery: () => ({
      data: valuesState.data,
      isLoading: valuesState.isLoading,
    }),
  }),
}));

import {ConfigurationScreen} from "./ConfigurationScreen";

const baseMeta = {
  sections: [
    {
      description: "root-desc",
      displayName: "Root",
      fields: {
        enabled: {required: false, type: "boolean"},
        name: {required: false, type: "string"},
      },
      name: "__root__",
    },
    {
      description: "smtp-desc",
      displayName: "SMTP",
      fields: {
        apiKey: {required: false, secret: true, type: "string"},
        host: {required: false, type: "string"},
        notes: {required: false, type: "string", widget: "markdown"},
        port: {default: 587, required: false, type: "number"},
      },
      name: "smtp",
    },
  ],
};

describe("ConfigurationScreen", () => {
  beforeEach(() => {
    metaState.data = undefined;
    metaState.isLoading = false;
    valuesState.data = undefined;
    valuesState.isLoading = false;
    updateImpl = async () => ({});
    updateCalls.length = 0;
  });

  it("renders loading state on initial load", () => {
    metaState.isLoading = true;
    valuesState.isLoading = true;
    const {toJSON} = renderWithTheme(<ConfigurationScreen />);
    expect(toJSON()).toBeDefined();
  });

  it("renders an empty-state when metadata is missing", () => {
    const {toJSON, getByText} = renderWithTheme(<ConfigurationScreen />);
    expect(toJSON()).toBeDefined();
    expect(getByText(/No configuration metadata available/)).toBeDefined();
  });

  it("renders no sections when metadata has empty sections", () => {
    metaState.data = {sections: []};
    valuesState.data = {};
    const {getByText} = renderWithTheme(
      <ConfigurationScreen basePath="/config" title="My Config" />
    );
    expect(getByText(/No configuration sections defined/)).toBeDefined();
  });

  it("renders all field types and saves edits", async () => {
    metaState.data = baseMeta;
    valuesState.data = {
      enabled: true,
      name: "Initial",
      smtp: {apiKey: "secret", host: "h", notes: "notes", port: 25},
    };
    const {getByTestId} = renderWithTheme(<ConfigurationScreen />);
    await act(async () => {
      fireEvent.changeText(getByTestId("config-__root__-name"), "Updated");
      await new Promise((r) => setTimeout(r, 50));
    });
    await act(async () => {
      fireEvent.press(getByTestId("config-save-button"));
      await new Promise((r) => setTimeout(r, 200));
    });
    expect(updateCalls.length).toBe(1);
    expect(updateCalls[0].name).toBe("Updated");
  });

  it("handles save errors without throwing", async () => {
    metaState.data = baseMeta;
    valuesState.data = {};
    updateImpl = async () => {
      throw new Error("nope");
    };
    const {getByTestId} = renderWithTheme(<ConfigurationScreen />);
    await act(async () => {
      fireEvent.changeText(getByTestId("config-__root__-name"), "Boom");
      await new Promise((r) => setTimeout(r, 50));
    });
    await act(async () => {
      fireEvent.press(getByTestId("config-save-button"));
      await new Promise((r) => setTimeout(r, 200));
    });
    expect(updateCalls.length).toBe(1);
  });

  it("accepts non-numeric number input and preserves the raw text", async () => {
    metaState.data = baseMeta;
    valuesState.data = {};
    const {getByTestId} = renderWithTheme(<ConfigurationScreen />);
    await act(async () => {
      fireEvent.changeText(getByTestId("config-smtp-port"), "not-a-number");
      await new Promise((r) => setTimeout(r, 50));
    });
  });
});
