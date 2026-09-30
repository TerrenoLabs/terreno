---
category: Fixed
---

`/gpt/prompt` sends each generated image once. Image-output models no longer duplicate the SSE `image` event and saved content part, and image-only responses save empty text instead of the `(image)` placeholder. `GptHistory` prompt `text` is now required only when the prompt has no `content` parts.
