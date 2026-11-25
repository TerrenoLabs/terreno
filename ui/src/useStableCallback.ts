import {useCallback, useLayoutEffect, useRef} from "react";

/**
 * Returns a function whose identity never changes but which always calls the newest
 * `callback`. Pass it to memoized children so an inline handler from the caller does not
 * re-render every child.
 */
export const useStableCallback = <Args extends unknown[], Result>(
  callback: (...args: Args) => Result
): ((...args: Args) => Result) => {
  const latestCallback = useRef(callback);

  // Point at the newest callback after every commit, before any event can fire.
  useLayoutEffect(() => {
    latestCallback.current = callback;
  });

  return useCallback((...args: Args): Result => latestCallback.current(...args), []);
};
