import type {Page, Route} from "@playwright/test";
import {DateTime} from "luxon";

const API_URL = process.env.BACKEND_URL ?? "http://localhost:4000";

type SseEvent = Record<string, unknown>;
type HistoryRow = Record<string, unknown>;
type AskStatus = "pending" | "answered" | "cancelled";

const fulfillSse = (route: Route, events: SseEvent[]): Promise<void> =>
  route.fulfill({
    body: events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
    headers: {
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
    },
    status: 200,
  });

/** The 409 the server returns when a request finds the conversation's ask already resolved. */
const fulfillAskConflict = (route: Route, detail: string): Promise<void> =>
  route.fulfill({
    body: JSON.stringify({detail, status: 409, title: "This ask is no longer pending"}),
    contentType: "application/json",
    status: 409,
  });

/** Word-level text events, for realistic streaming. */
const textEvents = (text: string): SseEvent[] =>
  text.split(" ").map((word) => ({text: `${word} `}));

export const mockGptStream = async (
  page: Page,
  responseText: string,
  options?: {historyId?: string; title?: string}
): Promise<void> => {
  const historyId = options?.historyId ?? `mock-history-${Date.now()}`;
  const title = options?.title ?? "Mock Chat";

  await page.route(`${API_URL}/gpt/prompt`, (route) =>
    fulfillSse(route, [...textEvents(responseText), {done: true, historyId, title}])
  );
};

/**
 * Streams `turns[i]` for the i-th `/gpt/prompt` request and aborts any request past the last turn.
 * Returns every request body, in order.
 */
export const mockGptTurns = async (
  page: Page,
  turns: SseEvent[][]
): Promise<Array<Record<string, unknown>>> => {
  const requests: Array<Record<string, unknown>> = [];
  await page.route(`${API_URL}/gpt/prompt`, (route) => {
    requests.push((route.request().postDataJSON() ?? {}) as Record<string, unknown>);
    const events = turns[requests.length - 1];
    if (!events) {
      return route.abort();
    }
    return fulfillSse(route, events);
  });
  return requests;
};

/** The `{ask}` event payload, as the server streams it. */
export interface MockAsk {
  input: Record<string, unknown>;
  kind: "choice" | "files";
  simple?: Record<string, unknown>;
  toolCallId: string;
}

/** A 400 the mock returns for the next answer, as the server does for an invalid `askResponse`. */
export interface MockAnswerRejection {
  fields: Array<{code: string; fix: string; message: string; path: string}>;
}

/** An answer another tab or device already sent, and the assistant's reply to it. */
export interface MockAnswerElsewhere {
  content: Record<string, unknown>;
  continuation: string;
}

export interface MockGptAsk {
  /**
   * Makes the next answer fail with a 409, as when another tab already answered the ask, and
   * serves the conversation as that tab left it from `GET /gpt/histories/:id` and the history list.
   */
  answerElsewhere: (answer: MockAnswerElsewhere) => Promise<void>;
  /**
   * Makes the next prompt arrive just after another tab answered the ask: the prompt streams a
   * normal reply without `{askResolved}`, and the saved conversation shows the other tab's answer.
   */
  answerRacesNextPrompt: (
    answer: MockAnswerElsewhere & {prompt: string; reply: string}
  ) => Promise<void>;
  /** Makes the next prompt stream its `{ask}` but end before `{done}`, as a slow turn does. */
  holdNextDone: () => void;
  /** Every `/gpt/prompt` request body, in order. */
  requests: Array<Record<string, unknown>>;
  /** Makes the next answer fail with a 400 and these `fields`. */
  rejectNextAnswer: (rejection: MockAnswerRejection) => void;
}

export const userRow = (text: string): HistoryRow => ({content: [], text, type: "user"});

export const assistantRow = (text: string): HistoryRow => ({content: [], text, type: "assistant"});

/** The tool-call row that holds an ask, as the server saves it. */
export const askCallRow = (ask: MockAsk, status: AskStatus): HistoryRow => ({
  args: ask.input,
  ask: {kind: ask.kind, status},
  content: [],
  text: `Tool call: ask_${ask.kind}`,
  toolCallId: ask.toolCallId,
  toolName: `ask_${ask.kind}`,
  type: "tool-call",
});

/** The tool-result row that holds an ask's answer envelope, as the server saves it. */
export const askResultRow = (ask: MockAsk, result: Record<string, unknown>): HistoryRow => ({
  result,
  text: `Tool result: ask_${ask.kind}`,
  toolCallId: ask.toolCallId,
  toolName: `ask_${ask.kind}`,
  type: "tool-result",
});

