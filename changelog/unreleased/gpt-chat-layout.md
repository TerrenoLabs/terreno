---
category: Changed
---

**@terreno/ui:** `GPTChat` reads as a transcript. User messages stay in a light bubble. Assistant text sits on the page background inside a 760px column, with copy, download, and ratings in one row. An image-only reply copies the image. A reply that also has text copies the text, and the separate `gpt-copy-image` control is gone. A tool call and its result are one expandable row labeled `Tool: <name>` (previously `Result: <name>`), and the body scrolls inside a 240px cap. **Tools** appears beside the composer only when `mcpTools` has entries. It opens a large list whose arguments stay hidden until **Show arguments** is checked.
