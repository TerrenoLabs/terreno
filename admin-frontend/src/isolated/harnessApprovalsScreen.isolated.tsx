import {describe, expect, it} from "bun:test";
import {act, fireEvent, waitFor} from "@testing-library/react-native";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import {AdminWidgetContext} from "../adminContext";
import type {AdminRequestArgs} from "../adminRequest";
import type {AdminApi, AdminProviderValue} from "../types";
import {BUILT_IN_SCREEN_WIDGETS} from "../widgets/builtInWidgets";
import {
  HARNESS_ADMIN_WIDGETS,
  HarnessApprovalsScreenWidget,
} from "../widgets/harness/HarnessApprovalsScreenWidget";

describe("HarnessApprovalsScreenWidget", () => {
  it("is the built-in widget for the harness-approvals custom screen", () => {
    expect(HARNESS_ADMIN_WIDGETS["harness-approvals"]).toBe(HarnessApprovalsScreenWidget);
    expect(BUILT_IN_SCREEN_WIDGETS["harness-approvals"]).toBe(HarnessApprovalsScreenWidget);
  });

  it("renders the inbox with the AdminProvider request client", async () => {
    const urls: string[] = [];
    const request = async (args: AdminRequestArgs): Promise<unknown> => {
      urls.push(args.url);
      return {data: []};
    };
    const view = renderWithTheme(
      <AdminWidgetContext.Provider value={{adminRpc: request} as unknown as AdminProviderValue}>
        <HarnessApprovalsScreenWidget
          api={{} as AdminApi}
          config={{customScreens: [], models: [], scripts: []}}
          routeBase="/admin"
          screenName="harness-approvals"
        />
      </AdminWidgetContext.Provider>
    );
    await waitFor(() => {
      expect(view.getByTestId("harness-approvals-empty")).toBeTruthy();
    });
    expect(urls).toEqual(["/harness/approvals?limit=100"]);
  });

  it("closes an open approval with the page back control, without a second back button", async () => {
    const request = async (): Promise<unknown> => ({
      data: [{_id: "a1", definitionKey: "demo.approvalDemo@1:k", id: "a1", title: "Sign off"}],
    });
    const view = renderWithTheme(
      <AdminWidgetContext.Provider value={{adminRpc: request} as unknown as AdminProviderValue}>
        <HarnessApprovalsScreenWidget
          api={{} as AdminApi}
          config={{customScreens: [], models: [], scripts: []}}
          routeBase="/admin"
          screenName="harness-approvals"
        />
      </AdminWidgetContext.Provider>
    );
    await waitFor(() => {
      expect(view.getByTestId("harness-approval-row-a1-clickable")).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(view.getByTestId("harness-approval-row-a1-clickable"));
    });
    expect(view.getByTestId("harness-approval-detail")).toBeTruthy();
    expect(view.queryByTestId("harness-approval-back")).toBeNull();

    await act(async () => {
      fireEvent.press(view.getByLabelText("Back"));
    });
    expect(view.queryByTestId("harness-approval-detail")).toBeNull();
    expect(view.getByTestId("harness-approvals-list")).toBeTruthy();
  });
});
