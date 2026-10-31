// noExplicitAny: test mocks use type-erased admin model API doubles and dynamic mock returns
// biome-ignore-all lint/suspicious/noExplicitAny: test mock typing
import {afterAll, beforeEach, describe, expect, it, mock, spyOn} from "bun:test";
import * as terrenoUi from "@terreno/ui";
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

const printedHtml: string[] = [];
let printImpl: () => Promise<void> = async () => {};
// Capture what the print button hands to @terreno/ui's printConsentHtml.
const printSpy = spyOn(terrenoUi, "printConsentHtml").mockImplementation(
  async ({html}: {html: string}) => {
    printedHtml.push(html);
    return printImpl();
  }
);

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
    printedHtml.length = 0;
    printImpl = async () => {};
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
  describe("provisional signatures", () => {
    const provisionalResponse = {
      _id: "response-7",
      agreed: true,
      agreedAt: "2026-10-20T15:30:00.000Z",
      consentFormId: {slug: "intake", title: "Intake Consent", type: "agreement", version: 1},
      provisional: true,
      provisionalNote: "Guardian agreed by phone",
      provisionalSignedBy: {_id: "staff-1", email: "dana@example.com", name: "Dana Rivera"},
      provisionalSignerIp: "10.0.0.7",
      userId: {_id: "member-1", email: "sam@example.com", name: "Sam"},
    };

    it("shows the provisional badge, signer, date, and note", () => {
      readState.data = provisionalResponse;
      const {getByTestId, getByText, queryByTestId} = renderWithTheme(
        <ConsentResponseViewer baseUrl="/admin" id="response-7" />
      );
      expect(getByTestId("consent-response-provisional")).toBeDefined();
      expect(getByText("Provisional")).toBeDefined();
      expect(getByText("Dana Rivera")).toBeDefined();
      expect(getByTestId("consent-response-provisional-note")).toBeDefined();
      expect(getByText("Guardian agreed by phone")).toBeDefined();
      expect(getByText("10.0.0.7")).toBeDefined();
      expect(queryByTestId("consent-response-provisional-voided")).toBeNull();
    });

    it("shows the void state", () => {
      readState.data = {
        ...provisionalResponse,
        voidedAt: "2026-10-21T09:00:00.000Z",
        voidReason: "Wrong member",
      };
      const {getByTestId, getByText} = renderWithTheme(
        <ConsentResponseViewer baseUrl="/admin" id="response-7" />
      );
      expect(getByTestId("consent-response-provisional-voided")).toBeDefined();
      expect(getByText("Wrong member")).toBeDefined();
    });

    it("shows no provisional section for the user's own response", () => {
      readState.data = {agreed: true, consentFormId: {title: "Terms"}, userId: "u1"};
      const {queryByTestId} = renderWithTheme(<ConsentResponseViewer baseUrl="/admin" id="r1" />);
      expect(queryByTestId("consent-response-provisional")).toBeNull();
    });

    it("prints HTML that includes the provisional block with the note", async () => {
      readState.data = provisionalResponse;
      const {getByTestId} = renderWithTheme(
        <ConsentResponseViewer baseUrl="/admin" id="response-7" />
      );
      await act(async () => {
        fireEvent.press(getByTestId("consent-response-print-button"));
        await new Promise((r) => setTimeout(r, 100));
      });
      expect(printedHtml).toHaveLength(1);
      expect(printedHtml[0]).toContain("<h2>Provisional signature</h2>");
      expect(printedHtml[0]).toContain("Dana Rivera");
      expect(printedHtml[0]).toContain("Guardian agreed by phone");
      expect(printedHtml[0]).toContain("10.0.0.7");
      expect(printedHtml[0]).toContain("Intake Consent");
      expect(pdfCalls).toHaveLength(0);
    });

    it("prints a non-provisional response without the provisional block", async () => {
      readState.data = {agreed: true, consentFormId: {title: "Terms"}, userId: "u1"};
      const {getByTestId} = renderWithTheme(<ConsentResponseViewer baseUrl="/admin" id="r1" />);
      await act(async () => {
        fireEvent.press(getByTestId("consent-response-print-button"));
        await new Promise((r) => setTimeout(r, 100));
      });
      expect(printedHtml).toHaveLength(1);
      expect(printedHtml[0]).not.toContain("Provisional signature");
    });

    it("keeps the page usable when printing fails", async () => {
      readState.data = provisionalResponse;
      printImpl = async () => {
        throw new Error("printer offline");
      };
      const {getByTestId} = renderWithTheme(
        <ConsentResponseViewer baseUrl="/admin" id="response-7" />
      );
      await act(async () => {
        fireEvent.press(getByTestId("consent-response-print-button"));
        await new Promise((r) => setTimeout(r, 100));
      });
      expect(printedHtml).toHaveLength(1);
      expect(getByTestId("consent-response-print-button")).toBeDefined();
    });
  });
});

afterAll(() => {
  printSpy.mockRestore();
});
