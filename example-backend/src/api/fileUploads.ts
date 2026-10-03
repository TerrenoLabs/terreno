import {evaluateFlag, FeatureFlag, type SegmentFunction} from "@terreno/feature-flags";
import type express from "express";

import {exampleFeatureFlagSegments} from "../featureFlagSegments";

/** Boolean feature flag that turns user file uploads on and off. */
export const FILE_UPLOADS_FLAG_KEY = "file-uploads";

/**
 * Whether this user may upload files.
 * A missing flag stays enabled so existing apps keep working until the flag is created.
 * `enabled: false`, or a boolean evaluation of false, disables uploads.
 */
export const areFileUploadsEnabledForUser = async (
  user: unknown,
  segments: Record<string, SegmentFunction> = exampleFeatureFlagSegments
): Promise<boolean> => {
  const flag = await FeatureFlag.findOneOrNone({
    archived: {$ne: true},
    key: FILE_UPLOADS_FLAG_KEY,
  });
  if (flag?.type !== "boolean") {
    return true;
  }
  const record = user as {_id?: unknown; id?: string} | undefined;
  const userId = String(record?._id ?? record?.id ?? "");
  return evaluateFlag(flag, userId, user, segments) === true;
};

export const fileUploadsEnabledForRequest = (req: express.Request): Promise<boolean> =>
  areFileUploadsEnabledForUser(req.user);
