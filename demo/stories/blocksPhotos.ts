import {Image} from "react-native";

/**
 * Public-domain food photos bundled with the demo (see assets/blocks/ATTRIBUTION.md). Block
 * documents name them as `file:<name>` and `resolveBlocksPhoto` turns the name into a URI, the
 * way a host's `resolveImage` turns an uploaded file id into a URL.
 */
const PHOTO_MODULES: Record<string, unknown> = {
  "apple-crumble": require("../assets/blocks/apple-crumble.jpg"),
  "dinner-table": require("../assets/blocks/dinner-table.jpg"),
  greens: require("../assets/blocks/greens.jpg"),
  "roast-lamb": require("../assets/blocks/roast-lamb.jpg"),
  "roast-plate": require("../assets/blocks/roast-plate.jpg"),
  "roast-potatoes": require("../assets/blocks/roast-potatoes.jpg"),
  "roasted-carrots": require("../assets/blocks/roasted-carrots.jpg"),
};

/**
 * Metro bundles an image as `{uri}` (or a URL string) on web and as a numeric asset id on native.
 * Test runners wrap it in `{default}`.
 */
const assetUri = (asset: unknown): string | undefined => {
  if (typeof asset === "string") {
    return asset;
  }
  if (typeof asset === "number") {
    return Image.resolveAssetSource?.(asset)?.uri;
  }
  if (typeof asset === "object" && asset !== null) {
    const record = asset as {default?: unknown; uri?: unknown};
    if (typeof record.uri === "string") {
      return record.uri;
    }
    if (record.default !== undefined) {
      return assetUri(record.default);
    }
  }
  return undefined;
};

/** `resolveImage` for demo documents: a bundled photo's URI, or undefined for any other id. */
export const resolveBlocksPhoto = async (fileId: string): Promise<string | undefined> =>
  assetUri(PHOTO_MODULES[fileId]);
