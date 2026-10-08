import {describe, expect, it} from "bun:test";
import {MockImageModelV3} from "ai/test";
import mongoose from "mongoose";

import {PhotoLibraryEntry} from "../models/photoLibraryEntry";
import {User} from "../models/user";
import {
  DEFAULT_PHOTO_IMAGE_MODEL,
  ensurePhotoLibraryUser,
  generatePhotoLibrary,
  PHOTO_LIBRARY_USER_EMAIL,
  type PhotoLibraryLogger,
  type PhotoStorage,
  type PhotoUploadParams,
  type PhotoUploadResult,
  parsePhotoLibraryArgs,
  resolvePhotoLibraryEnv,
} from "./generatePhotoLibrary";
import {PHOTO_PROMPTS, type PhotoPrompt} from "./photoPrompts";

// One PNG signature is enough for the AI SDK to detect image/png.
const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);

interface FakeImageModel {
  calls: string[];
  model: MockImageModelV3;
}

const createFakeImageModel = ({failFor = []}: {failFor?: string[]} = {}): FakeImageModel => {
  const calls: string[] = [];
  const model = new MockImageModelV3({
    doGenerate: async ({prompt}) => {
      calls.push(prompt ?? "");
      if (prompt && failFor.includes(prompt)) {
        throw new Error("Vertex said no");
      }
      return {
        images: [PNG_BYTES],
        response: {headers: {}, modelId: DEFAULT_PHOTO_IMAGE_MODEL, timestamp: new Date()},
        warnings: [],
      };
    },
    modelId: DEFAULT_PHOTO_IMAGE_MODEL,
  });
  return {calls, model};
};

interface FakeStorage {
  storage: PhotoStorage;
  uploads: PhotoUploadParams[];
}

const createFakeStorage = (): FakeStorage => {
  const uploads: PhotoUploadParams[] = [];
  return {
    storage: {
      upload: async (params: PhotoUploadParams): Promise<PhotoUploadResult> => {
        uploads.push(params);
        const gcsKey = `uploads/${params.userId.toString()}/${uploads.length}-${params.filename}`;
        return {
          filename: params.filename,
          gcsKey,
          id: new mongoose.Types.ObjectId().toHexString(),
          mimeType: params.mimeType,
          size: params.buffer.length,
          url: `https://storage.googleapis.com/test-bucket/${gcsKey}`,
        };
      },
    },
    uploads,
  };
};

interface CapturedLogs {
  errors: string[];
  logger: PhotoLibraryLogger;
}

const captureLogs = (): CapturedLogs => {
  const errors: string[] = [];
  return {
    errors,
    logger: {
      error: (message: string): void => {
        errors.push(message);
      },
      info: (): void => {},
    },
  };
};

const TEST_PROMPTS: PhotoPrompt[] = [
  {alt: "Roast lamb on a board", prompt: "roast lamb, overhead", tags: ["roast", "lamb"]},
  {alt: "Crispy roast potatoes", prompt: "crispy potatoes in a tin", tags: ["potatoes"]},
  {alt: "Apple crumble in a dish", prompt: "apple crumble, warm", tags: ["dessert", "crumble"]},
];

describe("PHOTO_PROMPTS", () => {
  it("ships about a dozen distinct, valid Sunday-roast prompts", async () => {
    expect(PHOTO_PROMPTS.length).toBeGreaterThanOrEqual(10);
    expect(PHOTO_PROMPTS.length).toBeLessThanOrEqual(14);
    expect(new Set(PHOTO_PROMPTS.map((entry) => entry.prompt)).size).toBe(PHOTO_PROMPTS.length);
    for (const entry of PHOTO_PROMPTS) {
      const doc = new PhotoLibraryEntry({
        ...entry,
        fileAttachmentId: new mongoose.Types.ObjectId(),
        gcsKey: "uploads/x/y.png",
      });
      await doc.validate();
    }
  });
});

