import {describe, expect, it} from "bun:test";
import {existsSync, mkdtempSync, readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {AIService, GptHistory} from "@terreno/ai";
import type {LanguageModel} from "ai";
import {MockLanguageModelV3} from "ai/test";
import mongoose from "mongoose";

import {FIND_PHOTOS_TOOL} from "../ai/tools";
import {PhotoLibraryEntry} from "../models/photoLibraryEntry";
import {User} from "../models/user";
import type {UserDocument} from "../types/models/userTypes";
import {
  BLOCKS_SMOKE_PROMPT,
  BLOCKS_SMOKE_USER_EMAIL,
  type BlocksSmokeLogger,
  checkBlocksReply,
  formatSmokeChecks,
  parseBlocksSmokeArgs,
  runBlocksSmoke,
  runBlocksSmokeCli,
  smokeModelProvider,
  writeSmokeOutput,
} from "./blocksSmoke";

type MockStreamResult = Awaited<ReturnType<MockLanguageModelV3["doStream"]>>;
type MockCallOptions = Parameters<MockLanguageModelV3["doStream"]>[0];
type MockStreamPart = MockStreamResult["stream"] extends ReadableStream<infer Part> ? Part : never;

const ZERO_USAGE = {
  inputTokens: {cacheRead: 0, cacheWrite: 0, noCache: 0, total: 0},
  outputTokens: {reasoning: 0, text: 0, total: 0},
};

const streamOf = (parts: MockStreamPart[]): MockStreamResult => ({
  stream: new ReadableStream<MockStreamPart>({
    start(controller) {
      for (const part of parts) {
        controller.enqueue(part);
      }
      controller.close();
    },
  }),
});

const findPhotosCall = (): MockStreamResult =>
  streamOf([
    {type: "stream-start", warnings: []},
    {
      input: JSON.stringify({count: 3, query: "roast lamb potatoes crumble"}),
      toolCallId: "call-find-photos",
      toolName: FIND_PHOTOS_TOOL,
      type: "tool-call",
    },
    {finishReason: {raw: "tool-calls", unified: "tool-calls"}, type: "finish", usage: ZERO_USAGE},
  ]);

const textReply = (text: string): MockStreamResult =>
  streamOf([
    {type: "stream-start", warnings: []},
    {id: "text-1", type: "text-start"},
    {delta: text, id: "text-1", type: "text-delta"},
    {id: "text-1", type: "text-end"},
    {finishReason: {raw: "stop", unified: "stop"}, type: "finish", usage: ZERO_USAGE},
  ]);

interface ScriptedModel {
  calls: MockCallOptions[];
  model: MockLanguageModelV3;
}

/** A model that searches the photo library first, then replies with `reply`. */
const scriptedModel = (reply: string): ScriptedModel => {
  const calls: MockCallOptions[] = [];
  const model = new MockLanguageModelV3({
    doStream: async (options) => {
      calls.push(options);
      return calls.length === 1 ? findPhotosCall() : textReply(reply);
    },
    modelId: "mock-roast-model",
  });
  return {calls, model};
};

const seedPhoto = async ({alt, tags}: {alt: string; tags: string[]}): Promise<string> => {
  const entry = await PhotoLibraryEntry.create({
    alt,
    fileAttachmentId: new mongoose.Types.ObjectId(),
    gcsKey: `photo-library/${crypto.randomUUID()}.png`,
    prompt: `${alt} ${crypto.randomUUID()}`,
    tags,
  });
  return `file:${String(entry._id)}`;
};

const seedLibrary = async (): Promise<{crumble: string; lamb: string; potatoes: string}> => ({
  crumble: await seedPhoto({alt: "Warm apple crumble", tags: ["crumble", "dessert"]}),
  lamb: await seedPhoto({alt: "Rosemary roast lamb", tags: ["roast", "lamb"]}),
  potatoes: await seedPhoto({alt: "Crispy roast potatoes", tags: ["potatoes", "side"]}),
});

const createUser = async (): Promise<UserDocument> =>
  (await User.create({
    admin: false,
    email: `smoke-${crypto.randomUUID()}@example.com`,
    name: "Smoke",
  })) as UserDocument;

interface RoastShape {
  galleryImages: string[];
  listImage: string;
  withStepper?: boolean;
}

/** A roast-shaped reply: gallery, menu list, a stepper with a copy button, and a checklist. */
const roastReply = ({galleryImages, listImage, withStepper = true}: RoastShape): string => {
  // Assigned one key at a time because a block document puts `v` before `blocks`.
  const document: Record<string, unknown> = {};
  document.v = 1;
  document.blocks = [
    {size: "lg", text: "Your Sunday lamb roast", type: "heading"},
    {
      id: "roast_photos",
      images: galleryImages.map((src, index) => ({alt: `Roast photo ${index + 1}`, src})),
      type: "gallery",
    },
    {
      id: "menu",
      items: [
        {
          image: {alt: "Rosemary roast lamb", src: listImage},
          text: "Lemon, garlic, and rosemary.",
          title: "Roast lamb",
        },
      ],
      type: "list",
    },
    ...(withStepper
      ? [
          {
            callback: {name: "scaleStepper"},
            id: "guests",
            items: [{amount: 2, decimals: 1, label: "Bone-in leg of lamb", unit: "kg"}],
            label: "Number of people",
            max: 20,
            min: 1,
            type: "stepper",
            value: 5,
          },
        ]
      : []),
    {
      elements: [
        {
          action: withStepper ? {kind: "copy", target: "guests"} : {kind: "copy", text: "Lamb"},
          id: "copy_shopping_list",
          text: "Copy shopping list",
          type: "button",
        },
      ],
      id: "shopping_actions",
      type: "actions",
    },
    {
      callback: {name: "toggleChecklist"},
      id: "cooking",
      items: [
        {id: "prep", text: "Prep ahead"},
        {id: "roast", text: "Start roasting"},
      ],
      title: "Cooking checklist",
      type: "checklist",
    },
  ];
  return JSON.stringify(document);
};

const failedChecks = (checks: {name: string; ok: boolean}[]): string[] =>
  checks.filter((check) => !check.ok).map((check) => check.name);

const systemPromptOf = (call: MockCallOptions | undefined): string => {
  const system = call?.prompt.find((message) => message.role === "system");
  return typeof system?.content === "string" ? system.content : "";
};

describe("runBlocksSmoke", () => {
  it("passes a reply that uses the photos findPhotos returned", async () => {
    const photos = await seedLibrary();
    const user = await createUser();
    const reply = roastReply({
      galleryImages: [photos.lamb, photos.potatoes, photos.crumble],
      listImage: photos.lamb,
    });
    const {calls, model} = scriptedModel(reply);

    const result = await runBlocksSmoke({
      aiService: new AIService({model: model as unknown as LanguageModel}),
      user,
    });

    expect(failedChecks(result.checks)).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.reply).toBe(reply);
    expect(result.foundSrcs.sort()).toEqual([photos.crumble, photos.lamb, photos.potatoes].sort());
    // The turn sent the post's prompt with the chat's opted-in blocks prompt and the tool.
    const [firstCall] = calls;
    expect(JSON.stringify(firstCall?.prompt)).toContain(BLOCKS_SMOKE_PROMPT);
    expect(systemPromptOf(firstCall)).toContain("scaleStepper");
    expect(systemPromptOf(firstCall)).toContain("toggleChecklist");
    expect(firstCall?.tools?.map((tool) => tool.name)).toContain(FIND_PHOTOS_TOOL);
    // The smoke cleans up the history it created.
    expect(await GptHistory.countDocuments({userId: user._id})).toBe(0);
  });

  it("fails with a clear check when the reply has no stepper", async () => {
    const photos = await seedLibrary();
    const {model} = scriptedModel(
      roastReply({
        galleryImages: [photos.lamb, photos.potatoes],
        listImage: photos.lamb,
        withStepper: false,
      })
    );

    const result = await runBlocksSmoke({
      aiService: new AIService({model: model as unknown as LanguageModel}),
      user: await createUser(),
    });

    expect(result.ok).toBe(false);
    expect(failedChecks(result.checks)).toEqual(["reply contains a stepper block"]);
    expect(formatSmokeChecks(result.checks)).toContain("FAIL reply contains a stepper block");
  });

  it("fails when an image src was not returned by findPhotos", async () => {
    const photos = await seedLibrary();
    const invented = `file:${new mongoose.Types.ObjectId().toHexString()}`;
    const {model} = scriptedModel(
      roastReply({galleryImages: [photos.lamb, invented], listImage: photos.potatoes})
    );

    const result = await runBlocksSmoke({
      aiService: new AIService({model: model as unknown as LanguageModel}),
      user: await createUser(),
    });

    expect(result.ok).toBe(false);
    expect(failedChecks(result.checks)).toEqual([
      `every image src is a file: id ${FIND_PHOTOS_TOOL} returned`,
    ]);
    const srcCheck = result.checks.find((check) => check.name.startsWith("every image src"));
    expect(srcCheck?.detail).toContain(invented);
  });
});

