import {beforeEach, describe, expect, it} from "bun:test";
import {FeatureFlag} from "@terreno/feature-flags";

import {areFileUploadsEnabledForUser, FILE_UPLOADS_FLAG_KEY} from "./fileUploads";

describe("areFileUploadsEnabledForUser", () => {
  beforeEach(async () => {
    await FeatureFlag.deleteMany({key: FILE_UPLOADS_FLAG_KEY});
  });

  it("stays enabled when the flag does not exist", async () => {
    expect(await areFileUploadsEnabledForUser({_id: "user-1"})).toBe(true);
  });

  it("disables uploads when the flag is turned off", async () => {
    await FeatureFlag.create({
      description: "uploads",
      enabled: false,
      key: FILE_UPLOADS_FLAG_KEY,
      name: "File Uploads",
      rules: [],
      type: "boolean",
    });
    expect(await areFileUploadsEnabledForUser({_id: "user-1"})).toBe(false);
  });

  it("enables uploads when the flag is on for everyone", async () => {
    await FeatureFlag.create({
      defaultVariant: "on",
      description: "uploads",
      enabled: true,
      key: FILE_UPLOADS_FLAG_KEY,
      name: "File Uploads",
      rolloutPercentage: 100,
      rules: [],
      type: "boolean",
    });
    expect(await areFileUploadsEnabledForUser({_id: "user-1"})).toBe(true);
  });
});
