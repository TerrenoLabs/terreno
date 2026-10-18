import {beforeEach, describe, expect, it, mock} from "bun:test";
import {act, fireEvent, waitFor} from "@testing-library/react-native";
import {type ScaledSize, StyleSheet, useWindowDimensions} from "react-native";

import {renderWithTheme} from "./test-utils";
import {Unifier} from "./Unifier";
import {getUnseenWhatsNewReleases, WhatsNewBanner, type WhatsNewRelease} from "./WhatsNewBanner";

const RELEASES: WhatsNewRelease[] = [
  {body: "### Fixed\n\n- Third fix.", date: "2026-10-13", version: "3.0.0"},
  {body: "### Added\n\n- Second feature.", date: "2026-10-12", version: "2.0.0"},
  {body: "### Added\n\n- First feature.", date: "2026-10-01", version: "1.0.0"},
];

const STORAGE_KEY = "test:whatsNew";

type MockableUseWindowDimensions = (() => ScaledSize) & {
  mockImplementation?: (impl: () => ScaledSize) => void;
};

const setWindowHeight = (height: number): void => {
  (useWindowDimensions as MockableUseWindowDimensions).mockImplementation?.(() => ({
    fontScale: 1,
    height,
    scale: 2,
    width: 375,
  }));
};

const mockStoredVersion = (version: string | null): void => {
  Unifier.storage.getItem = mock(() => Promise.resolve(version));
};

describe("getUnseenWhatsNewReleases", () => {
  it("returns every release when nothing was seen", () => {
    expect(getUnseenWhatsNewReleases({releases: RELEASES})).toEqual(RELEASES);
  });

  it("returns only releases newer than the last seen version", () => {
    const unseen = getUnseenWhatsNewReleases({lastSeenVersion: "2.0.0", releases: RELEASES});
    expect(unseen.map((release) => release.version)).toEqual(["3.0.0"]);
  });

  it("returns nothing when the latest release was seen", () => {
    expect(getUnseenWhatsNewReleases({lastSeenVersion: "3.0.0", releases: RELEASES})).toEqual([]);
  });

  it("treats an unknown last seen version as nothing seen", () => {
    const unseen = getUnseenWhatsNewReleases({lastSeenVersion: "0.1.0", releases: RELEASES});
    expect(unseen).toEqual(RELEASES);
  });
});

describe("WhatsNewBanner", () => {
  beforeEach(() => {
    mockStoredVersion(null);
    Unifier.storage.setItem = mock(() => Promise.resolve());
  });

  it("shows the latest version and how many earlier releases are unseen", async () => {
    const {findByTestId} = renderWithTheme(
      <WhatsNewBanner releases={RELEASES} storageKey={STORAGE_KEY} />
    );
    const text = await findByTestId("whats-new-banner-text");
    expect(text.props.children).toBe("What's new in 3.0.0 and 2 earlier releases");
  });

  it("names a single unseen release without an earlier count", async () => {
    mockStoredVersion("2.0.0");
    const {findByTestId} = renderWithTheme(
      <WhatsNewBanner releases={RELEASES} storageKey={STORAGE_KEY} />
    );
    const text = await findByTestId("whats-new-banner-text");
    expect(text.props.children).toBe("What's new in 3.0.0");
  });

  it("renders nothing once the latest release was seen", async () => {
    mockStoredVersion("3.0.0");
    const {queryByTestId} = renderWithTheme(
      <WhatsNewBanner releases={RELEASES} storageKey={STORAGE_KEY} />
    );
    await waitFor(() => {
      expect(Unifier.storage.getItem).toHaveBeenCalledWith(STORAGE_KEY);
    });
    expect(queryByTestId("whats-new-banner")).toBeNull();
  });

  it("renders nothing without releases", async () => {
    const {queryByTestId} = renderWithTheme(
      <WhatsNewBanner releases={[]} storageKey={STORAGE_KEY} />
    );
    await waitFor(() => {
      expect(Unifier.storage.getItem).toHaveBeenCalled();
    });
    expect(queryByTestId("whats-new-banner")).toBeNull();
  });

  it("dismissing stores the latest version and hides the banner", async () => {
    const {findByLabelText, queryByTestId} = renderWithTheme(
      <WhatsNewBanner releases={RELEASES} storageKey={STORAGE_KEY} />
    );
    const dismiss = await findByLabelText("Dismiss what's new");
    await act(async () => {
      fireEvent.press(dismiss);
    });
    expect(Unifier.storage.setItem).toHaveBeenCalledWith(STORAGE_KEY, "3.0.0");
    await waitFor(() => {
      expect(queryByTestId("whats-new-banner")).toBeNull();
    });
  });

  it("opening lists the unseen release notes and marks them seen", async () => {
    mockStoredVersion("1.0.0");
    const onOpen = mock(() => undefined);
    const {findByTestId, queryByTestId} = renderWithTheme(
      <WhatsNewBanner onOpen={onOpen} releases={RELEASES} storageKey={STORAGE_KEY} />
    );
    const openButton = await findByTestId("whats-new-banner-open-button");
    await act(async () => {
      fireEvent.press(openButton);
    });

    await waitFor(() => {
      expect(Unifier.storage.setItem).toHaveBeenCalledWith(STORAGE_KEY, "3.0.0");
    });
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(await findByTestId("whats-new-banner-release-3.0.0")).toBeTruthy();
    expect(await findByTestId("whats-new-banner-release-2.0.0")).toBeTruthy();
    expect(queryByTestId("whats-new-banner-release-1.0.0")).toBeNull();
  });

  it("leaves room for the modal title and Done button on short windows", async () => {
    const openNotesMaxHeight = async (height: number): Promise<unknown> => {
      setWindowHeight(height);
      mockStoredVersion(null);
      const {findByTestId, getByTestId, unmount} = renderWithTheme(
        <WhatsNewBanner releases={RELEASES} storageKey={STORAGE_KEY} />
      );
      const openButton = await findByTestId("whats-new-banner-open-button");
      await act(async () => {
        fireEvent.press(openButton);
      });
      const maxHeight = StyleSheet.flatten(
        getByTestId("whats-new-banner-notes").props.style
      ).maxHeight;
      unmount();
      return maxHeight;
    };

    try {
      expect(await openNotesMaxHeight(1000)).toBe(600);
      expect(await openNotesMaxHeight(400)).toBe(160);
      expect(await openNotesMaxHeight(300)).toBe(120);
    } finally {
      setWindowHeight(812);
    }
  });

  it("keeps the open notes mounted when marking them seen hides the banner", async () => {
    mockStoredVersion("1.0.0");
    let finishSave: () => void = () => undefined;
    Unifier.storage.setItem = mock(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve;
        })
    );
    const {findByTestId, getByTestId, queryByTestId} = renderWithTheme(
      <WhatsNewBanner releases={RELEASES} storageKey={STORAGE_KEY} />
    );
    const openButton = await findByTestId("whats-new-banner-open-button");
    await act(async () => {
      fireEvent.press(openButton);
    });
    const notesWhileBannerShown = getByTestId("whats-new-banner-notes");

    await act(async () => {
      finishSave();
    });

    await waitFor(() => {
      expect(queryByTestId("whats-new-banner")).toBeNull();
    });
    expect(getByTestId("whats-new-banner-notes")).toBe(notesWhileBannerShown);
  });
});
