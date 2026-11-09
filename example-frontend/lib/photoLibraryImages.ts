import {DateTime} from "luxon";

/**
 * In the example app a `file:<id>` image src in an agent block is a photo library entry id
 * (the ids `findPhotos` returns). Nothing else in the example writes `file:` image ids, so no
 * prefix is needed to tell them apart.
 */

/** Signed URLs last an hour on the server; refresh a little before that. */
const SIGNED_URL_TTL_MINUTES = 50;

/** The `GET /photoLibrary/:id/url` body, with or without the `{data}` envelope. */
interface PhotoUrlBody {
  data?: {url?: string};
  url?: string;
}

interface CachedUrl {
  expiresAt: DateTime;
  url: Promise<string | undefined>;
}

const urlFromBody = (body: PhotoUrlBody | undefined): string | undefined => {
  const url = body?.data?.url ?? body?.url;
  return typeof url === "string" && url.length > 0 ? url : undefined;
};

/**
 * Builds a `resolveImage` for `BlocksView` / `GPTChat`. Each id is fetched once while its URL is
 * fresh. A failed lookup (unknown id, no storage configured) resolves to `undefined`, so the
 * block keeps its labelled placeholder, and the next render tries again.
 */
export const createPhotoImageResolver = ({
  fetchUrl,
  now = DateTime.now,
}: {
  fetchUrl: (id: string) => Promise<PhotoUrlBody | undefined>;
  now?: () => DateTime;
}): ((fileId: string) => Promise<string | undefined>) => {
  const cache = new Map<string, CachedUrl>();
  return async (fileId: string): Promise<string | undefined> => {
    const cached = cache.get(fileId);
    if (cached && cached.expiresAt > now()) {
      return cached.url;
    }
    const url = fetchUrl(fileId)
      .then(urlFromBody)
      .catch((error: unknown) => {
        console.warn("Photo library URL lookup failed", {error, fileId});
        return undefined;
      });
    cache.set(fileId, {expiresAt: now().plus({minutes: SIGNED_URL_TTL_MINUTES}), url});
    const resolved = await url;
    if (resolved === undefined) {
      cache.delete(fileId);
    }
    return resolved;
  };
};
