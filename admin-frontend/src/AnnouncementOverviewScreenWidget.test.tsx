// noExplicitAny: test mocks use type-erased admin model API doubles
// biome-ignore-all lint/suspicious/noExplicitAny: test mock typing
import {beforeEach, describe, it, mock} from "bun:test";
import {assert} from "chai";
import React from "react";
import {renderWithTheme} from "../../ui/src/test-utils";
import type {AnnouncementOverviewProps} from "./AnnouncementOverview";

const pushMock = mock((_path: string) => {});

mock.module("expo-router", () => ({
  useRouter: () => ({push: pushMock}),
}));

let capturedOverviewProps: AnnouncementOverviewProps | undefined;

mock.module("./AnnouncementOverview", () => ({
  AnnouncementOverview: (props: AnnouncementOverviewProps) => {
    capturedOverviewProps = props;
    return null;
  },
}));

import {
  ANNOUNCEMENTS_ADMIN_WIDGETS,
  AnnouncementOverviewScreenWidget,
} from "./AnnouncementOverviewScreenWidget";

describe("AnnouncementOverviewScreenWidget", () => {
  beforeEach(() => {
    pushMock.mockClear();
    capturedOverviewProps = undefined;
  });

  it("registers the announcements overview widget", () => {
    assert.strictEqual(ANNOUNCEMENTS_ADMIN_WIDGETS.announcements, AnnouncementOverviewScreenWidget);
  });

  it("routes create, edit, and analytics table actions through expo-router", () => {
    renderWithTheme(<AnnouncementOverviewScreenWidget routeBase="/admin" />);

    assert.strictEqual(capturedOverviewProps?.routeBase, "/admin");
    assert.isFunction(capturedOverviewProps?.onCreate);
    assert.isFunction(capturedOverviewProps?.onEdit);
    assert.isFunction(capturedOverviewProps?.onOpenAcknowledgements);
    assert.isFunction(capturedOverviewProps?.onOpenImpressions);
    assert.isFunction(capturedOverviewProps?.onOpenClickEvents);

    capturedOverviewProps?.onCreate?.();
    capturedOverviewProps?.onEdit?.("ann-1");
    capturedOverviewProps?.onOpenAcknowledgements?.();
    capturedOverviewProps?.onOpenImpressions?.();
    capturedOverviewProps?.onOpenClickEvents?.();

    assert.deepEqual(
      pushMock.mock.calls.map((call) => call[0]),
      [
        "/admin/announcements/create",
        "/admin/announcements/ann-1",
        "/admin/AnnouncementAcknowledgement",
        "/admin/AnnouncementImpression",
        "/admin/AnnouncementClickEvent",
      ]
    );
  });
});
