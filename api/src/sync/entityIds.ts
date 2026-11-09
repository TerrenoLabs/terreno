import type mongoose from "mongoose";

const OBJECT_ID_HEX = /^[0-9a-fA-F]{24}$/;

/**
 * True for a 24-character hex string. Stricter than `mongoose.isValidObjectId`, which also
 * accepts any 12-character string as raw ObjectId bytes.
 */
export const isObjectIdHex = (id: unknown): id is string =>
  typeof id === "string" && OBJECT_ID_HEX.test(id);

/**
 * True when the model keys documents by ObjectId. Synced ObjectId models take client-minted
 * ObjectId hex ids (syncdb `idFormats: {collection: "objectId"}`); String-keyed models take
 * any id shape (syncdb's UUID default).
 */
export const isObjectIdKeyed = (model: {schema?: mongoose.Schema}): boolean =>
  (model.schema?.path("_id") as {instance?: string} | undefined)?.instance === "ObjectId";
