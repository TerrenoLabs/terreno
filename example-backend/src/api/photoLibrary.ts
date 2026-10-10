import type {FileStorageService} from "@terreno/ai";
import {APIError, type ModelRouterRegistration, modelRouter, Permissions, z} from "@terreno/api";
import type {Model} from "mongoose";

import {PhotoLibraryEntry} from "../models/photoLibraryEntry";
import type {PhotoLibraryEntryDocument} from "../types/models/photoLibraryEntryTypes";
import {getFileStorageService} from "./ai";

/** The one storage call the `url` action needs, so tests can pass a fake signer. */
export type PhotoUrlSigner = Pick<FileStorageService, "getSignedUrl">;

/**
 * The shared generated photo library (`bun run photos:generate` writes it). Every signed-in
 * user can list, read, and sign a photo URL; nobody can write through the API. The per-user
 * `GET /files/*` route does not fit because every user reads the same photos.
 *
 * `getStorage` runs per request because Profile settings can swap the bucket at runtime.
 * Without a bucket, `url` returns 503 rather than a broken link.
 */
export const createPhotoLibraryRouter = ({
  getStorage,
}: {
  getStorage: () => PhotoUrlSigner | undefined;
}): ModelRouterRegistration =>
  modelRouter("/photoLibrary", PhotoLibraryEntry as unknown as Model<PhotoLibraryEntryDocument>, {
    instanceActions: {
      url: {
        description:
          "Returns a short-lived signed URL for a library photo. Resolves `file:<entry id>` " +
          "image sources in agent blocks.",
        handler: async ({doc}): Promise<{url: string}> => {
          const storage = getStorage();
          if (!storage) {
            throw new APIError({
              detail: "Set GCS_BUCKET (or a bucket in Profile settings) to serve library photos.",
              disableExternalErrorTracking: true,
              status: 503,
              title: "Photo storage is not configured",
            });
          }
          return {url: await storage.getSignedUrl(doc.gcsKey)};
        },
        method: "GET",
        permissions: [Permissions.IsAuthenticated],
        response: z.object({url: z.string()}).strict(),
        summary: "Get a signed URL for a library photo",
        tag: "photoLibrary",
      },
    },
    permissions: {
      create: [],
      delete: [],
      list: [Permissions.IsAuthenticated],
      read: [Permissions.IsAuthenticated],
      update: [],
    },
    queryFields: ["tags"],
    sort: "_id",
  });

export const photoLibraryRouter = createPhotoLibraryRouter({getStorage: getFileStorageService});
