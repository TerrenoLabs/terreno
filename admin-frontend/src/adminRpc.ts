import type {AdminRequestArgs} from "./adminRequest";

export type AdminRpc = (args: AdminRequestArgs) => Promise<unknown>;

export const withQueryString = ({
  params,
  url,
}: {
  params?: Record<string, unknown>;
  url: string;
}): string => {
  if (!params) {
    return url;
  }
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    // A list repeats the key (`prompt=a&prompt=b`), which Express parses back into an array.
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (entry !== undefined && entry !== null && entry !== "") {
          search.append(key, String(entry));
        }
      }
      continue;
    }
    search.set(key, String(value));
  }
  const query = search.toString();
  if (!query) {
    return url;
  }
  return `${url}?${query}`;
};

export const asJsonBody = (value: object): Record<string, unknown> => {
  return value as Record<string, unknown>;
};
