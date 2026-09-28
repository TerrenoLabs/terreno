import {randomUUID} from "node:crypto";
import {
  AIService,
  type Ask,
  type AskResponse,
  COMPACT_SURFACE_SYSTEM_PROMPT,
  TITLE_GENERATION_PROMPT,
} from "@terreno/ai";
import type {LanguageModel} from "ai";

/** The AI SDK language model spec (v3) that the demo agent implements. */
type DemoLanguageModel = Extract<LanguageModel, {specificationVersion: "v3"}>;
type DemoCallOptions = Parameters<DemoLanguageModel["doStream"]>[0];
type DemoPrompt = DemoCallOptions["prompt"];
type DemoGenerateResult = Awaited<ReturnType<DemoLanguageModel["doGenerate"]>>;
type DemoStreamResult = Awaited<ReturnType<DemoLanguageModel["doStream"]>>;
type DemoStreamPart = DemoStreamResult["stream"] extends ReadableStream<infer Part> ? Part : never;

type FormAskInput = Extract<Ask, {kind: "form"}>["input"];

export const DEMO_AGENT_MODEL_ID = "terreno-demo-agent";

/** Tool call ids look like `demo_<scenario id>_<uuid>`, so an answer finds its scenario. */
const TOOL_CALL_ID_PATTERN = /^demo_([a-z]+)_/;

interface DemoAnswer {
  /**
   * The text the model saw for each text, CSV, or JSON file of a `files` answer, by the file's
   * index. Empty for other answers.
   */
  fileTexts: ReadonlyMap<number, string>;
  /** True when the user answers on a small screen, which wants at most two short sentences. */
  isCompact: boolean;
  response: AskResponse;
}

/** A reply in two lengths: `compact` for a small screen, `full` for the chat. */
interface DemoReply {
  compact: string;
  full: string;
}

/**
 * A scripted exchange: words in the user's message start it, it calls one ask tool, and it
 * replies to the answer. Add one to DEMO_SCENARIOS for each ask kind the example app shows. On the
 * compact surface the input must also fit a simple card (at most 3 options with short labels,
 * select one), or the scenario sets `compactFallback`. Scenarios match in order, so a scenario with
 * narrower trigger words comes before a broader one.
 */
