import {APIError, asyncHandler, authenticateMiddleware, createOpenApiBuilder} from "@terreno/api";
import type expressTypes from "express";
import express from "express";

import {type LocalDatasetStore, throwOnDatasetImportErrors} from "../local/datasetStore";
import {
  type ObservabilityRouteAccessOptions,
  observabilityAccessMiddleware,
  observabilityRouteMiddleware,
} from "./observabilityRouteAccess";

const BASE_PATH = "/ai/observability";

export interface ObservabilityDatasetRouteOptions extends ObservabilityRouteAccessOptions {
  store: LocalDatasetStore;
}

export const addObservabilityDatasetRoutes = (
  router: expressTypes.Application,
  options: ObservabilityDatasetRouteOptions
): void => {
  const openApiOptions = options.openApi ? {openApi: options.openApi} : {};
  const builder = (): ReturnType<typeof createOpenApiBuilder> => {
    return createOpenApiBuilder(openApiOptions as Parameters<typeof createOpenApiBuilder>[0]);
  };

  router.get(
    `${BASE_PATH}/datasets`,
    observabilityRouteMiddleware(
      options.accessControl,
      {action: "list", resource: "aiDataset"},
      builder()
        .withTags(["observability"])
        .withSummary("List datasets")
        .withResponse(200, {})
        .build()
    ),
    asyncHandler(async (_req, res) => {
      return res.json({data: await options.store.list()});
    })
  );

  router.post(
    `${BASE_PATH}/datasets`,
    observabilityRouteMiddleware(
      options.accessControl,
      {action: "create", resource: "aiDataset"},
      builder()
        .withTags(["observability"])
        .withSummary("Create a dataset")
        .withResponse(201, {})
        .build()
    ),
    asyncHandler(async (req, res) => {
      const data = await options.store.create(req.body);
      return res.status(201).json({data});
    })
  );

  router.get(
    `${BASE_PATH}/datasets/:id`,
    observabilityRouteMiddleware(
      options.accessControl,
      {action: "read", resource: "aiDataset"},
      builder()
        .withTags(["observability"])
        .withSummary("Get a dataset")
        .withPathParameter("id", {type: "string"})
        .withResponse(200, {})
        .build()
    ),
    asyncHandler(async (req, res) => {
      return res.json({data: await options.store.get(req.params.id)});
    })
  );

  router.patch(
    `${BASE_PATH}/datasets/:id`,
    observabilityRouteMiddleware(
      options.accessControl,
      {action: "update", resource: "aiDataset"},
      builder()
        .withTags(["observability"])
        .withSummary("Update a dataset")
        .withPathParameter("id", {type: "string"})
        .withResponse(200, {})
        .build()
    ),
    asyncHandler(async (req, res) => {
      return res.json({data: await options.store.update(req.params.id, req.body)});
    })
  );

  router.delete(
    `${BASE_PATH}/datasets/:id`,
    observabilityRouteMiddleware(
      options.accessControl,
      {action: "delete", resource: "aiDataset"},
      builder()
        .withTags(["observability"])
        .withSummary("Delete a dataset")
        .withPathParameter("id", {type: "string"})
        .withResponse(204, {})
        .build()
    ),
    asyncHandler(async (req, res) => {
      await options.store.remove(req.params.id);
      return res.status(204).end();
    })
  );

  router.get(
    `${BASE_PATH}/datasets/:id/items`,
    observabilityRouteMiddleware(
      options.accessControl,
      {action: "read", resource: "aiDataset"},
      builder()
        .withTags(["observability"])
        .withSummary("List dataset items")
        .withPathParameter("id", {type: "string"})
        .withResponse(200, {})
        .build()
    ),
    asyncHandler(async (req, res) => {
      return res.json({data: await options.store.listItems(req.params.id)});
    })
  );

  router.post(
    `${BASE_PATH}/datasets/:id/items`,
    observabilityRouteMiddleware(
      options.accessControl,
      {action: "update", resource: "aiDataset"},
      builder()
        .withTags(["observability"])
        .withSummary("Create a dataset item")
        .withPathParameter("id", {type: "string"})
        .withResponse(201, {})
        .build()
    ),
    asyncHandler(async (req, res) => {
      const data = await options.store.createItem(req.params.id, req.body);
      return res.status(201).json({data});
    })
  );

  router.patch(
    `${BASE_PATH}/datasets/:id/items/:itemId`,
    observabilityRouteMiddleware(
      options.accessControl,
      {action: "update", resource: "aiDataset"},
      builder()
        .withTags(["observability"])
        .withSummary("Update a dataset item")
        .withPathParameter("id", {type: "string"})
        .withPathParameter("itemId", {type: "string"})
        .withResponse(200, {})
        .build()
    ),
    asyncHandler(async (req, res) => {
      const data = await options.store.updateItem(req.params.id, req.params.itemId, req.body);
      return res.json({data});
    })
  );

  router.delete(
    `${BASE_PATH}/datasets/:id/items/:itemId`,
    observabilityRouteMiddleware(
      options.accessControl,
      {action: "delete", resource: "aiDataset"},
      builder()
        .withTags(["observability"])
        .withSummary("Delete a dataset item")
        .withPathParameter("id", {type: "string"})
        .withPathParameter("itemId", {type: "string"})
        .withResponse(204, {})
        .build()
    ),
    asyncHandler(async (req, res) => {
      await options.store.removeItem(req.params.id, req.params.itemId);
      return res.status(204).end();
    })
  );

  router.post(
    `${BASE_PATH}/datasets/:id/import`,
    [
      express.text({type: ["text/csv", "text/plain"]}),
      authenticateMiddleware(),
      observabilityAccessMiddleware(options.accessControl, {
        action: "update",
        resource: "aiDataset",
      }),
      builder()
        .withTags(["observability"])
        .withSummary("Import dataset items from JSON or CSV")
        .withPathParameter("id", {type: "string"})
        .withResponse(200, {})
        .build(),
    ],
    asyncHandler(async (req, res) => {
      const contentType = req.headers["content-type"] ?? "";
      if (contentType.includes("text/csv")) {
        const content = typeof req.body === "string" ? req.body : String(req.body ?? "");
        const data = await options.store.importCsv(req.params.id, content);
        throwOnDatasetImportErrors(data);
        return res.json({data});
      }
      const body = req.body as {content?: string; format?: string; rows?: unknown};
      if (body.format === "csv") {
        if (!body.content) {
          throw new APIError({status: 400, title: "CSV import requires content"});
        }
        const data = await options.store.importCsv(req.params.id, body.content);
        throwOnDatasetImportErrors(data);
        return res.json({data});
      }
      const payload = body.rows ?? body;
      const data = await options.store.importJson(req.params.id, payload);
      throwOnDatasetImportErrors(data);
      return res.json({data});
    })
  );

  router.post(
    `${BASE_PATH}/traces/add-to-dataset`,
    observabilityRouteMiddleware(
      options.accessControl,
      {action: "update", resource: "aiDataset"},
      builder()
        .withTags(["observability"])
        .withSummary("Copy one or many traces into a dataset")
        .withResponse(201, {})
        .build()
    ),
    asyncHandler(async (req, res) => {
      const body = req.body as {datasetId?: string; traceId?: string; traceIds?: string[]};
      if (!body.datasetId) {
        throw new APIError({status: 400, title: "datasetId is required"});
      }
      const traceIds = body.traceIds ?? (body.traceId ? [body.traceId] : []);
      if (traceIds.length === 0) {
        throw new APIError({status: 400, title: "traceId or traceIds is required"});
      }
      const data = await options.store.addTracesToDataset({
        datasetId: body.datasetId,
        traceIds,
      });
      return res.status(201).json({data});
    })
  );
};
