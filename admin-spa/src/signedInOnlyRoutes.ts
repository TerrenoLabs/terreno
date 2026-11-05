/** Routes any signed-in user may open; they skip the admin check and admin bootstrapping. */
const SIGNED_IN_ONLY_ROUTES: readonly string[] = ["/oauth/consent"];

/** Whether a route path (`/oauth/consent`, trailing slashes ignored) is signed-in-only. */
export const isSignedInOnlyRoute = (pathname: string): boolean => {
  return SIGNED_IN_ONLY_ROUTES.includes(pathname.replace(/\/+$/, "") || "/");
};
