import {afterEach, describe, expect, it, type Mock} from "bun:test";
import {ListDetailLayout} from "@terreno/ui";
import {act, fireEvent} from "@testing-library/react-native";
import {router} from "expo-router";

import {renderWithTheme} from "../../ui/src/test-utils";
import {MailList} from "./MailList";

const push = router.push as unknown as Mock<(href: string) => void>;

const renderSplitInbox = async (): Promise<ReturnType<typeof renderWithTheme>> => {
  const result = renderWithTheme(
    <ListDetailLayout detailHref={(id) => `/mail/${id}`} indexHref="/mail" list={<MailList />} />
  );
  await act(async () => {
    fireEvent(result.getByTestId("list-detail-layout"), "layout", {
      nativeEvent: {layout: {height: 800, width: 1200}},
    });
  });
  return result;
};

describe("MailList", () => {
  afterEach(() => {
    push.mockClear();
  });

  it("labels each row with its sender and subject", async () => {
    const {getByLabelText} = await renderSplitInbox();
    expect(getByLabelText("Avery Chen: Quarterly planning notes")).toBeTruthy();
  });

  it("opens the pressed message through the layout", async () => {
    const {getByTestId} = await renderSplitInbox();
    await act(async () => {
      fireEvent.press(getByTestId("mail-row-2-clickable"));
    });
    expect(push).toHaveBeenCalledWith("/mail/2");
  });
});
