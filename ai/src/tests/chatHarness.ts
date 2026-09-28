import {expect, mock, spyOn} from "bun:test";
import {once} from "node:events";
import type {AddressInfo} from "node:net";
import {TerrenoApp} from "@terreno/api";
import {jsonSchema, type LanguageModel, tool} from "ai";
import type express from "express";
import mongoose from "mongoose";

import {GptHistory} from "../models/gptHistory";
import {addGptRoutes} from "../routes/gpt";
import {addGptHistoryRoutes} from "../routes/gptHistories";
import {AIService} from "../service/aiService";
import type {GptHistoryDocument, GptRouteOptions} from "../types";
import {type authAsUser, UserModel} from "./helpers";

type ModelStreamPart = {type: string; [key: string]: unknown};

export interface ModelPromptMessage {
  content: unknown;
  role: string;
}

interface ModelTool {
  description?: string;
  inputSchema: Record<string, unknown>;
  name: string;
}

export interface ModelCallOptions {
  prompt: ModelPromptMessage[];
  toolChoice?: unknown;
  tools?: ModelTool[];
}

interface ScriptedToolCall {
  input: unknown;
  toolCallId: string;
  toolName: string;
}

type SseEvent = Record<string, unknown>;
export type Agent = Awaited<ReturnType<typeof authAsUser>>;

const USAGE = {inputTokens: 1, outputTokens: 1, totalTokens: 2};

export const PLAN_ASK_INPUT = {
  default: ["team"],
  options: [
    {description: "$0, one seat", id: "starter", label: "Starter"},
    {description: "$20 per seat", id: "team", label: "Team"},
    {id: "enterprise", label: "Enterprise"},
  ],
  prompt: "Which plan should I set up?",
  select: "one",
  submitLabel: "Set up plan",
  title: "Choose a plan",
};

export const PLAN_SIMPLE_CARD = {
  buttons: [
    {
      id: "option:team",
      label: "Team",
      response: {action: "accept", content: {selected: ["team"]}},
      style: "primary",
    },
    {
      id: "option:starter",
      label: "Starter",
      response: {action: "accept", content: {selected: ["starter"]}},
      style: "default",
    },
    {
      id: "option:enterprise",
      label: "Enterprise",
      response: {action: "accept", content: {selected: ["enterprise"]}},
      style: "default",
    },
  ],
  handoff: false,
  kind: "choice",
  text: "Which plan should I set up?",
  title: "Choose a plan",
  toolCallId: "call_plan",
};

export const REGION_ASK_INPUT = {
  options: [
    {id: "us", label: "US"},
    {id: "eu", label: "EU"},
  ],
  prompt: "Where should your data live?",
  select: "one",
};

export const REGION_SIMPLE_CARD = {
  buttons: [
    {
      id: "option:us",
      label: "US",
      response: {action: "accept", content: {selected: ["us"]}},
      style: "default",
    },
    {
      id: "option:eu",
      label: "EU",
      response: {action: "accept", content: {selected: ["eu"]}},
      style: "default",
    },
    {id: "skip", label: "Skip", response: {action: "decline"}, style: "cancel"},
  ],
  handoff: false,
  kind: "choice",
  text: "Where should your data live?",
  toolCallId: "call_region",
};

export const DUPLICATE_ID_ASK_INPUT = {
  options: [
    {id: "team", label: "Team"},
    {id: "team", label: "Team (annual)"},
  ],
  prompt: "Which plan?",
  select: "one",
};

export const PLAN_ASK_CALL = {
  input: PLAN_ASK_INPUT,
  toolCallId: "call_plan",
  toolName: "ask_choice",
};
export const REGION_ASK_CALL = {
  input: REGION_ASK_INPUT,
  toolCallId: "call_region",
  toolName: "ask_choice",
};
export const LOOKUP_CALL = {input: {}, toolCallId: "call_lookup", toolName: "lookupPlans"};

export const PLAN_ASK_ROW = {
  args: PLAN_ASK_INPUT,
  text: "Tool call: ask_choice",
  toolCallId: "call_plan",
  toolName: "ask_choice",
  type: "tool-call",
};

export const REGION_ASK_ROW = {
  args: REGION_ASK_INPUT,
  text: "Tool call: ask_choice",
  toolCallId: "call_region",
  toolName: "ask_choice",
  type: "tool-call",
};

export const ONE_ASK_AT_A_TIME = {action: "cancel", reason: "one_ask_at_a_time"};

export const PLAN_ASK_MODEL_CALL = {
  input: PLAN_ASK_INPUT,
  toolCallId: "call_plan",
  toolName: "ask_choice",
  type: "tool-call",
};

export const TEAM_ANSWER = {action: "accept", content: {selected: ["team"]}};

export const USER_PROMPT = "Set up my workspace";

