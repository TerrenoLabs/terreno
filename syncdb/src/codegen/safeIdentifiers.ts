const TS_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
/** One path segment of a collection tag; tags derived from nested route paths join segments with `/`. */
const SYNC_COLLECTION = /^[A-Za-z0-9][A-Za-z0-9_-]*(?:\/[A-Za-z0-9][A-Za-z0-9_-]*)*$/;

export const assertTsIdentifier = ({label, value}: {label: string; value: string}): string => {
  if (!TS_IDENTIFIER.test(value)) {
    throw new Error(`Invalid ${label}: ${JSON.stringify(value)} is not a TypeScript identifier`);
  }
  return value;
};

/**
 * Sync collection tags may use hyphens (e.g. notification-preferences) and `/`-separated
 * segments (e.g. gpt/histories, from the `/gpt/histories` route path) but must be safe in
 * JSON strings.
 */
export const assertSyncCollectionName = ({
  label,
  value,
}: {
  label: string;
  value: string;
}): string => {
  if (!SYNC_COLLECTION.test(value)) {
    throw new Error(
      `Invalid ${label}: ${JSON.stringify(value)} is not a valid sync collection name`
    );
  }
  return value;
};

export const emitTsString = (value: string): string => JSON.stringify(value);

export const emitTsPropertyKey = (key: string): string => {
  if (TS_IDENTIFIER.test(key)) {
    return key;
  }
  return JSON.stringify(key);
};