describe("PhotoLibraryEntry", () => {
  const validEntry = {
    alt: "Roast lamb",
    fileAttachmentId: new mongoose.Types.ObjectId(),
    gcsKey: "uploads/x/lamb.png",
    prompt: "roast lamb",
    tags: ["lamb"],
  };

  it("rejects alt text over 200 characters and empty alt text", async () => {
    await expect(
      new PhotoLibraryEntry({...validEntry, alt: "a".repeat(201)}).validate()
    ).rejects.toThrow(/alt/);
    await expect(new PhotoLibraryEntry({...validEntry, alt: ""}).validate()).rejects.toThrow(/alt/);
  });

  it("requires between 1 and 12 tags", async () => {
    await expect(new PhotoLibraryEntry({...validEntry, tags: []}).validate()).rejects.toThrow(
      /tags/
    );
    const thirteen = Array.from({length: 13}, (_, index) => `tag${index}`);
    await expect(new PhotoLibraryEntry({...validEntry, tags: thirteen}).validate()).rejects.toThrow(
      /tags/
    );
  });

  it("rejects fields outside the schema", async () => {
    expect(() => new PhotoLibraryEntry({...validEntry, url: "https://x"})).toThrow();
  });

  it("keeps one entry per prompt, even if two runs race", async () => {
    await PhotoLibraryEntry.init();
    await PhotoLibraryEntry.create({...validEntry, prompt: "racing roast lamb"});
    await expect(
      PhotoLibraryEntry.create({...validEntry, prompt: "racing roast lamb"})
    ).rejects.toThrow(/duplicate key/);
  });
});

describe("generatePhotoLibrary", () => {
  it("creates one entry per prompt, and a second run creates none", async () => {
    const user = await ensurePhotoLibraryUser();
    const image = createFakeImageModel();
    const files = createFakeStorage();
    const logs = captureLogs();

    const first = await generatePhotoLibrary({
      imageModel: image.model,
      logger: logs.logger,
      prompts: TEST_PROMPTS,
      storage: files.storage,
      userId: user._id,
    });

    expect(first.created).toEqual(TEST_PROMPTS.map((entry) => entry.prompt));
    expect(first.failed).toEqual([]);
    const entries = await PhotoLibraryEntry.find({}).sort({prompt: 1}).lean();
    expect(entries).toHaveLength(3);
    const lamb = entries.find((entry) => entry.prompt === "roast lamb, overhead");
    expect(lamb?.alt).toBe("Roast lamb on a board");
    expect(lamb?.tags).toEqual(["roast", "lamb"]);
    expect(lamb?.gcsKey).toStartWith(`uploads/${user._id.toString()}/`);
    expect(mongoose.isValidObjectId(lamb?.fileAttachmentId)).toBe(true);
    expect(files.uploads.every((upload) => upload.mimeType === "image/png")).toBe(true);
    expect(files.uploads.every((upload) => upload.userId.equals(user._id))).toBe(true);
    expect(files.uploads[0].buffer.equals(Buffer.from(PNG_BYTES))).toBe(true);

    const second = await generatePhotoLibrary({
      imageModel: image.model,
      logger: logs.logger,
      prompts: TEST_PROMPTS,
      storage: files.storage,
      userId: user._id,
    });

    expect(second.created).toEqual([]);
    expect(second.skipped).toEqual(TEST_PROMPTS.map((entry) => entry.prompt));
    expect(await PhotoLibraryEntry.countDocuments({})).toBe(3);
    expect(image.calls).toHaveLength(3);
    expect(files.uploads).toHaveLength(3);
  });

  it("regenerates existing prompts in place with force, without duplicating them", async () => {
    const user = await ensurePhotoLibraryUser();
    const image = createFakeImageModel();
    const files = createFakeStorage();
    const logs = captureLogs();
    await generatePhotoLibrary({
      imageModel: image.model,
      logger: logs.logger,
      prompts: TEST_PROMPTS,
      storage: files.storage,
      userId: user._id,
    });
    const before = await PhotoLibraryEntry.findExactlyOne({prompt: TEST_PROMPTS[0].prompt});

    const changedAlt = [{...TEST_PROMPTS[0], alt: "Lamb, carved"}, ...TEST_PROMPTS.slice(1)];
    const forced = await generatePhotoLibrary({
      force: true,
      imageModel: image.model,
      logger: logs.logger,
      prompts: changedAlt,
      storage: files.storage,
      userId: user._id,
    });

    expect(forced.updated).toEqual(TEST_PROMPTS.map((entry) => entry.prompt));
    expect(forced.created).toEqual([]);
    expect(await PhotoLibraryEntry.countDocuments({})).toBe(3);
    const after = await PhotoLibraryEntry.findExactlyOne({prompt: TEST_PROMPTS[0].prompt});
    expect(after._id.equals(before._id)).toBe(true);
    expect(after.alt).toBe("Lamb, carved");
    expect(after.gcsKey).not.toBe(before.gcsKey);
    expect(after.fileAttachmentId.equals(before.fileAttachmentId)).toBe(false);
    expect(image.calls).toHaveLength(6);
  });

  it("logs a failed prompt, keeps going, and reports it", async () => {
    const user = await ensurePhotoLibraryUser();
    const image = createFakeImageModel({failFor: [TEST_PROMPTS[1].prompt]});
    const files = createFakeStorage();
    const logs = captureLogs();

    const result = await generatePhotoLibrary({
      imageModel: image.model,
      logger: logs.logger,
      prompts: TEST_PROMPTS,
      storage: files.storage,
      userId: user._id,
    });

    expect(result.created).toEqual([TEST_PROMPTS[0].prompt, TEST_PROMPTS[2].prompt]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].prompt).toBe(TEST_PROMPTS[1].prompt);
    expect(result.failed[0].error).toContain("Vertex said no");
    expect(logs.errors.some((message) => message.includes(TEST_PROMPTS[1].prompt))).toBe(true);
    expect(await PhotoLibraryEntry.countDocuments({})).toBe(2);
  });
});

