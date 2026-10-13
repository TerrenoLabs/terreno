import {Image} from "react-native";

/**
 * Metro bundles an image as `{uri}` (or a URL string) on web and as a numeric asset id on native.
 * Test runners wrap it in `{default}`.
 */
export const assetUri = (
  asset: unknown,
  resolveNativeAsset: (id: number) => string | undefined = (id) =>
    Image.resolveAssetSource?.(id)?.uri
): string | undefined => {
  if (typeof asset === "string") {
    return asset;
  }
  if (typeof asset === "number") {
    return resolveNativeAsset(asset);
  }
  if (typeof asset === "object" && asset !== null) {
    const record = asset as {default?: unknown; uri?: unknown};
    if (typeof record.uri === "string") {
      return record.uri;
    }
    if (record.default !== undefined) {
      return assetUri(record.default, resolveNativeAsset);
    }
  }
  return undefined;
};
