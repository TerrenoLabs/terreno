import type React from "react";
import {useCallback, useMemo, useState} from "react";
import {useWindowDimensions} from "react-native";

import {BannerButton} from "./Banner";
import {Box} from "./Box";
import {DismissButton} from "./DismissButton";
import {Heading} from "./Heading";
import {MarkdownView} from "./MarkdownView";
import {Modal} from "./Modal";
import {Text} from "./Text";
import {useStoredState} from "./useStoredState";

const DEFAULT_STORAGE_KEY = "@TerrenoUI:whatsNew:lastSeenVersion";
/** Share of the window height the release notes may fill before they scroll. */
const NOTES_MAX_HEIGHT_RATIO = 0.6;

export interface WhatsNewRelease {
  /** Release version, for example "57.16.2". Identifies what the viewer has already seen. */
  version: string;
  /** ISO date (YYYY-MM-DD) the release shipped. */
  date?: string;
  /** Release notes as Markdown. */
  body: string;
}

export interface WhatsNewBannerProps {
  /** Releases ordered newest first. The first entry is the current release. */
  releases: WhatsNewRelease[];
  /**
   * Storage key holding the last version the viewer saw. Change it to keep separate
   * what's new histories (for example per product) on one device.
   * @default "@TerrenoUI:whatsNew:lastSeenVersion"
   */
  storageKey?: string;
  /**
   * Modal title above the release notes.
   * @default "What's new"
   */
  title?: string;
  /** Called when the viewer opens the release notes. */
  onOpen?: () => void;
  testID?: string;
}

/**
 * Returns the releases newer than `lastSeenVersion`, newest first. When the viewer has never
 * seen a release, or the last seen version is no longer listed, every release is unseen.
 */
export const getUnseenWhatsNewReleases = ({
  lastSeenVersion,
  releases,
}: {
  lastSeenVersion?: string;
  releases: WhatsNewRelease[];
}): WhatsNewRelease[] => {
  const lastSeenIndex = releases.findIndex((release) => release.version === lastSeenVersion);
  if (lastSeenIndex === -1) {
    return releases;
  }
  return releases.slice(0, lastSeenIndex);
};

/**
 * Non-blocking release notes banner. Shows "What's new in 57.16.2" (the latest version) until
 * the viewer opens or dismisses it, then stays hidden until a newer release is listed. Opening
 * it lists the notes of every release the viewer has not seen yet.
 */
export const WhatsNewBanner: React.FC<WhatsNewBannerProps> = ({
  releases,
  storageKey = DEFAULT_STORAGE_KEY,
  title = "What's new",
  onOpen,
  testID = "whats-new-banner",
}) => {
  const [lastSeenVersion, setLastSeenVersion, isLoading] = useStoredState<string>(storageKey);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [modalReleases, setModalReleases] = useState<WhatsNewRelease[]>([]);
  const {height: windowHeight} = useWindowDimensions();

  const unseenReleases = useMemo(
    () => getUnseenWhatsNewReleases({lastSeenVersion, releases}),
    [lastSeenVersion, releases]
  );
  const latestRelease = releases[0];

  const markLatestSeen = useCallback(async (): Promise<void> => {
    if (!latestRelease) {
      return;
    }
    await setLastSeenVersion(latestRelease.version);
  }, [latestRelease, setLastSeenVersion]);

  const handleOpen = useCallback(async (): Promise<void> => {
    // Snapshot the unseen list so marking it seen does not empty the open modal.
    setModalReleases(unseenReleases);
    setIsModalVisible(true);
    onOpen?.();
    await markLatestSeen();
  }, [markLatestSeen, onOpen, unseenReleases]);

  const handleCloseModal = useCallback((): void => {
    setIsModalVisible(false);
  }, []);

  const modal = (
    <Modal
      onDismiss={handleCloseModal}
      primaryButtonOnClick={handleCloseModal}
      primaryButtonText="Done"
      size="lg"
      testID={`${testID}-modal`}
      title={title}
      visible={isModalVisible}
    >
      <Box
        gap={4}
        maxHeight={Math.round(windowHeight * NOTES_MAX_HEIGHT_RATIO)}
        scroll
        testID={`${testID}-notes`}
      >
        {modalReleases.map((release) => (
          <Box gap={2} key={release.version} testID={`${testID}-release-${release.version}`}>
            <Heading size="sm">
              {release.date ? `${release.version} (${release.date})` : release.version}
            </Heading>
            <MarkdownView>{release.body}</MarkdownView>
          </Box>
        ))}
      </Box>
    </Modal>
  );

  if (isLoading || !latestRelease || unseenReleases.length === 0) {
    return isModalVisible ? modal : null;
  }

  const moreCount = unseenReleases.length - 1;
  const bannerText =
    moreCount > 0
      ? `What's new in ${latestRelease.version} and ${moreCount} earlier ${moreCount === 1 ? "release" : "releases"}`
      : `What's new in ${latestRelease.version}`;

  return (
    <Box
      alignItems="center"
      color="secondaryDark"
      direction="row"
      marginBottom={3}
      minHeight={8}
      padding={1}
      rounding="md"
      testID={testID}
      width="100%"
    >
      <Box alignItems="center" direction="row" flex="grow" justifyContent="center" paddingX={2}>
        <Text bold color="inverted" testID={`${testID}-text`}>
          {bannerText}
        </Text>
      </Box>
      <Box alignItems="center" direction="row" gap={2} paddingX={2}>
        <BannerButton
          buttonOnClick={handleOpen}
          buttonText="See what's new"
          testID={`${testID}-open-button`}
        />
        <Box testID={`${testID}-dismiss`}>
          <DismissButton
            accessibilityHint="Hides the what's new banner until the next release"
            accessibilityLabel="Dismiss what's new"
            color="inverted"
            onClick={markLatestSeen}
          />
        </Box>
      </Box>
      {modal}
    </Box>
  );
};
