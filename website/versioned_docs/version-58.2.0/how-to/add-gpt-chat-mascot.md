# Add a GPT chat mascot

Pass a `mascot` node into `GPTChat`. Terreno does not ship a character — the consumer owns the image, Lottie, icon, or copy.

## When it shows

| Chat state | Mascot |
| --- | --- |
| `currentMessages` is empty | Rendered, centered in the chat panel above suggested prompts |
| One or more messages | Hidden |

The empty state fills the message area and centers both axes. GPTChat sizes that hero to the message viewport so a short mascot stays centered, and the same scroller still reaches a large mascot, suggested prompts, or an open keyboard. Streaming feedback stays with the centered hero until the first message arrives. Size the mascot for a hero slot (`Heading size="2xl"`, a large `Image`, or a Lottie view).

Omit `mascot` to keep the default empty chat (prompts only, or a blank panel).

## Steps

### 1. Build the node in your app

Keep the asset in the consumer package. `GPTChat` only mounts whatever you pass.

```tsx
import {Box, Heading} from "@terreno/ui";
import {Image} from "react-native";
import {useState} from "react";

const MASCOTS = [
  require("../assets/mascot-1.png"),
  require("../assets/mascot-2.png"),
  require("../assets/mascot-3.png"),
  require("../assets/mascot-4.png"),
];

const ChatScreen: React.FC = (): React.ReactElement => {
  // Select once per screen mount; ordinary re-renders keep the same character.
  const [mascot] = useState(() => MASCOTS[Math.floor(Math.random() * MASCOTS.length)]);

  return (
    <GPTChat
      currentMessages={currentMessages}
      histories={histories}
      mascot={
        <Box alignItems="center" gap={3}>
          <Image
            accessibilityLabel="App mascot"
            resizeMode="cover"
            source={mascot}
            style={{borderRadius: 112, height: 224, width: 224}}
          />
          <Heading align="center" size="md">Ask anything.</Heading>
        </Box>
      }
      onCreateHistory={handleCreateHistory}
      onDeleteHistory={handleDeleteHistory}
      onSelectHistory={handleSelectHistory}
      onSubmit={handleSubmit}
    />
  );
};
```

For a single fixed mascot, pass one asset directly instead of selecting from an array.

### 2. Pass it to `GPTChat`

```tsx
<GPTChat
  currentMessages={currentMessages}
  histories={histories}
  mascot={ChatMascot}
  onCreateHistory={handleCreateHistory}
  onDeleteHistory={handleDeleteHistory}
  onSelectHistory={handleSelectHistory}
  onSubmit={handleSubmit}
  suggestedPrompts={["What can you help with?"]}
/>
```

### 3. Confirm empty vs thread

Open a new chat: the mascot is visible. After the first user or assistant message, it is gone.

## Example

The example app bundles four consumer-owned plant robots in
`example-frontend/assets/gptMascots/` and selects one on each AI screen mount. The
demo story `GPTChat` → `Mascot` shows the slot without a backend.

## Related

- [`GPTChat` props](../reference/ui.md#gptchat)
- Demo: `http://localhost:8085/dev/GPTChat?story=Mascot`
