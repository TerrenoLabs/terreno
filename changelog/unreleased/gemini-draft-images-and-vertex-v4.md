---
category: Fixed
---

- GPT chat no longer shows an image twice for Gemini image models such as `gemini-3-pro-image`. The draft images Gemini returns while it reasons (`thought: true`) are no longer streamed or saved; the last draft is kept only when there is no final image.
- `@terreno/ai` works with Gemini and Vertex again on `ai` 6. 58.0.0 moved the Google providers to the `ai` 7 line (`@ai-sdk/google-vertex` 5, `@ai-sdk/provider` 4, `@ai-sdk/mcp` 2), whose models `ai` 6 rejects with `Unsupported model version v4`. The `@ai-sdk/google-vertex` peer is back to `^4.0.199`, the `@ai-sdk/provider` peer is removed, and `@ai-sdk/mcp` is back to `^1.0.104`. Apps should install `@ai-sdk/google-vertex` 4.x and `@ai-sdk/google` 3.x.