describe("ensurePhotoLibraryUser", () => {
  it("finds or creates one non-admin system user", async () => {
    const first = await ensurePhotoLibraryUser();
    const second = await ensurePhotoLibraryUser();

    expect(first._id.equals(second._id)).toBe(true);
    expect(first.email).toBe(PHOTO_LIBRARY_USER_EMAIL);
    expect(first.admin).toBe(false);
    expect(await User.countDocuments({email: PHOTO_LIBRARY_USER_EMAIL})).toBe(1);
  });
});

describe("resolvePhotoLibraryEnv", () => {
  it("lists every missing required variable in one error", () => {
    expect(() => resolvePhotoLibraryEnv({env: {}})).toThrow(
      "Missing required environment variables for photos:generate: GOOGLE_VERTEX_PROJECT, GCS_BUCKET"
    );
    expect(() => resolvePhotoLibraryEnv({env: {GCS_BUCKET: "bucket"}})).toThrow(
      /: GOOGLE_VERTEX_PROJECT$/
    );
  });

  it("returns the config, defaulting the image model", () => {
    const config = resolvePhotoLibraryEnv({
      env: {GCS_BUCKET: "bucket", GOOGLE_VERTEX_PROJECT: "project"},
    });
    expect(config).toEqual({
      bucketName: "bucket",
      imageModelId: DEFAULT_PHOTO_IMAGE_MODEL,
      location: "us-central1",
      project: "project",
    });
    expect(DEFAULT_PHOTO_IMAGE_MODEL).toBe("imagen-4.0-fast-generate-001");
  });

  it("uses PHOTO_IMAGE_MODEL and GOOGLE_VERTEX_LOCATION when set", () => {
    const config = resolvePhotoLibraryEnv({
      env: {
        GCS_BUCKET: "bucket",
        GOOGLE_VERTEX_LOCATION: "us-central1",
        GOOGLE_VERTEX_PROJECT: "project",
        PHOTO_IMAGE_MODEL: "imagen-4.0-generate-001",
      },
    });
    expect(config.imageModelId).toBe("imagen-4.0-generate-001");
    expect(config.location).toBe("us-central1");
  });
});

describe("parsePhotoLibraryArgs", () => {
  it("reads --force and rejects unknown flags", () => {
    expect(parsePhotoLibraryArgs({argv: []})).toEqual({force: false});
    expect(parsePhotoLibraryArgs({argv: ["--force"]})).toEqual({force: true});
    expect(() => parsePhotoLibraryArgs({argv: ["--forse"]})).toThrow(/--forse/);
  });
});
