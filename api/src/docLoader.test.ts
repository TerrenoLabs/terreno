import {describe, expect, it, mock} from "bun:test";
import mongoose, {type Model} from "mongoose";
import {loadDocOr404} from "./docLoader";
import {APIError} from "./errors";

describe("loadDocOr404", () => {
  it("returns hidden reason metadata when document is deleted", async () => {
    const model = {
      collection: {findOne: mock(async () => ({deleted: true}))},
      findById: mock(() => ({exec: mock(async () => null)})),
      modelName: "MockModel",
    } as unknown as Model<unknown>;

    try {
      await loadDocOr404(model, "507f1f77bcf86cd799439011");
      expect.unreachable("expected loadDocOr404 to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(APIError);
      const apiError = error as APIError;
      expect(apiError.status).toBe(404);
      expect(apiError.meta).toEqual({deleted: "true"});
      expect(apiError.disableExternalErrorTracking).toBe(true);
    }
  });

  it("rethrows APIError from query execution without wrapping", async () => {
    const original = new APIError({status: 400, title: "validation failed"});
    const model = {
      collection: {findOne: mock(async () => null)},
      findById: mock(() => ({
        exec: mock(async () => {
          throw original;
        }),
      })),
      modelName: "MockModel",
    } as unknown as Model<unknown>;

    await expect(loadDocOr404(model, "507f1f77bcf86cd799439011")).rejects.toBe(original);
  });

  it("maps CastError on a populate path to a GET error, not 404", async () => {
    const model = {
      collection: {findOne: mock(async () => null)},
      findById: mock(() => ({
        exec: mock(async () => {
          throw new mongoose.Error.CastError("ObjectId", "not-an-object-id", "ownerId");
        }),
      })),
      modelName: "MockModel",
    } as unknown as Model<unknown>;

    try {
      await loadDocOr404(model, "507f1f77bcf86cd799439011");
      expect.unreachable("expected loadDocOr404 to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(APIError);
      const apiError = error as APIError;
      expect(apiError.status).toBe(500);
      expect(apiError.title).toBe("GET error");
    }
  });

  it("maps CastError from findById to a 404", async () => {
    const model = {
      collection: {findOne: mock(async () => null)},
      findById: mock(() => ({
        exec: mock(async () => {
          throw new mongoose.Error.CastError("ObjectId", "not-an-object-id", "_id");
        }),
      })),
      modelName: "MockModel",
    } as unknown as Model<unknown>;

    try {
      await loadDocOr404(model, "not-an-object-id");
      expect.unreachable("expected loadDocOr404 to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(APIError);
      const apiError = error as APIError;
      expect(apiError.status).toBe(404);
      expect(apiError.title).toBe("Document not found");
    }
  });

  it("returns plain not found when document does not exist", async () => {
    const model = {
      collection: {findOne: mock(async () => null)},
      findById: mock(() => ({exec: mock(async () => null)})),
      modelName: "MockModel",
    } as unknown as Model<unknown>;

    try {
      await loadDocOr404(model, "507f1f77bcf86cd799439011");
      expect.unreachable("expected loadDocOr404 to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(APIError);
      const apiError = error as APIError;
      expect(apiError.status).toBe(404);
      expect(apiError.title).toBe("Document not found");
      expect(apiError.meta).toEqual({});
    }
  });

  it("rejects a non-string id before it can reach the query as an operator", async () => {
    const findById = mock(() => ({exec: mock(async () => ({_id: "leaked"}))}));
    const model = {
      collection: {findOne: mock(async () => null)},
      findById,
      modelName: "MockModel",
    } as unknown as Model<unknown>;

    const injected = {$ne: null} as unknown as string;
    await expect(loadDocOr404(model, injected)).rejects.toMatchObject({status: 404});
    expect(findById).not.toHaveBeenCalled();
  });
});
