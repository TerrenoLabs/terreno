/**
 * Model smoke for rich agent replies: `bun run blocks:smoke [--out <dir>]`.
 *
 * Sends the Sunday roast prompt through one real chat turn (`runBufferedChatTurn`, the same code
 * the `/gpt/histories/:id/turn` route runs) with the example app's `uiBlocks` options and the
 * `findPhotos` tool. It then checks that the reply is a valid block document with a `gallery`,
 * `list`, `stepper`, `checklist`, and a `copy` action, and that every image `src` is a `file:` id
 * that `findPhotos` returned during the turn.
 *
 * Environment:
 * - `GOOGLE_VERTEX_PROJECT` (with Application Default Credentials) or `GEMINI_API_KEY`: the model,
 *   resolved exactly as the server resolves it. With neither, the script prints that it skipped
 *   and exits 0.
 * - `BLOCKS_SMOKE_MODEL` (optional): a model id instead of the server default.
 * - `BLOCKS_SMOKE_OUT_DIR` (optional, or `--out`): where `reply.yaml` and `result.json` go.
 *   Defaults to a new temp directory.
 * - `MONGO_URI` / `MONGO_DB_NAME`: the database holding the photo library (`photos:generate`).
 *
 * Exit codes: 0 when every check passes or the run skipped, 1 otherwise. The turn is owned by a
 * system user (`blocks-smoke@system.invalid`, found or created) and its history is deleted after.
 */
