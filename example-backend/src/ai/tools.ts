import {GptHistory, registerAiDataset} from "@terreno/ai";
import type {Tool} from "ai";
import {tool, zodSchema} from "ai";
import type mongoose from "mongoose";
import {z} from "zod";

import {PhotoLibraryEntry} from "../models/photoLibraryEntry";
import {Todo} from "../models/todo";

export const TODO_STATS_TOOL = "todoStats";
export const FIND_PHOTOS_TOOL = "findPhotos";

/** Bounds on how many photos one `findPhotos` call returns. */
const FIND_PHOTOS_COUNT = {default: 3, max: 6, min: 1} as const;

/** Tool description the model reads before it calls `findPhotos`. */
export const FIND_PHOTOS_DESCRIPTION =
  "Find photos in the app's photo library for gallery, list, and image blocks. " +
  "Pass a short query of food or table words (for example roast lamb, potatoes, crumble) and " +
  `a count from ${FIND_PHOTOS_COUNT.min} to ${FIND_PHOTOS_COUNT.max}. ` +
  "Each result is {src, alt}. Put each src into a block exactly as returned (it is a file: id) " +
  "and use its alt as the image alt. Never invent a file: id or an https image. " +
  "When nothing matches, leave the image out.";

/** Shown to the model with results, so it does not rewrite or invent ids. */
const FIND_PHOTOS_FOUND_NOTE =
  "Use each src exactly as returned, with its alt, in gallery, list, or image blocks.";

/** Shown to the model when no photo matched the query. */
const FIND_PHOTOS_EMPTY_NOTE =
  "No library photos matched this query. Do not invent file: ids; leave the image out or try " +
  "a different food word.";

/** Words too common to tell photos apart. */
const STOP_WORDS = new Set(["and", "for", "the", "with"]);

interface FoundPhoto {
  alt: string;
  src: string;
}

interface FindPhotosResult {
  note: string;
  photos: FoundPhoto[];
}

const toWords = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));

/** A query word matches an entry word that equals it or starts with it (lamb → lambs). */
const countMatches = (queryWords: string[], entryWords: Set<string>): number => {
  let matches = 0;
  for (const queryWord of queryWords) {
    for (const entryWord of entryWords) {
      if (entryWord.startsWith(queryWord)) {
        matches += 1;
        break;
      }
    }
  }
  return matches;
};

const clampCount = (count: number): number => {
  if (!Number.isFinite(count)) {
    return FIND_PHOTOS_COUNT.default;
  }
  return Math.min(FIND_PHOTOS_COUNT.max, Math.max(FIND_PHOTOS_COUNT.min, Math.trunc(count)));
};

/**
 * Searches the shared photo library. Entries that match more distinct query words rank first;
 * ties keep entry id order so the same query always returns the same photos.
 */
export const findPhotos = async ({
  count,
  query,
}: {
  count: number;
  query: string;
}): Promise<FindPhotosResult> => {
  const queryWords = [...new Set(toWords(query))];
  if (queryWords.length === 0) {
    return {note: FIND_PHOTOS_EMPTY_NOTE, photos: []};
  }
  // The library is a few dozen generated photos, so ranking happens in memory.
  const entries = await PhotoLibraryEntry.find({deleted: false}).sort({_id: 1});
  const ranked = entries
    .map((entry) => ({
      entry,
      score: countMatches(
        queryWords,
        new Set([...entry.tags.flatMap(toWords), ...toWords(entry.alt)])
      ),
    }))
    .filter(({score}) => score > 0)
    .sort((a, b) => b.score - a.score);
  const photos = ranked.slice(0, clampCount(count)).map(({entry}) => ({
    alt: entry.alt,
    src: `file:${String(entry._id)}`,
  }));
  return {note: photos.length > 0 ? FIND_PHOTOS_FOUND_NOTE : FIND_PHOTOS_EMPTY_NOTE, photos};
};

/** Registers `findPhotos` so the model can cite library photos as `file:` ids. */
export const createFindPhotosTool = (): Record<string, Tool> => ({
  [FIND_PHOTOS_TOOL]: tool({
    description: FIND_PHOTOS_DESCRIPTION,
    execute: async ({count, query}: {count: number; query: string}): Promise<FindPhotosResult> =>
      findPhotos({count, query}),
    inputSchema: zodSchema(
      z
        .object({
          count: z
            .number()
            .int()
            .min(FIND_PHOTOS_COUNT.min)
            .max(FIND_PHOTOS_COUNT.max)
            .describe(
              `How many photos to return, ${FIND_PHOTOS_COUNT.min}–${FIND_PHOTOS_COUNT.max}`
            ),
          query: z.string().trim().min(1).max(200).describe("Food or table words to search for"),
        })
        .strict()
    ),
  }),
});

interface TodoStatsResult {
  datasetId: string | null;
  rowCount: number;
}

const columns = [
  {name: "status", type: "string" as const},
  {name: "count", type: "number" as const},
];

/**
 * Counts the signed-in user's open and completed todos and stores them as a `ref` dataset.
 * The model puts the returned `datasetId` on a chart dataset with `source: ref`.
 */
export const createTodoStatsTool = ({
  historyId,
  userId,
}: {
  historyId?: mongoose.Types.ObjectId | string;
  userId: mongoose.Types.ObjectId | string | undefined;
}): Record<string, Tool> => ({
  [TODO_STATS_TOOL]: tool({
    description:
      "Count the signed-in user's open and completed todos and store them for a chart. " +
      "The result's datasetId is a ref dataset. Columns are status (string) and count (number). " +
      "Rows are Open and Done. Reply with one block document whose chart uses that ref.",
    execute: async (): Promise<TodoStatsResult> => {
      if (!userId) {
        return {datasetId: null, rowCount: 0};
      }
      const open = await Todo.countDocuments({completed: false, ownerId: userId});
      const done = await Todo.countDocuments({completed: true, ownerId: userId});
      const history = historyId
        ? await GptHistory.findOneOrNone({_id: historyId, deleted: false, userId})
        : ((await GptHistory.find({deleted: false, userId}).sort({created: -1}).limit(1))[0] ??
          null);
      if (!history) {
        return {datasetId: null, rowCount: 0};
      }
      const registered = await registerAiDataset({
        columns,
        historyId: history._id,
        rows: [
          ["Open", open],
          ["Done", done],
        ],
        userId,
      });
      return {datasetId: registered.datasetId, rowCount: registered.rowCount};
    },
    inputSchema: zodSchema(z.object({}).strict()),
  }),
});
