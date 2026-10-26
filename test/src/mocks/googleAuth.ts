import {type Mock, mock} from "bun:test";

import {createMockGroup} from "./mockGroup";

export interface GoogleAuthMockRequestOptions {
  data?: unknown;
  method?: string;
  url: string;
  [key: string]: unknown;
}

export interface GoogleAuthMockResponse {
  data: unknown;
  headers: Record<string, string>;
  status: number;
}

export interface GoogleAuthMockClient {
  getAccessToken: GoogleAuthMock["getAccessToken"];
  getRequestHeaders: GoogleAuthMock["getRequestHeaders"];
  request: GoogleAuthMock["request"];
}

export interface GoogleAuthMockIdTokenPayload {
  aud?: string;
  email?: string;
  email_verified?: boolean;
  [key: string]: unknown;
}

export interface GoogleAuthMockTicket {
  getPayload: () => GoogleAuthMockIdTokenPayload;
}

export interface RegisterGoogleAuthMockOptions {
  /** Token `getAccessToken()` returns. Default `"mock-access-token"`. */
  accessToken?: string;
  /** Claims every verified ID token carries (merged with `aud`). Default: a verified email. */
  idTokenPayload?: GoogleAuthMockIdTokenPayload;
  /** Project id `getProjectId()` returns. Default `"mock-project"`. */
  projectId?: string;
}

export interface GoogleAuthMock {
  /** `new GoogleAuth(options)` — every instance shares `getClient`, `getAccessToken`, `request`. */
  GoogleAuth: Mock<
    (options?: Record<string, unknown>) => {
      getAccessToken: GoogleAuthMock["getAccessToken"];
      getClient: GoogleAuthMock["getClient"];
      getProjectId: GoogleAuthMock["getProjectId"];
      request: GoogleAuthMock["request"];
    }
  >;
  /** `new OAuth2Client(...)` — every instance shares `verifyIdToken`. */
  OAuth2Client: Mock<(...args: unknown[]) => {verifyIdToken: GoogleAuthMock["verifyIdToken"]}>;
  client: GoogleAuthMockClient;
  getAccessToken: Mock<() => Promise<{token: string}>>;
  getClient: Mock<() => Promise<GoogleAuthMockClient>>;
  getProjectId: Mock<() => Promise<string>>;
  getRequestHeaders: Mock<() => Promise<Record<string, string>>>;
  /** Authorized request — resolves `{data: {}, status: 200}`. Override per test. */
  request: Mock<(options: GoogleAuthMockRequestOptions) => Promise<GoogleAuthMockResponse>>;
  /** Accepts any token; the ticket's payload is `idTokenPayload` plus the requested audience. */
  verifyIdToken: Mock<
    (options: {audience?: string | string[]; idToken: string}) => Promise<GoogleAuthMockTicket>
  >;
  /** Clears calls and overrides. */
  reset: () => void;
}

/**
 * Registers `mock.module("google-auth-library", ...)` covering what Terreno calls: `GoogleAuth`
 * (`getClient().request` / `getAccessToken`, used by Vertex model discovery and the Cloud Tasks
 * REST client) and `OAuth2Client.verifyIdToken` (Cloud Tasks OIDC execute auth).
 */
export const registerGoogleAuthMock = (
  options: RegisterGoogleAuthMockOptions = {}
): GoogleAuthMock => {
  const accessToken = options.accessToken ?? "mock-access-token";
  const idTokenPayload = options.idTokenPayload ?? {
    email: "mock-service-account@mock-project.iam.gserviceaccount.com",
    email_verified: true,
  };
  const projectId = options.projectId ?? "mock-project";
  const group = createMockGroup();

  const getAccessToken = group.fn(async (): Promise<{token: string}> => ({token: accessToken}));
  const getRequestHeaders = group.fn(
    async (): Promise<Record<string, string>> => ({Authorization: `Bearer ${accessToken}`})
  );
  const request = group.fn(
    async (_options: GoogleAuthMockRequestOptions): Promise<GoogleAuthMockResponse> => ({
      data: {},
      headers: {},
      status: 200,
    })
  );
  const client: GoogleAuthMockClient = {getAccessToken, getRequestHeaders, request};
  const getClient = group.fn(async (): Promise<GoogleAuthMockClient> => client);
  const getProjectId = group.fn(async (): Promise<string> => projectId);
  const GoogleAuth = group.fn((_options?: Record<string, unknown>) => ({
    getAccessToken,
    getClient,
    getProjectId,
    request,
  }));

  const verifyIdToken = group.fn(
    async ({
      audience,
    }: {
      audience?: string | string[];
      idToken: string;
    }): Promise<GoogleAuthMockTicket> => {
      const aud = Array.isArray(audience) ? audience[0] : audience;
      return {getPayload: (): GoogleAuthMockIdTokenPayload => ({...idTokenPayload, aud})};
    }
  );
  const OAuth2Client = group.fn((..._args: unknown[]) => ({verifyIdToken}));

  const moduleExports = {GoogleAuth, OAuth2Client};
  mock.module("google-auth-library", () => ({...moduleExports, default: moduleExports}));

  return {
    client,
    GoogleAuth,
    getAccessToken,
    getClient,
    getProjectId,
    getRequestHeaders,
    OAuth2Client,
    request,
    reset: group.reset,
    verifyIdToken,
  };
};
