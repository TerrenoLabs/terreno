/**
 * Seed a complete local AI observability workspace for the example app. Each prompt the app
 * reads from the registry (example-summarize, joke-generator, chat-assistant) gets labelled
 * versions, a golden dataset, and finished experiments, plus traces with scores and a human
 * review queue in every status. A human question-set batch of the 10 newest summaries has 8 items
 * answered and two LLM judges run over it, so judge-vs-human agreement shows a judge that matches
 * reviewers and one that does not. Experiments run through the real LocalExperimentRunner against
 * a deterministic fixture client, so gates, outliers, and promote rules behave as they do for
 * live runs.
 */

import {randomUUID} from "node:crypto";
import {
  LocalDatasetStore,
  LocalEvaluatorStore,
  LocalExperimentRunner,
  LocalPromptStore,
  LocalReviewBatchStore,
  LocalReviewStore,
  LocalScoreSink,
  LocalTraceStore,
  type ObservabilityGenerateClient,
  type ScoreRecord,
  type SpanRecord,
  TemperaturePresets,
  type TraceRecord,
} from "@terreno/ai";
import {BackgroundTask, type SeedChangeResult} from "@terreno/api";
import {DateTime} from "luxon";
import {User} from "../models/user";

export const SEED_FIXTURE_MODEL_ID = "seed-fixture";
export const SUMMARIZE_GOLD_DATASET_NAME = "example-summarize-gold";
export const JOKE_DATASET_NAME = "joke-generator-topics";
export const CHAT_DATASET_NAME = "chat-assistant-gold";
export const SUMMARIZE_EXPERIMENT_V1_V2 = "Summarize v1 vs v2 (gold)";
export const SUMMARIZE_EXPERIMENT_V2_V3 = "Summarize v2 vs v3 (length cap)";
export const JOKE_EXPERIMENT = "Jokes v1 vs v2 (one-liners)";
export const CHAT_EXPERIMENT = "Chat assistant v1 vs v2 (brevity)";
export const SUMMARY_QUESTION_SET = "summary-review-questions";
export const SUMMARY_CAREFUL_JUDGE = "summary-questions-judge";
export const SUMMARY_QUICK_JUDGE = "summary-questions-judge-quick";
export const SUMMARY_REVIEW_BATCH = "Recent summaries — batch 1";

const SEED_TRACE_SESSION_PREFIX = "seed-obs-";
const TRACE_MODEL_ID = "gemini-2.5-flash";
const TRACE_PRICE = {inputPerMTok: 0.1, outputPerMTok: 0.4};

interface FixtureOutput {
  confidence?: number;
  correct?: boolean;
  helpfulness: number;
  text: string;
}

interface FixtureRow {
  expected?: string;
  input: Record<string, string>;
  // Canned generation per prompt version number.
  outputs: Record<number, FixtureOutput>;
  tags: string[];
}

interface Threshold {
  aggregate: "mean" | "trueRate";
  dimension: string;
  evaluatorName: string;
  op: "eq" | "gte" | "lte";
  value: number;
}

interface PromptVersionSeed {
  outputSchema: Record<string, unknown>;
  system: string;
}

interface PromptSuite {
  dataset: {
    description: string;
    name: string;
    rows: FixtureRow[];
    tags: string[];
    unproofread?: Array<{expectedOutput?: string; input: Record<string, string>; tags: string[]}>;
  };
  description: string;
  experiments: Array<{
    evaluators: string[];
    name: string;
    thresholds: Threshold[];
    versions: number[];
  }>;
  name: string;
  staging: number;
  tags: string[];
  temperature: number;
  template: string;
  variables: Array<{key: string; label: string}>;
  versions: PromptVersionSeed[];
}

const correctnessGate: Threshold = {
  aggregate: "trueRate",
  dimension: "correct",
  evaluatorName: "correctness",
  op: "gte",
  value: 0.8,
};
const helpfulnessGate: Threshold = {
  aggregate: "mean",
  dimension: "helpfulness",
  evaluatorName: "helpfulness",
  op: "gte",
  value: 0.75,
};
const schemaGate: Threshold = {
  aggregate: "trueRate",
  dimension: "schema_valid",
  evaluatorName: "schema-assert",
  op: "eq",
  value: 1,
};

