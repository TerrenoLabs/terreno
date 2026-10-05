/** How to cover rows [start, start + count) with modelRouter `page`/`limit` requests. */
export interface RangePlan {
  /** `limit` sent with every request. */
  chunk: number;
  /** `page` of the first request (1-based). */
  firstPage: number;
  /** Sequential requests needed. */
  requests: number;
  /** Leading rows of the first request that precede `start` and are dropped. */
  offset: number;
}

/**
 * modelRouter pages by `skip = (page - 1) * limit`, so a request can only start
 * on a multiple of its own `limit`. One exact request is used when the range
 * fits under `cap` and is aligned; otherwise requests of `cap` rows start at the
 * aligned page containing `start`, and the leading/trailing extra rows are trimmed.
 */
export const planRange = ({
  start,
  count,
  cap,
}: {
  start: number;
  count: number;
  cap: number;
}): RangePlan => {
  if (count <= cap && start % count === 0) {
    return {chunk: count, firstPage: start / count + 1, offset: 0, requests: 1};
  }
  const chunk = Math.min(cap, count);
  const alignedStart = Math.floor(start / chunk) * chunk;
  return {
    chunk,
    firstPage: alignedStart / chunk + 1,
    offset: start - alignedStart,
    requests: Math.ceil((start + count - alignedStart) / chunk),
  };
};