import {mkdirSync, mkdtempSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {AIService, GptHistory, runBufferedChatTurn, type UiBlocksOptions} from "@terreno/ai";
import {logger} from "@terreno/api";
import {parseBlocks, validateBlocks} from "@terreno/blocks";
import type {Tool} from "ai";
import type express from "express";
import mongoose from "mongoose";

import {exampleUiBlocksOptions} from "../ai/hostActions";
import {createFindPhotosTool, FIND_PHOTOS_TOOL} from "../ai/tools";
import {PhotoLibraryEntry} from "../models/photoLibraryEntry";
import {User} from "../models/user";
import type {UserDocument} from "../types/models/userTypes";
import {connectToMongoDB} from "../utils/database";

/** The user message from the post the roast reply answers. */
export const BLOCKS_SMOKE_PROMPT =
  "Give me a plan for a sunday lamb roast, I'm having friends over still figuring out numbers tbh";

/** Block types the roast reply must use somewhere in its tree. */
const REQUIRED_BLOCK_TYPES = ["gallery", "list", "stepper", "checklist"] as const;

/** Matches the server chat route's step budget, so the model can search photos and then reply. */
const SMOKE_MAX_STEPS = 5;

export const BLOCKS_SMOKE_USER_EMAIL = "blocks-smoke@system.invalid";
const BLOCKS_SMOKE_USER_NAME = "Blocks smoke";

export interface SmokeCheck {
  detail?: string;
  name: string;
  ok: boolean;
}

export interface BlocksSmokeResult {
  checks: SmokeCheck[];
  errors: string[];
  /** Every `src` that `findPhotos` returned during the turn. */
  foundSrcs: string[];
  ok: boolean;
  reply: string;
}

export interface BlocksSmokeLogger {
  error: (message: string) => void;
  info: (message: string) => void;
}

type ModelProvider = "gemini" | "vertex";

/** Which model provider the server would use, or undefined when none is configured. */
export const smokeModelProvider = ({
  env,
}: {
  env: Record<string, string | undefined>;
}): ModelProvider | undefined => {
  if (env.GOOGLE_VERTEX_PROJECT?.trim()) {
    return "vertex";
  }
  if (env.GEMINI_API_KEY?.trim()) {
    return "gemini";
  }
  return undefined;
};

/** Parse the CLI flags. Only `--out <dir>` is accepted, so a typo cannot silently do nothing. */
export const parseBlocksSmokeArgs = ({argv}: {argv: string[]}): {outDir?: string} => {
  const [flag, value, ...rest] = argv;
  if (flag === undefined) {
    return {};
  }
  if (flag !== "--out" || !value?.trim() || rest.length > 0) {
    throw new Error(`Unknown arguments for blocks:smoke: ${argv.join(" ")} (only --out <dir>)`);
  }
  return {outDir: value};
};

/** The plain objects under `value`, depth first, `value` included. */
const plainObjects = (value: unknown): Record<string, unknown>[] => {
  if (Array.isArray(value)) {
    return value.flatMap(plainObjects);
  }
  if (value === null || typeof value !== "object") {
    return [];
  }
  const record = value as Record<string, unknown>;
  return [record, ...Object.values(record).flatMap(plainObjects)];
};

/** The block callback allowlists chat validates against, from the host's action registry. */
const callbackAllowlists = (
  uiBlocks: UiBlocksOptions
): {checklistActions?: string[]; hostActions?: string[]; stepperActions?: string[]} => {
  if (uiBlocks.hostActions === undefined) {
    return {};
  }
  const entries = Object.entries(uiBlocks.hostActions);
  const handling = (block: "checklist" | "stepper"): string[] =>
    entries.filter(([, action]) => action.handles === block).map(([name]) => name);
  return {
    checklistActions: handling("checklist"),
    hostActions: entries.map(([name]) => name),
    stepperActions: handling("stepper"),
  };
};

/**
 * Check a reply against AC12. A reply that does not parse or validate fails those checks and the
 * content checks still run on whatever parsed, so one run shows every gap.
 */
export const checkBlocksReply = ({
  foundSrcs,
  reply,
  uiBlocks,
}: {
  foundSrcs: readonly string[];
  reply: string;
  uiBlocks: UiBlocksOptions;
}): SmokeCheck[] => {
  const parsed = parseBlocks(reply);
  if (!parsed.ok) {
    const detail = parsed.errors.map((error) => `${error.path} ${error.code}`).join("; ");
    return [{detail, name: "reply parses as a block document", ok: false}];
  }
  const checks: SmokeCheck[] = [{name: "reply parses as a block document", ok: true}];

  const validated = validateBlocks(parsed.value, {
    ...(uiBlocks.html === true ? {allowHtml: true} : {}),
    ...callbackAllowlists(uiBlocks),
    ...(uiBlocks.imageHosts ? {imageHosts: uiBlocks.imageHosts} : {}),
  });
  checks.push({
    detail: validated.ok
      ? undefined
      : validated.errors.map((error) => `${error.path} ${error.code}`).join("; "),
    name: "reply validates",
    ok: validated.ok,
  });

  const blocks = (parsed.value as {blocks?: unknown}).blocks;
  const nodes = plainObjects(blocks);
  const types = new Set(nodes.map((node) => node.type).filter((type) => typeof type === "string"));
  for (const type of REQUIRED_BLOCK_TYPES) {
    checks.push({name: `reply contains a ${type} block`, ok: types.has(type)});
  }
  checks.push({
    name: "reply contains a copy action",
    ok: nodes.some((node) => node.kind === "copy"),
  });

  const srcs = nodes
    .map((node) => node.src)
    .filter((src): src is string => typeof src === "string");
  const found = new Set(foundSrcs);
  const unknownSrcs = srcs.filter((src) => !found.has(src));
  checks.push({
    detail:
      srcs.length === 0
        ? "the reply has no images"
        : unknownSrcs.length > 0
          ? `not returned by ${FIND_PHOTOS_TOOL}: ${unknownSrcs.join(", ")}`
          : `${srcs.length} images`,
    name: `every image src is a file: id ${FIND_PHOTOS_TOOL} returned`,
    ok: srcs.length > 0 && unknownSrcs.length === 0,
  });
  return checks;
};

/** `findPhotos` as chat registers it, recording every `src` it returns. */
const recordingFindPhotosTool = (found: Set<string>): Record<string, Tool> => {
  const base = createFindPhotosTool()[FIND_PHOTOS_TOOL] as Tool;
  const execute = base.execute as unknown as (
    input: unknown,
    options: unknown
  ) => Promise<{photos: {src: string}[]}>;
  return {
    [FIND_PHOTOS_TOOL]: {
      ...base,
      execute: async (input: unknown, options: unknown) => {
        const output = await execute(input, options);
        for (const photo of output.photos) {
          found.add(photo.src);
        }
        return output;
      },
    } as Tool,
  };
};

/** The request a chat route would hand the turn: the signed-in user and no per-request key. */
const turnRequest = (user: UserDocument, body: Record<string, unknown>): express.Request =>
  ({
    body,
    header: (): undefined => undefined,
    headers: {},
    user,
  }) as unknown as express.Request;

/**
 * Run the roast prompt through one chat turn and check the reply. `aiService` supplies the model;
 * `user` owns the turn's history, which is deleted afterwards.
 */
export const runBlocksSmoke = async ({
  aiService,
  prompt = BLOCKS_SMOKE_PROMPT,
  uiBlocks = exampleUiBlocksOptions,
  user,
}: {
  aiService: AIService;
  prompt?: string;
  uiBlocks?: UiBlocksOptions;
  user: UserDocument;
}): Promise<BlocksSmokeResult> => {
  const found = new Set<string>();
  const errors: string[] = [];
  const history = await GptHistory.create({prompts: [], userId: user._id});
  let reply = "";
  try {
    const turn = await runBufferedChatTurn({
      body: {historyId: history._id.toString(), prompt},
      options: {
        aiService,
        maxSteps: SMOKE_MAX_STEPS,
        toolChoice: "auto",
        tools: recordingFindPhotosTool(found) as never,
        uiBlocks,
      },
      req: turnRequest(user, {historyId: history._id.toString(), prompt}),
    });
    reply = turn.text;
    if (turn.error) {
      errors.push(turn.error);
    }
    if (turn.pendingAsk) {
      errors.push(`the turn paused on a ${turn.pendingAsk.kind} ask instead of replying`);
    }
  } catch (error: unknown) {
    errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    await GptHistory.deleteOne({_id: history._id});
  }

  const foundSrcs = [...found];
  const checks: SmokeCheck[] = [
    {
      detail: errors.length > 0 ? errors.join("; ") : undefined,
      name: "the turn finished without errors",
      ok: errors.length === 0,
    },
    {
      detail: `${foundSrcs.length} photos`,
      name: `${FIND_PHOTOS_TOOL} returned photos`,
      ok: foundSrcs.length > 0,
    },
    ...checkBlocksReply({foundSrcs, reply, uiBlocks}),
  ];
  return {checks, errors, foundSrcs, ok: checks.every((check) => check.ok), reply};
};

/** One line per check, for the terminal. */
export const formatSmokeChecks = (checks: SmokeCheck[]): string[] =>
  checks.map(
    (check) =>
      `${check.ok ? "PASS" : "FAIL"} ${check.name}${check.detail ? ` (${check.detail})` : ""}`
  );

/** Save the raw reply and the check results, returning the directory. */
export const writeSmokeOutput = ({
  outDir,
  result,
}: {
  outDir?: string;
  result: BlocksSmokeResult;
}): string => {
  const dir = outDir ?? mkdtempSync(path.join(tmpdir(), "blocks-smoke-"));
  mkdirSync(dir, {recursive: true});
  writeFileSync(path.join(dir, "reply.yaml"), result.reply);
  const {checks, errors, foundSrcs, ok} = result;
  writeFileSync(
    path.join(dir, "result.json"),
    `${JSON.stringify({checks, errors, foundSrcs, ok, prompt: BLOCKS_SMOKE_PROMPT}, null, 2)}\n`
  );
  return dir;
};

/** Find or create the system user that owns smoke turns. */
const ensureSmokeUser = async (): Promise<UserDocument> => {
  const existing = await User.findOneOrNone({email: BLOCKS_SMOKE_USER_EMAIL});
  if (existing) {
    return existing as UserDocument;
  }
  return User.create({admin: false, email: BLOCKS_SMOKE_USER_EMAIL, name: BLOCKS_SMOKE_USER_NAME});
};

const runCli = async (log: BlocksSmokeLogger): Promise<number> => {
  const {outDir: argOutDir} = parseBlocksSmokeArgs({argv: process.argv.slice(2)});
  const provider = smokeModelProvider({env: process.env});
  if (!provider) {
    log.info("blocks:smoke skipped: no model key (set GOOGLE_VERTEX_PROJECT or GEMINI_API_KEY)");
    return 0;
  }
  // Loaded only with a key, so a skipped run does not set up the chat routes module.
  const {createServerModel} = await import("../api/ai");
  const model = createServerModel(process.env.BLOCKS_SMOKE_MODEL?.trim() || undefined);
  if (!model) {
    log.error(`blocks:smoke: ${provider} is configured but no model could be created`);
    return 1;
  }

  await connectToMongoDB();
  try {
    const photoCount = await PhotoLibraryEntry.countDocuments({deleted: false});
    if (photoCount === 0) {
      log.error("blocks:smoke: the photo library is empty; run `bun run photos:generate` first");
      return 1;
    }
    const user = await ensureSmokeUser();
    log.info(`blocks:smoke: ${provider} model, ${photoCount} library photos`);
    const result = await runBlocksSmoke({aiService: new AIService({model}), user});
    for (const line of formatSmokeChecks(result.checks)) {
      (line.startsWith("PASS") ? log.info : log.error)(line);
    }
    const dir = writeSmokeOutput({
      outDir: argOutDir ?? process.env.BLOCKS_SMOKE_OUT_DIR?.trim() ?? undefined,
      result,
    });
    log.info(`blocks:smoke: ${result.ok ? "passed" : "failed"}; reply saved to ${dir}`);
    return result.ok ? 0 : 1;
  } finally {
    await mongoose.disconnect();
  }
};

if (import.meta.main) {
  runCli(logger)
    .then((code) => {
      process.exit(code);
    })
    .catch((error: unknown) => {
      logger.error(`blocks:smoke: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    });
}
