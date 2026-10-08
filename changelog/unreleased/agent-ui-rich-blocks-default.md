---
category: Changed
---

Behaviour change: hosts with `uiBlocks` on get the new rich blocks (`checklist`, `gallery`, `list`, card `eyebrow`, and `copy`, plus `stepper` when a host action has `handles: "stepper"`) in the chat system prompt by default. A native build released before them shows an error banner for a reply that uses them. Set `uiBlocks.richBlocks: false` to keep the old catalog until those builds update; the prompt is then unchanged from before, even with a stepper action registered. Validation accepts the new blocks either way. See [Keep the old catalog for shipped native builds](docs/how-to/agent-ui-blocks.md#keep-the-old-catalog-for-shipped-native-builds).
