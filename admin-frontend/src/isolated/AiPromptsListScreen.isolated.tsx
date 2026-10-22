import {beforeEach, describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import type {AdminConfigResponse} from "../types";
import {AiPromptsScreenWidget as AiPromptsScreenWidgetBase} from "../widgets/aiObservability/prompts/AiPromptsListScreen";
import type {PromptListItem} from "../widgets/aiObservability/prompts/promptTypes";
import {
  createObservabilityServer,
  type FakeObservabilityServer,
  flushObservabilityRequests,
  withObservabilityServer,
} from "./observabilityFakeApi.isolated";
import {
  operatorObservabilityStatus,
  readOnlyPromptObservabilityStatus,
} from "./observabilityStatusFixtures.isolated";

const AiPromptsScreenWidget = withObservabilityServer(AiPromptsScreenWidgetBase);

const routerPush = mock(() => undefined);

mock.module("expo-router", () => ({
  router: {push: (...args: unknown[]) => routerPush(...args)},
  useLocalSearchParams: () => ({}),
}));

describe("AiPromptsListScreen", () => {
  const loaded: PromptListItem[] = [
    {
      folder: "examples",
      latestVersion: 1,
      name: "summarize",
      production: "—",
      type: "chat",
    },
  ];

  const CREATE_ROUTE = "POST /ai/observability/prompts";

  const createServer = (status: unknown = operatorObservabilityStatus()): FakeObservabilityServer =>
    createObservabilityServer({
      [CREATE_ROUTE]: (request) => ({
        name: String((request.body as {name?: unknown} | undefined)?.name),
        version: 1,
      }),
      "GET /ai/observability/prompts": {data: loaded},
      "GET /ai/observability/status": {data: status},
    });

  const lastCreateBody = (server: FakeObservabilityServer): Record<string, unknown> | undefined => {
    const calls = server.callsTo(CREATE_ROUTE);
    return calls[calls.length - 1]?.body as Record<string, unknown> | undefined;
  };

  const config: AdminConfigResponse = {customScreens: [], models: [], scripts: []};

  beforeEach(() => {
    routerPush.mockClear();
  });

  const fillRequiredCreateFields = (view: ReturnType<typeof renderWithTheme>): void => {
    fireEvent.changeText(view.getByTestId("ai-prompts-create-folder"), "examples");
    fireEvent.changeText(view.getByTestId("ai-prompts-create-name"), "new-prompt");
    fireEvent.changeText(view.getByTestId("ai-prompts-create-system"), "You are helpful.");
    fireEvent.changeText(view.getByTestId("ai-prompts-create-template"), "Hi {{name}}");
  };

  it("omits description from create payload when the field is blank", async () => {
    const server = createServer();
    const view = renderWithTheme(
      <AiPromptsScreenWidget
        config={config}
        routeBase="/admin"
        screenName="ai-prompts"
        server={server}
      />
    );
    await flushObservabilityRequests();
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-prompts-create"));
      await Promise.resolve();
    });
    fillRequiredCreateFields(view);
    await act(async () => {
      fireEvent.press(view.getByText("Create"));
      await Promise.resolve();
    });
    await flushObservabilityRequests();
    const body = lastCreateBody(server);
    expect(body?.name).toBe("new-prompt");
    expect(body && "description" in body).toBe(false);
  });

  it("hides create when status permissions are read-only", async () => {
    const view = renderWithTheme(
      <AiPromptsScreenWidget
        config={config}
        routeBase="/admin"
        screenName="ai-prompts"
        server={createServer(readOnlyPromptObservabilityStatus())}
      />
    );
    await flushObservabilityRequests();
    expect(view.queryByTestId("ai-prompts-create")).toBeNull();
  });

  it("includes trimmed description in the create payload", async () => {
    const server = createServer();
    const view = renderWithTheme(
      <AiPromptsScreenWidget
        config={config}
        routeBase="/admin"
        screenName="ai-prompts"
        server={server}
      />
    );
    await flushObservabilityRequests();
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-prompts-create"));
      await Promise.resolve();
    });
    fillRequiredCreateFields(view);
    fireEvent.changeText(view.getByTestId("ai-prompts-create-description"), "  Operator summary  ");
    await act(async () => {
      fireEvent.press(view.getByText("Create"));
      await Promise.resolve();
    });
    await flushObservabilityRequests();
    expect(lastCreateBody(server)?.description).toBe("Operator summary");
  });
});