export const textStep = (text: string): ModelStreamPart[] => [
  {id: "text-1", type: "text-start"},
  {delta: text, id: "text-1", type: "text-delta"},
  {id: "text-1", type: "text-end"},
  {finishReason: "stop", type: "finish", usage: USAGE},
];

export const toolCallStep = (...calls: ScriptedToolCall[]): ModelStreamPart[] => [
  ...calls.map((call) => ({
    input: JSON.stringify(call.input),
    toolCallId: call.toolCallId,
    toolName: call.toolName,
    type: "tool-call",
  })),
  {finishReason: "tool-calls", type: "finish", usage: USAGE},
];

const STREAM_FAILURE = "harness-stream-failure";

/** A scripted part that makes the model's stream fail with `message`, as a dropped connection does. */
export const streamFailure = (message: string): ModelStreamPart => ({
  message,
  type: STREAM_FAILURE,
});

/** A step that streams `text`, then fails before the step finishes. */
export const failingTextStep = (text: string, message: string): ModelStreamPart[] => [
  {id: "text-1", type: "text-start"},
  {delta: text, id: "text-1", type: "text-delta"},
  streamFailure(message),
];

const streamOf = (parts: ModelStreamPart[]): ReadableStream<ModelStreamPart> =>
  new ReadableStream<ModelStreamPart>({
    start(controller) {
      for (const part of parts) {
        if (part.type === STREAM_FAILURE) {
          controller.error(new Error(String(part.message)));
          return;
        }
        controller.enqueue(part);
      }
      controller.close();
    },
  });

export interface ModelHold {
  arrived: Deferred;
  release: Promise<void>;
}

/**
 * A mock model that streams one scripted step per call and records each call's options. The call
 * whose index is in `holds` resolves `arrived`, then waits for `release` before it streams.
 */
export const createScriptedModel = ({
  holds = {},
  modelId = "scripted-model",
  steps,
}: {
  holds?: Record<number, ModelHold>;
  modelId?: string;
  steps: ModelStreamPart[][];
}) => {
  const remaining = [...steps];
  let callCount = 0;
  return {
    doGenerate: mock(async () => ({
      content: [{text: "Workspace setup", type: "text" as const}],
      finishReason: "stop" as const,
      usage: USAGE,
    })),
    doStream: mock(async (_options: ModelCallOptions) => {
      const hold = holds[callCount];
      callCount += 1;
      if (hold) {
        hold.arrived.resolve();
        await hold.release;
      }
      const parts = remaining.shift();
      if (!parts) {
        expect.unreachable("The scripted model has no more steps");
      }
      return {stream: streamOf(parts)};
    }),
    modelId,
    provider: "mock-provider",
    specificationVersion: "v2" as const,
    supportedUrls: {},
  };
};

export type ScriptedModel = ReturnType<typeof createScriptedModel>;

export interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

export const deferred = (): Deferred => {
  let resolve = (): void => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return {promise, resolve};
};

const lastUserTextOf = (call: ModelCallOptions): string => {
  const content = call.prompt.findLast((message) => message.role === "user")?.content;
  if (!Array.isArray(content)) {
    return String(content ?? "");
  }
  return content.map((part) => (part as {text?: string}).text ?? "").join("");
};

/**
 * A scripted model for turns that run at the same time: each call streams the next step scripted
 * for its last user message. A call for a prompt in `holds` resolves `arrived`, then waits for
 * `release`, so a test can order two turns' loads, model calls, and saves.
 */
export const createPromptKeyedModel = ({
  holds = {},
  steps,
}: {
  holds?: Record<string, ModelHold>;
  steps: Record<string, ModelStreamPart[][]>;
}): ScriptedModel => {
  const remaining = new Map(Object.entries(steps).map(([prompt, list]) => [prompt, [...list]]));
  const model = createScriptedModel({steps: []});
  model.doStream.mockImplementation(async (options: ModelCallOptions) => {
    const prompt = lastUserTextOf(options);
    const hold = holds[prompt];
    if (hold) {
      hold.arrived.resolve();
      await hold.release;
    }
    const parts = remaining.get(prompt)?.shift();
    if (!parts) {
      expect.unreachable(`The scripted model has no step for "${prompt}"`);
    }
    return {stream: streamOf(parts)};
  });
  return model;
};

export const modelCall = (model: ScriptedModel, index: number): ModelCallOptions => {
  const call = model.doStream.mock.calls[index];
  if (!call) {
    expect.unreachable(`The model was not called ${index + 1} times`);
  }
  return call[0];
};

export const systemPromptOf = (call: ModelCallOptions): unknown =>
  call.prompt.find((message) => message.role === "system")?.content;

export const conversationOf = (call: ModelCallOptions): ModelPromptMessage[] =>
  call.prompt.filter((message) => message.role !== "system");

