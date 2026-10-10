import {assetUri} from "./assetUri";

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

/** `resolveImage` for demo documents: a bundled photo's URI, or undefined for any other id. */
export const resolveBlocksPhoto = async (fileId: string): Promise<string | undefined> =>
  assetUri(PHOTO_MODULES[fileId]);
