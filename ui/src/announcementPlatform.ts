import {Platform} from "react-native";
import {getAnnouncementBuildVersion} from "./announcementBuildVersion";

export type AnnouncementPlatform = "android" | "ios" | "web";

export const getAnnouncementPlatform = (): AnnouncementPlatform => {
  if (Platform.OS === "ios") {
    return "ios";
  }
  if (Platform.OS === "android") {
    return "android";
  }
  return "web";
};

/** `platform` and `version` query params the announcement routes filter by. */
export const buildAnnouncementParams = (): {platform: AnnouncementPlatform; version?: number} => {
  const version = getAnnouncementBuildVersion();
  return {
    platform: getAnnouncementPlatform(),
    ...(version === undefined ? {} : {version}),
  };
};
