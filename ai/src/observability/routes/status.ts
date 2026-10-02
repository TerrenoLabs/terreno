import {APIError, asyncHandler, createOpenApiBuilder} from "@terreno/api";
import type express from "express";
import {getObservabilityApp} from "../observabilityAppRegistry";
import {buildObservabilityStatus} from "../status";
import {
  type ObservabilityRouteAccessOptions,
  observabilityRouteMiddleware,
} from "./observabilityRouteAccess";

const BASE_PATH = "/ai/observability";

export interface ObservabilityStatusRouteOptions extends ObservabilityRouteAccessOptions {}

export const addObservabilityStatusRoutes = (
  router: express.Application,
  options: ObservabilityStatusRouteOptions = {}
): void => {
  const openApiOptions = options.openApi ? {openApi: options.openApi} : {};
  const builder = (): ReturnType<typeof createOpenApiBuilder> => {
    return createOpenApiBuilder(openApiOptions as Parameters<typeof createOpenApiBuilder>[0]);
  };

  router.get(
    `${BASE_PATH}/status`,
    observabilityRouteMiddleware(
      options.accessControl,
      {action: "list", resource: "aiTrace"},
      builder()
        .withTags(["observability"])
        .withSummary("Observability plugin status for admin chrome")
        .withResponse(200, {data: {type: "object"}})
        .build()
    ),
    asyncHandler(async (_req, res) => {
      const app = getObservabilityApp();
      if (!app) {
        throw new APIError({status: 503, title: "ObservabilityApp is not registered"});
      }
      return res.json({data: buildObservabilityStatus(app)});
    })
  );
};