// v1 and v2 match the base seed's EXAMPLE_SUMMARIZE_PROMPT versions; this seed appends v3.
// v1 adds unsupported claims on two rows (fails correctness); v2 passes every gate; v3 overruns
// its 120-character cap on two rows (fails schema-assert).
const SUMMARIZE_SUITE: PromptSuite = {
  dataset: {
    description:
      "Golden summaries of Terreno feature descriptions. Experiments compare example-summarize versions against these rows.",
    name: SUMMARIZE_GOLD_DATASET_NAME,
    rows: [
      {
        expected: "Terreno provides the common app plumbing so teams write only business logic.",
        input: {
          text: "Terreno ships auth, CRUD APIs, admin screens, permissions, and an AI service so app code can focus on business logic.",
        },
        outputs: {
          1: {
            correct: true,
            helpfulness: 0.85,
            text: "Terreno bundles auth, CRUD APIs, admin, permissions, and AI so developers focus on business logic.",
          },
          2: {
            correct: true,
            helpfulness: 0.9,
            text: "Terreno includes the common app plumbing, so app code is just business logic.",
          },
          3: {
            correct: true,
            helpfulness: 0.8,
            text: "Terreno ships auth, CRUD APIs, admin screens, permissions, and an AI service out of the box, so teams skip the undifferentiated work and spend their time on business logic.",
          },
        },
        tags: ["framework"],
      },
      {
        expected: "One React Native codebase produces the iOS, Android, and web apps.",
        input: {
          text: "One React Native codebase builds the iOS, Android, and web apps, and the web build is not a separate project.",
        },
        outputs: {
          1: {
            correct: false,
            helpfulness: 0.6,
            text: "A single React Native codebase builds iOS, Android, and web, and it is the fastest cross-platform stack available.",
          },
          2: {
            correct: true,
            helpfulness: 0.9,
            text: "One React Native codebase produces the iOS, Android, and web apps.",
          },
          3: {
            correct: true,
            helpfulness: 0.85,
            text: "One React Native codebase builds iOS, Android, and web with no separate web project.",
          },
        },
        tags: ["universal"],
      },
      {
        expected: "SyncDB queues offline writes locally and replays them on reconnect.",
        input: {
          text: "SyncDB keeps a local copy of each synced collection, queues writes in a durable outbox while offline, and replays them when the socket reconnects.",
        },
        outputs: {
          1: {
            correct: true,
            helpfulness: 0.8,
            text: "SyncDB stores data locally, queues offline writes, and replays them on reconnect.",
          },
          2: {
            correct: true,
            helpfulness: 0.9,
            text: "SyncDB queues offline writes locally and replays them when the connection returns.",
          },
          3: {
            correct: true,
            helpfulness: 0.85,
            text: "SyncDB keeps local copies and replays queued offline writes on reconnect.",
          },
        },
        tags: ["syncdb"],
      },
      {
        expected: "Prompt edits create immutable versions; production moves only on promotion.",
        input: {
          text: "Prompt versions are immutable. Saving an edit creates a new version, and the production label moves only when an operator promotes one.",
        },
        outputs: {
          1: {
            correct: true,
            helpfulness: 0.85,
            text: "Prompt edits create new immutable versions, and production moves only on explicit promotion.",
          },
          2: {
            correct: true,
            helpfulness: 0.85,
            text: "Each prompt edit is a new immutable version; production moves only on promotion.",
          },
          3: {
            correct: true,
            helpfulness: 0.75,
            text: "Every saved prompt edit becomes a new immutable version, and the production label stays where it is until an operator explicitly promotes a different version.",
          },
        },
        tags: ["prompts"],
      },
      {
        expected:
          "Experiments compare prompt versions on proofread data and block promotion on failed gates.",
        input: {
          text: "An experiment runs two or three prompt versions over a proofread dataset and blocks promotion when any score gate fails.",
        },
        outputs: {
          1: {
            correct: false,
            helpfulness: 0.55,
            text: "Experiments compare prompt versions on a dataset and automatically promote the winner.",
          },
          2: {
            correct: true,
            helpfulness: 0.9,
            text: "Experiments compare prompt versions on proofread data and block promotion on failed gates.",
          },
          3: {
            correct: true,
            helpfulness: 0.85,
            text: "Experiments run 2–3 prompt versions on proofread data and block promotion if a gate fails.",
          },
        },
        tags: ["experiments"],
      },
      {
        expected: "Traces needing a human decision go to a review queue for scoring.",
        input: {
          text: "Traces that need a human decision go to the review queue, where a reviewer scores each one against the evaluator's dimensions.",
        },
        outputs: {
          1: {
            confidence: 0.55,
            correct: true,
            helpfulness: 0.8,
            text: "Traces needing a human call go to a review queue where reviewers score them.",
          },
          2: {
            correct: true,
            helpfulness: 0.85,
            text: "Traces that need a human decision are queued for reviewers to score.",
          },
          3: {
            correct: true,
            helpfulness: 0.85,
            text: "Reviewers score queued traces against each evaluator dimension.",
          },
        },
        tags: ["review"],
      },
      {
        expected:
          "Rate limiting is opt-in; an empty config enables memory buckets with tighter auth limits.",
        input: {
          text: "Rate limiting is opt-in. Passing an empty object turns on in-memory buckets with stricter limits on auth routes.",
        },
        outputs: {
          1: {
            correct: true,
            helpfulness: 0.8,
            text: "Rate limiting is opt-in, and an empty config enables in-memory buckets with stricter auth limits.",
          },
          2: {
            correct: true,
            helpfulness: 0.85,
            text: "Rate limiting is opt-in; an empty config turns on memory buckets with tighter auth limits.",
          },
          3: {
            correct: true,
            helpfulness: 0.8,
            text: "Opt-in rate limiting uses in-memory buckets, stricter on auth routes.",
          },
        },
        tags: ["api"],
      },
      {
        expected: "Feature flags target user segments and update live over the socket.",
        input: {
          text: "Feature flags can target segments of users and update in running apps over the realtime socket without a redeploy.",
        },
        outputs: {
          1: {
            correct: true,
            helpfulness: 0.85,
            text: "Feature flags target user segments and update running apps over the socket without redeploying.",
          },
          2: {
            correct: true,
            helpfulness: 0.9,
            text: "Feature flags target user segments and update live apps over the socket, no redeploy.",
          },
          3: {
            correct: true,
            helpfulness: 0.85,
            text: "Segment-targeted feature flags update running apps live over the socket.",
          },
        },
        tags: ["feature-flags"],
      },
    ],
    tags: ["example", "gold", "summarization"],
    // Unproofread rows show the "needs review" count and are excluded from experiments by default.
    unproofread: [
      {
        expectedOutput:
          "Jobs retry with backoff and land in a dead-letter queue after the last attempt.",
        input: {
          text: "Durable jobs retry with exponential backoff, and a job that fails its last attempt moves to the dead-letter queue for an operator.",
        },
        tags: ["jobs", "synthetic"],
      },
      {
        expectedOutput: "Comms sends mail, SMS, and push through pluggable providers.",
        input: {
          text: "The comms package sends mail, SMS, and push notifications through pluggable providers and records every delivery attempt.",
        },
        tags: ["comms", "synthetic"],
      },
    ],
  },
  description: "Todos → Summarize in the example app",
  experiments: [
    {
      evaluators: ["schema-assert", "correctness", "helpfulness"],
      name: SUMMARIZE_EXPERIMENT_V1_V2,
      thresholds: [correctnessGate, helpfulnessGate, schemaGate],
      versions: [1, 2],
    },
    {
      evaluators: ["schema-assert", "correctness", "helpfulness"],
      name: SUMMARIZE_EXPERIMENT_V2_V3,
      thresholds: [correctnessGate, helpfulnessGate, schemaGate],
      versions: [2, 3],
    },
  ],
  name: "example-summarize",
  staging: 3,
  tags: ["example", "summarization"],
  temperature: 0.3,
  template: "Summarize the following text:\n\n{{text}}",
  variables: [{key: "text", label: "Source text"}],
  versions: [
    {
      outputSchema: {type: "string"},
      system: "Write one faithful, concise sentence that preserves the source meaning.",
    },
    {
      outputSchema: {type: "string"},
      system: "Write one faithful sentence of at most 20 words that preserves the source meaning.",
    },
    {
      outputSchema: {maxLength: 120, type: "string"},
      system:
        "Write one detailed sentence that a new teammate could act on, keeping every concrete item.",
    },
  ],
};

