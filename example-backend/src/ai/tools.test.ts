import {describe, expect, it} from "bun:test";
import mongoose from "mongoose";

import {PhotoLibraryEntry} from "../models/photoLibraryEntry";
import {createFindPhotosTool, FIND_PHOTOS_DESCRIPTION, FIND_PHOTOS_TOOL, findPhotos} from "./tools";

const seedPhoto = async ({
  alt,
  deleted = false,
  tags,
}: {
  alt: string;
  deleted?: boolean;
  tags: string[];
}): Promise<string> => {
  const entry = await PhotoLibraryEntry.create({
    alt,
    deleted,
    fileAttachmentId: new mongoose.Types.ObjectId(),
    gcsKey: `photo-library/${crypto.randomUUID()}.png`,
    prompt: `${alt} ${crypto.randomUUID()}`,
    tags,
  });
  return String(entry._id);
};

const seedRoastLibrary = async (): Promise<Record<string, string>> => ({
  carrots: await seedPhoto({
    alt: "Honey-glazed roast carrots and parsnips with thyme",
    tags: ["carrots", "parsnips", "vegetables", "side"],
  }),
  crumble: await seedPhoto({
    alt: "Apple crumble with a golden oat topping",
    tags: ["dessert", "apple", "crumble"],
  }),
  lamb: await seedPhoto({
    alt: "A rosemary and garlic roast leg of lamb on a wooden board",
    tags: ["roast", "lamb", "main", "sunday roast"],
  }),
  potatoes: await seedPhoto({
    alt: "Golden crispy roast potatoes in a dark roasting tin",
    tags: ["potatoes", "roast potatoes", "side"],
  }),
});

const runTool = async (input: unknown): Promise<unknown> => {
  const findTool = createFindPhotosTool()[FIND_PHOTOS_TOOL];
  if (!findTool?.execute) {
    throw new Error("findPhotos has no execute");
  }
  return findTool.execute(input as never, {messages: [], toolCallId: "call_photos"});
};

const parseInput = async (input: unknown): Promise<{success: boolean}> => {
  const findTool = createFindPhotosTool()[FIND_PHOTOS_TOOL];
  const schema = findTool?.inputSchema as {
    validate?: (value: unknown) => Promise<{success: boolean}> | {success: boolean};
  };
  if (!schema?.validate) {
    throw new Error("findPhotos has no input validator");
  }
  return schema.validate(input);
};

describe("findPhotos", () => {
  it("returns three file: ids for roast lamb, the best match first", async () => {
    const ids = await seedRoastLibrary();

    const result = await findPhotos({count: 3, query: "roast lamb"});

    expect(result.photos).toHaveLength(3);
    for (const photo of result.photos) {
      expect(photo.src).toMatch(/^file:[0-9a-f]{24}$/);
      expect(photo.alt.length).toBeGreaterThan(0);
    }
    expect(result.photos[0]).toEqual({
      alt: "A rosemary and garlic roast leg of lamb on a wooden board",
      src: `file:${ids.lamb}`,
    });
    expect(result.photos.map((photo) => photo.src)).not.toContain(`file:${ids.crumble}`);
  });

  it("ranks more matched words first and breaks ties by entry id", async () => {
    const ids = await seedRoastLibrary();

    const result = await findPhotos({count: 6, query: "roast lamb"});

    const tied = [ids.carrots, ids.potatoes].sort().map((id) => `file:${id}`);
    expect(result.photos.map((photo) => photo.src)).toEqual([`file:${ids.lamb}`, ...tied]);
    const again = await findPhotos({count: 6, query: "LAMB, roast!"});
    expect(again.photos).toEqual(result.photos);
  });

  it("matches alt text as well as tags", async () => {
    const ids = await seedRoastLibrary();

    const result = await findPhotos({count: 2, query: "rosemary"});

    expect(result.photos.map((photo) => photo.src)).toEqual([`file:${ids.lamb}`]);
  });

  it("returns an empty list and says nothing matched", async () => {
    await seedRoastLibrary();

    const result = await findPhotos({count: 3, query: "sushi"});

    expect(result.photos).toEqual([]);
    expect(result.note).toContain("No library photos matched");
    expect(result.note).toContain("Do not invent");
  });

  it("leaves out soft-deleted entries", async () => {
    await seedPhoto({alt: "A deleted roast lamb", deleted: true, tags: ["roast", "lamb"]});
    const live = await seedPhoto({alt: "A live roast lamb", tags: ["roast", "lamb"]});

    const result = await findPhotos({count: 6, query: "roast lamb"});

    expect(result.photos.map((photo) => photo.src)).toEqual([`file:${live}`]);
  });

  it("clamps count to 1–6 for direct callers", async () => {
    for (let index = 0; index < 8; index += 1) {
      await seedPhoto({alt: `Roast dish ${index}`, tags: ["roast"]});
    }

    expect((await findPhotos({count: 10, query: "roast"})).photos).toHaveLength(6);
    expect((await findPhotos({count: 0, query: "roast"})).photos).toHaveLength(1);
  });

  it("tells the model to use src as-is in gallery, list, and image blocks", async () => {
    await seedRoastLibrary();

    const result = (await runTool({count: 1, query: "lamb"})) as {
      note: string;
      photos: {src: string}[];
    };

    expect(result.photos).toHaveLength(1);
    expect(result.note).toContain("exactly as returned");
    for (const text of [FIND_PHOTOS_DESCRIPTION, result.note]) {
      expect(text).toContain("src");
    }
    expect(FIND_PHOTOS_DESCRIPTION).toContain("gallery");
    expect(FIND_PHOTOS_DESCRIPTION).toContain("list");
    expect(FIND_PHOTOS_DESCRIPTION).toContain("image");
  });

  it("rejects a count outside 1–6 and an empty query at the tool boundary", async () => {
    expect((await parseInput({count: 3, query: "roast lamb"})).success).toBe(true);
    expect((await parseInput({count: 0, query: "roast lamb"})).success).toBe(false);
    expect((await parseInput({count: 7, query: "roast lamb"})).success).toBe(false);
    expect((await parseInput({count: 2.5, query: "roast lamb"})).success).toBe(false);
    expect((await parseInput({count: 3, query: ""})).success).toBe(false);
  });
});
