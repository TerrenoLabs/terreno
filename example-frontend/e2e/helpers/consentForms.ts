import type {APIRequestContext} from "@playwright/test";

const API_URL = process.env.BACKEND_URL ?? "http://localhost:4000";

export const createConsentForm = async (
  request: {
    post: (
      url: string,
      options?: Record<string, unknown>
    ) => Promise<{ok: () => boolean; json: () => Promise<Record<string, unknown>>}>;
  },
  token: string,
  options?: {checkboxes?: Array<{label: string; required: boolean}>}
): Promise<string> => {
  const slug = `e2e-test-consent-${Date.now()}`;
  const res = await request.post(`${API_URL}/consent-forms`, {
    data: {
      active: true,
      agreeButtonText: "I Agree",
      allowDecline: true,
      captureSignature: false,
      content: {en: "This is an E2E test consent form. Please agree to continue."},
      declineButtonText: "I Decline",
      defaultLocale: "en",
      order: 999,
      required: true,
      slug,
      title: "E2E Test Consent",
      type: "custom",
      version: 1,
      ...(options?.checkboxes ? {checkboxes: options.checkboxes} : {}),
    },
    headers: {authorization: `Bearer ${token}`},
  });
  if (!res.ok()) {
    throw new Error(`Failed to create consent form: ${JSON.stringify(await res.json())}`);
  }
  const body = (await res.json()) as {data?: {_id?: string}};
  return body?.data?._id ?? "";
};

export const deleteConsentForm = async (
  request: {
    delete: (url: string, options?: Record<string, unknown>) => Promise<{ok: () => boolean}>;
  },
  token: string,
  formId: string
): Promise<void> => {
  await request.delete(`${API_URL}/consent-forms/${formId}`, {
    headers: {authorization: `Bearer ${token}`},
  });
};

/**
 * Agrees to every consent form pending for the user the bearer `token` belongs to, on the API at
 * `apiUrl` (default `BACKEND_URL`, or the local backend).
 */
export const acceptPendingConsentForms = async (
  request: APIRequestContext,
  token: string,
  {apiUrl = API_URL}: {apiUrl?: string} = {}
): Promise<void> => {
  const pendingRes = await request.get(`${apiUrl}/consents/pending`, {
    headers: {authorization: `Bearer ${token}`},
  });
  if (!pendingRes.ok()) {
    return;
  }
  const pendingData = await pendingRes.json();
  const forms: Array<{_id: string; captureSignature?: boolean}> = pendingData?.data ?? [];

  for (const form of forms) {
    await request.post(`${apiUrl}/consents/respond`, {
      data: {
        agreed: true,
        consentFormId: form._id,
        locale: "en",
        ...(form.captureSignature ? {signature: "Test User"} : {}),
      },
      headers: {authorization: `Bearer ${token}`},
    });
  }
};

const authHeaders = (token: string): Record<string, string> => ({authorization: `Bearer ${token}`});

/** The app user id behind a bearer token. */
export const getUserIdForToken = async (
  request: APIRequestContext,
  token: string,
  {apiUrl = API_URL}: {apiUrl?: string} = {}
): Promise<string> => {
  const res = await request.get(`${apiUrl}/auth/me`, {headers: authHeaders(token)});
  if (!res.ok()) {
    throw new Error(`Failed to load /auth/me: ${res.status()}`);
  }
  const body = (await res.json()) as {data?: {_id?: string; id?: string}};
  const userId = body.data?._id ?? body.data?.id;
  if (!userId) {
    throw new Error("/auth/me returned no user id");
  }
  return userId;
};

/**
 * Create (once) an RBAC role granting consentResponse:signOnBehalf and assign it to `userId`.
 * `adminToken` must belong to a user who can manage and assign roles (superadmin).
 */
export const grantConsentSignerRole = async (
  request: APIRequestContext,
  adminToken: string,
  userId: string,
  {apiUrl = API_URL, roleName = "e2e-consent-signer"}: {apiUrl?: string; roleName?: string} = {}
): Promise<void> => {
  const listRes = await request.get(`${apiUrl}/rbac/roles`, {headers: authHeaders(adminToken)});
  if (!listRes.ok()) {
    throw new Error(`Failed to list roles: ${listRes.status()} ${await listRes.text()}`);
  }
  const roles = ((await listRes.json()) as {data?: Array<{name: string}>}).data ?? [];
  if (!roles.some((role) => role.name === roleName)) {
    const createRes = await request.post(`${apiUrl}/rbac/roles`, {
      data: {
        description: "E2E staff who record consent on a user's behalf",
        displayName: "E2E Consent Signer",
        name: roleName,
        permissions: {consentResponse: ["signOnBehalf"]},
      },
      headers: authHeaders(adminToken),
    });
    if (!createRes.ok()) {
      throw new Error(
        `Failed to create role ${roleName}: ${createRes.status()} ${await createRes.text()}`
      );
    }
  }
  const assignRes = await request.put(`${apiUrl}/rbac/users/${userId}/roles`, {
    data: {roleNames: [roleName]},
    headers: authHeaders(adminToken),
  });
  if (!assignRes.ok()) {
    throw new Error(
      `Failed to assign ${roleName}: ${assignRes.status()} ${await assignRes.text()}`
    );
  }
};

/** Record a provisional signature for `userId` as the signer behind `signerToken`; returns its id. */
export const signConsentProvisionally = async (
  request: APIRequestContext,
  signerToken: string,
  {
    apiUrl = API_URL,
    consentFormId,
    note,
    userId,
  }: {apiUrl?: string; consentFormId: string; note: string; userId: string}
): Promise<string> => {
  const res = await request.post(`${apiUrl}/consent-responses/provisional`, {
    data: {consentFormId, locale: "en", note, userId},
    headers: authHeaders(signerToken),
  });
  if (!res.ok()) {
    throw new Error(`Failed to sign provisionally: ${res.status()} ${await res.text()}`);
  }
  const body = (await res.json()) as {data?: {_id?: string}};
  return body.data?._id ?? "";
};

/** Agree to one consent form as the user behind `token`. */
export const agreeToConsentForm = async (
  request: APIRequestContext,
  token: string,
  consentFormId: string,
  {apiUrl = API_URL}: {apiUrl?: string} = {}
): Promise<void> => {
  const res = await request.post(`${apiUrl}/consents/respond`, {
    data: {agreed: true, consentFormId, locale: "en"},
    headers: authHeaders(token),
  });
  if (!res.ok()) {
    throw new Error(`Failed to respond to consent form: ${res.status()} ${await res.text()}`);
  }
};