// The template matches the prompt text the example's generate_joke tool sends.
// v1 rambles (fails the helpfulness gate); v2 one-liners pass every gate.
const JOKE_SUITE: PromptSuite = {
  dataset: {
    description: "Topics and styles the chat's generate_joke tool receives.",
    name: JOKE_DATASET_NAME,
    rows: [
      {
        input: {style: "pun", topic: "git"},
        outputs: {
          1: {
            helpfulness: 0.6,
            text: "Git and I have a lot in common. We both commit too fast and then spend hours trying to revert. At least git keeps a log.",
          },
          2: {helpfulness: 0.85, text: "I'd tell you a git joke, but you'd just fork it."},
        },
        tags: ["dev"],
      },
      {
        input: {style: "dad joke", topic: "kubernetes"},
        outputs: {
          1: {
            helpfulness: 0.7,
            text: "My kids asked why I love Kubernetes. I told them it's the only thing in my life that restarts itself when it fails.",
          },
          2: {
            helpfulness: 0.8,
            text: "Kubernetes is like my kids: nothing works until it's restarted.",
          },
        },
        tags: ["dev"],
      },
      {
        input: {style: "witty", topic: "coffee"},
        outputs: {
          1: {
            helpfulness: 0.65,
            text: "Coffee is just a scheduled job that runs every morning. The problem is when it fails, everything else does too. No retries.",
          },
          2: {helpfulness: 0.9, text: "Coffee: the only dependency I never pin."},
        },
        tags: ["everyday"],
      },
      {
        input: {style: "absurdist", topic: "meetings"},
        outputs: {
          1: {
            helpfulness: 0.7,
            text: "We held a meeting to plan fewer meetings. It went well, so we scheduled a follow-up. Then a retro about the follow-up.",
          },
          2: {helpfulness: 0.85, text: "Our meeting about fewer meetings now has a weekly sync."},
        },
        tags: ["work"],
      },
      {
        input: {style: "pun", topic: "typescript"},
        outputs: {
          1: {
            helpfulness: 0.65,
            text: "TypeScript asked JavaScript out. JavaScript said yes, but TypeScript wanted to know exactly what type of yes.",
          },
          2: {helpfulness: 0.8, text: "TypeScript never gets lost; it always knows its type."},
        },
        tags: ["dev"],
      },
      {
        input: {style: "dry", topic: "mondays"},
        outputs: {
          1: {
            helpfulness: 0.6,
            text: "Mondays are proof that the weekend was just a cache. It never lasts and nobody can explain why it expired.",
          },
          2: {helpfulness: 0.85, text: "Monday: the weekend's error message."},
        },
        tags: ["everyday"],
      },
    ],
    tags: ["example", "jokes"],
  },
  description: "System prompt for the chat's generate_joke tool",
  experiments: [
    {
      evaluators: ["schema-assert", "helpfulness"],
      name: JOKE_EXPERIMENT,
      thresholds: [helpfulnessGate, schemaGate],
      versions: [1, 2],
    },
  ],
  name: "joke-generator",
  staging: 2,
  tags: ["example", "chat", "jokes"],
  temperature: 1.2,
  template: "Tell me a {{style}} joke about: {{topic}}",
  variables: [
    {key: "style", label: "Style"},
    {key: "topic", label: "Topic"},
  ],
  versions: [
    {
      outputSchema: {type: "string"},
      system:
        "You are a witty comedian. Tell a short, clever joke in 1-3 sentences. Be funny and concise.",
    },
    {
      outputSchema: {maxLength: 120, type: "string"},
      system:
        "You are a witty comedian. Tell exactly one clean one-liner under 120 characters. No setup questions.",
    },
  ],
};

// v1 pads replies and misstates SyncDB (fails helpfulness); v2 passes every gate.
const CHAT_SUITE: PromptSuite = {
  dataset: {
    description: "Messages a user sends the example chat, with the reply a good assistant gives.",
    name: CHAT_DATASET_NAME,
    rows: [
      {
        expected: "Lists the user's open todos.",
        input: {message: "What's on my todo list?"},
        outputs: {
          1: {
            correct: true,
            helpfulness: 0.7,
            text: "You have 2 open todos: Try offline mode and Review the sync status banner. Let me know if you want to add, complete, or delete any of them, or if you'd like a summary.",
          },
          2: {
            correct: true,
            helpfulness: 0.9,
            text: "You have 2 open todos: Try offline mode and Review the sync status banner.",
          },
        },
        tags: ["todos"],
      },
      {
        expected: "Confirms the new todo by title.",
        input: {message: "Add a todo to renew the SSL cert"},
        outputs: {
          1: {
            correct: true,
            helpfulness: 0.6,
            text: "Sure! I can help with that. I've gone ahead and added it.",
          },
          2: {correct: true, helpfulness: 0.9, text: 'Added "Renew the SSL cert" to your todos.'},
        },
        tags: ["todos", "tools"],
      },
      {
        expected: "A short joke about git.",
        input: {message: "Tell me a joke about git"},
        outputs: {
          1: {
            correct: true,
            helpfulness: 0.8,
            text: "Why did the commit break up with the branch? It needed space to rebase. Want another one?",
          },
          2: {
            correct: true,
            helpfulness: 0.85,
            text: "Why did the commit break up with the branch? It needed space to rebase.",
          },
        },
        tags: ["tools", "jokes"],
      },
      {
        expected: "SyncDB keeps data local, queues offline writes, and syncs on reconnect.",
        input: {message: "What does SyncDB do?"},
        outputs: {
          1: {correct: false, helpfulness: 0.3, text: "SyncDB is Terreno's GraphQL caching layer."},
          2: {
            correct: true,
            helpfulness: 0.9,
            text: "SyncDB keeps a local copy of your data, queues offline writes, and syncs them when you reconnect.",
          },
        },
        tags: ["terreno"],
      },
      {
        expected: "Asks for confirmation before deleting.",
        input: {message: "Delete all completed todos"},
        outputs: {
          1: {correct: true, helpfulness: 0.7, text: "Done! All completed todos are deleted."},
          2: {
            correct: true,
            helpfulness: 0.9,
            text: "I need your confirmation first: delete 1 completed todo?",
          },
        },
        tags: ["todos", "approval"],
      },
      {
        expected: "The current time in Tokyo.",
        input: {message: "What time is it in Tokyo?"},
        outputs: {
          1: {correct: true, helpfulness: 0.85, text: "It's 9:14 PM in Tokyo (Asia/Tokyo)."},
          2: {correct: true, helpfulness: 0.85, text: "It's 9:14 PM in Tokyo."},
        },
        tags: ["tools"],
      },
    ],
    tags: ["example", "chat", "gold"],
  },
  description: "Default system prompt for the example chat (systemPromptName on addGptRoutes)",
  experiments: [
    {
      evaluators: ["schema-assert", "correctness", "helpfulness"],
      name: CHAT_EXPERIMENT,
      thresholds: [correctnessGate, helpfulnessGate, schemaGate],
      versions: [1, 2],
    },
  ],
  name: "chat-assistant",
  staging: 2,
  tags: ["example", "chat"],
  temperature: 0.7,
  template: "{{message}}",
  variables: [{key: "message", label: "User message"}],
  versions: [
    {
      outputSchema: {type: "string"},
      system:
        "You are the assistant in the Terreno example app. Help the user manage todos and answer questions about Terreno. Use tools when they help.",
    },
    {
      outputSchema: {type: "string"},
      system:
        "You are the assistant in the Terreno example app. Help the user manage todos and answer questions about Terreno. Use tools when they help. Keep replies under three sentences, and say what changed after any tool call.",
    },
  ],
};

const PROMPT_SUITES = [SUMMARIZE_SUITE, JOKE_SUITE, CHAT_SUITE];

const JUDGE_PROMPTS = [
  {
    description: "Judge prompt behind the correctness llm-judge evaluator",
    name: "eval-judge-correctness",
    outputSchema: {
      properties: {confidence: {type: "number"}, correct: {type: "boolean"}},
      required: ["correct", "confidence"],
      type: "object",
    },
    system:
      "Decide whether the model output is faithful to the input and makes no claim the input does not support. Set confidence from 0 to 1.",
  },
  {
    description: "Judge prompt behind the helpfulness llm-judge evaluator",
    name: "eval-judge-helpfulness",
    outputSchema: {
      properties: {confidence: {type: "number"}, helpfulness: {type: "number"}},
      required: ["helpfulness", "confidence"],
      type: "object",
    },
    system:
      "Score from 0 to 1 how useful the output is to the person who asked. Set confidence from 0 to 1.",
  },
];

