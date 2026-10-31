import {afterEach, beforeAll, beforeEach, describe, expect, it, mock, spyOn} from "bun:test";
import {logger} from "@terreno/api";
import type mongoose from "mongoose";

import {FileAttachment} from "../models/fileAttachment";
import {GptHistory} from "../models/gptHistory";
import {GptSkill} from "../models/gptSkill";
import type {UploadFileParams} from "../service/fileStorage";
import {
  buildApp,
  conversationOf,
  createImageOnlyModel,
  createScriptedModel,
  type ImageOnlyModel,
  lookupPlans,
  modelCall,
  type ScriptedModel,
  streamFailure,
  streamPrompt,
  textStep,
  toolCallStep,
  toolNamesOf,
} from "../tests/chatHarness";
import {authAsUser, authAsUserWithCredentials, ensureTestUsers, UserModel} from "../tests/helpers";

const OTHER_USER = {admin: false, email: "other@example.com", name: "Other", password: "password"};
const MODEL_ID = "gemini-3-pro-image";
const REF_BYTES = Buffer.from("REFBYTES");
const asB = {email: OTHER_USER.email, password: "password"};

const imageCall = (prompt: string, references?: string[], id = "call_img") =>
  toolCallStep({
    input: references ? {prompt, references} : {prompt},
    toolCallId: id,
    toolName: "generate_image",
  });

