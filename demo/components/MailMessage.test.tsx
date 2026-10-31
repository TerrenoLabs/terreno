import {afterEach, describe, expect, it, type Mock} from "bun:test";
import {useLocalSearchParams} from "expo-router";

import {renderWithTheme} from "../../ui/src/test-utils";
import {MailEmptyState, MailMessage} from "./MailMessage";

const mockedParams = useLocalSearchParams as unknown as Mock<() => Record<string, string>>;

describe("MailMessage", () => {
  afterEach(() => {
    mockedParams.mockImplementation(() => ({}));
  });

  it("shows the message named by the route's id param", () => {
    mockedParams.mockImplementation(() => ({id: "2"}));
    const {getByTestId, getByText} = renderWithTheme(<MailMessage />);
    expect(getByTestId("mail-message-2")).toBeTruthy();
    expect(getByText("Design review moved to Thursday")).toBeTruthy();
  });

  it("explains when the id does not match a message", () => {
    mockedParams.mockImplementation(() => ({id: "missing"}));
    const {getByTestId} = renderWithTheme(<MailMessage />);
    expect(getByTestId("mail-message-missing")).toBeTruthy();
  });
});

describe("MailEmptyState", () => {
  it("asks the user to pick a message", () => {
    const {getByText} = renderWithTheme(<MailEmptyState />);
    expect(getByText("Select a message to read it.")).toBeTruthy();
  });
});
