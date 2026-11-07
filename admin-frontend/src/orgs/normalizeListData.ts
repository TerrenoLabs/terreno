/**
 * List hooks unwrap `{data}` for responses without pagination metadata (`more`), so
 * they may receive a bare array; other endpoints keep the JSON API envelope.
 */
export type ListQueryData<T> = T[] | {data?: T[]} | undefined;

export const normalizeListData = <T>(data: ListQueryData<T>): T[] => {
  if (Array.isArray(data)) {
    return data;
  }
  return data?.data ?? [];
};
