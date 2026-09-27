# Add agent asks to a chat

Pass `asks: true` to the GPT routes, then show and answer asks with `GPTChat`. The example app
does both: `example-backend/src/api/ai.ts` and `example-frontend/app/(tabs)/ai.tsx`. Fields, events,
and errors are in the [reference](../reference/agent-ui-asks.md).

To answer asks from a watch or another client that does not read server-sent events, see
[Answer asks from an Apple Watch or another small client](#answer-asks-from-an-apple-watch-or-another-small-client).

## Try it without an API key

The example backend uses a scripted demo agent, `terreno-demo-agent`, when no model is configured.

1. Start `example-backend` without `GEMINI_API_KEY` or `GOOGLE_VERTEX_PROJECT`. The log says
   chat uses the scripted Terreno demo agent.
2. Start `example-frontend`, log in, and open the AI tab. Leave the Gemini API key empty: a saved
   key is sent as `x-ai-api-key` and switches chat to that model.
3. Send "Help me pick a plan" (a suggested prompt).
4. Tap a plan. The agent replies with your pick, and the card collapses to "You chose: Team".
5. Reload the page and open the conversation again. The summary is still there.
6. Send "Pick toppings for my pizza". Check up to three toppings, type your own in "Another
   topping", and press "Add toppings". The agent names every topping you picked, and the card
   collapses to "You chose: Extra cheese, Olives. Another topping: Basil".
7. Send "Archive old chats" (a suggested prompt). The card shows a red "Archive 12 chats" button
   first and "Keep them" last, with no Skip. Press "Keep them": the agent says it kept your chats,
   and the card collapses to "You declined: Keep them".
8. Send "Send the weekly report" and press "Send report". The card collapses to "You confirmed:
   Send report". Reload the page: both summaries are still there.

| You send | The demo agent |
| --- | --- |
| A message with the word topping or toppings, such as "pick toppings" or "pick several toppings" | Asks "Which toppings should I add? Pick up to three." with `select: "many"`, six toppings (Extra cheese and Mushrooms preselected), `maxSelected: 3`, and an Other field titled "Another topping" |
| A message with "weekly report", such as "send the weekly report" | Asks `ask_confirm` "Send the weekly report to the team now? It goes to 8 people." with "Send report" (primary) and "Not now" |
| A message with the word archive, such as "archive old chats" | Asks `ask_confirm` "Archive the 12 chats older than 90 days? You can't undo this." with `destructive: true`, "Archive 12 chats" (destructive) and "Keep them" |
| Any other message with a word like pick, choose, or plan, such as "choose between several plans" | Asks "Which plan should I set up for your workspace?" with Starter, Team (the default), and Enterprise |
| The same kind of message, on routes without `asks` | Says asks are turned off and how to turn them on |
| An answer, or Skip | Replies with the plan or the toppings you picked, including the topping you typed, says whether it would send the report or archive the chats, or says it skipped the question |
| Anything else, with or without `asks` | Explains that it follows a script and how to use a real model |
| Any of these with `surface: "compact"` | Asks the same plan and confirm questions, which already fit a watch, and replies in one or two short sentences without markdown. The compact surface offers only select one for `choice`, so a toppings message gets a text reply that says to open the chat on a phone. |

To script another exchange, add an entry to `DEMO_SCENARIOS` in
`example-backend/src/api/demoAgent.ts`: a trigger pattern, one ask input, and a reply for the
answer. Scenarios match in order, so put one with narrower trigger words first. Set
`compactFallback` when the input does not fit the compact surface.

## Confirm before a destructive tool

With asks on, the model can call `ask_confirm` before a tool that deletes data, sends something on
the user's behalf, spends money, or cannot be undone. The asks system prompt tells it to, and to
take the action only after `{"confirmed": true}`. `ask_confirm` has no `execute`, so the turn
pauses until the user presses a button.

1. Say in the tool's description what it changes and that it needs a confirm first:

   ```typescript
   const deleteCompletedTodos = tool({
     description:
       "Deletes the user's completed todos. Cannot be undone. Call ask_confirm with " +
       "destructive: true first, and call this only after {confirmed: true}.",
     execute: async () => ({deleted: await removeCompletedTodos(userId)}),
     inputSchema: z.object({}),
   });

   addGptRoutes(router, {aiService, asks: true, tools: {deleteCompletedTodos}});
   ```

2. Check the rule in the tool too. The model decides when to ask, so a tool that must never run
   unconfirmed should refuse on its own, for example by requiring an id list the user saw.

The card shows `confirmLabel` first and `denyLabel` last. With `destructive: true` the approve
button uses the destructive style, and a watch never makes it the Double Tap button. A deny sends
`{"confirmed": false}`, so the model hears "no" and skips the action. Skip appears only when the
ask sets `allowDecline: true`. See [confirm](../reference/agent-ui-asks.md#confirm).

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
| `{ask: {toolCallId, kind, input, simple}, historyId}` | Append a `tool-call` message with `ask: {kind, input, simple, status: "pending", toolCallId}`, and remember `historyId` for the ask so it can be answered before `{done}` |
| `{askResolved: {toolCallId, action}}` | Mark the ask `answered` (`cancelled` for `cancel`), set its `response`, and insert a `tool-result` message right after it |
| `{done: true, historyId, pendingAsk?}` | The turn ended, also after `{error}`. `pendingAsk.toolCallId` names the ask the conversation waits on. |

```typescript
if (data.ask) {
  askHistoryIdsRef.current.set(data.ask.toolCallId, data.historyId);
  setCurrentMessages((prev) => [...withoutEmptyAssistant(prev), askMessage(data.ask)]);
} else if (data.askResolved) {
  const {action, toolCallId} = data.askResolved;
  setCurrentMessages((prev) => withResolvedAsk({action, messages: prev, submitted, toolCallId}));
}
```

Copy `askMessage`, `withResolvedAsk`, `withoutEmptyAssistant`, and `answerHistoryId` from
`example-frontend/lib/gptAsks.ts`. `submitted` is the answer this turn sent, so the summary can
name the chosen option. `withoutEmptyAssistant` drops the empty assistant placeholder but keeps a
reply that holds only an image or a file. `askHistoryIdsRef` is a `useRef(new Map<string, string>())`.

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
    // A new chat's ask can be answered before `{done}` sets currentHistoryId.
    const historyId = answerHistoryId({
      askHistoryIds: askHistoryIdsRef.current,
      currentHistoryId,
      toolCallId,
    });
    if (!historyId) {
      return;
    }
    await runTurn({
      body: {askResponse: {...response, toolCallId}, historyId},
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
| A `prompt` sent while the transcript shows a pending ask, with no `{askResolved}` for it | Another tab or device resolved the ask first, and the message went ahead as a normal prompt. Reload the conversation so the card shows how the ask ended. A `prompt` never gets 409. |

## Answer asks from an Apple Watch or another small client

A client that does not read server-sent events, such as a watch app, a notification action, or a
chat bot, uses two JSON endpoints on `/gpt/histories`:

| Endpoint | Use |
| --- | --- |
| `GET /gpt/histories/pendingAsks` | List the asks waiting on the user, newest first, each with its simple card |
| `POST /gpt/histories/:id/turn` | Send a message or a pressed button, and get the reply once the turn finishes |

The client needs no knowledge of ask kinds. It shows the card's text and buttons and sends back the
pressed button's `id`. React Native does not run on watchOS, so a watch client is a native SwiftUI
target. [`@bacons/apple-targets`](https://github.com/evanbacon/expo-apple-targets) adds one to an
Expo app. Terreno does not ship a watch app; the steps below sketch one. Fields and errors are in
[Headless endpoints](../reference/agent-ui-asks.md#headless-endpoints).

### 1. Register the endpoints

Both endpoints exist only with asks on. `new AiApp({aiService, asks: true})` registers both. With
the route functions, pass `addGptHistoryRoutes` the options you give `addGptRoutes`, as `chat`, so
`turn` runs the same chat as `/gpt/prompt`. Without `chat`, or with `asks` off in it, it adds
neither endpoint:

```typescript
const chat = {aiService, asks: true};
addGptHistoryRoutes(router, {chat});
addGptRoutes(router, chat);
```

### 2. Try them with curl

Run the example backend as in [Try it without an API key](#try-it-without-an-api-key) and seed
it with `bun run backend:seed`. This script signs in, asks the demo agent to pick a plan from a
small screen, lists the pending ask's buttons, and presses Starter. It needs `jq`.

```bash
API=http://localhost:4000
JSON="Content-Type: application/json"

TOKEN=$(curl -s -X POST $API/api/auth/sign-in/email -H "$JSON" \
  -d '{"email": "test@example.com", "password": "testpassword123"}' | jq -r .token)
AUTH="Authorization: Bearer $TOKEN"

HISTORY=$(curl -s -X POST $API/gpt/histories -H "$AUTH" -H "$JSON" -d '{}' | jq -r .data._id)
ASK=$(curl -s -X POST $API/gpt/histories/$HISTORY/turn -H "$AUTH" -H "$JSON" \
  -d '{"prompt": "Help me pick a plan", "surface": "compact"}' | jq -r .data.pendingAsk.toolCallId)
curl -s $API/gpt/histories/pendingAsks -H "$AUTH" | jq -c '[.data[0].simple.buttons[].id]'
curl -s -X POST $API/gpt/histories/$HISTORY/turn -H "$AUTH" -H "$JSON" \
  -d "{\"toolCallId\": \"$ASK\", \"buttonId\": \"option:starter\", \"surface\": \"compact\"}" |
  jq -r .data.text
```

It prints the card's button ids, the default plan first, then the demo agent's compact reply:

```text
["option:team","option:starter","option:enterprise"]
You picked the Starter plan. A real agent would set it up now.
```

### 3. Hand the session token to the watch

The watch signs its requests with the phone's Better Auth session token, sent as
`Authorization: Bearer <token>`, the header the example app sends on every request. On the phone,
the token is `session.token` from `authClient.getSession()`, which `getSessionToken()` in
`example-frontend/lib/betterAuth.ts` reads.

Send the token to the watch in the WatchConnectivity application context. From JavaScript,
`react-native-watch-connectivity` wraps `WCSession`. It needs a development build and works only
on iOS:

```typescript
import {Platform} from "react-native";
import {updateApplicationContext} from "react-native-watch-connectivity";

import {getSessionToken} from "@/lib/betterAuth";

/** Call after sign-in and after sign-out: an empty token tells the watch to forget it. */
export const shareSessionWithWatch = async (): Promise<void> => {
  if (Platform.OS !== "ios") {
    return;
  }
  updateApplicationContext({sessionToken: (await getSessionToken()) ?? ""});
};
```

The application context holds only the latest value, and the watch receives it the next time the
watch app runs. On the watch, keep the token in the keychain, never in `UserDefaults`:

```swift
import WatchConnectivity

/// Keeps the session token the phone sends. Call `start()` when the watch app launches.
final class SessionTokenReceiver: NSObject, WCSessionDelegate {
    static let shared = SessionTokenReceiver()

    func start() {
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        store(session.receivedApplicationContext)
    }

    func session(_ session: WCSession, didReceiveApplicationContext context: [String: Any]) {
        store(context)
    }

    private func store(_ context: [String: Any]) {
        guard let token = context["sessionToken"] as? String else {
            return
        }
        if token.isEmpty {
            TokenKeychain.delete()
        } else {
            TokenKeychain.save(token)
        }
    }
}
```

`TokenKeychain` stands for your keychain wrapper: one generic password item written with
`SecItemAdd` and `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`, read with
`SecItemCopyMatching`, and removed with `SecItemDelete`. The token has the same access as the phone
app. It stops working when the session expires or the user signs out.

### 4. Call the endpoints with URLSession

```swift
import Foundation

struct SimpleCardButton: Decodable, Identifiable {
    let id: String
    let label: String
    /// "default", "primary", "destructive", or "cancel"
    let style: String
}

struct SimpleCard: Decodable {
    let title: String?
    let text: String
    let buttons: [SimpleCardButton]
    let handoff: Bool
}

struct PendingAsk: Decodable, Identifiable {
    let historyId: String
    let toolCallId: String
    let title: String?
    let simple: SimpleCard

    var id: String { toolCallId }
}

struct TurnResult: Decodable {
    let text: String
    let error: String?
}

enum AskClientError: Error {
    case signedOut
    case noLongerPending
    case failed(status: Int)
}

struct AskClient {
    let baseURL: URL
    let token: String

    func pendingAsks() async throws -> [PendingAsk] {
        try await send("GET", "gpt/histories/pendingAsks")
    }

    func press(_ button: SimpleCardButton, on ask: PendingAsk) async throws -> TurnResult {
        try await send("POST", "gpt/histories/\(ask.historyId)/turn", body: [
            "buttonId": button.id,
            "surface": "compact",
            "toolCallId": ask.toolCallId,
        ])
    }

    func say(_ prompt: String, in historyId: String) async throws -> TurnResult {
        try await send("POST", "gpt/histories/\(historyId)/turn", body: [
            "prompt": prompt,
            "surface": "compact",
        ])
    }

    private struct Envelope<Value: Decodable>: Decodable {
        let data: Value
    }

    private func send<Value: Decodable>(
        _ method: String, _ path: String, body: [String: String]? = nil
    ) async throws -> Value {
        var request = URLRequest(url: baseURL.appending(path: path))
        request.httpMethod = method
        // A turn responds only when the agent is done, which can take longer than the 60 s default.
        request.timeoutInterval = 120
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(body)
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        switch status {
        case 200..<300:
            return try JSONDecoder().decode(Envelope<Value>.self, from: data).data
        case 401:
            TokenKeychain.delete()
            throw AskClientError.signedOut
        case 409:
            throw AskClientError.noLongerPending
        default:
            throw AskClientError.failed(status: status)
        }
    }
}
```

`JSONDecoder` ignores fields the structs leave out, such as each button's `response`: the server
answers with the stored `response` of the button whose `id` the watch sends. `turn` also returns
`pendingAsk` when the reply ends in a new ask. This sketch reloads `pendingAsks` after every turn
instead, which also picks up asks from other devices. To start a conversation from the watch, send
`POST /gpt/histories` with the body `{}` and use `data._id` as the `historyId`. The
[JSON Schemas](../reference/agent-ui-asks.md#json-schemas-and-fixtures) in
`@terreno/blocks/schemas/` describe every field, if you would rather generate `Codable` types.

The watch sends `surface: "compact"` on every turn, answers included:

- **Every ask fits the watch.** On a compact turn the agent can ask only a `choice` with 2–3
  options whose labels fit a button uncut and differ from each other. Its card has
  `handoff: false`, so the user can answer it from the watch.
- **Replies fit the screen.** The system prompt asks for at most two short sentences.
- **The surface covers one turn.** The server does not store it. An answer starts a turn that can
  end in a new ask, so the answer sends `compact` too. The phone's chat sends no `surface`, so its
  turns in the same conversation use `full` and offer every ask kind.

`pendingAsks` also lists asks the agent made in the phone's chat, whose cards can set `handoff`.
Show the buttons such a card has, such as `Use "Team"` and Skip, with its "Continue on your phone"
line.

### 5. Show the card in SwiftUI

```swift
import SwiftUI

struct PendingAskView: View {
    let ask: PendingAsk
    let client: AskClient
    /// Shows the reply, then reloads `pendingAsks`. `nil` when the answer did not go through.
    let onFinish: (TurnResult?) -> Void

    @State private var pressedButtonId: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                if let title = ask.simple.title {
                    Text(title).font(.headline)
                }
                Text(ask.simple.text)
                if ask.simple.handoff {
                    Text("Continue on your phone")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                ForEach(ask.simple.buttons) { button in
                    Button(button.label, role: role(for: button.style)) {
                        press(button)
                    }
                    .tint(button.style == "primary" ? .accentColor : nil)
                    .disabled(pressedButtonId != nil)
                    .handGestureShortcut(.primaryAction, isEnabled: button.id == doubleTapButtonId)
                }
            }
        }
    }

    /// The first button that is not destructive, so Double Tap never approves a destructive action.
    private var doubleTapButtonId: String? {
        ask.simple.buttons.first { $0.style != "destructive" }?.id
    }

    private func role(for style: String) -> ButtonRole? {
        switch style {
        case "destructive":
            return .destructive
        case "cancel":
            return .cancel
        default:
            return nil
        }
    }

    private func press(_ button: SimpleCardButton) {
        pressedButtonId = button.id
        Task {
            let result = try? await client.press(button, on: ask)
            pressedButtonId = nil
            onFinish(result)
        }
    }
}
```

Keep the buttons in the card's order. When the ask suggests an answer, its button comes first with
style `primary`, and Skip comes last with style `cancel`. A `confirm` card has the approve button
first and the deny button last. Give Double Tap (`handGestureShortcut`, watchOS 11 and later) to the
first button that is not `destructive`: on a destructive confirm that is the deny button, so the
gesture cannot approve an action that cannot be undone. Disable every button while one answer is
sending, so a double tap sends one answer instead of a second one that gets 409. `SimpleAskCard`
in `@terreno/ui` draws the same card in React Native ([props](../reference/ui.md#simpleaskcard)).

### 6. Handle errors

| Response | Handling |
| --- | --- |
| 401 | The session ended or the user signed out. The client above deletes the token. Ask the user to open the phone app, which sends a new token after sign-in. |
| 409 `This ask is no longer pending` | Another device answered or cancelled the ask first. Reload `pendingAsks`. |
| 400 `UNKNOWN_BUTTON` | The `buttonId` is not on the card. Send only ids from `simple.buttons`; the error's `fix` lists them. |
| 200 with `error` in `data` | The agent failed after the turn started. The message or answer is kept, with what the agent did before it failed. Show a short error; the next message continues the conversation. |
| A timeout or a lost connection | The turn still finishes and is saved. Reload `pendingAsks`, or read the conversation with `GET /gpt/histories/:id`. |

## Verify

| Test | Covers |
| --- | --- |
| `example-frontend/e2e/ai-chat.spec.ts` | Against a mocked stream: a quick-reply answer, a radio answer after a rejected one, an answer another tab sent first, a turn that streams only `{done}`, a message that goes through after another tab answered the ask, and an ask on a new chat answered before `{done}` |
| `example-frontend/lib/gptAsks.test.ts` | Stream events and saved rows mapped to messages, image-only replies kept, and the conversation an answer goes to |
| `example-backend/src/api/demoAgent.test.ts` | The demo agent's ask, answers, and replies on both surfaces, and a plan ask answered over HTTP with a button of its simple card |
| `ui/src/GPTChat.test.tsx`, `ui/src/asks/AskCard.test.tsx` | Rendering, focus, answers, errors, and summaries |
| `ai/src/routes/gptHistories.test.ts`, `ai/src/aiApp.test.ts` | `turn` and `pendingAsks`: a pressed button, a full answer, a prompt that cancels the ask, a failed turn, a stream that fails mid-reply, a client that disconnects, the 400, 403, 404, and 409 responses, response bodies that match the published JSON Schemas, and neither endpoint when asks are off |
| `ai/src/routes/gpt.test.ts` (compact surface) | A compact turn offers only the narrowed `ask_choice` and adds the compact line to the system prompt |
| `ai/src/routes/gpt.test.ts` (failures and races) | `{error}` then `{done}` when the model fails before its first chunk, mid-reply, or during a resume; a prompt that goes through after an answer resolved the ask; two turns and a rating on one conversation keeping every row |
| `ui/src/asks/SimpleAskCard.test.tsx`, `demo/stories/SimpleAskCard.stories.test.tsx` | Every fixture's card, button presses, the sending state, and the compact `turn` body the watch-sized demo sends |

Related: [UI reference for `GPTChat` asks and `AskCard`](../reference/ui.md#asks),
[Agent UI Asks explained](../explanation/agent-ui-asks.md).
