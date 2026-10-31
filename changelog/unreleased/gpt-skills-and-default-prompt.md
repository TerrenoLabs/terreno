---
category: Added
---

- `@terreno/ai`: `defaultSystemPrompt` on `AiApp` and `addGptRoutes` puts an app-wide system
  prompt first in every chat turn. Mount the exported `aiConfigurationSchema` on a
  `configurationPlugin` model and read it with `configurationPromptGetter` so admins edit it on
  the Configuration screen.
- `@terreno/ai`: skills in Anthropic's `SKILL.md` format. `skills: true` mounts `/gpt/skills`
  (CRUD plus `POST /gpt/skills/upload` for a `SKILL.md` or `.zip` package) with user and global
  scopes, and gives tool-capable chat turns a `## Skills` catalog, a `load_skill` tool, and
  leading `/name` activation. `AIAdminApp` adds **AI → Skills** for global skills. New exports:
  `GptSkill`, `addSkillRoutes`, `parseSkillPackage`.
- `@terreno/ai`: `imageGeneration` adds a built-in `generate_image` tool. The chat model writes
  the prompt, an optional style prompt is prepended, skill and attachment reference images are
  read server-side, and images are stored under `generated/<userId>/` and saved on the reply.
  At most 4 calls per turn by default. New export: `createGenerateImageTool`.
- `@terreno/ai`: `FileStorageService.upload` accepts an optional `keyPrefix` (default `uploads`,
  so existing keys are unchanged).
