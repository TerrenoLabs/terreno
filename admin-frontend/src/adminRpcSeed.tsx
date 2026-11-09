import type React from "react";
import {createContext, useContext, useMemo} from "react";

const ORGANIZATION_HEADER = "x-organization-id";

/** Read the `X-Organization-Id` value from any `HeadersInit` form, case-insensitively. */
const readOrganizationHeader = (headers?: HeadersInit): string | undefined => {
  if (!headers) {
    return undefined;
  }
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    return headers.get(ORGANIZATION_HEADER) ?? undefined;
  }
  const entries: Array<[string, string]> = Array.isArray(headers)
    ? (headers as Array<[string, string]>)
    : Object.entries(headers as Record<string, string>);
  const match = entries.find(([name]) => name.toLowerCase() === ORGANIZATION_HEADER);
  return match?.[1];
};

/**
 * Seed key for one `useAdminRpcQuery` request: the exact `url` (query string included) plus the
 * `X-Organization-Id` the hook sends. A body fetched under one organization scope, or under none,
 * never satisfies a hook that asks with another. Other headers do not change the key.
 */
export const adminRpcSeedKey = (url: string, headers?: HeadersInit): string => {
  const organizationId = readOrganizationHeader(headers);
  if (organizationId === undefined) {
    return url;
  }
  return `${url}\u0000${ORGANIZATION_HEADER}=${organizationId}`;
};

const AdminRpcSeedContext = createContext<Readonly<Record<string, unknown>>>({});

export interface AdminRpcSeedProps {
  children?: React.ReactNode;
  /** Response bodies keyed by `adminRpcSeedKey(url, headers)`. */
  data: Readonly<Record<string, unknown>>;
}

/**
 * Initial data for `useAdminRpcQuery`, typically server-rendered loader data. A query whose seed
 * key matches renders the seed on its first render and skips its first fetch. Seeds nest: inner
 * seeds merge over outer ones. Independent of `AdminProvider`.
 */
export const AdminRpcSeed: React.FC<AdminRpcSeedProps> = ({children, data}) => {
  const outer = useContext(AdminRpcSeedContext);
  const merged = useMemo(() => ({...outer, ...data}), [outer, data]);
  return <AdminRpcSeedContext.Provider value={merged}>{children}</AdminRpcSeedContext.Provider>;
};

export interface AdminRpcSeedMatch {
  found: boolean;
  value: unknown;
}

/** @internal The nearest seed for `key`, or `{found: false}`. */
export const useAdminRpcSeedMatch = (key: string): AdminRpcSeedMatch => {
  const seeds = useContext(AdminRpcSeedContext);
  if (!Object.hasOwn(seeds, key)) {
    return {found: false, value: undefined};
  }
  return {found: true, value: seeds[key]};
};