/** A saved conversation as `GET /gpt/histories/:id` returns it; `pendingAsk` is still waiting. */
export const savedHistory = ({
  historyId,
  pendingAsk,
  prompts,
  title,
}: {
  historyId: string;
  pendingAsk?: MockAsk;
  prompts: HistoryRow[];
  title: string;
}): Record<string, unknown> => {
  const now = DateTime.now().toISO();
  return {
    _id: historyId,
    created: now,
    id: historyId,
    // Only the fields the client reads; the server also sends the paused turn's replay state.
    ...(pendingAsk
      ? {
          pendingAsk: {
            input: pendingAsk.input,
            kind: pendingAsk.kind,
            toolCallId: pendingAsk.toolCallId,
            ...(pendingAsk.simple ? {simple: pendingAsk.simple} : {}),
          },
        }
      : {}),
    prompts,
    title,
    updated: now,
    userId: "mock-user",
  };
};

/** Serves `history` from `GET /gpt/histories/:id` and as the only conversation in the list. */
export const mockSavedHistory = async (
  page: Page,
  history: Record<string, unknown>
): Promise<void> => {
  await page.route(`${API_URL}/gpt/histories/${history.id}`, (route) =>
    route.fulfill({
      body: JSON.stringify({data: history}),
      contentType: "application/json",
      status: 200,
    })
  );
  await page.route(
    (url) => url.href.startsWith(API_URL) && url.pathname === "/gpt/histories",
    (route) =>
      route.fulfill({
        body: JSON.stringify({data: [history], limit: 100, more: false, page: 1, total: 1}),
        contentType: "application/json",
        status: 200,
      })
  );
};

/**
 * Mocks an ask round trip on `/gpt/prompt`: a prompt streams `ask` and pauses; an answer
 * (`askResponse`) streams `{askResolved}`, the continuation text, and `{done}`.
 */
export const mockGptAskStream = async (
  page: Page,
  {ask, continuation, title}: {ask: MockAsk; continuation: string; title?: string}
): Promise<MockGptAsk> => {
  const historyId = `mock-history-${Date.now()}`;
  const requests: Array<Record<string, unknown>> = [];
  let rejection: MockAnswerRejection | undefined;
  let isAnsweredElsewhere = false;
  let racingAnswer: (MockAnswerElsewhere & {prompt: string; reply: string}) | undefined;
  let isDoneHeld = false;

  await page.route(`${API_URL}/gpt/prompt`, (route) => {
    const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
    requests.push(body);
    const answer = body.askResponse as {action?: string; toolCallId?: string} | undefined;
    if (!answer && racingAnswer) {
      const {reply} = racingAnswer;
      racingAnswer = undefined;
      return fulfillSse(route, [
        ...textEvents(reply),
        {done: true, historyId, ...(title ? {title} : {})},
      ]);
    }
    if (!answer) {
      const doneEvents = isDoneHeld
        ? []
        : [{done: true, historyId, pendingAsk: {toolCallId: ask.toolCallId}}];
      isDoneHeld = false;
      return fulfillSse(route, [{ask, historyId}, ...doneEvents]);
    }
    if (isAnsweredElsewhere) {
      return fulfillAskConflict(
        route,
        `Tool call ${ask.toolCallId} is not the ask this conversation is waiting on.`
      );
    }
    if (rejection) {
      const {fields} = rejection;
      rejection = undefined;
      return route.fulfill({
        body: JSON.stringify({
          detail: "The answer does not match the ask. See fields.",
          fields,
          status: 400,
          title: "Invalid askResponse",
        }),
        contentType: "application/json",
        status: 400,
      });
    }
    return fulfillSse(route, [
      {askResolved: {action: answer.action, toolCallId: answer.toolCallId}},
      ...textEvents(continuation),
      {done: true, historyId, ...(title ? {title} : {})},
    ]);
  });

  return {
    answerElsewhere: async ({content, continuation: elsewhereContinuation}) => {
      isAnsweredElsewhere = true;
      const prompt = requests.find((body) => typeof body.prompt === "string")?.prompt as string;
      await mockSavedHistory(
        page,
        savedHistory({
          historyId,
          prompts: [
            userRow(prompt),
            askCallRow(ask, "answered"),
            askResultRow(ask, {action: "accept", content}),
            assistantRow(elsewhereContinuation),
          ],
          title: title ?? "Mock Chat",
        })
      );
    },
    answerRacesNextPrompt: async (next) => {
      racingAnswer = next;
      const prompts = requests.filter((body) => typeof body.prompt === "string");
      await mockSavedHistory(
        page,
        savedHistory({
          historyId,
          prompts: [
            userRow(prompts[0]?.prompt as string),
            askCallRow(ask, "answered"),
            askResultRow(ask, {action: "accept", content: next.content}),
            assistantRow(next.continuation),
            userRow(next.prompt),
            assistantRow(next.reply),
          ],
          title: title ?? "Mock Chat",
        })
      );
    },
    holdNextDone: () => {
      isDoneHeld = true;
    },
    rejectNextAnswer: (next) => {
      rejection = next;
    },
    requests,
  };
};