describe("checkBlocksReply", () => {
  it("fails parsing for a reply that is not a block document", () => {
    const checks = checkBlocksReply({
      foundSrcs: [],
      reply: "Here is your plan: roast the lamb.",
      uiBlocks: {},
    });

    expect(checks).toHaveLength(1);
    expect(checks[0]?.name).toBe("reply parses as a block document");
    expect(checks[0]?.ok).toBe(false);
  });
});

describe("smokeModelProvider", () => {
  it("skips when no model key is configured", () => {
    expect(smokeModelProvider({env: {}})).toBeUndefined();
    expect(smokeModelProvider({env: {GEMINI_API_KEY: "  "}})).toBeUndefined();
  });

  it("prefers Vertex, as the server does", () => {
    expect(smokeModelProvider({env: {GEMINI_API_KEY: "k", GOOGLE_VERTEX_PROJECT: "p"}})).toBe(
      "vertex"
    );
    expect(smokeModelProvider({env: {GEMINI_API_KEY: "k"}})).toBe("gemini");
  });
});

describe("parseBlocksSmokeArgs", () => {
  it("accepts no flags or --out <dir>", () => {
    expect(parseBlocksSmokeArgs({argv: []})).toEqual({});
    expect(parseBlocksSmokeArgs({argv: ["--out", "/tmp/smoke"]})).toEqual({outDir: "/tmp/smoke"});
  });

  it("rejects unknown flags", () => {
    expect(() => parseBlocksSmokeArgs({argv: ["--force"]})).toThrow("only --out <dir>");
    expect(() => parseBlocksSmokeArgs({argv: ["--out"]})).toThrow("only --out <dir>");
  });
});

