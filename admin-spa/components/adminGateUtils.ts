import {sanitizeReturnTo} from "../src/returnTo";
import {isSignedInOnlyRoute} from "../src/signedInOnlyRoutes";

export {isSignedInOnlyRoute, sanitizeReturnTo};

interface IsForbiddenAdminConfigErrorOptions {
  error: unknown;
  isAuthenticated: boolean;
  isConfigLoading: boolean;
  status?: number;
}

export const isForbiddenAdminConfigError = ({
  error,
  isAuthenticated,
  isConfigLoading,
  status,
}: IsForbiddenAdminConfigErrorOptions): boolean => {
  if (!isAuthenticated) {
    return false;
  }
  if (isConfigLoading) {
    return false;
  }
  if (!error) {
    return false;
  }
  return status === 403;
};

/** Build "/path?a=b" from a router pathname and its search params. */
export const buildRoutePath = ({
  params,
  pathname,
}: {
  params: Record<string, string | string[] | undefined>;
  pathname: string;
}): string => {
  const search = new URLSearchParams();
  for (const key of Object.keys(params).sort()) {
    const value = params[key];
    const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
    for (const item of values) {
      search.append(key, item);
    }
  }
  const query = search.toString();
  return query ? `${pathname}?${query}` : pathname;
};

/** Login URL that brings the user back to `returnTo` after signing in. */
const buildLoginHref = (returnTo: string | undefined): string => {
  const safeReturnTo = sanitizeReturnTo(returnTo);
  if (!safeReturnTo) {
    return "/login";
  }
  return `/login?returnTo=${encodeURIComponent(safeReturnTo)}`;
};

export type AdminGateDecision =
  | {kind: "loading"}
  | {kind: "render"}
  | {kind: "redirect"; target: string; render: boolean};

interface ResolveAdminGateOptions {
  currentPath: string;
  isAdmin: boolean;
  isAuthenticated: boolean;
  isAuthLoading: boolean;
  isConfigLoading: boolean;
  isForbidden: boolean;
  pathname: string;
  returnTo: unknown;
  status?: number;
}

/**
 * The gate's whole decision as data: what to render and where to send the browser.
 * `redirect.render` says whether the current route may render while the redirect runs.
 */
export const resolveAdminGate = ({
  currentPath,
  isAdmin,
  isAuthenticated,
  isAuthLoading,
  isConfigLoading,
  isForbidden,
  pathname,
  returnTo,
  status,
}: ResolveAdminGateOptions): AdminGateDecision => {
  if (isAuthLoading) {
    return {kind: "loading"};
  }

  // Signed-in-only routes ignore /admin/config entirely: a non-admin's 403 never clears, and a
  // stale pre-login 401 would otherwise bounce the user back to login.
  if (isSignedInOnlyRoute(pathname)) {
    if (!isAuthenticated) {
      return {kind: "redirect", render: false, target: buildLoginHref(currentPath)};
    }
    return {kind: "render"};
  }

  if (!isAuthenticated || status === 401) {
    if (pathname === "/login") {
      return {kind: "render"};
    }
    return {kind: "redirect", render: false, target: "/login"};
  }

  // Signed in on /login with somewhere to go back to: go there, admin or not.
  const safeReturnTo = sanitizeReturnTo(returnTo);
  if (pathname === "/login" && safeReturnTo) {
    return {kind: "redirect", render: false, target: safeReturnTo};
  }

  if (isForbidden) {
    if (pathname === "/forbidden") {
      return {kind: "render"};
    }
    return {kind: "redirect", render: false, target: "/forbidden"};
  }
  if (isAdmin && (pathname === "/login" || pathname === "/forbidden")) {
    return {kind: "redirect", render: true, target: "/"};
  }
  if (isConfigLoading) {
    return {kind: "loading"};
  }
  return {kind: "render"};
};
