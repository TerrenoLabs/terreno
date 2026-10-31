import {afterEach, describe, it} from "bun:test";
import {act} from "@testing-library/react-native";
import {assert} from "chai";
import type React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import {AdminProvider} from "../AdminProvider";
import type {AdminApi} from "../types";
import {useConfigurationApi} from "../useConfigurationApi";

const api = {
  enhanceEndpoints: () => ({injectEndpoints: () => ({})}),
} as unknown as AdminApi;

describe("useConfigurationApi over admin RPC", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns the configuration document, not the {data} response envelope", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          data: {_id: "c1", ai: {systemPrompt: "Answer as Terreno Bot"}},
          requestId: "r1",
        }),
        {headers: {"Content-Type": "application/json"}, status: 200}
      )) as typeof fetch;

    let values: unknown;
    const Harness: React.FC = () => {
      const {useValuesQuery} = useConfigurationApi({api, basePath: "/configuration"});
      values = useValuesQuery().data;
      return null;
    };

    renderWithTheme(
      <AdminProvider
        api={api}
        apiBase="/admin"
        credentials="same-origin"
        getAuthHeaders={() => ({})}
        routeBase="/admin"
      >
        <Harness />
      </AdminProvider>
    );
    await act(async () => {
      await Promise.resolve();
    });

    assert.deepEqual(values, {_id: "c1", ai: {systemPrompt: "Answer as Terreno Bot"}});
  });
});
