/**
 * Client ID Metadata Documents (CIMD): a client whose `client_id` is an https URL serving JSON
 * that lists its redirect URIs. Claude.ai's "Use Claude's published identity" is one. Only ids on
 * the app's allowlist are ever fetched, so a `client_id` can't point the server at another host.
 */
import {DateTime} from "luxon";

import type {McpOAuthMetadataDocumentClient} from "../types/mcpOAuth";
import {LOOPBACK_HOSTS, type McpOAuthMetadataFetch} from "./oauthMetadata";

/** The parts of a client metadata document the authorization server stores. */
type ClientMetadataDocument = McpOAuthMetadataDocumentClient;

export interface ClientMetadataDocumentResolver {
  /** Whether `clientId` is on the allowlist (an exact string match). */
  isAllowed: (clientId: string) => boolean;
  /**
   * Load and validate the document for an allowlisted id, from cache when a successful fetch is
   * under ten minutes old. Throws {@link ClientMetadataDocumentError} when it can't be used.
   */
  load: (clientId: string) => Promise<ClientMetadataDocument>;
}

/** Why a client metadata document could not be used. */
export class ClientMetadataDocumentError extends Error {}

const FETCH_TIMEOUT_MS = 5000;
const MAX_DOCUMENT_BYTES = 16 * 1024;
const CACHE_MINUTES = 10;
const MAX_CLIENT_NAME_LENGTH = 200;
const MAX_REDIRECT_URIS = 10;

/** Read at most `limit` bytes of the body, failing as soon as it is larger. */
const readCappedBody = async (response: Response, limit: number): Promise<string> => {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) {
    throw new ClientMetadataDocumentError("The client metadata document is too large");
  }
  if (!response.body) {
    return "";
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    let chunk: Awaited<ReturnType<typeof reader.read>>;
    try {
      chunk = await reader.read();
    } catch {
      // A body that stalls past the fetch timeout, or a dropped connection, lands here.
      throw new ClientMetadataDocumentError("The client metadata document could not be read");
    }
    const {done, value} = chunk;
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new ClientMetadataDocumentError("The client metadata document is too large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
};

/** A redirect URI a public client may use: https, or http on a loopback host; no fragment. */
const isUsableRedirectUri = (uri: string): boolean => {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return false;
  }
  if (parsed.hash) {
    return false;
  }
  return (
    parsed.protocol === "https:" ||
    (parsed.protocol === "http:" && LOOPBACK_HOSTS.has(parsed.hostname))
  );
};

const parseDocument = (clientId: string, text: string): ClientMetadataDocument => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ClientMetadataDocumentError("The client metadata document is not valid JSON");
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ClientMetadataDocumentError("The client metadata document is not a JSON object");
  }
  const document = raw as Record<string, unknown>;
  if (document.client_id !== clientId) {
    throw new ClientMetadataDocumentError(
      "The client metadata document's client_id does not match its URL"
    );
  }
  const redirectUris = document.redirect_uris;
  if (
    !Array.isArray(redirectUris) ||
    redirectUris.length === 0 ||
    redirectUris.length > MAX_REDIRECT_URIS ||
    !redirectUris.every((uri) => typeof uri === "string" && isUsableRedirectUri(uri))
  ) {
    throw new ClientMetadataDocumentError(
      `redirect_uris must list 1 to ${MAX_REDIRECT_URIS} https or loopback http URLs`
    );
  }
  const authMethod = document.token_endpoint_auth_method;
  if (authMethod !== undefined && authMethod !== "none") {
    throw new ClientMetadataDocumentError(
      "Only public clients are supported: token_endpoint_auth_method must be none"
    );
  }
  const clientName =
    typeof document.client_name === "string" && document.client_name.trim() !== ""
      ? document.client_name.slice(0, MAX_CLIENT_NAME_LENGTH)
      : undefined;
  return {clientId, clientName, redirectUris: redirectUris as string[]};
};

/**
 * Build a resolver for one app. Its cache lives with the resolver, so separate apps (and tests)
 * never share fetched documents. Failures are never cached.
 */
export const createClientMetadataDocumentResolver = ({
  allowedClientIds,
  fetch,
}: {
  allowedClientIds: string[];
  fetch: McpOAuthMetadataFetch;
}): ClientMetadataDocumentResolver => {
  const allowed = new Set(allowedClientIds);
  const cache = new Map<string, {document: ClientMetadataDocument; until: DateTime}>();

  const load = async (clientId: string): Promise<ClientMetadataDocument> => {
    if (!allowed.has(clientId)) {
      throw new ClientMetadataDocumentError("The client_id is not an allowed metadata document");
    }
    const cached = cache.get(clientId);
    if (cached && cached.until > DateTime.now()) {
      return cached.document;
    }
    let response: Response;
    try {
      response = await fetch(clientId, {
        headers: {accept: "application/json"},
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch {
      throw new ClientMetadataDocumentError("The client metadata document could not be fetched");
    }
    if (response.status !== 200) {
      throw new ClientMetadataDocumentError(
        `The client metadata document answered HTTP ${response.status}`
      );
    }
    const document = parseDocument(clientId, await readCappedBody(response, MAX_DOCUMENT_BYTES));
    cache.set(clientId, {document, until: DateTime.now().plus({minutes: CACHE_MINUTES})});
    return document;
  };

  return {isAllowed: (clientId) => allowed.has(clientId), load};
};
