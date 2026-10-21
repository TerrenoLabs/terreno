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