const SUMMARY_QUESTION_KEYS = ["faithful", "covers_every_item", "actionable", "concise"];

const summaryQuestionSchema = {
  properties: {
    confidence: {type: "number"},
    ...Object.fromEntries(SUMMARY_QUESTION_KEYS.map((key) => [key, {type: "boolean"}])),
  },
  required: [...SUMMARY_QUESTION_KEYS, "confidence"],
  type: "object",
};

// Two judges for the same questions: the careful prompt spells out each rule the reviewers use;
// the quick prompt paraphrases them and reads "concise" as 10 words, so it drifts from humans.
const SUMMARY_JUDGE_PROMPTS = [
  {
    description: "Careful judge prompt for the summary review question set",
    name: "eval-judge-summary-questions",
    outputSchema: summaryQuestionSchema,
    system: [
      "You review one-sentence summaries of todo lists. The input is the todo list; the model output is the summary.",
      "Answer each question true or false:",
      "- faithful: Is every statement backed by the todo list? Rewording and merging are fine; adding a relationship or detail the list does not state is not.",
      "- covers_every_item: Does the summary mention every todo?",
      "- actionable: Is each todo still a clear action someone could do? A bare noun like 'plumber call' is not.",
      "- concise: Is it one sentence of about 20 words or fewer?",
      "Set confidence from 0 to 1.",
    ].join("\n"),
  },
  {
    description: "Quick judge prompt for the summary review question set",
    name: "eval-judge-summary-questions-quick",
    outputSchema: summaryQuestionSchema,
    system:
      "Is the summary faithful, does it cover every item, is it actionable, and is it concise (10 words or fewer)? Answer true or false for each and set confidence from 0 to 1.",
  },
];

const SUMMARY_QUESTION_SET_EVALUATOR = {
  description: "Yes/no questions reviewers answer for every Todos → Summarize output",
  dimensions: [
    {
      dataType: "boolean" as const,
      key: "faithful",
      question: "Is every statement backed by the todo list (nothing invented)?",
      required: true,
    },
    {
      dataType: "boolean" as const,
      key: "covers_every_item",
      question: "Does it mention every todo?",
      required: true,
    },
    {
      dataType: "boolean" as const,
      key: "actionable",
      question: "Is each todo still a clear action someone could do?",
      required: true,
    },
    {
      dataType: "boolean" as const,
      key: "concise",
      question: "Is it one sentence of about 20 words or fewer?",
      required: true,
    },
  ],
  instructions:
    "Read the todo list and the summary, then answer every question. Rewording is fine; inventing details is not.",
  name: SUMMARY_QUESTION_SET,
  target: "full trace" as const,
  type: "human" as const,
};

const SUMMARY_JUDGE_EVALUATORS = [
  {
    description: "LLM judge for the summary review questions (spells out each reviewer rule)",
    judgePromptName: "eval-judge-summary-questions",
    name: SUMMARY_CAREFUL_JUDGE,
  },
  {
    description: "LLM judge for the summary review questions (short paraphrased prompt)",
    judgePromptName: "eval-judge-summary-questions-quick",
    name: SUMMARY_QUICK_JUDGE,
  },
];

type SummaryAnswers = Record<(typeof SUMMARY_QUESTION_KEYS)[number], boolean>;

const yes = (overrides: Partial<SummaryAnswers> = {}): SummaryAnswers => {
  return {actionable: true, concise: true, covers_every_item: true, faithful: true, ...overrides};
};

// Reviewer answers and each judge's answers per seeded summary output. The careful judge misses
// one call ("plumber call" is not an action); the quick judge says yes to the first three
// questions and fails "concise" past 10 words.
const SUMMARY_ANSWERS: Record<
  string,
  {careful: SummaryAnswers; human: SummaryAnswers; quick: SummaryAnswers}
> = {
  "Add the project archive migration and backfill existing projects.": {
    careful: yes(),
    human: yes(),
    quick: yes(),
  },
  "Call the doctor about the refill and pick up the prescription.": {
    careful: yes(),
    human: yes(),
    quick: yes({concise: false}),
  },
  "Draft the Q3 roadmap using support feedback and the top five bugs.": {
    careful: yes({actionable: false, covers_every_item: false, faithful: false}),
    human: yes({actionable: false, covers_every_item: false, faithful: false}),
    quick: yes({concise: false}),
  },
  "Finish onboarding copy, fix the Android date picker, and book the design review.": {
    careful: yes(),
    human: yes(),
    quick: yes({concise: false}),
  },
  "Renew the SSL certificate and rotate staging API keys.": {
    careful: yes(),
    human: yes(),
    quick: yes(),
  },
  "Run errands: groceries, plumber call, and dry cleaning.": {
    careful: yes(),
    human: yes({actionable: false}),
    quick: yes(),
  },
  "Test offline mode and check the sync status banner.": {
    careful: yes(),
    human: yes(),
    quick: yes(),
  },
};

// Reviewers answer the first 8 batch items; the last 2 stay pending for the demo.
const SUMMARY_BATCH_ANSWERED = 8;

const EVALUATOR_TEMPLATES = [
  "correctness-human",
  "helpfulness-human",
  "schema-assert",
  "correctness",
  "helpfulness",
];

// What the example frontend sends from Todos → Summarize: the user's todo list as text.
const TODO_LIST_TRACES: Array<{input: string; output: string}> = [
  {
    input: "- Try offline mode\n- Review the sync status banner",
    output: "Test offline mode and check the sync status banner.",
  },
  {
    input: "- Ship the onboarding copy\n- Fix the date picker on Android\n- Book the design review",
    output: "Finish onboarding copy, fix the Android date picker, and book the design review.",
  },
  {
    input: "- Renew the SSL cert\n- Rotate the staging API keys",
    output: "Renew the SSL certificate and rotate staging API keys.",
  },
  {
    input: "- Draft Q3 roadmap\n- Collect feedback from support\n- Prioritize top five bugs",
    output: "Draft the Q3 roadmap using support feedback and the top five bugs.",
  },
  {
    input: "- Buy groceries\n- Call the plumber\n- Pick up dry cleaning",
    output: "Run errands: groceries, plumber call, and dry cleaning.",
  },
  {
    input: "- Write migration for project archive flag\n- Backfill existing projects",
    output: "Add the project archive migration and backfill existing projects.",
  },
];

interface AiObservabilityDemoResult {
  changes: SeedChangeResult[];
  results: string[];
}

const compile = (template: string, variables: Record<string, string>): string => {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    return variables[key] ?? "";
  });
};

const costFor = (inputTokens: number, outputTokens: number): number => {
  return (
    (inputTokens * TRACE_PRICE.inputPerMTok + outputTokens * TRACE_PRICE.outputPerMTok) / 1_000_000
  );
};

