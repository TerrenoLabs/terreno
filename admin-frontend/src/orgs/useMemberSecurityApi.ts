import {useCallback, useMemo, useState} from "react";
import type {AdminRpc} from "../adminRpc";
import {useAdminRpc, useAdminRpcQuery} from "../useAdminRpc";

/** One recovery action from the security summary (`GET .../security` `actions`). */
export interface MemberSecurityAction {
  destructive: boolean;
  id: string;
  label: string;
  /** HTTP method, when the server sends it. Known actions and the fallback (`POST`) cover its absence. */
  method?: string;
  /** Path under `.../security`, such as `/passkeys/:passkeyId`, when the server sends it. */
  path?: string;
}

/** The body of `GET /users/:id/security` and `GET /orgs/:orgId/members/:userId/security`. */
export interface MemberSecuritySummary {
  actions: MemberSecurityAction[];
  betterAuthLinked: boolean;
  disabled: boolean;
  emailVerified: boolean;
  lastSignIn: {at: string | null; method: string | null};
  legacyPassword: boolean;
  passkeys: {count: number; items: {createdAt: string | null; id: string; name: string | null}[]};
  password: boolean;
  providers: {linkedAt: string | null; providerId: string}[];
  sessions: {active: number};
  twoFactor: {backupCodesRemaining: number | null; enabled: boolean};
  userId: string;
}

/** What an action route answers inside `{data}`: the action id, whether it changed anything, and extras. */
export interface MemberSecurityActionResult {
  [key: string]: unknown;
  action: string;
  changed: boolean;
}

export interface MemberSecurityRequest {
  method: string;
  path: string;
}

/** Method and path of the built-in actions, for servers whose summary does not carry them. */
const KNOWN_ACTION_ROUTES: Record<string, MemberSecurityRequest> = {
  disable: {method: "POST", path: "/disable"},
  enable: {method: "POST", path: "/enable"},
  "issue-sign-in-link": {method: "POST", path: "/issue-sign-in-link"},
  "remove-passkey": {method: "DELETE", path: "/passkeys/:passkeyId"},
  "reset-two-factor": {method: "POST", path: "/reset-two-factor"},
  "revoke-sessions": {method: "POST", path: "/revoke-sessions"},
  "send-password-reset": {method: "POST", path: "/send-password-reset"},
  "suspend-membership": {method: "POST", path: "/suspend-membership"},
  "unlink-provider": {method: "DELETE", path: "/accounts/:providerId"},
};

/**
 * The security base path for a user: `{baseURL}/{orgId}/members/{userId}/security` under an
 * organization (`baseURL` defaults to `/orgs`), otherwise `{baseURL}/{userId}/security`
 * (`baseURL` defaults to `/users`).
 */
export const memberSecurityPath = ({
  baseURL,
  orgId,
  userId,
}: {
  baseURL?: string;
  orgId?: string;
  userId: string;
}): string => {
  const user = encodeURIComponent(userId);
  if (orgId) {
    return `${baseURL ?? "/orgs"}/${encodeURIComponent(orgId)}/members/${user}/security`;
  }
  return `${baseURL ?? "/users"}/${user}/security`;
};

/**
 * Method and path for an action: the server's own `method`/`path` when sent, else the built-in
 * route, else `POST /{id}` (the convention every parameterless action follows).
 */
const resolveSecurityActionRoute = (action: MemberSecurityAction): MemberSecurityRequest => {
  const known = KNOWN_ACTION_ROUTES[action.id];
  return {
    method: (action.method ?? known?.method ?? "POST").toUpperCase(),
    path: action.path ?? known?.path ?? `/${action.id}`,
  };
};

/** Path params (`:passkeyId`) an action's path needs. */
export const securityActionParams = (action: MemberSecurityAction): string[] => {
  const {path} = resolveSecurityActionRoute(action);
  return Array.from(path.matchAll(/:([A-Za-z0-9_]+)/g), (match) => match[1] ?? "");
};

/** Fills `:param` segments from `params`; throws when one is missing so no request hits a literal `:param`. */
export const resolveSecurityActionRequest = ({
  action,
  params = {},
}: {
  action: MemberSecurityAction;
  params?: Record<string, string>;
}): MemberSecurityRequest => {
  const route = resolveSecurityActionRoute(action);
  const path = route.path.replace(/:([A-Za-z0-9_]+)/g, (_segment, name: string) => {
    const value = params[name];
    if (!value) {
      throw new Error(`${action.id} needs ${name}`);
    }
    return encodeURIComponent(value);
  });
  return {method: route.method, path};
};

const unwrapData = <T>(body: unknown): T => {
  if (body && typeof body === "object" && "data" in body) {
    return (body as {data: T}).data;
  }
  return body as T;
};

export interface UseMemberSecurityApiArgs {
  /** Route prefix: defaults to `/orgs` with `orgId`, `/users` without. */
  baseURL?: string;
  /** Organization id for the org-admin routes. Omit for the platform `/users/:id/security` routes. */
  orgId?: string;
  userId: string;
}

export interface UseMemberSecurityApiResult {
  error: unknown;
  isFetching: boolean;
  isLoading: boolean;
  isRunning: boolean;
  refetch: () => void;
  runAction: (args: {
    action: MemberSecurityAction;
    params?: Record<string, string>;
  }) => Promise<MemberSecurityActionResult>;
  securityPath: string;
  summary: MemberSecuritySummary | undefined;
}

/**
 * Reads a user's security summary and runs its recovery actions through the host-bound
 * `adminRequest` (AdminProvider `credentials` / `getAuthHeaders`), against either the org-admin
 * prefix or the platform prefix.
 */
export const useMemberSecurityApi = ({
  baseURL,
  orgId,
  userId,
}: UseMemberSecurityApiArgs): UseMemberSecurityApiResult => {
  const rpc: AdminRpc | undefined = useAdminRpc();
  const securityPath = useMemo(
    () => memberSecurityPath({baseURL, orgId, userId}),
    [baseURL, orgId, userId]
  );
  const query = useAdminRpcQuery<unknown>({rpc, skip: !userId, url: securityPath});
  const [isRunning, setIsRunning] = useState(false);
  const summary =
    query.data === undefined ? undefined : unwrapData<MemberSecuritySummary>(query.data);
  const error = query.error;

  const runAction = useCallback(
    async ({
      action,
      params,
    }: {
      action: MemberSecurityAction;
      params?: Record<string, string>;
    }): Promise<MemberSecurityActionResult> => {
      if (!rpc) {
        throw new Error("Admin RPC client is unavailable");
      }
      const request = resolveSecurityActionRequest({action, params});
      setIsRunning(true);
      try {
        const body = await rpc({method: request.method, url: `${securityPath}${request.path}`});
        return unwrapData<MemberSecurityActionResult>(body) ?? {action: action.id, changed: true};
      } finally {
        setIsRunning(false);
      }
    },
    [rpc, securityPath]
  );

  return {
    error,
    isFetching: query.isFetching,
    isLoading: query.isLoading,
    isRunning,
    refetch: query.refetch,
    runAction,
    securityPath,
    summary,
  };
};
