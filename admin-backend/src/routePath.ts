/** Normalize admin model route paths for collision detection (`/users` and `/users/` match). */
export const normalizeAdminRoutePath = (routePath: string): string => {
  if (!routePath) {
    return "/";
  }
  let path = routePath.trim();
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  if (path.length === 1) {
    return path;
  }
  // A loop instead of `/\/+$/` keeps trimming linear on long runs of slashes.
  let end = path.length;
  while (end > 0 && path[end - 1] === "/") {
    end -= 1;
  }
  return path.slice(0, end);
};
