import {randomUUID} from "node:crypto";
import {AIService, type Ask, type AskResponse, TITLE_GENERATION_PROMPT} from "@terreno/ai";
import type {LanguageModel} from "ai";

/** The AI SDK language model spec (v3) that the demo agent implements. */
type DemoLanguageModel = Extract<LanguageModel, {specificationVersion: "v3"}>;
type DemoCallOptions = Parameters<DemoLanguageModel["doStream"]>[0];
type DemoPrompt = DemoCallOptions["prompt"];
type DemoGenerateResult = Awaited<ReturnType<DemoLanguageModel["doGenerate"]>>;
type DemoStreamResult = Awaited<ReturnType<DemoLanguageModel["doStream"]>>;
type DemoStreamPart = DemoStreamResult["stream"] extends ReadableStream<infer Part> ? Part : never;

export const DEMO_AGENT_MODEL_ID = "terreno-demo-agent";

/** Tool call ids look like `demo_<scenario id>_<uuid>`, so an answer finds its scenario. */
const TOOL_CALL_ID_PATTERN = /^demo_([a-z]+)_/;

/**
 * A scripted exchange: words in the user's message start it, it calls one ask tool, and it
 * replies to the answer. Add one to DEMO_SCENARIOS for each ask kind the example app shows.
 */
type DemoAskScenario = {
  [Kind in Ask["kind"]]: {
    /** Lowercase letters only; carried in the tool call id. */
    id: string;
    input: Extract<Ask, {kind: Kind}>["input"];
    kind: Kind;
    reply: (response: AskResponse) => string;
    /** Conversation title once the user answers. */
    title: string;
    trigger: RegExp;
  };
}[Ask["kind"]];

interface DemoAskTurn {
  input: DemoAskScenario["input"];
  toolCallId: string;
  toolName: string;
  type: "ask";
}

interface DemoTextTurn {
  text: string;
  type: "text";
}

type DemoTurn = DemoAskTurn | DemoTextTurn;

const PLAN_OPTIONS = [
  {description: "Free for one person", id: "starter", label: "Starter"},
  {description: "$20 per seat each month", id: "team", label: "Team"},
  {description: "SSO, audit logs, and a support contract", id: "enterprise", label: "Enterprise"},
];

const selectedIds = (content: Record<string, unknown>): string[] => {
  const {selected} = content;
  if (!Array.isArray(selected)) {
    return [];
  }
  return selected.filter((id): id is string => typeof id === "string");
};

const planReply = (response: AskResponse): string => {
  if (response.action === "decline") {
    return 'No problem, I skipped the plan for now. Say "pick a plan" when you want to choose one.';
  }
  if (response.action === "cancel") {
    return "The plan question was cancelled, so I did not choose a plan.";
  }
  const [selectedId] = selectedIds(response.content);
  const option = PLAN_OPTIONS.find((candidate) => candidate.id === selectedId);
  if (!option) {
    return 'I could not find that plan. Say "pick a plan" to try again.';
  }
  return `You picked the **${option.label}** plan (${option.description}). A real agent would set it up now. Say "pick a plan" to try another answer.`;
};

const DEMO_SCENARIOS: DemoAskScenario[] = [
  {
    id: "plan",
    input: {
      default: ["team"],
      options: PLAN_OPTIONS,
      prompt: "Which plan should I set up for your workspace?",
      select: "one",
      title: "Choose a plan",
    },
    kind: "choice",
    reply: planReply,
    title: "Choosing a plan",
    trigger: /\b(choos\w*|chose|pick\w*|plans?)\b/i,
  },
];

const DEMO_HELP_REPLY = [
  "I'm the Terreno demo agent. This server has no AI model configured, so I follow a script.",
  'Say "help me pick a plan" and I will ask you to choose one right here in the chat.',
  "To talk to a real model, set GEMINI_API_KEY on the server or save a Gemini API key on the Profile tab.",
].join("\n\n");

const DEMO_ASKS_OFF_REPLY =
  "Asks are turned off on this server, so I cannot ask you to choose. Pass `asks: true` to addGptRoutes to turn them on.";

const DEMO_NO_MODEL_REPLY =
  "The Terreno demo agent only scripts chat. Set GEMINI_API_KEY to use a real model.";

const DEMO_DEFAULT_TITLE = "Demo agent chat";

const lastUserText = (prompt: DemoPrompt): string => {
  const message = prompt.findLast((candidate) => candidate.role === "user");
  if (message?.role !== "user") {
    return "";
  }
  return message.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join(" ")
    .trim();
};

const isAskResponse = (value: unknown): value is AskResponse => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const {action} = value as {action?: unknown};
  return action === "accept" || action === "decline" || action === "cancel";
};

