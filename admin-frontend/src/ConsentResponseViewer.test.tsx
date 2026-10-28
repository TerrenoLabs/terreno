// noExplicitAny: test mocks use type-erased admin model API doubles and dynamic mock returns
// biome-ignore-all lint/suspicious/noExplicitAny: test mock typing
import {beforeEach, describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import React from "react";
import {renderWithTheme} from "../../ui/src/test-utils";
import {
  configureAdminModelApiDouble,
  resetAdminModelApiDouble,
} from "./testing/useAdminModelApiDouble";

interface ReadState {
  data: unknown;
  isLoading: boolean;
}
const readState: ReadState = {data: undefined, isLoading: false};

const pdfCalls: unknown[] = [];
let pdfImpl: (r: unknown) => Promise<void> = async () => {};
mock.module("./generateConsentPdf", () => ({
  generateConsentPdf: async (r: unknown) => {
    pdfCalls.push(r);
    return pdfImpl(r);
  },
}));

import {ConsentResponseViewer} from "./ConsentResponseViewer";

describe("ConsentResponseViewer", () => {
  beforeEach(() => {
    resetAdminModelApiDouble();
    configureAdminModelApiDouble({
      useReadQuery: (_id: string, opts: {skip?: boolean}) => {
        if (opts?.skip) {
          return {data: undefined, isLoading: false};
        }
        return {data: readState.data, isLoading: readState.isLoading};
      },
    });
    readState.data = undefined;
    readState.isLoading = false;
    pdfCalls.length = 0;
    pdfImpl = async () => {};
  });

  it("renders loading state", () => {
    readState.isLoading = true;
    const {toJSON} = renderWithTheme(<ConsentResponseViewer baseUrl="/admin" id="r1" />);
    expect(toJSON()).toBeDefined();
  });

  // Regression: useState/useCallback used to run after the early-return spinner
  // branch, which produced React error #310 ("Rendered more hooks than during the
  // previous render") the moment loading flipped to loaded. This test exercises
  // both renders.
  it("survives the loading → loaded transition without a hook-order error", async () => {
    readState.isLoading = true;
    const {rerender, getByText} = renderWithTheme(
      <ConsentResponseViewer baseUrl="/admin" id="r1" />
    );
    await act(async () => {
      readState.isLoading = false;
      readState.data = {agreed: true, consentFormId: "raw-id", userId: "u1"};
      rerender(<ConsentResponseViewer baseUrl="/admin" id="r1" />);
    });
    expect(getByText("Download PDF")).toBeDefined();
  });

  it("shows not-found state when there is no id / data", () => {
    const {getByText} = renderWithTheme(<ConsentResponseViewer baseUrl="/admin" id="missing" />);
    expect(getByText(/Response not found\./)).toBeDefined();
  });

  it("renders a full response and triggers PDF download", async () => {
    readState.data = {
      agreed: true,
      agreedAt: "2024-01-02T03:04:05.000Z",
      checkboxValues: {0: true, 1: false},
      consentFormId: {title: "My Form"},
      contentSnapshot: "# Hello",
      formVersionSnapshot: {title: "My Form", version: 1},
      ipAddress: "127.0.0.1",
      locale: "en",
      signature: "data:image/png;base64,abc",
      userAgent: "jest",
      userId: {_id: "u1", email: "user@example.com", name: "Test User"},
    };
    const {getByText} = renderWithTheme(<ConsentResponseViewer baseUrl="/admin" id="r1" />);
    expect(getByText("User Information")).toBeDefined();
    expect(getByText("Test User")).toBeDefined();
    expect(getByText("user@example.com")).toBeDefined();
    await act(async () => {
      fireEvent.press(getByText("Download PDF"));
      await new Promise((r) => setTimeout(r, 100));
    });
    expect(pdfCalls.length).toBe(1);
  });

  it("renders minimal declined response without optional sections", () => {
    readState.data = {
      agreed: false,
      consentFormId: "raw-id",
      userId: "u2",
    };
    const {toJSON} = renderWithTheme(<ConsentResponseViewer baseUrl="/admin" id="r2" />);
    expect(toJSON()).toBeDefined();
  });

  it("handles PDF generation errors", async () => {
    readState.data = {agreed: true};
    pdfImpl = async () => {
      throw new Error("broken");
    };
    const {getByText} = renderWithTheme(<ConsentResponseViewer baseUrl="/admin" id="r1" />);
    await act(async () => {
      fireEvent.press(getByText("Download PDF"));
      await new Promise((r) => setTimeout(r, 100));
    });
    expect(pdfCalls.length).toBe(1);
  });

  it("formats invalid dates gracefully", () => {
    readState.data = {agreed: true, agreedAt: "not-a-date"};
    const {toJSON} = renderWithTheme(<ConsentResponseViewer baseUrl="/admin" id="r1" />);
    expect(toJSON()).toBeDefined();
  });
});
