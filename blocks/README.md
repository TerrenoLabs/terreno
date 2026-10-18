# @terreno/blocks

Shared contracts for agent-driven UI — ask schemas, answer validation, and simple cards.

Runtime-agnostic Zod contracts shared by `@terreno/ai` (server) and `@terreno/ui` (renderer), plus
JSON Schema documents and fixtures for native clients such as a Swift watch app. The only runtime
dependency is `zod`.

## Install

```bash
bun add @terreno/blocks
```

Most apps get it through `@terreno/ai` and `@terreno/ui`. Install it directly to validate asks or
answers in your own code, or to build a client that answers asks without React.

## Quick start

```typescript
import {type ChoiceAsk, toSimpleCard, validateAskInput, validateAskResponse} from "@terreno/blocks";

const ask: ChoiceAsk = {
  input: {
    options: [
      {id: "starter", label: "Starter"},
      {id: "team", label: "Team"},
    ],
    prompt: "Which plan should I set up?",
    select: "one",
  },
  kind: "choice",
};

const inputErrors = validateAskInput(ask); // [] when the ask is valid
const answerErrors = validateAskResponse({
  ...ask,
  response: {action: "accept", content: {selected: ["team"]}},
});
const card = toSimpleCard({...ask, toolCallId: "call_1"}); // title, text, and up to 3 buttons
```

## What's included

- Ask schemas for every kind (`choice`, `confirm`, `markdown`, `form`, `files`) and the answer
  envelope (`accept`, `decline`, `cancel`)
- `validateAskInput` and `validateAskResponse`, with stable error codes (`ASK_ERROR_CODES`) and
  limits (`ASK_LIMITS`)
- Simple cards for small screens: `toSimpleCard`, `resolveButtonAnswer`, and the compact surface
- Bodies of the headless `pendingAsks` and `turn` endpoints
- JSON Schema documents (`@terreno/blocks/schemas/*`) and valid and invalid fixtures
  (`@terreno/blocks/fixtures/*`)

## Documentation

- Reference: [docs/reference/agent-ui-asks.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/reference/agent-ui-asks.md)
- How-to: [docs/how-to/agent-ui-asks.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/how-to/agent-ui-asks.md)
- Explanation: [docs/explanation/agent-ui-asks.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/explanation/agent-ui-asks.md)

## License and Contributing

Licensed under the [MIT License](https://github.com/TerrenoLabs/terreno/blob/master/LICENSE). See [CONTRIBUTING.md](https://github.com/TerrenoLabs/terreno/blob/master/CONTRIBUTING.md) for contribution guidelines.
