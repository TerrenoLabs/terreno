import {APIError} from "@terreno/api";
import type express from "express";

import type {ObservabilityGenerateClient, ObservabilityRequestAiServiceFactory} from "../types";

const MISSING_AI_SERVICE_TITLE =
  "No AI service is available. Configure ObservabilityApp.aiService or provide an AI API key.";

export interface ResolveRequestAiServiceOptions {
  aiService?: ObservabilityGenerateClient;
  modelId?: string;
  req: express.Request;
  requestAiServiceFactory?: ObservabilityRequestAiServiceFactory;
}

/**
 * Prefer the server-wide client, then let the host build one from the caller's
 * `x-ai-api-key` header so admins can run AI routes with their own provider key.
 */
export const resolveRequestAiService = ({
  aiService,
  modelId,
  req,
  requestAiServiceFactory,
}: ResolveRequestAiServiceOptions): ObservabilityGenerateClient => {
  const resolved =
    aiService ??
    requestAiServiceFactory?.({
      apiKey: req.header("x-ai-api-key"),
      modelId,
    });
  if (!resolved) {
    throw new APIError({status: 503, title: MISSING_AI_SERVICE_TITLE});
  }
  return resolved;
};
