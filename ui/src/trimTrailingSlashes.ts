/**
 * Drop trailing `/`s. A loop instead of `/\/+$/` keeps this linear on long runs of slashes.
 * Internal to @terreno/ui (not re-exported from the package root).
 */
export const trimTrailingSlashes = (value: string): string => {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") {
    end -= 1;
  }
  return value.slice(0, end);
};
