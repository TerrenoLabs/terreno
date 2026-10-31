/**
 * Reads `map[key]` only when `key` is one of the map's own entries. Codes and provider ids reach
 * the auth screens from URLs, device storage and the server, and a plain lookup would return
 * `Object.prototype` members for keys such as `__proto__`, `constructor` or `toString`, which
 * React cannot render.
 */
export const getOwnEntry = <Value>(
  map: Readonly<Record<string, Value>> | undefined,
  key: string
): Value | undefined => {
  if (!map || !Object.hasOwn(map, key)) {
    return undefined;
  }
  return map[key];
};
