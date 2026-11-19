---
category: Breaking
---

**@terreno/ui:** `GPTChat` now reads as a transcript: user messages in a light bubble, assistant text on the page in a 760px column, and tool calls as one expandable row capped at 240px. Breaking changes for apps and e2e suites that select these elements:

- `gpt-copy-image` is removed. Use `gpt-copy-msg-<index>` for copy. It copies the image for an image-only reply and the text when a reply has both.
- Tool rows are labeled `Tool: <name>` instead of `Result: <name>`.
- **Tools** (`gpt-tools-button`) appears beside the composer only when `mcpTools` has entries.
- A user or assistant message with no text, content parts, or blocks renders nothing, including its action row.

Download for an image reply is `gpt-download-image-<index>`. The **Tools** modal hides arguments until **Show arguments** is checked, and it resets to hidden when closed.
