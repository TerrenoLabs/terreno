import {DateTime} from "luxon";

import {generateMutationId} from "./outbox";

/**
 * How the client mints ids for a collection's creates. `uuid` (the default) suits a String
 * `_id`. `objectId` mints 24-hex ObjectIds for a collection whose Mongoose model keeps the
 * default ObjectId `_id`, so an existing model can sync without migrating its ids.
 */
export type SyncIdFormat = "uuid" | "objectId";

const OBJECT_ID_HEX = /^[0-9a-fA-F]{24}$/;

/** True for a 24-character hex string, the only id an ObjectId-keyed collection accepts. */
export const isObjectIdHex = (id: string): boolean => OBJECT_ID_HEX.test(id);

const randomBytes = (length: number, random: () => number): Uint8Array => {
  const bytes = new Uint8Array(length);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    return globalThis.crypto.getRandomValues(bytes);
  }
  for (let index = 0; index < length; index += 1) {
    bytes[index] = Math.floor(random() * 256);
  }
  return bytes;
};

/**
 * Mint an ObjectId hex string: 4 bytes of Unix seconds, then 8 random bytes. MongoDB's own
 * layout uses 5 random bytes plus a 3-byte counter; a client has no shared counter, so the
 * counter's bytes are random too. That leaves 64 random bits per second, so two clients
 * colliding is not a practical concern, and the server's unique `_id` index rejects one if
 * it ever happens (`id_collision` nack). The timestamp comes from the device clock: sort and
 * display by `created`, never by the id.
 */
export const generateObjectId = ({
  nowSeconds = Math.floor(DateTime.now().toSeconds()),
  random = Math.random,
}: {
  nowSeconds?: number;
  random?: () => number;
} = {}): string => {
  const timestamp = (nowSeconds >>> 0).toString(16).padStart(8, "0");
  const tail = Array.from(randomBytes(8, random), (byte) => byte.toString(16).padStart(2, "0"));
  return `${timestamp}${tail.join("")}`;
};

/** Mint a create's entity id in the collection's configured format. */
export const generateEntityId = (format: SyncIdFormat | undefined): string =>
  format === "objectId" ? generateObjectId() : generateMutationId();