type DemoAskScenario = {
  [Kind in Ask["kind"]]: {
    /** Lowercase letters only; carried in the tool call id. */
    id: string;
    input: Extract<Ask, {kind: Kind}>["input"];
    kind: Kind;
    /**
     * Sent as text instead of the ask on the compact surface, for an input the compact ask tool
     * rejects, such as select many. Without it the scenario asks on every surface.
     */
    compactFallback?: string;
    reply: (answer: DemoAnswer) => string;
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

const TOPPING_OPTIONS = [
  {id: "cheese", label: "Extra cheese"},
  {id: "mushrooms", label: "Mushrooms"},
  {id: "olives", label: "Olives"},
  {id: "peppers", label: "Peppers"},
  {description: "Yes, on pizza", id: "pineapple", label: "Pineapple"},
  {id: "onions", label: "Red onions"},
];

const selectedIds = (content: Record<string, unknown>): string[] => {
  const {selected} = content;
  if (!Array.isArray(selected)) {
    return [];
  }
  return selected.filter((id): id is string => typeof id === "string");
};

const planReply = ({isCompact, response}: DemoAnswer): string => {
  if (response.action === "decline") {
    return isCompact
      ? "OK, I skipped the plan for now."
      : 'No problem, I skipped the plan for now. Say "pick a plan" when you want to choose one.';
  }
  if (response.action === "cancel") {
    return "The plan question was cancelled, so I did not choose a plan.";
  }
  const [selectedId] = selectedIds(response.content);
  const option = PLAN_OPTIONS.find((candidate) => candidate.id === selectedId);
  if (!option) {
    return 'I could not find that plan. Say "pick a plan" to try again.';
  }
  if (isCompact) {
    return `You picked the ${option.label} plan. A real agent would set it up now.`;
  }
  return `You picked the **${option.label}** plan (${option.description}). A real agent would set it up now. Say "pick a plan" to try another answer.`;
};

/** "A", "A and B", or "A, B, and C". */
const joinWithAnd = (items: string[]): string => {
  if (items.length <= 2) {
    return items.join(" and ");
  }
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
};

const toppingsReply = ({isCompact, response}: DemoAnswer): string => {
  if (response.action === "decline") {
    return isCompact
      ? "OK, no toppings for now."
      : 'No problem, I left the pizza as it is. Say "pick toppings" when you want to choose some.';
  }
  if (response.action === "cancel") {
    return "The toppings question was cancelled, so I did not add any toppings.";
  }
  const labels = selectedIds(response.content).map(
    (id) => TOPPING_OPTIONS.find((option) => option.id === id)?.label ?? id
  );
  const other = typeof response.content.other === "string" ? response.content.other : "";
  if (isCompact) {
    const names = other ? [...labels, other] : labels;
    return names.length === 0
      ? "OK, a plain pizza."
      : `You picked ${joinWithAnd(names)}. A real agent would add them now.`;
  }
  const picked = labels.map((label) => `**${label}**`);
  const own = other ? [`your own topping, **${other}**`] : [];
  if (picked.length + own.length === 0) {
    return 'You picked no toppings, so it is a plain pizza. Say "pick toppings" to try another answer.';
  }
  return `You picked ${joinWithAnd([...picked, ...own])}. A real agent would add them to the order now. Say "pick toppings" to try another answer.`;
};

interface ConfirmReplies {
  cancelled: string;
  confirmed: DemoReply;
  denied: DemoReply;
}

/** Replies to a confirm answer. A decline, which confirm refuses by default, counts as a deny. */
const confirmReply =
  ({cancelled, confirmed, denied}: ConfirmReplies) =>
  ({isCompact, response}: DemoAnswer): string => {
    if (response.action === "cancel") {
      return cancelled;
    }
    const reply =
      response.action === "accept" && response.content.confirmed === true ? confirmed : denied;
    return isCompact ? reply.compact : reply.full;
  };

const ANNOUNCEMENT_DRAFT = [
  "# We're live",
  "",
  "Today we launched **Terreno Asks**: your agent can now ask you a question and wait for the answer.",
  "",
  "- Pick from options",
  "- Approve or deny",
  "- Edit a draft like this one",
  "",
].join("\n");

const announcementReply = ({isCompact, response}: DemoAnswer): string => {
  if (response.action === "decline") {
    return isCompact
      ? "OK, I dropped the announcement."
      : 'No problem, I dropped the announcement. Say "draft an announcement" when you want a new draft.';
  }
  if (response.action === "cancel") {
    return "The announcement question was cancelled, so I did not post anything.";
  }
  const markdown = typeof response.content.markdown === "string" ? response.content.markdown : "";
  if (response.content.changed !== true) {
    return isCompact
      ? "You approved the draft. A real agent would post it now."
      : 'You approved the draft as is, so a real agent would post it now. Say "draft an announcement" to try another answer.';
  }
  const length = `${markdown.length.toLocaleString("en-US")} ${markdown.length === 1 ? "character" : "characters"}`;
  if (isCompact) {
    return `You edited the draft (${length}). A real agent would post it now.`;
  }
  return `You edited the draft (${length}). A real agent would post this now:\n\n---\n\n${markdown}\n\n---\n\nSay "draft an announcement" to try another answer.`;
};

const INVOICE_INPUT: FormAskInput = {
  fields: [
    {
      default: "Acme Corp",
      id: "company",
      label: "Company name",
      maxLength: 120,
      required: true,
      type: "text",
    },
    {
      default: "billing@acme.example",
      id: "email",
      label: "Billing email",
      required: true,
      type: "email",
    },
    {
      helperText: "We call this number if a payment fails.",
      id: "phone",
      label: "Callback phone",
      type: "phone",
    },
    {default: 5, id: "seats", integer: true, label: "Seats", max: 500, min: 1, type: "number"},
    {id: "start", label: "Start date", type: "date"},
    {
      default: "us",
      id: "region",
      label: "Region",
      options: [
        {id: "us", label: "United States"},
        {id: "eu", label: "European Union"},
      ],
      type: "select",
    },
    {default: true, id: "notify", label: "Email me the invoice", type: "boolean"},
    {id: "notes", label: "Notes for the invoice", maxLength: 500, type: "textarea"},
  ],
  prompt: "Here are the invoice details I have on file. Fix anything, then send them.",
  submitLabel: "Send details",
  title: "Invoice details",
};

/** One sent value as the reply shows it: Yes or No, an option's label, or the value itself. */
const invoiceValueText = (field: FormAskInput["fields"][number], value: unknown): string => {
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  if (field.type === "select") {
    return field.options.find((option) => option.id === value)?.label ?? String(value);
  }
  return String(value);
};

const invoiceReply = ({isCompact, response}: DemoAnswer): string => {
  if (response.action === "decline") {
    return isCompact
      ? "OK, no invoice for now."
      : 'No problem, I did not create an invoice. Say "invoice details" when you want to fill them in.';
  }
  if (response.action === "cancel") {
    return "The invoice question was cancelled, so I did not create an invoice.";
  }
  const {values} = response.content;
  const sent =
    typeof values === "object" && values !== null ? (values as Record<string, unknown>) : {};
  const fields = INVOICE_INPUT.fields.filter((field) => Object.hasOwn(sent, field.id));
  if (isCompact) {
    const count = `${fields.length} ${fields.length === 1 ? "field" : "fields"}`;
    return `You sent the invoice details (${count}). A real agent would create the invoice now.`;
  }
  return [
    "Thanks. A real agent would create the invoice with these details:",
    "",
    ...fields.map((field) => `- **${field.label}:** ${invoiceValueText(field, sent[field.id])}`),
    "",
    'Say "invoice details" to try another answer.',
  ].join("\n");
};

const FILE_TYPE_LABELS: Record<string, string> = {
  "application/json": "JSON file",
  "application/pdf": "PDF",
  "image/gif": "GIF image",
  "image/jpeg": "JPEG image",
  "image/png": "PNG image",
  "image/webp": "WebP image",
  "text/csv": "CSV file",
  "text/plain": "text file",
};

const FIRST_LINE_MAX_LENGTH = 120;

interface SentFile {
  filename: string;
  mimeType: string;
  size: number;
}

/** The files of a stored `files` answer: metadata only, since the bytes reach the model as parts. */
const sentFiles = (content: Record<string, unknown>): SentFile[] => {
  const {files} = content;
  if (!Array.isArray(files)) {
    return [];
  }
  return files.flatMap((file): SentFile[] => {
    const {filename, mimeType, size} = (file ?? {}) as Record<string, unknown>;
    if (typeof filename !== "string" || typeof mimeType !== "string" || typeof size !== "number") {
      return [];
    }
    return [{filename, mimeType, size}];
  });
};

const firstLine = (text: string): string => {
  const [line = ""] = text.split(/\r?\n/);
  const trimmed = line.trim();
  return trimmed.length > FIRST_LINE_MAX_LENGTH
    ? `${trimmed.slice(0, FIRST_LINE_MAX_LENGTH)}…`
    : trimmed;
};

const byteCount = (size: number): string =>
  `${size.toLocaleString("en-US")} ${size === 1 ? "byte" : "bytes"}`;

const receiptReply = ({fileTexts, isCompact, response}: DemoAnswer): string => {
  if (response.action === "decline") {
    return isCompact
      ? "OK, no receipt for now."
      : 'No problem, I did not file a receipt. Say "upload a receipt" when you have one.';
  }
  if (response.action === "cancel") {
    return "The receipt question was cancelled, so I did not file a receipt.";
  }
  const files = sentFiles(response.content);
  const count = `${files.length} ${files.length === 1 ? "file" : "files"}`;
  if (isCompact) {
    return `You sent ${count}. A real agent would add them to your expense report now.`;
  }
  const lines = files.map(({filename, mimeType, size}, index) => {
    const summary = `- **${filename}**: ${FILE_TYPE_LABELS[mimeType] ?? mimeType}, ${byteCount(size)}`;
    const text = fileTexts.get(index);
    return text === undefined ? summary : `${summary}. First line: "${firstLine(text)}"`;
  });
  return [
    `You sent ${count}:`,
    "",
    ...lines,
    "",
    'A real agent would add them to your expense report now. Say "upload a receipt" to try another answer.',
  ].join("\n");
};

const DEMO_SCENARIOS: DemoAskScenario[] = [
  {
    compactFallback:
      'Editing a draft needs a bigger screen. Open the chat on your phone and say "draft an announcement".',
    id: "announcement",
    input: {
      initial: ANNOUNCEMENT_DRAFT,
      maxLength: 2000,
      minLength: 40,
      placeholder: "Write the announcement",
      prompt: "Here is a draft of the launch announcement. Edit it, or approve it as is.",
      submitLabel: "Post it",
      title: "Launch announcement",
    },
    kind: "markdown",
    reply: announcementReply,
    title: "Drafting an announcement",
    trigger: /\bannouncements?\b/i,
  },
  {
    compactFallback:
      'Filling in a form needs a bigger screen. Open the chat on your phone and say "invoice details".',
    id: "invoice",
    input: INVOICE_INPUT,
    kind: "form",
    reply: invoiceReply,
    title: "Filling in invoice details",
    trigger: /\b(invoices?|forms?)\b/i,
  },
  {
    compactFallback:
      'Uploading a receipt needs a bigger screen. Open the chat on your phone and say "upload a receipt".',
    id: "receipt",
    input: {
      accept: ["image", "pdf", "text", "csv"],
      maxFiles: 3,
      prompt:
        "Upload the receipt for your expense report: a photo, a PDF, or a text or CSV export.",
      submitLabel: "Send receipt",
      title: "Upload a receipt",
    },
    kind: "files",
    reply: receiptReply,
    title: "Uploading a receipt",
    trigger:
      /\b(receipts?|upload\s+(?:(?:a|an|my|some|the)\s+)?(?:files?|documents?|photos?|images?))\b/i,
  },
  {
    compactFallback:
      'Picking several toppings needs a bigger screen. Open the chat on your phone and say "pick toppings".',
    id: "toppings",
    input: {
      allowOther: true,
      default: ["cheese", "mushrooms"],
      maxSelected: 3,
      options: TOPPING_OPTIONS,
      otherLabel: "Another topping",
      prompt: "Which toppings should I add? Pick up to three.",
      select: "many",
      submitLabel: "Add toppings",
      title: "Build your pizza",
    },
    kind: "choice",
    reply: toppingsReply,
    title: "Building a pizza",
    trigger: /\btoppings?\b/i,
  },
  {
    id: "report",
    input: {
      confirmLabel: "Send report",
      denyLabel: "Not now",
      prompt: "Send the weekly report to the team now? It goes to 8 people.",
      title: "Send the weekly report",
    },
    kind: "confirm",
    reply: confirmReply({
      cancelled: "The weekly report question was cancelled, so I did not send it.",
      confirmed: {
        compact: "OK. A real agent would send the weekly report now.",
        full: 'You said yes, so a real agent would send the **weekly report** to the team now. Say "send the weekly report" to try another answer.',
      },
      denied: {
        compact: "OK, I did not send the report.",
        full: 'OK, I did not send the weekly report. Say "send the weekly report" to try another answer.',
      },
    }),
    title: "Sending the weekly report",
    trigger: /\bweekly report\b/i,
  },
  {
    id: "archive",
    input: {
      confirmLabel: "Archive 12 chats",
      denyLabel: "Keep them",
      destructive: true,
      prompt: "Archive the 12 chats older than 90 days? You can't undo this.",
      title: "Archive old chats",
    },
    kind: "confirm",
    reply: confirmReply({
      cancelled: "The archive question was cancelled, so I kept your chats.",
      confirmed: {
        compact: "Confirmed. A real agent would archive 12 chats now.",
        full: 'You confirmed, so a real agent would archive the **12 chats** older than 90 days now. This demo archived nothing. Say "archive old chats" to try another answer.',
      },
      denied: {
        compact: "OK, I kept your chats.",
        full: 'OK, I kept all your chats. Say "archive old chats" to try another answer.',
      },
    }),
    title: "Archiving old chats",
    trigger: /\barchive\b/i,
  },
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

const DEMO_HELP_REPLY: DemoReply = {
  compact: `I'm the Terreno demo agent. Say "help me pick a plan" or "archive old chats" to try an ask.`,
  full: [
    "I'm the Terreno demo agent. This server has no AI model configured, so I follow a script.",
    'Say "help me pick a plan" and I will ask you to choose one right here in the chat, or "pick toppings" to choose several with an answer of your own.',
    'Say "send the weekly report" or "archive old chats" and I will ask you to confirm before I act. Archiving shows a destructive button, because it cannot be undone.',
    'Say "draft an announcement" and I will ask you to edit my draft in a markdown editor, then send it back.',
    'Say "invoice details" and I will ask you to check a short form, with a date, a number, and a few other field types, then send it.',
    'Say "upload a receipt" and I will ask you for a photo, a PDF, or a text or CSV file, then tell you what arrived.',
    "To talk to a real model, set GEMINI_API_KEY on the server or save a Gemini API key on the Profile tab.",
  ].join("\n\n"),
};

const DEMO_ASKS_OFF_REPLY: DemoReply = {
  compact: "Asks are turned off on this server, so I cannot ask you to choose.",
  full: "Asks are turned off on this server, so I cannot ask you to choose. Pass `asks: true` to addGptRoutes to turn them on.",
};

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

type DemoToolMessage = Extract<DemoPrompt[number], {role: "tool"}>;
type DemoToolOutput = Extract<DemoToolMessage["content"][number], {type: "tool-result"}>["output"];
type DemoContentPart = Extract<DemoToolOutput, {type: "content"}>["value"][number];

/** The line the chat turn puts before each file of a `files` answer. */
const FILE_HEADER_PATTERN = /^File (\d+) of \d+: /;

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/**
 * A `files` answer reaches the model as content: the stored answer as JSON, then each file after a
 * "File i of n" line. The text part right after a file's line is that file's text; an image or PDF
 * is a data part instead.
 */
const fileTextsOf = (parts: DemoContentPart[]): Map<number, string> => {
  const texts = new Map<number, string>();
  let current: number | undefined;
  for (const part of parts) {
    if (part.type !== "text") {
      current = undefined;
      continue;
    }
    if (current !== undefined) {
      texts.set(current, part.text);
      current = undefined;
      continue;
    }
    const header = FILE_HEADER_PATTERN.exec(part.text);
    if (header) {
      current = Number(header[1]) - 1;
    }
  }
  return texts;
};

interface DemoToolAnswer {
  fileTexts: ReadonlyMap<number, string>;
  response: AskResponse;
}

const answerOf = (output: DemoToolOutput): DemoToolAnswer | undefined => {
  if (output.type === "json") {
    return isAskResponse(output.value) ? {fileTexts: new Map(), response: output.value} : undefined;
  }
  if (output.type !== "content") {
    return undefined;
  }
  const [first, ...rest] = output.value;
  const stored = first?.type === "text" ? parseJson(first.text) : undefined;
  return isAskResponse(stored) ? {fileTexts: fileTextsOf(rest), response: stored} : undefined;
};

/** The user's answer when the conversation ends with an ask's tool result. */
const lastAskAnswer = (prompt: DemoPrompt): (DemoToolAnswer & {toolCallId: string}) | undefined => {
  const message = prompt.at(-1);
  if (message?.role !== "tool") {
    return undefined;
  }
  for (const part of message.content) {
    if (part.type !== "tool-result" || !part.toolName.startsWith("ask_")) {
      continue;
    }
    const answer = answerOf(part.output);
    if (answer) {
      return {...answer, toolCallId: part.toolCallId};
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

/** The chat turn adds the compact line to the system prompt when the user is on a small screen. */
const isCompactSurface = (prompt: DemoPrompt): boolean =>
  prompt.some(
    (message) =>
      message.role === "system" && message.content.includes(COMPACT_SURFACE_SYSTEM_PROMPT)
  );

/** Picks the demo agent's next step: reply to an answer, ask a scenario's question, or explain. */
const planDemoTurn = ({prompt, tools}: Pick<DemoCallOptions, "prompt" | "tools">): DemoTurn => {
  const isCompact = isCompactSurface(prompt);
  const replyFor = (reply: DemoReply): DemoTextTurn => ({
    text: isCompact ? reply.compact : reply.full,
    type: "text",
  });

  const answer = lastAskAnswer(prompt);
  if (answer) {
    const scenario = scenarioForToolCall(answer.toolCallId);
    return {
      text: scenario
        ? scenario.reply({fileTexts: answer.fileTexts, isCompact, response: answer.response})
        : "Thanks for answering.",
      type: "text",
    };
  }

  const scenario = matchScenario(lastUserText(prompt));
  if (!scenario) {
    return replyFor(DEMO_HELP_REPLY);
  }

  const toolName = `ask_${scenario.kind}`;
  const offeredAskTools = (tools ?? []).flatMap((tool) =>
    tool.type === "function" && tool.name.startsWith("ask_") ? [tool.name] : []
  );
  if (offeredAskTools.length === 0) {
    return replyFor(DEMO_ASKS_OFF_REPLY);
  }
  if (isCompact && scenario.compactFallback) {
    return {text: scenario.compactFallback, type: "text"};
  }
  if (!offeredAskTools.includes(toolName)) {
    return replyFor(DEMO_ASKS_OFF_REPLY);
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
