import {afterEach, describe, expect, it, type Mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import {router} from "expo-router";

import {renderWithTheme} from "../../ui/src/test-utils";
import {MailLayout} from "./MailLayout";

const push = router.push as unknown as Mock<(href: string) => void>;

describe("MailLayout", () => {
  afterEach(() => {
    push.mockClear();
  });

  it("puts the inbox in the list pane on a wide layout and opens a message under indexHref", async () => {
    const {getByTestId} = renderWithTheme(<MailLayout indexHref="/demo/list-detail" />);
    await act(async () => {
      fireEvent(getByTestId("list-detail-layout"), "layout", {
        nativeEvent: {layout: {height: 800, width: 1200}},
      });
    });
    expect(getByTestId("list-detail-list-pane")).toBeTruthy();
    expect(getByTestId("mail-list")).toBeTruthy();

    await act(async () => {
      fireEvent.press(getByTestId("mail-row-4-clickable"));
    });
    expect(push).toHaveBeenCalledWith("/demo/list-detail/4");
  });
});
