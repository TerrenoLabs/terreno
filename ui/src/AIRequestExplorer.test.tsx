import {describe, expect, it, mock} from "bun:test";
import {fireEvent} from "@testing-library/react-native";
import {DateTime} from "luxon";

import {AIRequestExplorer, type AIRequestExplorerData} from "./AIRequestExplorer";
import {renderWithTheme} from "./test-utils";

const fullRequest: AIRequestExplorerData = {
  aiModel: "gemini-3.8-flash",
  created: "2024-06-15T14:30:45.000Z",
  error: "A warning",
  prompt: "Summarize this request",
  requestType: "summarization",
  response: "Summary response",
  responseTime: 123,
  tokensUsed: 42,
  user: {email: "jane@example.com", name: "Jane Example"},
};

const defaultProps = {
  data: [fullRequest],
  onPageChange: mock((_page: number) => {}),
  page: 1,
  totalCount: 1,
  totalPages: 1,
};

describe("AIRequestExplorer", () => {
  it("renders request rows and formats complete and fallback data", () => {
    const fallbackRequest = {
      aiModel: "fallback-model",
      created: "",
      requestType: "general",
      user: {email: "fallback@example.com"},
    } as unknown as AIRequestExplorerData;
    const {getAllByText, getByText} = renderWithTheme(
      <AIRequestExplorer {...defaultProps} data={[fullRequest, fallbackRequest]} />
    );

    expect(getByText("Jane Example")).toBeTruthy();
    expect(getByText("gemini-3.8-flash")).toBeTruthy();
    expect(getByText("Summarize this request")).toBeTruthy();
    expect(getByText("Summary response")).toBeTruthy();
    expect(getByText("42")).toBeTruthy();
    expect(getByText("123ms")).toBeTruthy();
    expect(
      getByText(
        DateTime.fromISO(fullRequest.created).toLocaleString(DateTime.DATETIME_SHORT_WITH_SECONDS)
      )
    ).toBeTruthy();
    expect(getByText("A warning")).toBeTruthy();
    expect(getByText("fallback@example.com")).toBeTruthy();
    expect(getAllByText("-").length).toBeGreaterThanOrEqual(1);
  });

  it("falls back to a dash when the user and values are missing", () => {
    const fallbackRequest = {
      aiModel: "fallback-model",
      created: "",
      requestType: "general",
    } as unknown as AIRequestExplorerData;
    const {getAllByText} = renderWithTheme(
      <AIRequestExplorer {...defaultProps} data={[fallbackRequest]} />
    );

    expect(getAllByText("-").length).toBeGreaterThanOrEqual(6);
  });

  it("renders the loading branch instead of the table", () => {
    const {queryByText} = renderWithTheme(
      <AIRequestExplorer {...defaultProps} data={[fullRequest]} isLoading />
    );

    expect(queryByText("Summarize this request")).toBeNull();
  });

  it("renders optional filters and fires their callbacks", () => {
    const onEndDateChange = mock((_date: string) => {});
    const onRequestTypeFilterChange = mock((_types: string[]) => {});
    const onStartDateChange = mock((_date: string) => {});
    const {getAllByPlaceholderText, getByLabelText, getByText} = renderWithTheme(
      <AIRequestExplorer
        {...defaultProps}
        endDate=""
        onEndDateChange={onEndDateChange}
        onRequestTypeFilterChange={onRequestTypeFilterChange}
        onStartDateChange={onStartDateChange}
        requestTypeFilter={[]}
        startDate=""
      />
    );

    expect(getByText("Request Type")).toBeTruthy();
    expect(getByText("Start Date")).toBeTruthy();
    expect(getByText("End Date")).toBeTruthy();

    fireEvent.press(getByLabelText("General"));
    expect(onRequestTypeFilterChange).toHaveBeenCalledWith(["general"]);

    const monthInputs = getAllByPlaceholderText("MM");
    const dayInputs = getAllByPlaceholderText("DD");
    const yearInputs = getAllByPlaceholderText("YYYY");
    const hourInputs = getAllByPlaceholderText("hh");
    const minuteInputs = getAllByPlaceholderText("mm");
    fireEvent.changeText(monthInputs[0], "01");
    fireEvent.changeText(dayInputs[0], "02");
    fireEvent.changeText(yearInputs[0], "2024");
    fireEvent.changeText(hourInputs[0], "03");
    fireEvent.changeText(minuteInputs[0], "04");
    expect(onStartDateChange).toHaveBeenCalled();

    fireEvent.changeText(monthInputs[1], "03");
    fireEvent.changeText(dayInputs[1], "04");
    fireEvent.changeText(yearInputs[1], "2024");
    fireEvent.changeText(hourInputs[1], "05");
    fireEvent.changeText(minuteInputs[1], "06");
    expect(onEndDateChange).toHaveBeenCalled();
  });

  it("omits filters when callbacks are not provided", () => {
    const {queryByText} = renderWithTheme(<AIRequestExplorer {...defaultProps} />);

    expect(queryByText("Request Type")).toBeNull();
    expect(queryByText("Start Date")).toBeNull();
    expect(queryByText("End Date")).toBeNull();
  });

  it("renders pagination only for multiple pages and changes page", () => {
    const onPageChange = mock((_page: number) => {});
    const {getByHintText} = renderWithTheme(
      <AIRequestExplorer {...defaultProps} onPageChange={onPageChange} totalPages={3} />
    );

    expect(getByHintText("Click to go to page 2")).toBeTruthy();
    fireEvent.press(getByHintText("Click to go to page 2"));
    expect(onPageChange).toHaveBeenCalledWith(2);

    const singlePage = renderWithTheme(<AIRequestExplorer {...defaultProps} />);
    expect(singlePage.queryByHintText("Click to go to page 1")).toBeNull();
  });
});
