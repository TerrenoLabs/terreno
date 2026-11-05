import {beforeEach, describe, it, mock} from "bun:test";
import {Page} from "@terreno/ui";
import {act} from "@testing-library/react-native";
import {assert} from "chai";
import React from "react";
import {renderWithTheme} from "../../ui/src/test-utils";
import {AdminScreenPage} from "./AdminScreenPage";

const pushMock = mock((_href: unknown) => {});
const backMock = mock(() => {});

mock.module("expo-router", () => ({
  router: {back: backMock, push: pushMock},
}));

describe("AdminScreenPage", () => {
  beforeEach(() => {
    pushMock.mockClear();
    backMock.mockClear();
  });

  it("shows a back arrow by default", (): void => {
    const {UNSAFE_root} = renderWithTheme(<AdminScreenPage title="Example" />);

    assert.isTrue(UNSAFE_root.findByType(Page).props.backButton);
  });

  it("allows hosts to disable the back arrow", (): void => {
    const {UNSAFE_root} = renderWithTheme(<AdminScreenPage backButton={false} title="Example" />);

    assert.isFalse(UNSAFE_root.findByType(Page).props.backButton);
  });

  it("navigates to admin home when the back arrow is pressed", (): void => {
    const {UNSAFE_root} = renderWithTheme(<AdminScreenPage title="Example" />);

    act(() => {
      UNSAFE_root.findByType(Page).props.onBack();
    });

    assert.equal(pushMock.mock.calls.length, 1);
    assert.equal(pushMock.mock.calls[0]?.[0], "/admin");
    assert.equal(backMock.mock.calls.length, 0);
  });

  it("uses backHref when provided", (): void => {
    const {UNSAFE_root} = renderWithTheme(
      <AdminScreenPage backHref="/admin/comms" title="Example" />
    );

    act(() => {
      UNSAFE_root.findByType(Page).props.onBack();
    });

    assert.equal(pushMock.mock.calls[0]?.[0], "/admin/comms");
  });

  it("maps an empty standalone-admin route base to the root route", (): void => {
    const {UNSAFE_root} = renderWithTheme(<AdminScreenPage backHref="" title="Example" />);

    act(() => {
      UNSAFE_root.findByType(Page).props.onBack();
    });

    assert.equal(pushMock.mock.calls[0]?.[0], "/");
  });

  it("prefers onBack over backHref", (): void => {
    const onBack = mock(() => {});
    const {UNSAFE_root} = renderWithTheme(
      <AdminScreenPage backHref="/admin/comms" onBack={onBack} title="Example" />
    );

    act(() => {
      UNSAFE_root.findByType(Page).props.onBack();
    });

    assert.equal(onBack.mock.calls.length, 1);
    assert.equal(pushMock.mock.calls.length, 0);
  });
});