/** The user's answer when the conversation ends with an ask's tool result. */
const lastAskAnswer = (
  prompt: DemoPrompt
): {response: AskResponse; toolCallId: string} | undefined => {
  const message = prompt.at(-1);
  if (message?.role !== "tool") {
    return undefined;
  }
  for (const part of message.content) {
    if (
      part.type === "tool-result" &&
      part.toolName.startsWith("ask_") &&
      part.output.type === "json" &&
      isAskResponse(part.output.value)
    ) {
      return {response: part.output.value, toolCallId: part.toolCallId};
    }
  }
  return undefined;
};

const scenarioForToolCall = (toolCallId: string): DemoAskScenario | undefined => {
  const id = TOOL_CALL_ID_PATTERN.exec(toolCallId)?.[1];
  return DEMO_SCENARIOS.find((scenario) => scenario.id === id);
};

const matchScenario = (text: string): DemoAskScenario | undefined =>
  DEMO_SCENARIOS.find((scenario) => scenario.trigger.test(text));

/** Picks the demo agent's next step: reply to an answer, ask a scenario's question, or explain. */
const planDemoTurn = ({prompt, tools}: Pick<DemoCallOptions, "prompt" | "tools">): DemoTurn => {
  const answer = lastAskAnswer(prompt);
  if (answer) {
    const scenario = scenarioForToolCall(answer.toolCallId);
    return {
      text: scenario ? scenario.reply(answer.response) : "Thanks for answering.",
      type: "text",
    };
  }

  const scenario = matchScenario(lastUserText(prompt));
  if (!scenario) {
    return {text: DEMO_HELP_REPLY, type: "text"};
  }

  const toolName = `ask_${scenario.kind}`;
  const isOffered = (tools ?? []).some(
    (tool) => tool.type === "function" && tool.name === toolName
  );
  if (!isOffered) {
    return {text: DEMO_ASKS_OFF_REPLY, type: "text"};
  }
  return {
    input: scenario.input,
    toolCallId: `demo_${scenario.id}_${randomUUID()}`,
    toolName,
    type: "ask",
  };
};

/** Title requests send `User: …\nAssistant: …`; only the user's part names the scenario. */
const demoTitle = (prompt: DemoPrompt): string => {
  const snippet = lastUserText(prompt);
  const userText = /^User: ([\s\S]*?)\nAssistant:/.exec(snippet)?.[1] ?? snippet;
  return matchScenario(userText)?.title ?? DEMO_DEFAULT_TITLE;
};

const isTitleRequest = (prompt: DemoPrompt): boolean =>
  prompt.some(
    (message) => message.role === "system" && message.content === TITLE_GENERATION_PROMPT
  );

const ZERO_USAGE: DemoGenerateResult["usage"] = {
  inputTokens: {cacheRead: 0, cacheWrite: 0, noCache: 0, total: 0},
  outputTokens: {reasoning: 0, text: 0, total: 0},
};

const toStreamParts = (turn: DemoTurn): DemoStreamPart[] => {
  if (turn.type === "ask") {
    return [
      {type: "stream-start", warnings: []},
      {
        input: JSON.stringify(turn.input),
        toolCallId: turn.toolCallId,
        toolName: turn.toolName,
        type: "tool-call",
      },
      {finishReason: {raw: "tool-calls", unified: "tool-calls"}, type: "finish", usage: ZERO_USAGE},
    ];
  }
  return [
    {type: "stream-start", warnings: []},
    {id: "text-1", type: "text-start"},
    {delta: turn.text, id: "text-1", type: "text-delta"},
    {id: "text-1", type: "text-end"},
    {finishReason: {raw: "stop", unified: "stop"}, type: "finish", usage: ZERO_USAGE},
  ];
};

const streamOf = (parts: DemoStreamPart[]): ReadableStream<DemoStreamPart> =>
  new ReadableStream<DemoStreamPart>({
    start(controller) {
      for (const part of parts) {
        controller.enqueue(part);
      }
      controller.close();
    },
  });

/**
 * A scripted language model for servers without an AI model. It streams chat turns from
 * DEMO_SCENARIOS so the example app can show asks without an API key; other calls get a short
 * notice, and title requests get the scenario's title.
 */
export const createDemoAgentModel = (): DemoLanguageModel => ({
  doGenerate: async ({prompt}) => ({
    content: [
      {text: isTitleRequest(prompt) ? demoTitle(prompt) : DEMO_NO_MODEL_REPLY, type: "text"},
    ],
    finishReason: {raw: "stop", unified: "stop"},
    usage: ZERO_USAGE,
    warnings: [],
  }),
  doStream: async ({prompt, tools}) => ({
    stream: streamOf(toStreamParts(planDemoTurn({prompt, tools}))),
  }),
  modelId: DEMO_AGENT_MODEL_ID,
  provider: "terreno-demo",
  specificationVersion: "v3",
  supportedUrls: {},
});

export const createDemoAgentService = (): AIService =>
  new AIService({model: createDemoAgentModel()});
