export const parseNameValuePairs = (raw: string[]): Record<string, string> => {
  const params: Record<string, string> = {};
  for (const item of raw) {
    const eq = item.indexOf("=");
    if (eq <= 0) {
      throw new Error(`Expected name=value, got "${item}"`);
    }
    params[item.slice(0, eq)] = item.slice(eq + 1);
  }
  return params;
};

export const parseHeaderFlags = (raw: string[]): Record<string, string> => {
  const headers: Record<string, string> = {};
  for (const item of raw) {
    const sep = item.indexOf(":");
    if (sep <= 0) {
      throw new Error(`Expected "Name: value", got "${item}"`);
    }
    headers[item.slice(0, sep).trim()] = item.slice(sep + 1).trim();
  }
  return headers;
};

export const parseJsonValue = (raw?: string): unknown => {
  if (raw === undefined) {
    return undefined;
  }
  return JSON.parse(raw);
};
