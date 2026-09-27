# Add agent asks to a chat

Pass `asks: true` to the GPT routes, then show and answer asks with `GPTChat`. The example app
does both: `example-backend/src/api/ai.ts` and `example-frontend/app/(tabs)/ai.tsx`. Fields, events,
and errors are in the [reference](../reference/agent-ui-asks.md).

## Try it without an API key

The example backend uses a scripted demo agent, `terreno-demo-agent`, when no model is configured.

1. Start `example-backend` without `GEMINI_API_KEY` or `GOOGLE_VERTEX_PROJECT`. The log says
   chat uses the scripted Terreno demo agent.
2. Start `example-frontend`, log in, and open the AI tab. Leave the Gemini API key empty: a saved
   key is sent as `x-ai-api-key` and switches chat to that model.
3. Send "Help me pick a plan" (a suggested prompt).
4. Tap a plan. The agent replies with your pick, and the card collapses to "You chose: Team".
5. Reload the page and open the conversation again. The summary is still there.

| You send | The demo agent |
| --- | --- |
| A message with a word like pick, choose, or plan | Asks "Which plan should I set up for your workspace?" with Starter, Team (the default), and Enterprise |
| The same kind of message, on routes without `asks` | Says asks are turned off and how to turn them on |
| An answer, or Skip | Replies with the plan you picked, or says it skipped the plan |
| Anything else, with or without `asks` | Explains that it follows a script and how to use a real model |

To script another exchange, add an entry to `DEMO_SCENARIOS` in
`example-backend/src/api/demoAgent.ts`: a trigger pattern, one ask input, and a reply for the
answer.

## 1. Enable asks on the backend

```typescript
addGptRoutes(router, {aiService, asks: true});
```

`new AiApp({aiService, asks: true})` takes the same option. A real model decides when to ask; the
system prompt that asks add tells it how. See [Enable asks](../reference/agent-ui-asks.md#enable-asks).

## 2. Show asks from the stream

`POST /gpt/prompt` adds three events. Map them onto `GPTChat` messages:

| Event | Transcript change |
| --- | --- |
| `{ask: {toolCallId, kind, input, simple}}` | Append a `tool-call` message with `ask: {kind, input, simple, status: "pending", toolCallId}` |
| `{askResolved: {toolCallId, action}}` | Mark the ask `answered` (`cancelled` for `cancel`), set its `response`, and insert a `tool-result` message right after it |
| `{done: true, historyId, pendingAsk?}` | The turn ended. `pendingAsk.toolCallId` names the ask the conversation waits on. |

```typescript
if (data.ask) {
  setCurrentMessages((prev) => [...prev, askMessage(data.ask)]);
} else if (data.askResolved) {
  const {action, toolCallId} = data.askResolved;
  setCurrentMessages((prev) => withResolvedAsk({action, messages: prev, submitted, toolCallId}));
}
```

Copy `askMessage` and `withResolvedAsk` from `example-frontend/lib/gptAsks.ts`. `submitted` is the
answer this turn sent, so the summary can name the chosen option.

Insert the `tool-result` message even though `GPTChat` hides it. The server stores the ask and its
answer as two rows, and ratings are sent by message index.

A turn can stream only `{done}`, for example when the server cancels a second ask because one is
already pending. Reload the conversation with `GET /gpt/histories/:id` when a turn streamed nothing
visible, or when `done.pendingAsk` names an ask the stream did not send. The `@terreno/rtk` base
query returns the `data` of single-document responses, so an RTK query for that route resolves to
the history itself, not `{data}` (see [emptyApi](../reference/legacy/rtk.md#emptyapi--emptysplitapi)).

Refetch the history list after a turn that streams ask events or reloads the conversation. The
example app reopens a conversation from the list's cached rows, which still hold the pending ask.

## 3. Show asks in saved conversations

An ask's `tool-call` row has `ask: {kind, status}` and the ask input in `args`.
`GptHistory.pendingAsk` holds the ask the conversation waits on, with its simple card.

```typescript
const prompts = history.prompts.map((p): GPTChatMessage => {
  const ask = askFromHistoryPrompt({pendingAsk: history.pendingAsk, prompt: p});
  return {
    ...(ask ? {ask} : {}),
    content: p.text,
    role: p.type,
    ...(p.toolCallId && p.type === "tool-call"
      ? {toolCall: {args: p.args ?? {}, toolCallId: p.toolCallId, toolName: p.toolName ?? ""}}
      : {}),
    ...(p.toolCallId && p.type === "tool-result"
      ? {toolResult: {result: p.result, toolCallId: p.toolCallId, toolName: p.toolName ?? ""}}
      : {}),
  };
});
```

`askFromHistoryPrompt` is in `example-frontend/lib/gptAsks.ts`. Keep `tool-result` rows as
`tool-result` messages: `GPTChat` hides the ones that answer an ask and reads the summary from them.

## 4. Send answers

```tsx
const handleAskSubmit = useCallback(
  async ({response, toolCallId}: AskSubmission): Promise<void> => {
    await runTurn({
      body: {askResponse: {...response, toolCallId}, historyId: currentHistoryId},
      submitted: {response, toolCallId},
    });
  },
  [currentHistoryId, runTurn]
);

return (
  <GPTChat
    askErrors={askErrors}
    currentMessages={currentMessages}
    histories={histories}
    onAskSubmit={handleAskSubmit}
    onCreateHistory={handleCreateHistory}
    onDeleteHistory={handleDeleteHistory}
    onSelectHistory={handleSelectHistory}
    onSubmit={handleSubmit}
  />
);
```

`runTurn` is the function that already posts prompts and reads the SSE stream. An answer's turn
starts with `{askResolved}`, then streams the continuation. Return the promise: the pressed button
shows a loading state until it settles.

## 5. Handle errors

| Response | Handling |
| --- | --- |
| 400 `Invalid askResponse` with `fields` | Set `askErrors[toolCallId]` to `fields`. The card shows each `message`. Clear the entry when the user answers again. |
| 409 `This ask is no longer pending` on an answer | Another tab or device resolved the ask first. Reload the conversation and the history list so the card shows how it ended. |
| 409 on a `prompt` | An answer is still resolving the ask. Show the `detail`, "This conversation is finishing an answer; try again.", and let the user send again. |

## Verify

| Test | Covers |
| --- | --- |
| `example-frontend/e2e/ai-chat.spec.ts` | Against a mocked stream: a quick-reply answer, a radio answer after a rejected one, an answer another tab sent first, a turn that streams only `{done}`, and a message sent while another tab's answer finishes |
| `example-frontend/lib/gptAsks.test.ts` | Stream events and saved rows mapped to messages |
| `example-backend/src/api/demoAgent.test.ts` | The demo agent's ask, answers, and replies |
| `ui/src/GPTChat.test.tsx`, `ui/src/asks/AskCard.test.tsx` | Rendering, focus, answers, errors, and summaries |

Related: [UI reference for `GPTChat` asks and `AskCard`](../reference/ui.md#asks),
[Agent UI Asks explained](../explanation/agent-ui-asks.md).
