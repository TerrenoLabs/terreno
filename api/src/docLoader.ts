import mongoose, {type Model} from "mongoose";

import {addPopulateToQuery} from "./api";
import {APIError, errorDetail, isAPIError, NotFoundError} from "./errors";
import type {PopulatePath} from "./populate";

const isCastErrorOnDocumentId = (error: unknown): boolean => {
  if (error instanceof mongoose.Error.CastError) {
    return error.path === "_id";
  }
  const maybe = error as {name?: string; path?: string} | undefined;
  return maybe?.name === "CastError" && maybe.path === "_id";
};

const isInvalidIdError = (error: unknown): boolean => {
  if (isCastErrorOnDocumentId(error)) {
    return true;
  }
  const name = (error as {name?: string} | undefined)?.name;
  return name === "BSONError" || name === "BSONTypeError";
};

const documentNotFound = (modelName: string, id: string): NotFoundError => {
  return new NotFoundError({
    code: "document-not-found",
    detail: `Document ${id} not found for model ${modelName}`,
    title: "Document not found",
  });
};

/**
 * Loads a document by id or throws a 404 APIError.
 * Matches permission middleware behavior including soft-delete metadata.
 */
export const loadDocOr404 = async <T>(
  model: Model<T>,
  id: string,
  populatePaths?: PopulatePath[]
): Promise<T> => {
  // A non-string id (e.g. `{$ne: null}` from a JSON body) would become a query operator.
  if (typeof id !== "string") {
    throw documentNotFound(model.modelName, String(id));
  }
  const builtQuery = model.findById(id);
  const populatedQuery = addPopulateToQuery(
    builtQuery as unknown as Parameters<typeof addPopulateToQuery>[0],
    populatePaths
  );
  let data: T | null;
  try {
    data = (await populatedQuery.exec()) as T | null;
  } catch (error: unknown) {
    if (isAPIError(error)) {
      throw error;
    }
    if (isInvalidIdError(error)) {
      throw documentNotFound(model.modelName, id);
    }
    throw new APIError({
      cause: error,
      code: "get-error",
      detail: `GET failed on ${id}: ${errorDetail(error)}`,
      meta: {model: model.modelName},
      status: 500,
      title: "GET error",
    });
  }
  if (!data) {
    const idSchemaType = model.schema?.path("_id");
    let hiddenId: unknown;
    try {
      hiddenId = idSchemaType?.instance === "String" ? id : new mongoose.Types.ObjectId(id);
    } catch (error: unknown) {
      if (isInvalidIdError(error)) {
        throw documentNotFound(model.modelName, id);
      }
      throw error;
    }
    const hiddenDoc = await model.collection.findOne({
      _id: hiddenId as never,
    });

    const notFoundDetail = `Document ${id} not found for model ${model.modelName}`;

    if (!hiddenDoc) {
      throw documentNotFound(model.modelName, id);
    }

    let reason: {[key: string]: string} | null = null;
    if (hiddenDoc.deleted) {
      reason = {deleted: "true"};
    } else if (hiddenDoc.disabled) {
      reason = {disabled: "true"};
    } else if (hiddenDoc.archived) {
      reason = {archived: "true"};
    }

    if (!reason) {
      throw new NotFoundError({
        code: "document-not-found",
        detail: notFoundDetail,
        title: "Document not found",
      });
    }
    throw new NotFoundError({
      code: "document-not-found",
      detail: notFoundDetail,
      disableExternalErrorTracking: true,
      meta: reason,
      title: "Document not found",
    });
  }

  return data;
};