export const toolNamesOf = (call: ModelCallOptions): string[] =>
  (call.tools ?? []).map((offered) => offered.name);

export const lookupPlans = tool({
  description: "Look up how many plans exist",
  execute: async () => ({plans: 3}),
  inputSchema: jsonSchema<Record<string, never>>({properties: {}, type: "object"}),
});

/**
 * An app with the chat routes and the history routes, both given the same chat options, as the
 * example backend and `AiApp` register them.
 */
export const buildApp = ({
  model,
  ...routeOptions
}: {model: ScriptedModel} & Partial<GptRouteOptions>): express.Application =>
  new TerrenoApp({
    configureApp: (router, options) => {
      const chat: GptRouteOptions = {
        aiService: new AIService({model: model as unknown as LanguageModel}),
        openApiOptions: options,
        ...routeOptions,
      };
      addGptHistoryRoutes(router, {...options, chat});
      addGptRoutes(router, chat);
    },
    skipListen: true,
    userModel: UserModel,
  }).build();

export interface ServedApp {
  close: () => Promise<void>;
  url: string;
}

/**
 * Serves the app on a real port. An agent signed in at `url` sends every request to this server
 * instead of starting one per request, so a test can abort a request mid-turn and still close
 * the server afterwards.
 */
export const serveApp = async (app: express.Application): Promise<ServedApp> => {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const {port} = server.address() as AddressInfo;
  return {
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
    url: `http://127.0.0.1:${port}`,
  };
};

type SseStream = {on: (event: string, handler: (chunk: Buffer) => void) => void};

const collectSse = (
  res: SseStream,
  callback: (error: Error | null, body: string) => void
): void => {
  let body = "";
  res.on("data", (chunk: Buffer) => {
    body += chunk.toString();
  });
  res.on("end", () => callback(null, body));
};

const parseSse = (body: string): SseEvent[] =>
  body
    .split("\n\n")
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => JSON.parse(chunk.slice("data: ".length)) as SseEvent);

export const streamPrompt = async (
  agent: Agent,
  body: Record<string, unknown>
): Promise<{events: SseEvent[]; status: number}> => {
  const res = await agent
    .post("/gpt/prompt")
    .send(body)
    .buffer(true)
    .parse(collectSse as never);
  return {events: parseSse(res.body as string), status: res.status};
};

export const loadHistory = async (historyId: string): Promise<GptHistoryDocument> => {
  const history = await GptHistory.findById(historyId);
  if (!history) {
    expect.unreachable(`History ${historyId} not found`);
  }
  return history;
};

const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

/** The stored rows. Mongoose gives every row an empty `content` array; no row here has attachments. */
export const rowsOf = (history: GptHistoryDocument): Record<string, unknown>[] =>
  (plain(history.prompts) as Record<string, unknown>[]).map(({content, ...row}) => {
    expect(content).toEqual([]);
    return row;
  });

/** The stored pending ask without its `created` timestamp, which the test cannot know. */
export const pendingAskOf = (history: GptHistoryDocument): unknown => {
  if (!history.pendingAsk) {
    return undefined;
  }
  expect(history.pendingAsk.created).toBeInstanceOf(Date);
  const {created: _created, ...pendingAsk} = plain(history.pendingAsk) as Record<string, unknown>;
  return pendingAsk;
};

export const onlyHistoryId = async (): Promise<string> => {
  const histories = await GptHistory.find({});
  expect(histories).toHaveLength(1);
  return histories[0]._id.toString();
};

const isAskClaim = (update: unknown): boolean =>
  Array.isArray(update) &&
  (update[0] as {$set?: {pendingAsk?: {$cond?: unknown}}} | undefined)?.$set?.pendingAsk?.$cond !==
    undefined;

/**
 * Makes the next update that claims a pending ask throw, as a replica set failover would, after
 * the turn saved its rows. Call `mockRestore()` on the result when the turn ends.
 */
export const failNextAskClaim = (): {mockRestore: () => void} => {
  const findOneAndUpdate = GptHistory.findOneAndUpdate.bind(GptHistory) as (
    ...args: unknown[]
  ) => unknown;
  let hasFailed = false;
  return spyOn(GptHistory, "findOneAndUpdate").mockImplementation(((...args: unknown[]) => {
    if (!hasFailed && isAskClaim(args[1])) {
      hasFailed = true;
      throw new mongoose.Error("Primary stepped down");
    }
    return findOneAndUpdate(...args);
  }) as never);
};

/** Starts a conversation that pauses on the plan ask and returns its history id. */
export const pauseOnPlanAsk = async (agent: Agent): Promise<string> => {
  const {events} = await streamPrompt(agent, {prompt: USER_PROMPT});
  expect(events.map((event) => Object.keys(event)[0])).toEqual(["ask", "done"]);
  return onlyHistoryId();
};