const findPrompt = async (promptStore: LocalPromptStore, name: string) => {
  return (await promptStore.list({search: name})).find((entry) => {
    return entry.name === name;
  });
};

/** Deterministic stand-in for a model: canned generations per prompt version and judge verdicts. */
export const createSeedFixtureClient = (): ObservabilityGenerateClient => {
  const outputs = PROMPT_SUITES.flatMap((suite) => {
    return suite.dataset.rows.flatMap((row) => Object.values(row.outputs));
  });
  return {
    generateJsonObject: async <OBJECT>(options: {prompt: string; schemaName?: string}) => {
      const output = outputs.find((candidate) => {
        return options.prompt.includes(JSON.stringify(candidate.text));
      });
      const confidence = output?.confidence ?? 0.92;
      const questionJudge =
        options.schemaName === `${SUMMARY_CAREFUL_JUDGE}-judge`
          ? "careful"
          : options.schemaName === `${SUMMARY_QUICK_JUDGE}-judge`
            ? "quick"
            : undefined;
      if (questionJudge) {
        const summary = Object.entries(SUMMARY_ANSWERS).find(([text]) => {
          return options.prompt.includes(JSON.stringify(text));
        });
        return {confidence: 0.9, ...(summary?.[1][questionJudge] ?? yes())} as OBJECT;
      }
      if (options.schemaName === "helpfulness-judge") {
        return {confidence, helpfulness: output?.helpfulness ?? 0.8} as OBJECT;
      }
      return {confidence, correct: output?.correct ?? true} as OBJECT;
    },
    generateText: async (options: {prompt: string; systemPrompt?: string}) => {
      for (const suite of PROMPT_SUITES) {
        const version = suite.versions.findIndex((row) => row.system === options.systemPrompt) + 1;
        const row = suite.dataset.rows.find((candidate) => {
          return compile(suite.template, candidate.input) === options.prompt;
        });
        const output = version > 0 ? row?.outputs[version] : undefined;
        if (output) {
          return output.text;
        }
      }
      return options.prompt.split("\n").filter(Boolean).at(-1) ?? options.prompt;
    },
    modelId: SEED_FIXTURE_MODEL_ID,
  };
};

// True when the stored versions 1..count are the ones this seed defines (not operator edits).
const versionsMatch = async (
  promptStore: LocalPromptStore,
  suite: PromptSuite,
  count: number
): Promise<boolean> => {
  for (let version = 1; version <= count; version += 1) {
    const stored = await promptStore.getVersionByNumber(suite.name, version);
    if (stored?.system !== suite.versions[version - 1]?.system) {
      return false;
    }
  }
  return true;
};

const versionFields = (suite: PromptSuite, seed: PromptVersionSeed) => {
  return {
    config: {temperature: suite.temperature},
    inputSchema: {
      properties: Object.fromEntries(
        suite.variables.map((variable) => [variable.key, {type: "string"}])
      ),
      required: suite.variables.map((variable) => variable.key),
      type: "object",
    },
    outputSchema: seed.outputSchema,
    system: seed.system,
    template: suite.template,
    type: "chat" as const,
    variables: suite.variables.map((variable) => ({...variable, required: true})),
  };
};

const ensureSuitePrompt = async (
  dryRun: boolean,
  promptStore: LocalPromptStore,
  suite: PromptSuite,
  output: AiObservabilityDemoResult
): Promise<void> => {
  const existing = await findPrompt(promptStore, suite.name);
  const latest = existing?.latestVersion ?? 0;
  const canAppend =
    latest < suite.versions.length && (await versionsMatch(promptStore, suite, latest));
  output.changes.push({
    change: !existing ? "created" : canAppend ? "updated" : "unchanged",
    count: 1,
    key: JSON.stringify({name: suite.name}),
    model: "ObsPrompt",
  });
  if (!canAppend || dryRun) {
    return;
  }
  for (let version = latest + 1; version <= suite.versions.length; version += 1) {
    const fields = versionFields(suite, suite.versions[version - 1]);
    if (version === 1) {
      await promptStore.create({
        ...fields,
        description: suite.description,
        folder: "examples",
        name: suite.name,
        tags: suite.tags,
      });
    } else {
      await promptStore.createVersion(suite.name, fields);
    }
  }
  if (existing?.production === undefined || existing.production === "—") {
    await promptStore.moveLabel(suite.name, {label: "production", version: 1});
  }
  await promptStore.moveLabel(suite.name, {label: "staging", version: suite.staging});
  output.results.push(
    `${suite.name}: v1–v${suite.versions.length}, production v1, staging v${suite.staging}`
  );
};

const ensureJudgePrompts = async (
  dryRun: boolean,
  promptStore: LocalPromptStore,
  output: AiObservabilityDemoResult
): Promise<void> => {
  for (const judge of [...JUDGE_PROMPTS, ...SUMMARY_JUDGE_PROMPTS]) {
    const existing = await findPrompt(promptStore, judge.name);
    output.changes.push({
      change: existing ? "unchanged" : "created",
      count: 1,
      key: JSON.stringify({name: judge.name}),
      model: "ObsPrompt",
    });
    if (existing || dryRun) {
      continue;
    }
    await promptStore.create({
      config: {temperature: TemperaturePresets.DETERMINISTIC},
      description: judge.description,
      folder: "evaluators",
      name: judge.name,
      outputSchema: judge.outputSchema,
      system: judge.system,
      tags: ["judge"],
      template: "Grade the model output against the input and expected output.",
      type: "chat",
      variables: [],
    });
    await promptStore.moveLabel(judge.name, {label: "production", version: 1});
  }
};

const ensureEvaluators = async (
  dryRun: boolean,
  evaluatorStore: LocalEvaluatorStore,
  output: AiObservabilityDemoResult
): Promise<void> => {
  for (const templateName of EVALUATOR_TEMPLATES) {
    const existing = await evaluatorStore.getByName(templateName);
    output.changes.push({
      change: existing ? "unchanged" : "created",
      count: 1,
      key: JSON.stringify({name: templateName}),
      model: "ObsEvaluator",
    });
    if (!existing && !dryRun) {
      await evaluatorStore.installTemplate(templateName);
    }
  }
  const questionSet = await evaluatorStore.getByName(SUMMARY_QUESTION_SET);
  output.changes.push({
    change: questionSet ? "unchanged" : "created",
    count: 1,
    key: JSON.stringify({name: SUMMARY_QUESTION_SET}),
    model: "ObsEvaluator",
  });
  if (!questionSet && !dryRun) {
    await evaluatorStore.create(SUMMARY_QUESTION_SET_EVALUATOR);
  }
  for (const judge of SUMMARY_JUDGE_EVALUATORS) {
    const existing = await evaluatorStore.getByName(judge.name);
    output.changes.push({
      change: existing ? "unchanged" : "created",
      count: 1,
      key: JSON.stringify({name: judge.name}),
      model: "ObsEvaluator",
    });
    if (existing || dryRun) {
      continue;
    }
    await evaluatorStore.create({
      ...judge,
      dimensions: SUMMARY_QUESTION_SET_EVALUATOR.dimensions.map(({question: _q, ...row}) => row),
      target: "full trace",
      type: "llm-judge",
    });
  }
};

