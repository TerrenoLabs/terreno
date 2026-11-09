import {describe, expect, it} from "bun:test";
import {readdirSync} from "node:fs";
import {join} from "node:path";

import {resolveBlocksPhoto} from "./blocksPhotos";

/** The photos bundled in demo/assets/blocks, by file name without `.jpg`. */
const BUNDLED_PHOTO_IDS = readdirSync(join(import.meta.dir, "..", "assets", "blocks"))
  .filter((file) => file.endsWith(".jpg"))
  .map((file) => file.replace(/\.jpg$/, ""))
  .sort();

describe("resolveBlocksPhoto", () => {
  it("resolves every bundled photo to a URI and leaves other ids unset", async () => {
    expect(BUNDLED_PHOTO_IDS).toEqual([
      "apple-crumble",
      "dinner-table",
      "greens",
      "roast-lamb",
      "roast-plate",
      "roast-potatoes",
      "roasted-carrots",
    ]);
    for (const id of BUNDLED_PHOTO_IDS) {
      expect(typeof (await resolveBlocksPhoto(id))).toBe("string");
    }
    expect(await resolveBlocksPhoto("missing-photo")).toBeUndefined();
  });
});