describe("generate_image tool", () => {
  let userAId: mongoose.Types.ObjectId;
  let userBId: mongoose.Types.ObjectId;
  let imageModel: ImageOnlyModel;
  let upload: ReturnType<typeof mock>;
  let download: ReturnType<typeof mock>;
  let getSignedUrl: ReturnType<typeof mock>;

  beforeAll(async () => {
    await ensureTestUsers();
    await ensureTestUsers([OTHER_USER]);
    const a = await UserModel.findOne({email: "notAdmin@example.com"});
    const b = await UserModel.findOne({email: OTHER_USER.email});
    if (!a || !b) {
      throw new Error("Test users were not created");
    }
    userAId = a._id as mongoose.Types.ObjectId;
    userBId = b._id as mongoose.Types.ObjectId;
  });

  beforeEach(async () => {
    await GptSkill.deleteMany({});
    await FileAttachment.deleteMany({});
    imageModel = createImageOnlyModel();
    // Like the real service, an upload creates a FileAttachment owned by the uploader.
    upload = mock(async (params: UploadFileParams) => {
      const gcsKey = `${params.keyPrefix ?? "uploads"}/${params.userId.toString()}/1-${params.filename}`;
      const attachment = await FileAttachment.create({
        filename: params.filename,
        gcsKey,
        mimeType: params.mimeType,
        size: params.buffer.length,
        url: `https://storage.example/${gcsKey}`,
        userId: params.userId,
      });
      return {
        filename: params.filename,
        gcsKey,
        id: attachment._id.toString(),
        mimeType: params.mimeType,
        size: params.buffer.length,
        url: `https://storage.example/${gcsKey}`,
      };
    });
    download = mock(async (_gcsKey: string) => REF_BYTES);
    getSignedUrl = mock(async (gcsKey: string) => `https://signed.example/${gcsKey}`);
  });

  afterEach(async () => {
    await GptHistory.deleteMany({});
  });

  const seedGlobal = async (name: string, extra: Record<string, unknown> = {}) =>
    GptSkill.create({
      description: `${name} description`,
      files: [
        {filename: "ref.png", gcsKey: `skills/${name}/ref.png`, mimeType: "image/png", size: 8},
      ],
      instructions: `${name} instructions`,
      name,
      scope: "global",
      ...extra,
    });

  const seedUser = async (
    userId: mongoose.Types.ObjectId,
    name: string,
    extra: Record<string, unknown> = {}
  ) =>
    GptSkill.create({
      description: `${name} description`,
      files: [
        {filename: "ref.png", gcsKey: `skills/${name}/ref.png`, mimeType: "image/png", size: 8},
      ],
      instructions: `${name} instructions`,
      name,
      scope: "user",
      userId,
      ...extra,
    });

  interface TurnArgs {
    credentials?: {email: string; password: string};
    hostTools?: Record<string, unknown>;
    imageGeneration?: Record<string, unknown> | null;
    maxSteps?: number;
    steps?: ReturnType<typeof textStep>[];
    storage?: boolean;
  }

  const runTurn = async ({
    credentials,
    hostTools,
    imageGeneration = {},
    maxSteps,
    steps = [imageCall("A fox"), textStep("done")],
    storage = false,
  }: TurnArgs = {}) => {
    const model: ScriptedModel = createScriptedModel({steps});
    const app = buildApp({
      model,
      ...(imageGeneration
        ? {
            imageGeneration: {
              model: () => imageModel,
              modelId: MODEL_ID,
              ...imageGeneration,
            },
          }
        : {}),
      ...(storage ? {fileStorageService: {download, getSignedUrl, upload}} : {}),
      ...(hostTools ? {tools: hostTools} : {}),
      ...(maxSteps ? {maxSteps} : {}),
      skills: true,
    } as never);
    const agent = credentials
      ? await authAsUserWithCredentials(app, credentials)
      : await authAsUser(app, "notAdmin");
    const result = await streamPrompt(agent, {prompt: "Draw a fox"});
    return {agent, app, model, ...result};
  };

  /** Every tool result the chat model saw on its last call, in order. */
  const toolOutputsOf = (model: ScriptedModel): unknown[] => {
    const lastIndex = model.doStream.mock.calls.length - 1;
    return conversationOf(modelCall(model, lastIndex))
      .filter((message) => message.role === "tool")
      .flatMap((message) =>
        (message.content as {output: {value: unknown}}[]).map((part) => part.output.value)
      );
  };

  const imageModelMessage = (): {
    content: {type: string; [key: string]: unknown}[];
    role: string;
  } => {
    expect(imageModel.doGenerate).toHaveBeenCalledTimes(1);
    const {prompt} = imageModel.doGenerate.mock.calls[0][0];
    const users = prompt.filter((message) => message.role === "user");
    expect(users).toHaveLength(1);
    return users[0] as never;
  };

  const imageText = (): string =>
    String(imageModelMessage().content.find((part) => part.type === "text")?.text);

  const imageEvents = (events: Record<string, unknown>[]) =>
    events.filter((event) => event.image !== undefined);

  const assistantOf = async (events: Record<string, unknown>[]) => {
    const done = events.find((event) => event.done !== undefined);
    const history = await GptHistory.findById(String(done?.historyId));
    return history?.prompts.find((prompt) => prompt.type === "assistant");
  };

  describe("tool offering", () => {
    it("offers generate_image on a tool-capable turn when imageGeneration is set", async () => {
      const {model} = await runTurn({steps: [textStep("ok")]});
      expect(toolNamesOf(modelCall(model, 0))).toContain("generate_image");
    });

    it("omits the tool when model() returns undefined and passes req and modelId to it", async () => {
      const modelFn = mock((_args: {modelId: string; req: unknown}) => undefined);
      const {model} = await runTurn({
        imageGeneration: {model: modelFn},
        steps: [textStep("ok")],
      });
      expect(toolNamesOf(modelCall(model, 0))).not.toContain("generate_image");
      expect(modelFn).toHaveBeenCalled();
      const args = modelFn.mock.calls[0][0];
      expect(args.modelId).toBe(MODEL_ID);
      expect(args.req).toBeDefined();
    });

    it("lets the built-in win over a host tool of the same name and warns", async () => {
      const warn = spyOn(logger, "warn").mockImplementation((() => {}) as never);
      try {
        const {model} = await runTurn({
          hostTools: {generate_image: lookupPlans},
          steps: [imageCall("A fox"), textStep("done")],
        });
        const output = toolOutputsOf(model)[0] as {images?: unknown[]};
        expect(output.images).toHaveLength(1);
        expect(warn.mock.calls.some((call) => String(call[0]).includes("generate_image"))).toBe(
          true
        );
      } finally {
        warn.mockRestore();
      }
    });
  });

  describe("generating", () => {
    it("sends the style prompt, a blank line, and the prompt, then emits and saves one image", async () => {
      const {events, model, status} = await runTurn({
        imageGeneration: {stylePrompt: "Flat pastel"},
      });
      expect(status).toBe(200);
      expect(imageText()).toBe("Flat pastel\n\nA fox");
      expect(imageEvents(events)).toEqual([
        {image: {mimeType: "image/png", url: "data:image/png;base64,aGVsbG8="}},
      ]);

      const assistant = await assistantOf(events);
      expect(assistant?.content?.[0]?.type).toBe("image");
      expect(assistant?.content?.[0]?.url).toBe("data:image/png;base64,aGVsbG8=");

      const output = toolOutputsOf(model)[0] as {images: {id: string; mimeType: string}[]};
      expect(output.images).toHaveLength(1);
      expect(typeof output.images[0].id).toBe("string");
      expect(output.images[0].mimeType).toBe("image/png");
      const serialized = JSON.stringify(output);
      expect(serialized).not.toContain("data:");
      expect(serialized).not.toContain("aGVsbG8=");
    });

    it("uses a data: url when no storage is configured", async () => {
      const {events} = await runTurn();
      const url = String((imageEvents(events)[0].image as {url: string}).url);
      expect(url.startsWith("data:image/png;base64,")).toBe(true);
    });

    it("stores the image under generated/<userId>/ and re-signs the url on history load", async () => {
      const {agent, events} = await runTurn({storage: true});
      expect(upload).toHaveBeenCalledTimes(1);
      const params = upload.mock.calls[0][0] as UploadFileParams;
      expect(params.keyPrefix).toBe("generated");
      expect(params.mimeType).toBe("image/png");
      expect(params.userId.toString()).toBe(userAId.toString());

      const assistant = await assistantOf(events);
      const part = assistant?.content?.[0];
      expect(part?.type).toBe("image");
      expect(part?.gcsKey?.startsWith(`generated/${userAId.toString()}/`)).toBe(true);
      const attachment = await FileAttachment.findOne({gcsKey: part?.gcsKey});
      expect(attachment?.userId.toString()).toBe(userAId.toString());

      const eventUrl = String((imageEvents(events)[0].image as {url: string}).url);
      expect(eventUrl.startsWith("https://signed.example/generated/")).toBe(true);

      const done = events.find((event) => event.done !== undefined);
      getSignedUrl.mockImplementation(
        async (gcsKey: string) => `https://resigned.example/${gcsKey}`
      );
      const res = await agent.get(`/gpt/histories/${String(done?.historyId)}`).expect(200);
      const stored = res.body.data.prompts.find(
        (prompt: {type: string}) => prompt.type === "assistant"
      );
      expect(stored.content[0].url).toBe(`https://resigned.example/${part?.gcsKey}`);
    });

    it("saves the unsigned storage url, and an admin read of the history signs nothing", async () => {
      const {app, events} = await runTurn({storage: true});
      const assistant = await assistantOf(events);
      const part = assistant?.content?.[0];
      expect(part?.url).toBe(`https://storage.example/${part?.gcsKey}`);

      getSignedUrl.mockClear();
      const admin = await authAsUser(app, "admin");
      const done = events.find((event) => event.done !== undefined);
      const res = await admin.get(`/gpt/histories/${String(done?.historyId)}`).expect(200);
      const stored = res.body.data.prompts.find(
        (prompt: {type: string}) => prompt.type === "assistant"
      );
      expect(stored.content[0].url).toBe(`https://storage.example/${part?.gcsKey}`);
      expect(getSignedUrl).not.toHaveBeenCalled();
    });

    it("keeps an image already sent when a later step of the turn fails", async () => {
      const {events} = await runTurn({
        steps: [imageCall("A fox"), [streamFailure("Connection reset")]],
      });
      expect(imageEvents(events)).toHaveLength(1);
      expect(events.some((event) => event.error !== undefined)).toBe(true);
      const done = events.find((event) => event.done !== undefined);
      const history = await GptHistory.findById(String(done?.historyId));
      const assistant = history?.prompts.find((prompt) => prompt.type === "assistant");
      expect(assistant?.content?.[0]?.url).toBe("data:image/png;base64,aGVsbG8=");
    });

    it("replays an image with reply text as the text then [Generated image]", async () => {
      const {events} = await runTurn({steps: [imageCall("A fox"), textStep("Here it is")]});
      const done = events.find((event) => event.done !== undefined);
      const followUp = createScriptedModel({steps: [textStep("ok")]});
      const app = buildApp({model: followUp, skills: true} as never);
      const second = await authAsUser(app, "notAdmin");
      await streamPrompt(second, {historyId: String(done?.historyId), prompt: "Again"});
      const assistantMessages = conversationOf(modelCall(followUp, 0)).filter(
        (message) => message.role === "assistant"
      );
      expect(assistantMessages.map((message) => message.content)).toContainEqual([
        {text: "Here it is\n\n[Generated image]", type: "text"},
      ]);
    });

    it("replays a generated image to later turns as [Generated image]", async () => {
      const {agent, events} = await runTurn();
      const done = events.find((event) => event.done !== undefined);
      const followUp = createScriptedModel({steps: [textStep("ok")]});
      const app = buildApp({model: followUp, skills: true} as never);
      const second = await authAsUser(app, "notAdmin");
      await streamPrompt(second, {historyId: String(done?.historyId), prompt: "Again"});
      expect(agent).toBeDefined();
      const sent = JSON.stringify(conversationOf(modelCall(followUp, 0)));
      expect(sent).toContain("[Generated image]");
      expect(sent).not.toContain("aGVsbG8=");
    });
  });

  describe("style prompt", () => {
    it("sends only the prompt when stylePrompt is empty", async () => {
      await runTurn({imageGeneration: {stylePrompt: ""}});
      expect(imageText()).toBe("A fox");
    });

    it("sends only the prompt when stylePrompt is unset", async () => {
      await runTurn();
      expect(imageText()).toBe("A fox");
    });

    it("warns and sends only the prompt when a stylePrompt function throws", async () => {
      const warn = spyOn(logger, "warn").mockImplementation((() => {}) as never);
      try {
        const {events} = await runTurn({
          imageGeneration: {
            stylePrompt: () => {
              throw new Error("style lookup failed");
            },
          },
        });
        expect(imageText()).toBe("A fox");
        expect(warn).toHaveBeenCalled();
        expect(imageEvents(events)).toHaveLength(1);
      } finally {
        warn.mockRestore();
      }
    });
  });

  describe("references", () => {
    it("attaches a skill reference file's bytes as an image part after the text", async () => {
      await seedGlobal("house-style");
      await runTurn({
        steps: [imageCall("A fox", ["skill:house-style/ref.png"]), textStep("done")],
        storage: true,
      });
      expect(download).toHaveBeenCalledWith("skills/house-style/ref.png");
      const content = imageModelMessage().content;
      expect(content[0].type).toBe("text");
      const file = content.find((part) => part.type === "file");
      expect(file?.mediaType).toBe("image/png");
      expect(Buffer.from(file?.data as Uint8Array).toString()).toBe("REFBYTES");
    });

    it("resolves a global skill's file for a user who did not upload it", async () => {
      await seedGlobal("house-style");
      const {events} = await runTurn({
        credentials: asB,
        steps: [imageCall("A fox", ["skill:house-style/ref.png"]), textStep("done")],
        storage: true,
      });
      expect(download).toHaveBeenCalledWith("skills/house-style/ref.png");
      expect(imageEvents(events)).toHaveLength(1);
    });

    it("rejects another user's private skill file", async () => {
      await seedUser(userAId, "brand-voice");
      const {events, model} = await runTurn({
        credentials: asB,
        steps: [imageCall("A fox", ["skill:brand-voice/ref.png"]), textStep("done")],
        storage: true,
      });
      expect(toolOutputsOf(model)).toEqual([
        {error: "Unknown reference: skill:brand-voice/ref.png"},
      ]);
      expect(download).not.toHaveBeenCalled();
      expect(imageModel.doGenerate).not.toHaveBeenCalled();
      expect(imageEvents(events)).toHaveLength(0);
    });

    it("rejects a raw http url without any network fetch", async () => {
      const fetchSpy = spyOn(globalThis, "fetch");
      const url = "https://169.254.169.254/latest/meta-data";
      try {
        const {model} = await runTurn({
          steps: [imageCall("A fox", [url]), textStep("done")],
          storage: true,
        });
        expect(toolOutputsOf(model)).toEqual([{error: `Unknown reference: ${url}`}]);
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(download).not.toHaveBeenCalled();
        expect(imageModel.doGenerate).not.toHaveBeenCalled();
      } finally {
        fetchSpy.mockRestore();
      }
    });

    it("rejects an attachment reference owned by another user", async () => {
      await FileAttachment.create({
        filename: "b.png",
        gcsKey: `uploads/${userBId.toString()}/1-b.png`,
        mimeType: "image/png",
        size: 8,
        url: "https://storage.example/b.png",
        userId: userBId,
      });
      const ref = `attachment:uploads/${userBId.toString()}/1-b.png`;
      const {model} = await runTurn({
        steps: [imageCall("A fox", [ref]), textStep("done")],
        storage: true,
      });
      expect(toolOutputsOf(model)).toEqual([{error: `Unknown reference: ${ref}`}]);
      expect(download).not.toHaveBeenCalled();
    });

    it("downloads the caller's own attachment", async () => {
      const key = `uploads/${userAId.toString()}/1-a.png`;
      await FileAttachment.create({
        filename: "a.png",
        gcsKey: key,
        mimeType: "image/png",
        size: 8,
        url: "https://storage.example/a.png",
        userId: userAId,
      });
      const {events} = await runTurn({
        steps: [imageCall("A fox", [`attachment:${key}`]), textStep("done")],
        storage: true,
      });
      expect(download).toHaveBeenCalledWith(key);
      expect(
        Buffer.from(
          imageModelMessage().content.find((part) => part.type === "file")?.data as Uint8Array
        ).toString()
      ).toBe("REFBYTES");
      expect(imageEvents(events)).toHaveLength(1);
    });
  });

  describe("failures and limits", () => {
    it("returns an error when the image model returns no image, and the turn completes", async () => {
      imageModel = createImageOnlyModel({imageCount: 0});
      const {events, model, status} = await runTurn();
      expect(status).toBe(200);
      expect(toolOutputsOf(model)).toEqual([{error: "The image model returned no image"}]);
      expect(imageEvents(events)).toHaveLength(0);
      expect(events.some((event) => event.done !== undefined)).toBe(true);
    });

    it("rejects the 5th call in one turn with the default limit", async () => {
      const {events, model} = await runTurn({
        maxSteps: 10,
        steps: [
          imageCall("one", undefined, "c1"),
          imageCall("two", undefined, "c2"),
          imageCall("three", undefined, "c3"),
          imageCall("four", undefined, "c4"),
          imageCall("five", undefined, "c5"),
          textStep("done"),
        ],
      });
      const outputs = toolOutputsOf(model) as {error?: string; images?: unknown[]}[];
      expect(outputs).toHaveLength(5);
      expect(outputs.slice(0, 4).every((output) => output.images?.length === 1)).toBe(true);
      expect(outputs[4]).toEqual({error: "Image limit reached for this turn"});
      expect(imageModel.doGenerate).toHaveBeenCalledTimes(4);
      expect(imageEvents(events)).toHaveLength(4);
    });

    it("honors maxCallsPerTurn: 1", async () => {
      const {model} = await runTurn({
        imageGeneration: {maxCallsPerTurn: 1},
        maxSteps: 10,
        steps: [
          imageCall("one", undefined, "c1"),
          imageCall("two", undefined, "c2"),
          textStep("done"),
        ],
      });
      const outputs = toolOutputsOf(model) as {error?: string; images?: unknown[]}[];
      expect(outputs[0].images).toHaveLength(1);
      expect(outputs[1]).toEqual({error: "Image limit reached for this turn"});
      expect(imageModel.doGenerate).toHaveBeenCalledTimes(1);
    });

    it("counts a call whose reference fails toward the limit", async () => {
      const {events, model} = await runTurn({
        imageGeneration: {maxCallsPerTurn: 1},
        maxSteps: 10,
        steps: [
          imageCall("one", ["skill:nope/ref.png"], "c1"),
          imageCall("two", undefined, "c2"),
          textStep("done"),
        ],
        storage: true,
      });
      expect(toolOutputsOf(model)).toEqual([
        {error: "Unknown reference: skill:nope/ref.png"},
        {error: "Image limit reached for this turn"},
      ]);
      expect(imageModel.doGenerate).not.toHaveBeenCalled();
      expect(imageEvents(events)).toHaveLength(0);
    });

    it("rejects a skill reference when no storage is configured", async () => {
      await seedGlobal("house-style");
      const {model} = await runTurn({
        steps: [imageCall("A fox", ["skill:house-style/ref.png"]), textStep("done")],
      });
      expect(toolOutputsOf(model)).toEqual([
        {error: "Unknown reference: skill:house-style/ref.png"},
      ]);
      expect(imageModel.doGenerate).not.toHaveBeenCalled();
    });

    describe("input contract", () => {
      const invalidInputs: [string, Record<string, unknown>][] = [
        ["an empty prompt", {prompt: ""}],
        ["a prompt over 4000 characters", {prompt: "x".repeat(4001)}],
        ["more than 4 references", {prompt: "A fox", references: Array(5).fill("attachment:k")}],
        ["a non-string prompt", {prompt: 42}],
        ["a non-array references", {prompt: "A fox", references: "attachment:k"}],
        ["an unknown key", {extra: true, prompt: "A fox"}],
      ];

      for (const [label, input] of invalidInputs) {
        it(`rejects ${label} before any download or image-model call`, async () => {
          const {model, status} = await runTurn({
            steps: [
              toolCallStep({input, toolCallId: "call_bad", toolName: "generate_image"}),
              textStep("done"),
            ],
            storage: true,
          });
          expect(status).toBe(200);
          const outputs = toolOutputsOf(model);
          expect(outputs).toHaveLength(1);
          expect(JSON.stringify(outputs[0])).toContain("Invalid input");
          expect(download).not.toHaveBeenCalled();
          expect(upload).not.toHaveBeenCalled();
          expect(imageModel.doGenerate).not.toHaveBeenCalled();
        });
      }

      it("accepts a 4000-character prompt and exactly 4 references", async () => {
        await seedGlobal("house-style");
        const {model} = await runTurn({
          steps: [
            imageCall("x".repeat(4000), Array(4).fill("skill:house-style/ref.png")),
            textStep("done"),
          ],
          storage: true,
        });
        expect((toolOutputsOf(model)[0] as {images?: unknown[]}).images).toHaveLength(1);
        expect(download).toHaveBeenCalledTimes(4);
      });
    });

    it("starts a new turn with a fresh limit", async () => {
      const first = await runTurn({imageGeneration: {maxCallsPerTurn: 1}});
      expect(imageEvents(first.events)).toHaveLength(1);
      imageModel = createImageOnlyModel();
      const second = await runTurn({imageGeneration: {maxCallsPerTurn: 1}});
      expect(imageEvents(second.events)).toHaveLength(1);
    });
  });
});
