import type {Block} from "@terreno/blocks";
import {useEffect, useState} from "react";

/** Turns a `file:` image id into a URL the image component can load. */
type ResolveImage = (fileId: string) => Promise<string | undefined>;

/** The id after `file:`, when `src` is a file ref. */
export const fileRefId = (src: string): string | undefined => {
  if (!src.startsWith("file:")) {
    return undefined;
  }
  const id = src.slice("file:".length).trim();
  return id.length > 0 ? id : undefined;
};

const collectFileIds = (blocks: readonly Block[], ids: Set<string>): void => {
  for (const block of blocks) {
    if (block.type === "image") {
      const id = fileRefId(block.src);
      if (id !== undefined) {
        ids.add(id);
      }
    }
    if (block.type === "columns" || block.type === "card") {
      collectFileIds(block.children, ids);
    }
  }
};

/**
 * Resolves `file:` image refs. A missing resolver or a failed lookup leaves the id unset
 * so the renderer can keep the alt text and skip the image.
 */
export const useResolvedImages = ({
  blocks,
  resolveImage,
}: {
  blocks?: readonly Block[];
  resolveImage?: ResolveImage;
}): Record<string, string | undefined> => {
  const ids = new Set<string>();
  if (blocks !== undefined) {
    collectFileIds(blocks, ids);
  }
  const key = [...ids].sort().join("\n");
  const [resolved, setResolved] = useState<Record<string, string | undefined>>({});

  // Each distinct file id is fetched once. Data and https sources never call the host.
  useEffect(() => {
    const current = key.length === 0 ? [] : key.split("\n");
    if (current.length === 0 || resolveImage === undefined) {
      setResolved({});
      return;
    }
    let cancelled = false;
    void Promise.all(
      current.map(async (id) => {
        try {
          const url = await resolveImage(id);
          return [id, url] as const;
        } catch {
          return [id, undefined] as const;
        }
      })
    ).then((pairs) => {
      if (cancelled) {
        return;
      }
      const next: Record<string, string | undefined> = {};
      for (const [id, url] of pairs) {
        next[id] = url;
      }
      setResolved(next);
    });
    return () => {
      cancelled = true;
    };
  }, [key, resolveImage]);

  return resolved;
};
