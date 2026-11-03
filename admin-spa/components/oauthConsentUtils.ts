/** Why the consent screen cannot show Approve / Deny. */
export type ConsentErrorKind = "decided" | "error" | "expired" | "notFound" | "signedOut";

const MCP_OAUTH_EXPIRED_CODE = "mcp-oauth-request-expired";

interface RequestErrorLike {
  data?: {code?: unknown; title?: unknown};
  status?: unknown;
}

/** Map a request client error from the consent endpoints to the state the screen shows. */
export const consentErrorKind = (error: unknown): ConsentErrorKind => {
  if (!error || typeof error !== "object") {
    return "error";
  }
  const {data, status} = error as RequestErrorLike;
  if (status === 404) {
    return "notFound";
  }
  if (status === 409) {
    return "decided";
  }
  if (status === 401) {
    return "signedOut";
  }
  if (status === 400 && data?.code === MCP_OAUTH_EXPIRED_CODE) {
    return "expired";
  }
  if (status === 400 && data?.title === "Authorization request expired") {
    return "expired";
  }
  return "error";
};

export const CONSENT_ERROR_COPY: Record<ConsentErrorKind, {message: string; title: string}> = {
  decided: {
    message:
      "This request was already approved or denied. Start the connection again from your app.",
    title: "Request already decided",
  },
  error: {
    message: "Something went wrong loading or deciding this request. Try again.",
    title: "Could not complete the request",
  },
  expired: {
    message: "Authorization requests expire after a few minutes. Start the connection again.",
    title: "Request expired",
  },
  notFound: {
    message: "This authorization request does not exist. Check the link or start again.",
    title: "Request not found",
  },
  signedOut: {
    message: "Your session ended, or this browser cannot decide this request. Sign in again.",
    title: "Sign in required",
  },
};

/** Read the `request` query param, accepting only a single non-empty value. */
export const readConsentRequestId = (value: unknown): string | undefined => {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

/** Scopes as a list for display; an empty or missing scope means the server default. */
export const parseConsentScopes = (scope: string | null | undefined): string[] => {
  if (!scope) {
    return [];
  }
  return scope.split(/\s+/).filter(Boolean);
};
