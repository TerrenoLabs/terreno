import {APIError, asyncHandler, authenticateMiddleware, createOpenApiBuilder} from "@terreno/api";
import {DATASET_GRAINS} from "@terreno/blocks";
import type express from "express";
import mongoose from "mongoose";

import {AIDataset} from "../models/aiDataset";
import {type DatasetGrain, readDatasetRows} from "../service/aiDatasets";

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 1000;

const requestUserId = (req: express.Request): mongoose.Types.ObjectId | undefined =>
  (req.user as {_id?: mongoose.Types.ObjectId} | undefined)?._id;

const queryValue = (value: unknown): string | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new APIError({status: 400, title: "Query parameters must be single values"});
  }
  return value;
};

const parsePositiveInt = (value: string, name: string, max: number): number => {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new APIError({status: 400, title: `${name} must be a positive integer`});
  }
  const parsed = Number(value);
  if (parsed > max) {
    throw new APIError({status: 400, title: `${name} must be at most ${max}`});
  }
  return parsed;
};

const parseGrain = (value: string | undefined): DatasetGrain | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (!(DATASET_GRAINS as readonly string[]).includes(value)) {
    throw new APIError({status: 400, title: "grain must be hour, day, week, or month"});
  }
  return value as DatasetGrain;
};

/** Owner read of a stored dataset. Mounted only when `uiBlocks` is on. */
export const addGptDatasetRoutes = (
  router: express.Router,
  options: {openApiOptions?: Record<string, unknown>}
): void => {
  router.get(
    "/gpt/datasets/:id",
    [
      authenticateMiddleware(),
      createOpenApiBuilder(options.openApiOptions ?? {})
        .withTags(["gpt"])
        .withSummary("Read a stored chart dataset")
        .withPathParameter("id", {type: "string"})
        .withQueryParameter("grain", {enum: [...DATASET_GRAINS], type: "string"}, {required: false})
        .withQueryParameter("limit", {type: "number"}, {required: false})
        .withQueryParameter("page", {type: "number"}, {required: false})
        .withResponse(200, {
          columns: {items: {type: "object"}, type: "array"},
          more: {type: "boolean"},
          page: {type: "number"},
          rowCount: {type: "number"},
          rows: {items: {type: "array"}, type: "array"},
        })
        .build(),
    ],
    asyncHandler(async (req: express.Request, res: express.Response) => {
      const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
      if (!id || !mongoose.Types.ObjectId.isValid(id)) {
        throw new APIError({status: 400, title: "Dataset id is not valid"});
      }
      const userId = requestUserId(req);
      // Another user's dataset is "not found", so ids cannot be probed.
      const dataset = await AIDataset.findOneOrNone({
        _id: id,
        deleted: false,
        userId,
      });
      if (!dataset) {
        throw new APIError({status: 404, title: "Dataset not found"});
      }
      const grain = parseGrain(queryValue(req.query.grain));
      const limitText = queryValue(req.query.limit);
      const pageText = queryValue(req.query.page);
      const limit =
        limitText === undefined ? DEFAULT_LIMIT : parsePositiveInt(limitText, "limit", MAX_LIMIT);
      const page = pageText === undefined ? undefined : parsePositiveInt(pageText, "page", 10_000);
      const read = readDatasetRows(dataset, {grain, limit, page});
      return res.json({
        data: {
          columns: dataset.columns,
          more: read.more,
          page: read.page,
          rowCount: read.rowCount,
          rows: read.rows,
        },
      });
    })
  );
};