describe("writeSmokeOutput", () => {
  it("saves the raw reply and the checks", () => {
    const outDir = path.join(mkdtempSync(path.join(tmpdir(), "blocks-smoke-test-")), "run");
    const dir = writeSmokeOutput({
      outDir,
      result: {
        checks: [{name: "reply validates", ok: true}],
        errors: [],
        foundSrcs: ["file:abc"],
        ok: true,
        reply: "v: 1\nblocks: []\n",
      },
    });

    expect(dir).toBe(outDir);
    expect(readFileSync(path.join(dir, "reply.yaml"), "utf8")).toBe("v: 1\nblocks: []\n");
    const saved = JSON.parse(readFileSync(path.join(dir, "result.json"), "utf8"));
    expect(saved.ok).toBe(true);
    expect(saved.prompt).toBe(BLOCKS_SMOKE_PROMPT);
    expect(saved.foundSrcs).toEqual(["file:abc"]);
  });
});

describe("runBlocksSmoke turn failures", () => {
  it("records a model error as a failed turn and still deletes the history", async () => {
    const user = await createUser();
    const model = new MockLanguageModelV3({
      doStream: async () => {
        throw new Error("model unavailable");
      },
      modelId: "mock-broken-model",
    });

    const result = await runBlocksSmoke({
      aiService: new AIService({model: model as unknown as LanguageModel}),
      user,
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("model unavailable");
    const turnCheck = result.checks.find((check) => check.name.startsWith("the turn finished"));
    expect(turnCheck?.ok).toBe(false);
    expect(turnCheck?.detail).toContain("model unavailable");
    expect(await GptHistory.countDocuments({userId: user._id})).toBe(0);
  });
});

interface CliLogs {
  errors: string[];
  infos: string[];
  logger: BlocksSmokeLogger;
}

const cliLogs = (): CliLogs => {
  const errors: string[] = [];
  const infos: string[] = [];
  return {
    errors,
    infos,
    logger: {
      error: (message: string): void => {
        errors.push(message);
      },
      info: (message: string): void => {
        infos.push(message);
      },
    },
  };
};

interface FakeDb {
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  events: string[];
}

/** Stands in for connecting and disconnecting, since the test preload owns the connection. */
const fakeDb = (): FakeDb => {
  const events: string[] = [];
  return {
    connect: async (): Promise<void> => {
      events.push("connect");
    },
    disconnect: async (): Promise<void> => {
      events.push("disconnect");
    },
    events,
  };
};

describe("runBlocksSmokeCli", () => {
  it("skips with exit 0 when no model key is configured", async () => {
    const logs = cliLogs();
    const db = fakeDb();
    const requested: (string | undefined)[] = [];

    const code = await runBlocksSmokeCli({
      argv: [],
      createModel: (modelId) => {
        requested.push(modelId);
        return undefined;
      },
      ...db,
      env: {},
      logger: logs.logger,
    });

    expect(code).toBe(0);
    expect(logs.infos).toEqual([
      "blocks:smoke skipped: no model key (set GOOGLE_VERTEX_PROJECT or GEMINI_API_KEY)",
    ]);
    expect(requested).toEqual([]);
    expect(db.events).toEqual([]);
  });

  it("exits 1 with the usage message for an unknown flag", async () => {
    const logs = cliLogs();

    const code = await runBlocksSmokeCli({
      argv: ["--force"],
      env: {GEMINI_API_KEY: "k"},
      logger: logs.logger,
    });

    expect(code).toBe(1);
    expect(logs.errors).toEqual([
      "blocks:smoke: Unknown arguments for blocks:smoke: --force (only --out <dir>)",
    ]);
  });

  it("exits 1 before touching the database when no model can be created", async () => {
    const logs = cliLogs();
    const db = fakeDb();
    const requested: (string | undefined)[] = [];

    const code = await runBlocksSmokeCli({
      argv: [],
      createModel: (modelId) => {
        requested.push(modelId);
        return undefined;
      },
      ...db,
      env: {BLOCKS_SMOKE_MODEL: " gemini-test ", GEMINI_API_KEY: "k"},
      logger: logs.logger,
    });

    expect(code).toBe(1);
    expect(requested).toEqual(["gemini-test"]);
    expect(logs.errors).toEqual([
      "blocks:smoke: gemini is configured but no model could be created",
    ]);
    expect(db.events).toEqual([]);
  });

  it("exits 1 and disconnects when the photo library is empty, using the server model", async () => {
    const logs = cliLogs();
    const db = fakeDb();

    // No createModel: the server's model factory runs, but the empty library stops the run
    // before any model call.
    const code = await runBlocksSmokeCli({
      argv: [],
      ...db,
      env: {GEMINI_API_KEY: "k"},
      logger: logs.logger,
    });

    expect(code).toBe(1);
    expect(logs.errors).toEqual([
      "blocks:smoke: the photo library is empty; run `bun run photos:generate` first",
    ]);
    expect(db.events).toEqual(["connect", "disconnect"]);
  });

  it("exits 0 and saves the reply to --out when every check passes", async () => {
    const photos = await seedLibrary();
    const reply = roastReply({
      galleryImages: [photos.lamb, photos.potatoes, photos.crumble],
      listImage: photos.lamb,
    });
    const {model} = scriptedModel(reply);
    const outDir = path.join(mkdtempSync(path.join(tmpdir(), "blocks-smoke-cli-")), "out");
    const logs = cliLogs();
    const db = fakeDb();

    const code = await runBlocksSmokeCli({
      argv: ["--out", outDir],
      createModel: () => model as unknown as LanguageModel,
      ...db,
      env: {BLOCKS_SMOKE_OUT_DIR: "/ignored-when-out-is-passed", GOOGLE_VERTEX_PROJECT: "p"},
      logger: logs.logger,
    });

    expect(code).toBe(0);
    expect(logs.errors).toEqual([]);
    expect(logs.infos[0]).toBe("blocks:smoke: vertex model, 3 library photos");
    expect(logs.infos).toContain("PASS reply contains a stepper block");
    expect(logs.infos.at(-1)).toBe(`blocks:smoke: passed; reply saved to ${outDir}`);
    expect(readFileSync(path.join(outDir, "reply.yaml"), "utf8")).toBe(reply);
    expect(db.events).toEqual(["connect", "disconnect"]);
    // The turn ran as the smoke system user, created on first use.
    expect(await User.countDocuments({email: BLOCKS_SMOKE_USER_EMAIL})).toBe(1);
  });

  it("exits 1, logs failures as errors, and saves to BLOCKS_SMOKE_OUT_DIR", async () => {
    const photos = await seedLibrary();
    await User.create({admin: false, email: BLOCKS_SMOKE_USER_EMAIL, name: "Blocks smoke"});
    const {model} = scriptedModel(
      roastReply({
        galleryImages: [photos.lamb, photos.potatoes],
        listImage: photos.lamb,
        withStepper: false,
      })
    );
    const outDir = path.join(mkdtempSync(path.join(tmpdir(), "blocks-smoke-cli-")), "env-out");
    const logs = cliLogs();

    const code = await runBlocksSmokeCli({
      argv: [],
      createModel: () => model as unknown as LanguageModel,
      ...fakeDb(),
      env: {BLOCKS_SMOKE_OUT_DIR: ` ${outDir} `, GEMINI_API_KEY: "k"},
      logger: logs.logger,
    });

    expect(code).toBe(1);
    expect(logs.errors).toEqual(["FAIL reply contains a stepper block"]);
    expect(logs.infos.at(-1)).toBe(`blocks:smoke: failed; reply saved to ${outDir}`);
    expect(existsSync(path.join(outDir, "result.json"))).toBe(true);
    // The existing smoke user is reused, not duplicated.
    expect(await User.countDocuments({email: BLOCKS_SMOKE_USER_EMAIL})).toBe(1);
  });
});
