import {APIError} from "@terreno/api";
import type express from "express";

/** Static switch, or a per-request check (for example a feature flag). */
export type FileUploadsEnabled = boolean | ((req: express.Request) => boolean | Promise<boolean>);

/**
 * Reject the request when file uploads are turned off.
 * Missing or `true` leaves uploads enabled.
 */
export const assertFileUploadsEnabled = async (
  req: express.Request,
  fileUploadsEnabled: FileUploadsEnabled | undefined
): Promise<void> => {
  if (fileUploadsEnabled === undefined || fileUploadsEnabled === true) {
    return;
  }
  const allowed =
    typeof fileUploadsEnabled === "function" ? await fileUploadsEnabled(req) : fileUploadsEnabled;
  if (!allowed) {
    throw new APIError({status: 403, title: "File uploads are disabled"});
  }
};