const ensureSuiteDataset = async (
  dryRun: boolean,
  datasetStore: LocalDatasetStore,
  suite: PromptSuite,
  output: AiObservabilityDemoResult
): Promise<string | undefined> => {
  const {dataset} = suite;
  const existing = (await datasetStore.list()).find((entry) => entry.name === dataset.name);
  output.changes.push({
    change: existing ? "unchanged" : "created",
    count: 1,
    key: JSON.stringify({name: dataset.name}),
    model: "ObsDataset",
  });
  if (existing || dryRun) {
    return existing?.id;
  }
  const created = await datasetStore.create({
    description: dataset.description,
    inputSchemaPromptName: suite.name,
    name: dataset.name,
    tags: dataset.tags,
  });
  const gold = await datasetStore.importRows(
    created.id,
    dataset.rows.map((row) => {
      return {expectedOutput: row.expected, input: row.input, proofread: true, tags: row.tags};
    })
  );
  const synthetic = await datasetStore.importRows(
    created.id,
    (dataset.unproofread ?? []).map((row) => ({...row, proofread: false})),
    "synthetic"
  );
  output.results.push(
    `${dataset.name}: ${gold.created} proofread and ${synthetic.created} unproofread rows`
  );
  return created.id;
};

const ensureExperiments = async (params: {
  datasetIds: Map<string, string | undefined>;
  datasetStore: LocalDatasetStore;
  dryRun: boolean;
  evaluatorStore: LocalEvaluatorStore;
  output: AiObservabilityDemoResult;
  promptStore: LocalPromptStore;
}): Promise<void> => {
  const {datasetIds, datasetStore, dryRun, evaluatorStore, output, promptStore} = params;
  const pendingRuns: Array<() => Promise<void>> = [];
  const runner = new LocalExperimentRunner({
    // Run after create() returns so its "running" save cannot overwrite the completed result.
    backgroundTaskRunner: {
      enqueue: async ({execute, taskType}) => {
        const task = await BackgroundTask.create({status: "pending", taskType});
        pendingRuns.push(async () => {
          await execute();
          task.status = "completed";
          task.completedAt = DateTime.now().toJSDate();
          await task.save();
        });
        return {taskId: String(task._id)};
      },
    },
    datasetStore,
    evaluatorStore,
    promptStore,
  });
  runner.configureAi({aiService: createSeedFixtureClient()});
  const existingNames = new Set(
    (await runner.list({limit: 100})).data.map((row) => {
      return row.name;
    })
  );

  for (const suite of PROMPT_SUITES) {
    for (const plan of suite.experiments) {
      const exists = existingNames.has(plan.name);
      output.changes.push({
        change: exists ? "unchanged" : "created",
        count: 1,
        key: JSON.stringify({name: plan.name}),
        model: "ObsExperiment",
      });
      if (exists || dryRun) {
        continue;
      }
      const datasetId = datasetIds.get(suite.name);
      if (!datasetId) {
        output.results.push(`Skipped "${plan.name}": ${suite.dataset.name} is missing`);
        continue;
      }
      if (!(await versionsMatch(promptStore, suite, Math.max(...plan.versions)))) {
        output.results.push(`Skipped "${plan.name}": ${suite.name} versions were edited`);
        continue;
      }
      const evaluatorIds: string[] = [];
      for (const name of plan.evaluators) {
        const evaluator = await evaluatorStore.getByName(name);
        if (evaluator) {
          evaluatorIds.push(evaluator.id);
        }
      }
      await runner.create({
        datasetId,
        evaluatorIds,
        name: plan.name,
        promptName: suite.name,
        thresholds: plan.thresholds,
        versions: plan.versions,
      });
      output.results.push(`Ran experiment "${plan.name}"`);
    }
  }
  for (const run of pendingRuns) {
    await run();
  }
};

const buildLlmTrace = (params: {
  error?: string;
  input: string;
  label: "production" | "staging";
  output?: string;
  promptName: string;
  sensitive?: boolean;
  sessionId: string;
  startedAt: DateTime;
  userId?: string;
  version: number;
}): TraceRecord => {
  const inputTokens = 40 + params.input.length;
  const outputTokens = params.output ? Math.ceil(params.output.length / 4) : 0;
  const durationMs = params.error ? 2400 : 700 + params.input.length * 4;
  const startedAt = params.startedAt.toUTC().toISO() ?? "";
  const endedAt = params.startedAt.plus({milliseconds: durationMs}).toUTC().toISO() ?? "";
  const status = params.error ? ("error" as const) : ("ok" as const);
  const usage = {
    costUsd: costFor(inputTokens, outputTokens),
    inputTokens,
    model: TRACE_MODEL_ID,
    outputTokens,
  };
  return {
    endedAt,
    id: randomUUID(),
    input: params.input,
    name: params.promptName,
    output: params.output,
    prompts: [{label: params.label, name: params.promptName, version: params.version}],
    sensitive: params.sensitive ?? false,
    sessionId: params.sessionId,
    spans: [
      {
        durationMs,
        endedAt,
        id: randomUUID(),
        input: params.input,
        kind: "LLM",
        name: params.promptName,
        output: params.output,
        sensitive: params.sensitive,
        startedAt,
        status,
        usage,
        ...(params.error ? {error: params.error} : {}),
      },
    ],
    startedAt,
    status,
    usage,
    userId: params.userId,
    ...(params.error ? {errorSummary: params.error} : {}),
  };
};

// A chat turn under the chat-assistant prompt; tool turns show CHAIN → LLM/TOOL nesting.
const buildChatTrace = (params: {
  message: string;
  reply: string;
  sessionId: string;
  startedAt: DateTime;
  tool?: {input: Record<string, unknown>; name: string; output: Record<string, unknown>};
  userId?: string;
}): TraceRecord => {
  const rootId = randomUUID();
  const iso = (offsetMs: number): string => {
    return params.startedAt.plus({milliseconds: offsetMs}).toUTC().toISO() ?? "";
  };
  const usage = {
    costUsd: costFor(420, 60),
    inputTokens: 420,
    model: TRACE_MODEL_ID,
    outputTokens: 60,
  };
  const children: SpanRecord[] = params.tool
    ? [
        {
          durationMs: 900,
          endedAt: iso(1600),
          id: randomUUID(),
          input: params.tool.input,
          kind: "TOOL",
          name: params.tool.name,
          output: params.tool.output,
          parentSpanId: rootId,
          startedAt: iso(700),
          startOffsetMs: 700,
          status: "ok",
        },
      ]
    : [];
  return {
    endedAt: iso(2100),
    id: randomUUID(),
    input: params.message,
    name: "chat-assistant",
    output: params.reply,
    prompts: [{label: "production", name: "chat-assistant", version: 1}],
    sensitive: false,
    sessionId: params.sessionId,
    spans: [
      {
        durationMs: 2100,
        endedAt: iso(2100),
        id: rootId,
        input: params.message,
        kind: children.length > 0 ? "CHAIN" : "LLM",
        name: "chat-assistant",
        output: params.reply,
        startedAt: iso(0),
        status: "ok",
        usage,
      },
      ...children,
    ],
    startedAt: iso(0),
    status: "ok",
    usage,
    userId: params.userId,
  };
};

