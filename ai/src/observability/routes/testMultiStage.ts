import {asyncHandler, createOpenApiBuilder} from "@terreno/api";
import type express from "express";
import type mongoose from "mongoose";
import {runTestMultiStageWorkflow} from "../testMultiStageWorkflow";
import type {
  ObservabilityGenerateClient,
  ObservabilityRequestAiServiceFactory,
  TraceRecord,
} from "../types";
import {
  type ObservabilityRouteAccessOptions,
  observabilityRouteMiddleware,
} from "./observabilityRouteAccess";
import {resolveRequestAiService} from "./requestAiService";

const BASE_PATH = "/ai/observability";

export interface ObservabilityTestMultiStageRouteOptions extends ObservabilityRouteAccessOptions {
  aiService?: ObservabilityGenerateClient;
  exportTrace: (trace: TraceRecord) => Promise<string | undefined>;
  requestAiServiceFactory?: ObservabilityRequestAiServiceFactory;
}

export const addObservabilityTestMultiStageRoutes = (
  router: express.Application,
  options: ObservabilityTestMultiStageRouteOptions
): void => {
  const openApiOptions = options.openApi ? {openApi: options.openApi} : {};
  const builder = (): ReturnType<typeof createOpenApiBuilder> => {
    return createOpenApiBuilder(openApiOptions as Parameters<typeof createOpenApiBuilder>[0]);
  };

  router.post(
    `${BASE_PATH}/traces/test-multi-stage`,
    observabilityRouteMiddleware(
      options.accessControl,
      {action: "read", resource: "aiTrace"},
      builder()
        .withTags(["observability"])
        .withSummary("Run a multi-stage observability workflow and export one nested trace")
        .withRequestBody({
          input: {type: "string"},
        })
        .withResponse(200, {
          data: {
            properties: {
              output: {
                properties: {
                  keywords: {items: {type: "string"}, type: "array"},
                  metrics: {type: "object"},
                  phrase: {type: "string"},
                  sentence: {type: "string"},
                },
                type: "object",
              },
              stages: {
                items: {
                  properties: {
                    name: {type: "string"},
                    status: {type: "string"},
                  },
                  type: "object",
                },
                type: "array",
              },
              traceId: {type: "string"},
            },
            type: "object",
          },
        })
        .withResponse(503, {title: {type: "string"}})
        .build()
    ),
    asyncHandler(async (req, res) => {
      const aiService = resolveRequestAiService({
        aiService: options.aiService,
        req,
        requestAiServiceFactory: options.requestAiServiceFactory,
      });
      const input =
        typeof req.body?.input === "string" && req.body.input.length > 0
          ? req.body.input
          : "Terreno observability multi-stage smoke test.";
      const userId = (req.user as {_id?: mongoose.Types.ObjectId} | undefined)?._id;

      const result = await runTestMultiStageWorkflow({
        aiService,
        exportTrace: options.exportTrace,
        input,
        userId,
      });

      return res.json({data: result});
    })
  );
};
