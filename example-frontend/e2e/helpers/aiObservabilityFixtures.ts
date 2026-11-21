import type {APIRequestContext} from "@playwright/test";
import {ADMIN_USER} from "../fixtures/testUsers";
import {getAdminToken, setUserAdmin} from "./adminAuth";

const API_URL = process.env.BACKEND_URL ?? "http://localhost:4000";

/**
 * The summary card's prompt and the feedback review evaluator come from the backend boot seed,
 * which e2e backends do not run (no SEED_DEFAULTS). Creates both through the admin API when
 * missing, so feedback specs work on a fresh database. Idempotent.
 */
export const ensureSummarizeFeedbackFixtures = async (
  request: APIRequestContext
): Promise<void> => {
  await setUserAdmin(ADMIN_USER.email);
  const headers = {authorization: `Bearer ${await getAdminToken(request)}`};

  const prompt = await request.get(`${API_URL}/ai/observability/prompts/example-summarize`, {
    headers,
  });
  if (prompt.status() === 404) {
    const created = await request.post(`${API_URL}/ai/observability/prompts`, {
      data: {
        folder: "examples",
        name: "example-summarize",
        system: "Write one faithful, concise sentence that preserves the source meaning.",
        template: "Summarize the following text:\n\n{{text}}",
        type: "chat",
      },
      headers,
    });
    // Another worker may have created it first; that is fine as long as it now exists.
    if (!created.ok()) {
      const again = await request.get(`${API_URL}/ai/observability/prompts/example-summarize`, {
        headers,
      });
      if (!again.ok()) {
        throw new Error(`Creating example-summarize failed: ${await created.text()}`);
      }
    }
    const labelled = await request.post(
      `${API_URL}/ai/observability/prompts/example-summarize/labels`,
      {data: {label: "production", version: 1}, headers}
    );
    if (!labelled.ok()) {
      throw new Error(`Labelling example-summarize failed: ${await labelled.text()}`);
    }
  }

  const evaluators = await request.get(`${API_URL}/ai/observability/evaluators`, {headers});
  const rows = ((await evaluators.json()) as {data?: Array<{name?: string}>}).data ?? [];
  if (!rows.some((row) => row.name === "correctness-human")) {
    const installed = await request.post(
      `${API_URL}/ai/observability/evaluators/templates/correctness-human`,
      {headers}
    );
    if (!installed.ok()) {
      const again = await request.get(`${API_URL}/ai/observability/evaluators`, {headers});
      const nowRows = ((await again.json()) as {data?: Array<{name?: string}>}).data ?? [];
      if (!nowRows.some((row) => row.name === "correctness-human")) {
        throw new Error(`Installing correctness-human failed: ${await installed.text()}`);
      }
    }
  }
};