/**
 * Mocks POST /files/upload. Without `uploads` it answers 404, as a server without file storage
 * does; with it, each upload returns the next id. Returns the uploaded filenames, in order.
 */
export const mockFileUploads = async (
  page: Page,
  {uploads}: {uploads?: Array<{id: string; size: number}>} = {}
): Promise<string[]> => {
  const filenames: string[] = [];
  await page.route(`${API_URL}/files/upload`, (route) => {
    const filename = /filename="([^"]+)"/.exec(route.request().postData() ?? "")?.[1] ?? "";
    const upload = uploads?.[filenames.length];
    filenames.push(filename);
    if (!upload) {
      return route.fulfill({body: "Not Found", status: 404});
    }
    const {id, size} = upload;
    return route.fulfill({
      body: JSON.stringify({data: {filename, gcsKey: `uploads/${id}`, id, size}}),
      contentType: "application/json",
      status: 200,
    });
  });
  return filenames;
};

const SIGNUPS_DOCUMENT = `v: 1
datasets:
  mix:
    columns:
      - name: source
        type: string
      - name: count
        type: number
    rows:
      - [Web, 40]
      - [Mobile, 60]
  signups:
    source: ref
    id: ds_signups
blocks:
  - type: chart
    id: mix_chart
    kind: donut
    data: mix
    x: source
    y: count
  - type: chart
    id: signups_chart
    kind: bar
    data: signups
    x: month
    y: count
    title: Signups
  - type: actions
    id: followups
    elements:
      - type: button
        id: export_btn
        text: Export
        action:
          kind: callback
          name: export_csv
      - type: button
        id: weekly
        text: Show weekly
        action:
          kind: reply
          text: Show weekly signups
`;

const chunkText = (text: string, size: number): SseEvent[] => {
  const events: SseEvent[] = [];
  for (let index = 0; index < text.length; index += size) {
    events.push({text: text.slice(index, index + size)});
  }
  return events;
};

/** Whole-reply document in chunks, plus the dataset and action routes the chart needs. */
export const mockGptBlocks = async (page: Page): Promise<void> => {
  const historyId = "mock-history-blocks";
  let prompts = 0;
  await page.route(`${API_URL}/gpt/prompt`, (route) => {
    prompts += 1;
    if (prompts === 1) {
      return fulfillSse(route, [
        ...chunkText(SIGNUPS_DOCUMENT, 48),
        {blocks: {errors: [], ok: true, warnings: []}},
        {done: true, historyId, title: "Signups"},
      ]);
    }
    return fulfillSse(route, [
      ...textEvents("Here is the weekly view."),
      {done: true, historyId, title: "Signups"},
    ]);
  });
  await page.route(/\/gpt\/datasets\/ds_signups/, (route) =>
    route.fulfill({
      body: JSON.stringify({
        data: {
          columns: [
            {name: "month", type: "string"},
            {name: "count", type: "number"},
          ],
          more: false,
          page: 1,
          rowCount: 2,
          rows: [
            ["Jan", 120],
            ["Feb", 180],
          ],
        },
      }),
      contentType: "application/json",
      status: 200,
    })
  );
  await page.route(/\/gpt\/actions$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 400));
    const replacement = {
      blocks: [
        {
          elements: [
            {
              action: {kind: "reply", text: "Show weekly signups"},
              id: "weekly",
              text: "Show weekly",
              type: "button",
            },
          ],
          id: "followups",
          type: "actions",
        },
      ],
      v: 1,
    };
    return route.fulfill({
      body: JSON.stringify({data: {blocks: replacement, replace: "block"}}),
      contentType: "application/json",
      status: 200,
    });
  });
};

export const unmockGptStream = async (page: Page): Promise<void> => {
  await page.unroute(`${API_URL}/gpt/prompt`);
  await page.unroute(/\/gpt\/datasets\/ds_signups/);
  await page.unroute(/\/gpt\/actions$/);
};