const CHAT_TRACES: Array<{
  message: string;
  reply: string;
  tool?: {input: Record<string, unknown>; name: string; output: Record<string, unknown>};
}> = [
  {
    message: "Tell me a joke about git",
    reply: "I'd tell you a git joke, but you'd just fork it.",
    tool: {
      input: {style: "pun", topic: "git"},
      name: "generate_joke",
      output: {joke: "I'd tell you a git joke, but you'd just fork it."},
    },
  },
  {
    message: "What's on my todo list?",
    reply: "You have 2 open todos: Try offline mode and Review the sync status banner.",
    tool: {input: {}, name: "list_todos", output: {count: 2}},
  },
  {message: "What does SyncDB do?", reply: "SyncDB is Terreno's GraphQL caching layer."},
  {
    message: "Tell me a dad joke about kubernetes",
    reply: "Kubernetes is like my kids: nothing works until it's restarted.",
    tool: {
      input: {style: "dad joke", topic: "kubernetes"},
      name: "generate_joke",
      output: {joke: "Kubernetes is like my kids: nothing works until it's restarted."},
    },
  },
  {
    message: "How do I promote a prompt version?",
    reply: "Open the experiment and choose Promote on the passing version.",
  },
  {
    message: "What time is it in Tokyo?",
    reply: "It's 9:14 PM in Tokyo.",
    tool: {input: {timezone: "Asia/Tokyo"}, name: "get_current_time", output: {time: "9:14 PM"}},
  },
];

const seedTracesAndReview = async (params: {
  dryRun: boolean;
  evaluatorStore: LocalEvaluatorStore;
  output: AiObservabilityDemoResult;
}): Promise<void> => {
  const {dryRun, evaluatorStore, output} = params;
  const traceStore = new LocalTraceStore();
  const existing = await traceStore.list({
    limit: 1,
    sessionId: `${SEED_TRACE_SESSION_PREFIX}todos-1`,
  });
  output.changes.push({
    change: existing.data.length > 0 ? "unchanged" : "created",
    count: 1,
    key: JSON.stringify({sessionPrefix: SEED_TRACE_SESSION_PREFIX}),
    model: "ObsTrace",
  });
  if (existing.data.length > 0 || dryRun) {
    return;
  }

  const testUser = await User.findByEmail("test@example.com");
  const admin = await User.findByEmail("admin@example.com");
  const userIds = [testUser?._id, admin?._id].map((id) => {
    return id ? String(id) : undefined;
  });
  const now = DateTime.utc().startOf("hour");
  const summarizeIds: string[] = [];
  const summarizeCount = 18;

  // Spread across the last week so the 7-day usage rollups and date filters have data.
  for (let index = 0; index < summarizeCount; index += 1) {
    const fixture = TODO_LIST_TRACES[index % TODO_LIST_TRACES.length];
    const isStaging = index % 5 === 4;
    const isError = index === 6 || index === 13;
    const isSensitive = index === 9;
    const trace = buildLlmTrace({
      error: isError ? "429 RESOURCE_EXHAUSTED: quota exceeded for gemini-2.5-flash" : undefined,
      input: isSensitive
        ? "- Call Dr. Patel about the refill\n- Pick up prescription"
        : fixture.input,
      label: isStaging ? "staging" : "production",
      output: isError
        ? undefined
        : isSensitive
          ? "Call the doctor about the refill and pick up the prescription."
          : fixture.output,
      promptName: SUMMARIZE_SUITE.name,
      sensitive: isSensitive,
      sessionId: `${SEED_TRACE_SESSION_PREFIX}todos-${(index % 4) + 1}`,
      startedAt: now.minus({hours: index * 9 + 1}),
      userId: userIds[index % 2],
      version: isStaging ? 2 : 1,
    });
    if (index === 2 || index === 11) {
      trace.flaggedForDataset = true;
    }
    summarizeIds.push((await traceStore.exportTrace(trace)).id);
  }

  const jokeIds: string[] = [];
  for (const [index, row] of JOKE_SUITE.dataset.rows.entries()) {
    const trace = buildLlmTrace({
      input: compile(JOKE_SUITE.template, row.input),
      label: "production",
      output: row.outputs[1].text,
      promptName: JOKE_SUITE.name,
      sessionId: `${SEED_TRACE_SESSION_PREFIX}chat-${(index % 2) + 1}`,
      startedAt: now.minus({hours: index * 21 + 3}),
      userId: userIds[index % 2],
      version: 1,
    });
    jokeIds.push((await traceStore.exportTrace(trace)).id);
  }

  const chatIds: string[] = [];
  for (const [index, row] of CHAT_TRACES.entries()) {
    const trace = buildChatTrace({
      ...row,
      sessionId: `${SEED_TRACE_SESSION_PREFIX}chat-${(index % 2) + 1}`,
      startedAt: now.minus({hours: index * 21 + 2}),
      userId: userIds[index % 2],
    });
    chatIds.push((await traceStore.exportTrace(trace)).id);
  }
  output.results.push(
    `Created ${summarizeIds.length} example-summarize, ${jokeIds.length} joke-generator, and ${chatIds.length} chat-assistant traces`
  );

  const okSummarizeIds = summarizeIds.filter((_id, index) => index !== 6 && index !== 13);
  const [thumbsDownA, thumbsDownB, lowConfidence, manualA, manualB, ...rest] = okSummarizeIds;
  const [, , syncDbMisfire] = chatIds;
  const thumbs = (traceId: string, value: boolean, comment?: string): ScoreRecord => {
    return {
      comment,
      dataType: "boolean",
      name: "thumbs_up",
      source: "user-feedback",
      traceId,
      value,
    };
  };
  const judged = (traceId: string, confidence: number): ScoreRecord => {
    return {
      confidence,
      dataType: "boolean",
      name: "correct",
      source: "llm-judge",
      traceId,
      value: true,
    };
  };
  const scores: ScoreRecord[] = [
    thumbs(thumbsDownA, false, "Dropped one of my todos"),
    thumbs(thumbsDownB, false),
    ...rest.slice(0, 4).map((traceId) => thumbs(traceId, true)),
    judged(lowConfidence, 0.52),
    ...rest.slice(4, 7).map((traceId) => judged(traceId, 0.93)),
    ...[manualA, manualB].map((traceId): ScoreRecord => {
      return {dataType: "boolean", name: "schema_valid", source: "code", traceId, value: true};
    }),
    thumbs(jokeIds[0], false, "Too long, not funny"),
    thumbs(jokeIds[2], true),
    thumbs(chatIds[0], true),
    thumbs(syncDbMisfire, false, "That's wrong"),
  ];
  for (const score of scores) {
    await traceStore.exportScore(score);
  }
  output.results.push(`Created ${scores.length} feedback, judge, and code scores`);

  const correctness = await evaluatorStore.getByName("correctness-human");
  const helpfulness = await evaluatorStore.getByName("helpfulness-human");
  if (!correctness || !helpfulness) {
    output.results.push("Skipped review queue: human evaluators are missing");
    return;
  }
  const reviewStore = new LocalReviewStore();
  const [feedbackA] = await reviewStore.enqueue({
    evaluatorId: correctness.id,
    reason: "feedback",
    traceIds: [thumbsDownA, thumbsDownB, jokeIds[0], syncDbMisfire],
  });
  await reviewStore.enqueue({
    evaluatorId: correctness.id,
    reason: "eval",
    traceIds: [lowConfidence],
  });
  const [candidateA] = await reviewStore.enqueue({
    evaluatorId: correctness.id,
    reason: "dataset_candidate",
    traceIds: [summarizeIds[2], summarizeIds[11]],
  });
  const [manualReview] = await reviewStore.enqueue({
    evaluatorId: correctness.id,
    reason: "manual",
    traceIds: [manualA, manualB],
  });
  const [helpfulA] = await reviewStore.enqueue({
    evaluatorId: helpfulness.id,
    reason: "manual",
    traceIds: rest.slice(0, 3),
  });
  const [chatHelpful] = await reviewStore.enqueue({
    evaluatorId: helpfulness.id,
    reason: "manual",
    traceIds: [chatIds[1], chatIds[4]],
  });
  const sinks = [new LocalScoreSink(traceStore)];
  await reviewStore.submit({
    comment: "Summary is faithful.",
    id: manualReview.id,
    scores: {correct: true},
    sinks,
  });
  await reviewStore.submit({
    comment: "Left out the second todo.",
    id: feedbackA.id,
    scores: {correct: false},
    sinks,
  });
  await reviewStore.submit({
    comment: "Answers the question directly.",
    id: chatHelpful.id,
    scores: {helpfulness: 0.9},
    sinks,
  });
  await reviewStore.skip(candidateA.id);
  if (admin) {
    await reviewStore.assign(helpfulA.id, String(admin._id));
  }
  const {counts} = await reviewStore.list();
  output.changes.push({
    change: "created",
    count: counts.pending + counts.in_progress + counts.done + counts.skipped,
    key: JSON.stringify({queue: "review"}),
    model: "ObsReviewItem",
  });
  output.results.push(
    `Review queue: ${counts.pending} pending, ${counts.in_progress} in progress, ${counts.done} done, ${counts.skipped} skipped`
  );
};

// The 10 newest seeded summaries (not app traffic) so canned answers line up with each output.
const seededSummaryTraceIds = async (traceStore: LocalTraceStore): Promise<string[]> => {
  const rows: Array<{id: string; startedAt: string}> = [];
  for (let session = 1; session <= 4; session += 1) {
    const listed = await traceStore.list({
      limit: 100,
      prompt: SUMMARIZE_SUITE.name,
      sessionId: `${SEED_TRACE_SESSION_PREFIX}todos-${session}`,
      status: "ok",
    });
    rows.push(...listed.data);
  }
  return rows
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, 10)
    .map((row) => row.id);
};

const seedReviewBatch = async (params: {
  dryRun: boolean;
  evaluatorStore: LocalEvaluatorStore;
  output: AiObservabilityDemoResult;
  promptStore: LocalPromptStore;
}): Promise<void> => {
  const {dryRun, evaluatorStore, output, promptStore} = params;
  const batchStore = new LocalReviewBatchStore(promptStore);
  const exists = (await batchStore.list()).some((batch) => batch.name === SUMMARY_REVIEW_BATCH);
  output.changes.push({
    change: exists ? "unchanged" : "created",
    count: 1,
    key: JSON.stringify({name: SUMMARY_REVIEW_BATCH}),
    model: "ObsReviewBatch",
  });
  if (exists || dryRun) {
    return;
  }
  const questionSet = await evaluatorStore.getByName(SUMMARY_QUESTION_SET);
  const traceIds = await seededSummaryTraceIds(new LocalTraceStore());
  if (!questionSet || traceIds.length === 0) {
    output.results.push("Skipped review batch: question set or seeded summaries are missing");
    return;
  }
  const batch = await batchStore.create({
    description: "Seeded: reviewers answered 8 of the 10 newest summaries; both judges ran.",
    evaluatorId: questionSet.id,
    name: SUMMARY_REVIEW_BATCH,
    promptName: SUMMARIZE_SUITE.name,
    traceIds,
  });
  const reviewStore = new LocalReviewStore();
  const sinks = [new LocalScoreSink(new LocalTraceStore())];
  let answered = 0;
  for (const item of batch.items.slice(0, SUMMARY_BATCH_ANSWERED)) {
    const answers = typeof item.output === "string" ? SUMMARY_ANSWERS[item.output] : undefined;
    if (!answers) {
      continue;
    }
    await reviewStore.submit({id: item.reviewItemId, scores: answers.human, sinks});
    answered += 1;
  }
  const client = createSeedFixtureClient();
  for (const judge of SUMMARY_JUDGE_EVALUATORS) {
    const evaluator = await evaluatorStore.getByName(judge.name);
    if (evaluator) {
      await batchStore.runJudge({ai: client, batchId: batch.id, evaluatorId: evaluator.id});
    }
  }
  const judged = await batchStore.get(batch.id);
  const agreement = judged.judges
    .map((row) => `${row.evaluatorName} ${Math.round((row.agreement.rate ?? 0) * 100)}%`)
    .join(", ");
  output.results.push(
    `Review batch "${SUMMARY_REVIEW_BATCH}": ${answered} of ${batch.items.length} answered; judge agreement ${agreement}`
  );
};

export const seedAiObservabilityDemo = async ({
  dryRun,
}: {
  dryRun: boolean;
}): Promise<AiObservabilityDemoResult> => {
  const output: AiObservabilityDemoResult = {changes: [], results: []};
  const promptStore = new LocalPromptStore();
  const evaluatorStore = new LocalEvaluatorStore(promptStore);
  const datasetStore = new LocalDatasetStore(promptStore);

  for (const suite of PROMPT_SUITES) {
    await ensureSuitePrompt(dryRun, promptStore, suite, output);
  }
  await ensureJudgePrompts(dryRun, promptStore, output);
  await ensureEvaluators(dryRun, evaluatorStore, output);
  const datasetIds = new Map<string, string | undefined>();
  for (const suite of PROMPT_SUITES) {
    datasetIds.set(suite.name, await ensureSuiteDataset(dryRun, datasetStore, suite, output));
  }
  await ensureExperiments({datasetIds, datasetStore, dryRun, evaluatorStore, output, promptStore});
  await seedTracesAndReview({dryRun, evaluatorStore, output});
  await seedReviewBatch({dryRun, evaluatorStore, output, promptStore});
  return output;
};
