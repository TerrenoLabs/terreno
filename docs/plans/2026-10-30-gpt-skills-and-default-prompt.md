# GPT skills, an admin default system prompt, and skill-driven image generation

`@terreno/ai`'s GPT chat builds its system prompt from code constants, an optional Langfuse
prompt, the user's project, and a `systemPrompt` the client sends on each request. An
operator can't set the assistant's behavior for the whole app from the admin. Users can't
save reusable instructions. Image generation only works if you pick an image model in the
chat. That model gets no tools, so it can't use skills or compose a prompt from several
steps. This plan adds three things. Admins edit an
app-wide default system prompt and image style prompt on the existing **Configuration**
screen. Skills in Anthropic's `SKILL.md` format can be written or uploaded by users, or
installed for everyone by admins. A built-in `generate_image` tool lets the chat model
compose detailed prompts for Nano Banana (`gemini-3-pro-image`), with skill reference
images attached, so a team using one shared skill gets images in a consistent style.

## The idea

- **Default system prompt.** `GptRouteOptions`/`AiAppOptions` gain
  `defaultSystemPrompt: string | (({req}) => string | undefined | Promise<string | undefined>)`.
  `buildSystemPrompt` puts it in front of everything else (Langfuse prompt, project
  context, request `systemPrompt`). `@terreno/ai` exports `aiConfigurationSchema`
  (`{systemPrompt, imageStylePrompt}`). An app mounts it as the `ai` section of its
  `configurationPlugin` model, and admins edit it on the existing Configuration screen
  with the markdown widget.
- **Skills.** New `GptSkill` model, made of:
  - `name` (`^[a-z0-9-]{1,64}$`), `description` (≤1024 chars), `instructions` (markdown)
  - `files[]` (reference files in storage)
  - `scope`: `user` or `global`
  - `userId` (owner; unset when global)

  Routes under `/gpt/skills` cover CRUD plus `POST /gpt/skills/upload`, which takes a
  `SKILL.md` or a `.zip` holding `SKILL.md` and up to 20 files. Every chat turn on a model
  that supports tools gets:
  - a `## Skills` section in the system prompt listing each available skill as
    `name: description`;
  - a `load_skill({name})` tool that returns the full instructions and file refs;
  - a forced load when the prompt starts with `/skill-name`.

  Global skills are installed for every user automatically. User skills are visible only
  to their owner.
- **Images.** A built-in `generate_image` tool (`{prompt, references?}`):
  1. Prepends the configured image style prompt.
  2. Resolves `skill:<name>/<file>` and attachment references to image bytes.
  3. Calls an image-output language model (`generateText` → `result.files`). This is the
     same `result.files` handling chatTurn already applies to `streamText`.
  4. Stores the images through `FileStorageService` when it is configured.
  5. Emits the existing SSE `image` event, and saves an `image` content part on the
     assistant message.

  The model gets ids, never base64.

Rejected:
- **Versioned `ObsPrompt` for the default prompt.** It needs local observability turned
  on, and edits go through a prompt hub instead of the settings screen admins already use.
- **Org-scoped skills.** Moved to Expansions, per your answer.
- **Relying on a directly picked image model for skill-driven images.** It gets no tools,
  so it can't load skills or reference images. You chose the library tool. A directly
  picked image model keeps working and now also gets the default system prompt, because
  `system` is already sent to image models (`chatTurn.ts:2060`).

## The plan

| # | Task | Depends on | Lands in | Proves it |
| --- | --- | --- | --- | --- |
| T1 | Write the e2e guide | none | docs/testing | `cases: none (prose)`; Roast checks it against `playwright.config.ts` |
| T2 | Default system prompt in chat turns (tracer) | none | ai | `bun test ai/src/routes/defaultSystemPrompt.test.ts` |
| T3 | `GptSkill` model + CRUD routes with scopes | none | ai | `bun test ai/src/routes/skills.test.ts` |
| T4 | Upload `SKILL.md` / `.zip` skill packages | T2, T3 | ai | `bun test ai/src/routes/skillsUpload.test.ts` |
| T5 | Skills in chat: catalog, `load_skill`, `/name` | T4 | ai | `bun test ai/src/routes/gptSkills.test.ts` |
| T6 | Built-in `generate_image` tool | T4, T5 | ai | `bun test ai/src/routes/generateImage.test.ts` |
| T7 | `AiApp` wiring, exports, admin contribution | T6 | ai | `bun test ai/src/aiApp.test.ts` |
| T8 | example-backend wiring + SDK regen | T7 | example-backend, example-frontend SDK | `bun test example-backend/src/api/ai.test.ts` |
| T9 | Skills screen (create, upload, delete, install for everyone) | T1, T8 | example-frontend | `bunx playwright test e2e/gpt-skills.spec.ts` |
| T13 | GPTChat tool-row labels and status | none | ui | `bun test ui/src/GPTChat.test.tsx` |
| T10 | Generated images and skill loads in chat | T1, T8, T9, T13 | example-frontend | `bunx playwright test e2e/ai-image-generation.spec.ts` |
| T11 | Admin: default prompt + global skills | T1, T8, T10 | example-frontend e2e | `bunx playwright test e2e/admin-ai-configuration.spec.ts` |
| T12 | Reference, explanation, how-to docs + changelog | T7 | docs, changelog | `bun run check:changelog`, `bun run check:knip` |

- **Tracer:** `defaultSystemPrompt` → `buildSystemPrompt` → `streamText({system})`. The
  scripted model sees the admin text first.
- **E2E:** 3 specs (browser): skills screen, image generation in chat, admin
  configuration + global skills.
- **Regression:** AI-new-1 → `docs/regression/ai.md`: a real Nano Banana call with a skill reference image (the only check the live model honors references).
- **Serial chain:** T2→T4→T5→T6→T7→T8 is serial because each link edits `chatTurn.ts`, `types/index.ts`, or `aiApp.ts`, which the one before it also writes.
- **User guide:** 3 new pages: `ai/skills.md`, `ai/generate-images.md`, and
  `admin/ai-assistant-settings.md`. These also create `docs/user-guide/README.md`.
- **Design:** None. There is no Claude Design canvas. The UI follows the existing GPTChat,
  settings, and admin patterns.
- **Out of scope:** org/team skills, a skill picker in the composer, per-user opt-out of
  global skills, a skill marketplace, versioning skills (see Expansions).
- **Open risks:**
  - Every chat on a tool model now carries the skill catalog in the system prompt. It is
    capped at 50 skills, and descriptions are capped at 1024 characters.
  - Generated images cost money on each call. Each tool call is limited to 1 image, and
    each turn to 4 `generate_image` calls.
  - PHI. Prompts and reference images go to Google. HIPAA apps must use the Vertex path
    under Google's BAA, not the Gemini Developer API key. T12 documents this.
- **Elephant:** global skills and the default prompt reach every user's chat, so whatever
  an admin types there is injected into every conversation, all at once. Who changed a
  skill (T3) or the default prompt (T8) is audited when `AuditApp` is registered, but neither the skills nor the
  default prompt has version history or rollback.

## Contracts

### `GptRouteOptions` / `AiAppOptions` additions

| Option | Type | Default | Behavior |
| --- | --- | --- | --- |
| `defaultSystemPrompt` | `string \| (({req}) => string \| undefined \| Promise<string \| undefined>)` | unset | Trimmed and put first in the system prompt. Empty or whitespace adds nothing. A function that throws logs `logger.warn` and the turn continues without it. |
| `skills` | `boolean` | `false` | Mounts `/gpt/skills` and adds the catalog plus `load_skill` to chat turns. |
| `imageGeneration` | `{model: ({req, modelId}) => LanguageModel \| undefined; modelId: string; stylePrompt?: string \| (({req}) => string \| undefined \| Promise<string \| undefined>); maxCallsPerTurn?: number}` | unset | Adds a built-in `generate_image` tool to tool-capable turns. `maxCallsPerTurn` defaults to 4. |

The system prompt order becomes:
1. default
2. Langfuse prompt
3. project context and memories
4. request `systemPrompt`
5. `## Skills` catalog
6. any `## Active skill: <name>` sections
7. the asks/blocks/compact sections, as today

An admin `promptName` override still replaces layers 1–6, as it does today.

### `aiConfigurationSchema`

An exported Mongoose subschema (`_id: false`):
- `systemPrompt`: String, default `""`, described as "Default system prompt for every GPT
  chat".
- `imageStylePrompt`: String, default `""`, described as "Style guidance added to every
  generated image prompt".

Exported helpers: `configurationPromptGetter(model, "ai.systemPrompt")` returns a
`defaultSystemPrompt`-compatible function that reads `model.getConfig(path)`.

### Model: `GptSkill` (collection `gptskills`, new, no migration)

| Field | Type | Rules |
| --- | --- | --- |
| `name` | String, required | `^[a-z0-9-]{1,64}$`. Unique per (`scope`, `userId`), and a user skill may not use a global skill's name. |
| `description` | String, required | 1–1024 chars |
| `instructions` | String, required | Markdown, ≤ 50,000 chars |
| `files` | `[{filename, mimeType, size, gcsKey}]` | ≤ 20 files, ≤ 10 MB total. Images (jpeg/png/gif/webp), pdf, txt, csv, json, md. |
| `scope` | `"user" \| "global"` | Required. A `pre("validate")` hook sets `global` when neither `scope` nor `userId` is given (the admin create path). `/gpt/skills` `preCreate` sets `user` + `userId` unless an admin asks for `global`. |
| `userId` | ObjectId ref User | Required when `scope: "user"`. Unset when global. |
| (hooks) | | Name rules (409s) run in a schema `pre("validate")` hook, so both `/gpt/skills` and the admin routes enforce them. When `deleted` turns true, a hook removes the skill's files from storage. The hook reads the service from a module-level `setSkillFileStorage(service)`, which `addSkillRoutes`/`AiApp` call at registration, because the model has no route options. T3 confirms whether modelRouter's soft delete goes through `save` or `updateOne`, and registers the hook on whichever it is (cases cover both the `/gpt/skills` and admin delete paths). |
| `enabled` | Boolean | Default `true`. A disabled skill is left out of the catalog and `load_skill`. |
| `created`, `updated`, `deleted` | plugins | `createdUpdatedPlugin`, `isDeletedPlugin` |

### Routes (`/gpt/skills`, modelRouter + actions)

| Route | Who | Result |
| --- | --- | --- |
| `GET /gpt/skills` | authenticated | The caller's user skills plus all global skills. Fields: `_id, name, description, scope, enabled, files[{filename, mimeType, size}], created, updated`. Never `instructions`. |
| `GET /gpt/skills/:id` | owner, or anyone for global | Adds `instructions`. Another user's skill returns 403. |
| `POST /gpt/skills` | authenticated | `{name, description, instructions, scope?}`. `scope: "global"` without admin returns 403 `{title: "Only admins can create global skills"}`. |
| `PATCH /gpt/skills/:id` | owner, or admin for global | `name, description, instructions, enabled` |
| `DELETE /gpt/skills/:id` | owner, or admin for global | Soft delete. Files are removed from storage. |
| `POST /gpt/skills/upload` | authenticated | multipart `file` (`.md` or `.zip`, ≤ 10 MB) and optional `scope`. Returns 201 with the skill (list shape plus `instructions`). Error statuses are listed under T4. |

### Chat additions

- **`load_skill`**
  - Input `{name: string}`.
  - Result `{name, description, instructions, files: [{ref: "skill:<name>/<filename>", filename, mimeType}]}`, or `{error: "Unknown skill: <name>"}`.
- **`/name` at the very start of `prompt`.** It may repeat (`/brand /poster make…`, up to
  3). Each name is resolved at the start of the turn. An unknown name returns 400
  `{title: "Unknown skill: <name>"}` before streaming. The prompt text is stored unchanged.
- **`generate_image`**
  - Input `{prompt: string (1–4000), references?: string[] (≤ 4)}`. Each reference is a
    `skill:<name>/<filename>` ref or `attachment:<gcsKey>` for an image this user uploaded
    (a `FileAttachment` owned by the caller). The server reads both with
    `fileStorageService.download`. It never fetches a raw `http(s):` URL, which closes off
    SSRF through owner-editable history. Any other string is `Unknown reference`.
  - Result `{images: [{id, mimeType}]}`, or `{error}`. The errors are:
    - `"Unknown reference: <ref>"`
    - `"The image model returned no image"`
    - `"Image limit reached for this turn"`
  - Side effects: one SSE `{image: {mimeType, url}}` per image, and the assistant prompt
    stores `content: [{type: "image", url, mimeType, gcsKey?}]`.
  - When storage is configured, the image is stored under `generated/<userId>/…` with a
    `FileAttachment` owned by the chat user, and `url` is a signed URL that is re-signed
    when the history loads. Otherwise `url` is a `data:` URL.
- **Skill file storage.** `FileStorageService.upload` gains an optional `keyPrefix`
  (default `uploads`). The key becomes `<keyPrefix>/<userId>/<ts>-<name>`. Skill files use
  `keyPrefix: "skills/<skillId>"` and the uploader's `userId`; admins upload global ones.
  Skill files are never signed for a client. `generate_image` reads them server-side with
  `download(gcsKey)` after it checks the caller can see the skill (own or global).
- **Name collisions.** A user can't create a skill with a global skill's name (409). If an
  admin later creates a global skill whose name matches a user skill, the global one wins
  in the catalog, `/name`, and `load_skill`. The user's skill stays on their Skills screen
  marked "Hidden by a skill for everyone".

## E2E tests

| ID | Spec or flow | Layer | Proves | Written in |
| --- | --- | --- | --- | --- |
| E1 | `example-frontend/e2e/gpt-skills.spec.ts` | browser | A user creates a skill, uploads a `SKILL.md`, sees both listed with a global skill, deletes one; a non-admin sees no "Install for everyone" switch | T9 |
| E2 | `example-frontend/e2e/ai-image-generation.spec.ts` | browser | A `load_skill` + `generate_image` turn (mocked SSE) shows the "Used skill" row and the generated image in the chat, and the image is still there after reload (seeded history) | T10 |
| E3 | `example-frontend/e2e/admin-ai-configuration.spec.ts` | browser | An admin saves a default system prompt and image style prompt on Configuration, reloads, and sees them; an admin creates a global skill in the admin panel and a regular user sees it on the Skills screen | T11 |

Showing that the default prompt and skills reach the model is an `http` concern. It is
covered by the bun route tests in T2, T5, and T6 (a real Express app with a scripted
model), not by e2e, because the e2e suite mocks `/gpt/prompt`.

## Regression cases

Destination: AI → docs/regression/ai.md

| ID | Case | Steps | Expected | Platforms | Automated by | Added |
| --- | --- | --- | --- | --- | --- | --- |
| AI-new-1 | A global style skill with a reference image steers a real Nano Banana image | Start example-backend with a Vertex project that allows `gemini-3-pro-image`. As admin, upload `e2e/fixtures/team-poster.zip` (SKILL.md + a flat pastel reference PNG) with **Install for everyone** on. Sign in as test@example.com, open **AI**, and send "/team-poster a poster for a bake sale". | The chat shows "Used skill team-poster", then one generated image whose palette and style match the reference PNG. Reloading the page still shows the image. | web | manual (the mocked flow is E2) | gpt-skills-and-default-prompt |

Every automated test uses scripted models, so this is the only check that the real model
accepts reference images.

## User guide

| ID | Page | Change | Audience | Written in |
| --- | --- | --- | --- | --- |
| G1 | `docs/user-guide/ai/skills.md` | new (creates `docs/user-guide/README.md`) | user | T9 |
| G2 | `docs/user-guide/ai/generate-images.md` | new | user | T10 |
| G3 | `docs/user-guide/admin/ai-assistant-settings.md` | new | admin | T11 |

## Design

None. There is no Claude Design canvas. The Skills screen uses existing `@terreno/ui`
form and list components (as in `app/settings/notifications.tsx`). Chat images use the
existing GPTChat image rendering. Admin uses the generic Configuration and model screens.

## Tasks

- [x] **T1** — Write the e2e guide at docs/testing/e2e.md
  - Depends on: none
  - Files: docs/testing/e2e.md
  - Criteria:
    - The guide states the `browser` layer: specs live in `example-frontend/e2e/*.spec.ts`
      and use `getByTestId` first, `loginAs`/`loginAsAdmin`, and `mockGpt.ts` helpers for
      `/gpt/prompt`.
    - It says waits use `waitFor({state: "visible"})` and never `waitForTimeout`.
    - It gives the run command `cd example-frontend && bunx playwright test e2e/<spec>.spec.ts`
      and the replica-set Mongo prerequisite, linking `docs/how-to/run-tests-locally.md`
      rather than copying it.
    - It states the `http` layer as bun route tests through `supertest` on a `TerrenoApp`.
  - Seam: documentation
  - Interface: n/a
  - Cases: none (untestable: prose; Roast checks every path and command against `playwright.config.ts` and `e2e/helpers/`)
  - Blast radius: none
  - Test skills: none
  - Docs: this file

- [x] **T2** — Prepend an app-wide default system prompt to chat turns
  - Depends on: none
  - Files: ai/src/types/index.ts, ai/src/aiApp.ts, ai/src/service/chatTurn.ts, ai/src/configuration.ts, ai/src/index.ts, ai/src/routes/defaultSystemPrompt.test.ts
  - Criteria:
    - `defaultSystemPrompt` (string or function) is the first text in `system` for
      `/gpt/prompt` and the buffered `turn`.
    - `AiApp` passes it through.
    - `aiConfigurationSchema` and `configurationPromptGetter` are exported.
  - Seam: `POST /gpt/prompt` (HTTP route) via `buildApp` + `createScriptedModel` from `ai/src/tests/chatHarness.ts`
  - Interface: `addGptRoutes(router, {defaultSystemPrompt})`. `systemPromptOf(modelCall(model, 0))` returns the system string.
  - Cases:
    - `defaultSystemPrompt: "Be terse."`, body `{prompt: "Hi"}` → system starts with `"Be terse."`
    - Function returning `"From config"` → system starts with `"From config"`. The function receives `{req}` with `req.user` set.
    - With project `systemContext: "Project X"` and body `systemPrompt: "Req"` → order is `From config`, `Project X`, `Req`
    - `"   "` or a function returning `undefined` → system equals today's output (snapshot against no option)
    - Function throws → turn completes 200 with a `done` event, and the default is left out
    - Admin body `promptName` with a local prompt `body: "Override"` → system starts with `"Override"` and does not contain the default
    - Image model id (`gemini-3-pro-image`) with `defaultSystemPrompt: "Be terse."` → system starts with `"Be terse."` (image models already receive `system`; now it includes the default)
    - `configurationPromptGetter(AppConfig, "ai.systemPrompt")` on a test config model with `ai: aiConfigurationSchema` → returns the saved value, or `undefined` for `""`
  - Blast radius: buffered `turn` action (`gptHistories.ts`) shares `runChatTurn`, so add one `turn` case in the same file
  - Test skills: terreno-backend-tests, backend-test-env, ai-prompt-governance
  - Docs: T12

- [x] **T3** — Add the GptSkill model and /gpt/skills CRUD with user and global scopes
  - Depends on: none
  - Files: ai/src/models/gptSkill.ts, ai/src/routes/skills.ts, ai/src/routes/skills.test.ts, ai/src/types/skills.ts
  - Criteria:
    - The model, hooks, and routes match `## Contracts`.
    - `addSkillRoutes(router, {fileStorageService?})` is exported from `routes/skills.ts`.
    - The router sets `audit: true`.
  - Seam: `/gpt/skills` HTTP routes
  - Interface: see Routes table. List and read response fields are exactly as listed there.
  - Cases:
    - User A creates `{name: "brand-voice", description: "d", instructions: "i"}` → 201, `scope: "user"`, `userId` = A
    - A lists → own skill plus a seeded global `house-style`, with no `instructions` field. User B lists → only `house-style`.
    - B reads A's skill → 403. B patches it → 403. A reads it → includes `instructions`.
    - Non-admin `POST` with `scope: "global"` → 403 `{title: "Only admins can create global skills"}`. Admin → 201, `userId` unset.
    - Non-admin patch or delete of a global → 403. Admin → 200 / 204.
    - Name `"Brand Voice"` → 400. A 65-char name → 400. A description of 1025 chars → 400.
    - A creates `brand-voice` twice → 409 `{title: "Skill brand-voice already exists"}`. A creates `house-style` (a global name) → 409 `{title: "A global skill named house-style already exists"}`.
    - No token → 401
    - Delete of a skill with files via `/gpt/skills` → `fileStorageService.delete` called for each `gcsKey`. The list no longer shows it.
    - Delete of a global skill with files via the admin route → the same `delete` calls (needs T7 for the route; in T3 call the model's soft-delete path directly)
    - A skill created directly with `GptSkill.create({name, description, instructions})` (no `scope`, no `userId`) → saved `scope: "global"`
    - Name rules hold outside the routes: `GptSkill.create` of a user skill named like a global → rejects with an `APIError` status 409
    - With `AuditApp` registered, A creating a skill → one `AuditEvent` row for `GptSkill` create
  - Blast radius: T5 catalog reads enabled, non-deleted skills. Covered there.
  - Test skills: terreno-backend-tests, mongoose-schema-safety, model-router-actions
  - Docs: T12

- [x] **T4** — Upload SKILL.md and .zip skill packages
  - Depends on: T2, T3
  - Why ordered: T2: shares `ai/src/types/index.ts`
  - Files: ai/src/service/skillPackage.ts, ai/src/service/skillPackage.test.ts, ai/src/routes/skills.ts, ai/src/routes/skillsUpload.test.ts, ai/src/service/fileStorage.ts, ai/src/service/fileStorage.test.ts, ai/src/types/index.ts, ai/package.json, package.json
  - Criteria:
    - `POST /gpt/skills/upload` parses frontmatter (`yaml`) and zip (`fflate`, added to the root `catalog` and referenced from `ai/package.json`).
    - `FileStorageService.upload` accepts an optional `keyPrefix` (default `uploads`, so existing keys are unchanged).
    - Upload stores files with `keyPrefix: "skills/<skillId>"` and the uploader's `userId`.
    - It creates the skill atomically: if any upload fails, nothing is saved and uploaded keys are deleted.
  - Seam: `parseSkillPackage({buffer, filename})` (exported function) and the HTTP route
  - Interface: `parseSkillPackage` returns `{name, description, instructions, files: [{filename, mimeType, data: Uint8Array}]}` or throws `APIError` 400.
  - Cases:
    - `.md` with `---\nname: poster-style\ndescription: Poster look\n---\n# Steps` → name `poster-style`, instructions `# Steps`, 0 files
    - `.zip` with `poster-style/SKILL.md` + `poster-style/ref.png` → 1 file, `image/png`
    - The same zip with `SKILL.md` at the root → same result
    - Missing `name` → 400 `{title: "SKILL.md frontmatter needs name and description"}`
    - Zip without `SKILL.md` → 400 `{title: "No SKILL.md found in the package"}`
    - 21 files → 400 `{title: "A skill can hold at most 20 files"}`
    - Files totaling 10 MB + 1 byte → 400. An upload over 10 MB → 413.
    - An `.exe` inside the zip → 400 `{title: "Unsupported file type: x.exe"}`
    - A path-traversal entry `../evil.png` → 400 `{title: "Invalid file path: ../evil.png"}`
    - A zip with files and no `fileStorageService` → 400 `{title: "File storage is not configured"}`. A `.md` upload with no storage → 201.
    - Second upload failing in storage → 500, no skill saved, first key deleted
    - Non-admin `scope=global` → 403
    - `upload({buffer, filename: "a b.png", mimeType, userId})` with no `keyPrefix` → key matches `^uploads/<userId>/\d+-a_b\.png$` (unchanged). With `keyPrefix: "skills/abc"` → key matches `^skills/abc/<userId>/\d+-a_b\.png$`.
  - Blast radius:
    - `POST /files/upload` and chat `data:` attachments call `upload` without a prefix. Existing `gptFiles.test.ts` stays green; add one assertion on the `uploads/` key.
    - T6 reference resolution reads these keys. Covered in T6.
  - Test skills: terreno-backend-tests
  - Docs: T12

- [x] **T5** — Offer skills in chat through a catalog, load_skill, and /name
  - Depends on: T4
  - Why ordered: reads T3 skills; shares `ai/src/types/index.ts` with T2 and T4
  - Files: ai/src/service/skills.ts, ai/src/service/chatTurn.ts, ai/src/types/index.ts, ai/src/routes/gptSkills.test.ts
  - Criteria:
    - With `skills: true`, a tool-capable turn's system prompt contains a `## Skills`
      section listing at most 50 enabled skills. Globals come first by name, then the
      caller's skills by `updated` descending.
    - The tools include `load_skill`.
    - Leading `/name` tokens inject `## Active skill: <name>` sections.
  - Seam: `POST /gpt/prompt` with a scripted model
  - Interface: see Chat additions
  - Cases:
    - Global `house-style` + A's `brand-voice` → A's system contains `- house-style: …` before `- brand-voice: …`. B's system does not contain `brand-voice`.
    - A disabled or deleted skill → absent
    - Zero visible skills → no `## Skills` heading, and the tools object has no `load_skill` key
    - 3 globals + 50 of A's skills → the catalog lists exactly 50 lines: the 3 globals, then A's 47 most recently updated. A's 3 oldest are absent from the catalog but still loadable with `load_skill` and `/name`.
    - Admin creates global `brand-voice` while A has a user `brand-voice` → A's catalog lists one `brand-voice` (global description), and `load_skill`/`/brand-voice` return the global instructions
    - Scripted `toolCallStep("load_skill", {name: "brand-voice"})` → the tool result has `instructions` and `files[].ref` of the form `skill:brand-voice/ref.png`
    - B calling `load_skill` on `brand-voice` → `{error: "Unknown skill: brand-voice"}`
    - Prompt `/brand-voice write a tagline` → system contains `## Active skill: brand-voice` and its instructions. The stored user prompt text is unchanged.
    - Prompt `/nope hi` → 400 `{title: "Unknown skill: nope"}` before any SSE
    - 4 leading `/x` tokens → only the first 3 are resolved
    - `skills` unset → system and tools are identical to today
    - Image model → no catalog and no tool
  - Blast radius: buffered `turn` shares `runChatTurn`, so add one `turn` case. A host tool named `load_skill` → the built-in wins and a `logger.warn` is logged (one case).
  - Test skills: terreno-backend-tests, ai-prompt-governance
  - Docs: T12

- [x] **T6** — Generate images with a built-in generate_image tool
  - Depends on: T4, T5
  - Files: ai/src/service/generateImageTool.ts, ai/src/service/chatTurn.ts, ai/src/types/index.ts, ai/src/routes/generateImage.test.ts, ai/src/tests/chatHarness.ts, ai/src/routes/routes.test.ts
  - Criteria:
    - With `imageGeneration` set, tool-capable turns get `generate_image`.
    - It calls `generateText` on `imageGeneration.model(modelId)` with one user message:
      the style prompt, a blank line, the prompt, then each reference as an image part.
    - It emits SSE `image` events and saves image parts as in Chat additions.
  - Seam: `POST /gpt/prompt` with a scripted chat model plus `createImageOnlyModel` (from `routes/routes.test.ts`, moved to `tests/chatHarness.ts`)
  - Interface: see Chat additions
  - Cases:
    - `stylePrompt: "Flat pastel"`, tool args `{prompt: "A fox"}` → the image model's call has the text `"Flat pastel\n\nA fox"`. SSE has one `image` event. The assistant prompt `content[0].type === "image"`. The tool result has `images[0].id` and no `data:` string.
    - With storage → `fileStorageService.upload` is called with a key under `generated/<userId>/`. Stored `gcsKey` is set. `GET /gpt/histories/:id` returns a re-signed `url`.
    - Without storage → `url` starts with `data:image/png;base64,`
    - `references: ["skill:house-style/ref.png"]` → the image model gets an image part with those bytes (from `fileStorageService.download`)
    - A reference to another user's private skill file → `{error: "Unknown reference: skill:brand-voice/ref.png"}`
    - The image model returns no files → `{error: "The image model returned no image"}`, and the turn still completes
    - A 5th call in one turn with default `maxCallsPerTurn` → `{error: "Image limit reached for this turn"}`
    - `imageGeneration.model({req, modelId})` returns `undefined` → tool absent. The call args include `req` and `modelId: "gemini-3-pro-image"`.
    - Global skill file reference by user B (not the uploader) → bytes resolved through `download`, image generated
    - `references: ["https://169.254.169.254/latest/meta-data"]` → `{error: "Unknown reference: https://169.254.169.254/latest/meta-data"}`, and no network fetch (no `fetch` call recorded)
    - `references: ["attachment:<key owned by B>"]` as user A → `Unknown reference`. A's own key → bytes downloaded.
    - `maxCallsPerTurn: 1` → the 2nd call returns `Image limit reached for this turn`
    - `stylePrompt` function throws → `logger.warn`, and the image model text is exactly `"A fox"`
    - `stylePrompt: ""` → the image model text is exactly `"A fox"` (no leading blank line)
    - A host tool named `generate_image` → the built-in wins and a warning is logged
  - Blast radius:
    - History replay (`aiService.ts` `buildMessages`) sends the assistant image row as `[Generated image]`. Add one case.
    - The history GET re-sign path. Covered above.
  - Test skills: terreno-backend-tests, ai-prompt-governance
  - Docs: T12

- [x] **T7** — Wire skills and image generation into AiApp, exports, and the admin panel
  - Depends on: T6
  - Files: ai/src/aiApp.ts, ai/src/aiApp.test.ts, ai/src/aiAdminApp.ts, ai/src/index.ts
  - Criteria:
    - `AiApp({skills: true, imageGeneration, defaultSystemPrompt})` mounts `/gpt/skills`
      and passes the options to `addGptRoutes`.
    - `AIAdminApp` contributes `GptSkill` to the admin panel:
      - group `AI`, display name "Skills"
      - list fields `name, description, scope, enabled, updated`
      - `adminFilter: () => ({scope: "global"})`, so admins manage only global skills and
        never see users' personal skill text in the panel (`adminFilter` is a function;
        `api/src/adminTypes.ts:136`)
      - `hiddenFields: ["scope", "userId", "files"]`, so the admin form never shows them, an
        admin create leaves them out, and the T3 schema hook saves it as `global`
    - `index.ts` exports:
      - `GptSkill`, `addSkillRoutes`, `parseSkillPackage`
      - `aiConfigurationSchema`, `configurationPromptGetter`
      - `createGenerateImageTool` and its types
  - Seam: `AiApp` plugin registered on a `TerrenoApp`, plus `AIAdminApp.adminContribution()`
  - Interface: as above
  - Cases:
    - `skills: true` → `GET /gpt/skills` 200. Unset → 404.
    - `adminContribution().models` includes `routePath` `/gpt/skills` with those list fields and `hiddenFields` containing `scope`
    - Admin `POST` through the admin route without `scope` → saved `scope: "global"`
    - Admin list route with one user skill and one global → returns only the global
    - Admin create with a global name already taken → 409
    - A non-admin on the admin route → 403
  - Blast radius: none
  - Test skills: terreno-backend-tests, building-admin-interfaces
  - Docs: T12

- [x] **T8** — Wire the default prompt, skills, and Nano Banana into example-backend
  - Depends on: T7
  - Files: example-backend/src/models/appConfiguration.ts, example-backend/src/server.ts, example-backend/src/api/ai.ts, example-backend/src/api/ai.test.ts, example-frontend/store/openApiSdk.ts
  - Criteria:
    - `AppConfiguration` gains `ai: aiConfigurationSchema`.
    - `configure` gets `fieldOverrides` `{"ai.systemPrompt": {widget: "markdown"}, "ai.imageStylePrompt": {widget: "markdown"}}`.
    - The GPT routes use `defaultSystemPrompt: configurationPromptGetter(AppConfiguration, "ai.systemPrompt")` and `skills: true`.
    - `imageGeneration` is `{model: ({req, modelId}) => …, modelId: "gemini-3-pro-image", stylePrompt: configurationPromptGetter(..., "ai.imageStylePrompt")}`.
      The `model` function returns a LanguageModel (not an ImageModel):
      - the `x-ai-api-key` header key when present, so bring-your-own-key users keep image
        generation;
      - otherwise `vertexProvider.languageModel(modelId)`, only when
        `isModelAllowed(modelId)`;
      - otherwise `GEMINI_API_KEY`.
    - The old `createImageTool`/`generate_image` host tool (ImageModel + `fileData`) is removed.
    - `configure` gets a `postUpdate` hook that writes an `AuditEvent` (actor, changed dot
      paths) when `AuditApp` is registered, so default-prompt edits are audited like skill
      edits.
    - The SDK is regenerated with the `generate-sdk` skill.
  - Seam: example-backend `TerrenoApp` over HTTP
  - Interface: `PATCH /configuration` `{ai: {systemPrompt}}` (admin) → the next `/gpt/prompt` system starts with it
  - Cases:
    - Admin patches `ai.systemPrompt: "Answer as Terreno Bot"` → a scripted-model turn's system starts with it
    - `GET /configuration/meta` → `ai.systemPrompt.widget === "markdown"`
    - `GET /gpt/skills` as the seeded user → 200
    - With no Vertex project and no Gemini key → `generate_image` absent from tools
    - Same, but the request sends `x-ai-api-key: test-key` → `generate_image` present
    - Vertex configured with `GOOGLE_VERTEX_ALLOWED_MODELS=gemini-3.8-flash` (image model not allowed), no key → `generate_image` absent
    - With `AuditApp`, admin `PATCH /configuration` `{ai: {systemPrompt: "x"}}` → one `AuditEvent` whose changed paths include `ai.systemPrompt`
  - Blast radius:
    - Existing example-backend AI tests that referenced `createImageTool` are updated.
    - `/ai/models` is unchanged (one assertion).
  - Test skills: terreno-backend-tests, generate-sdk
  - Docs: T12

- [x] **T9** — Let users create, upload, and delete skills on a Skills screen
  - Depends on: T1, T8
  - Files: example-frontend/app/settings/skills.tsx, example-frontend/app/settings/skills.test.tsx, example-frontend/app/settings/_layout.tsx, example-frontend/app/(tabs)/ai.tsx, example-frontend/e2e/gpt-skills.spec.ts, example-frontend/e2e/fixtures/poster-style.md, example-frontend/e2e/fixtures/team-poster.zip, docs/user-guide/README.md, docs/user-guide/ai/skills.md
  - Criteria:
    - **Settings → Skills** (also reachable from a "Skills" header button on the AI tab)
      lists skills with a "For everyone" badge on global ones.
    - **New skill** opens a form (Name, Description, Instructions). Saving lists the skill.
    - **Upload skill** picks a `.md`/`.zip` and lists the result.
    - Errors show the API `title` inline.
    - Delete asks for confirmation.
    - Admins see an **Install for everyone** switch on the form and on upload. Others do not.
  - Seam: rendered screen (browser e2e) plus a component test for the error state
  - Interface: testIDs `skills-screen`, `skills-list`, `skills-item-{name}`, `skills-global-badge-{name}`, `skills-new-button`, `skills-upload-button`, `skills-form-name-input`, `skills-form-description-input`, `skills-form-instructions-input`, `skills-form-global-switch`, `skills-form-save-button`, `skills-form-error`, `skills-delete-button-{name}`, `skills-empty`
  - Cases:
    - Empty state shows `skills-empty`
    - Create `brand-voice` → `skills-item-brand-voice` visible
    - Upload fixture `e2e/fixtures/poster-style.md` → `skills-item-poster-style` visible
    - Admin uploads fixture `e2e/fixtures/team-poster.zip` (SKILL.md + 1 PNG) with `skills-form-global-switch` on → then, signed in as test@example.com, `skills-global-badge-team-poster` is visible
    - Upload sends multipart `file` the same way `ai.tsx` `uploadFormData` does for `/files/upload`
    - Name `Bad Name` → `skills-form-error` shows the 400 title
    - Seeded global `house-style` shows `skills-global-badge-house-style`, and the user has no delete button on it
    - Delete `brand-voice` → confirm → item gone
    - A non-admin has no `skills-form-global-switch`
    - A user skill hidden by a same-name global shows `skills-hidden-note-{name}` reading "Hidden by a skill for everyone" (component test with mocked list data)
  - Blast radius: none beyond the API (covered in T3/T4)
  - Test skills: terreno-frontend-tests, verify-ui-changes, accessibility-testing
  - Docs: G1

- [x] **T13** — Let GPTChat label tool rows and show their status
  - Depends on: none
  - Files: ui/src/GPTChat.tsx, ui/src/GPTChat.test.tsx, ui/src/Common.ts, demo/stories/GPTChat.stories.tsx, docs/reference/ui.md
  - Criteria:
    - `GPTChat` accepts `toolLabel?: (toolCall: {toolName, args, result?}) => string | undefined`.
    - When it returns a string, the tool row shows that string instead of "Tool: {toolName}",
      and so does the row's `accessibilityLabel`.
    - A tool row whose `result` has an `error` string shows that error text.
    - Each tool row gets a new testID, `gpt-tool-call-{toolName}`. There is none today.
    - Each image content part in a message gets testID `gpt-message-image-{messageIndex}-{partIndex}`.
      Today only the shared `gpt-image-actions` exists.
  - Seam: rendered component (`renderWithTheme`)
  - Interface: as above
  - Cases:
    - No `toolLabel` → the row reads "Tool: load_skill" (unchanged)
    - `toolLabel` returns `"Used skill house-style"` → that text is visible and is the accessibility label
    - `toolLabel` returns `undefined` → falls back to "Tool: …"
    - `result: {error: "Image limit reached for this turn"}` → the error text is visible
    - An assistant message (index 1) with 2 image parts → `gpt-message-image-1-0` and `gpt-message-image-1-1` exist
  - Blast radius: existing `GPTChat.test.tsx` tool-call cases stay green
  - Test skills: terreno-frontend-tests, accessibility-testing
  - Docs: `docs/reference/ui.md` GPTChat props (in this task)

- [x] **T10** — Show skill loads and generated images in the chat
  - Depends on: T1, T8, T9, T13
  - Files: example-frontend/app/(tabs)/ai.tsx, example-frontend/e2e/helpers/mockGpt.ts, example-frontend/e2e/ai-image-generation.spec.ts, docs/user-guide/README.md, docs/user-guide/ai/generate-images.md
  - Criteria:
    - A `load_skill` tool-call row reads "Used skill <name>".
    - A `generate_image` row reads "Generating image…" until its result arrives.
    - Then the image from the SSE `image` event renders in the assistant message, and it
      persists after reload from saved history.
  - Seam: browser e2e with `mockGptStream` extended to emit tool-call, tool-result, and `image` events
  - Interface: `ai.tsx` passes `toolLabel` (T13): `load_skill` → "Used skill {args.name}", and `generate_image` → "Generating image…" until a result arrives, then "Generated image". testIDs: `gpt-tool-call-load_skill` and `gpt-tool-call-generate_image` (from T13), plus `gpt-message-image-{messageIndex}-{partIndex}` (from T13).
  - Cases:
    - Mocked turn: `load_skill(house-style)` → `generate_image` → one `image` event (a 1×1 PNG data URL) → `done`. "Used skill house-style" is visible, the image is visible, and "Generating image…" is gone.
    - Seeded history with an assistant image part → image visible after reload
    - `generate_image` result `{error: "Image limit reached for this turn"}` → the error text is visible in the tool row
  - Blast radius: existing `ai-chat.spec.ts` image-attachment tests still pass
  - Test skills: terreno-frontend-tests, verify-ui-changes
  - Docs: G2

- [x] **T11** — Prove admin default prompt and global skills end to end
  - Depends on: T1, T8, T10
  - Why ordered: needs the T9 Skills screen; shares `docs/user-guide/README.md` with T9 and T10
  - Files: example-frontend/e2e/admin-ai-configuration.spec.ts, docs/user-guide/README.md, docs/user-guide/admin/ai-assistant-settings.md
  - Criteria:
    - On Admin → Configuration → AI, an admin edits **System prompt** and **Image style
      prompt** (markdown widget) and saves, and the values survive reload.
    - On Admin → AI → Skills, an admin creates a skill, and the seeded regular user sees
      it with the "For everyone" badge.
  - Seam: browser e2e (`loginAsAdmin`, then `loginAs`)
  - Interface: existing admin Configuration and model-form testIDs. Add missing ones per CLAUDE.md naming.
  - Cases:
    - Save "Answer as Terreno Bot" → reload → the field shows it
    - Clear it → saves `""`
    - Admin creates `team-poster` → user's Skills screen shows `skills-global-badge-team-poster`
  - Blast radius: existing `admin.spec.ts` configuration tests still pass
  - Test skills: terreno-frontend-tests, building-admin-interfaces
  - Docs: G3

- [x] **T12** — Document skills, the default prompt, and image generation
  - Depends on: T7
  - Files: docs/reference/ai.md, docs/explanation/ai-skills.md, docs/how-to/configure-gpt-skills-and-images.md, changelog/unreleased/gpt-skills-and-default-prompt.md
  - Criteria:
    - The reference covers the new options, model, routes, tools, and system-prompt order.
    - The explanation covers why the skill format, scopes, and progressive loading look
      the way they do, and the image-tool flow.
    - The how-to walks an app through mounting `aiConfigurationSchema`, enabling skills,
      and configuring Nano Banana.
    - It has a HIPAA section: PHI apps use the Vertex provider under Google's BAA, must
      not honor `x-ai-api-key` in `imageGeneration.model` (the Gemini Developer API has no
      BAA), and
      skill files and generated images are stored the same way as chat attachments.
    - There is a changelog fragment.
  - Seam: documentation
  - Interface: n/a
  - Cases: none (untestable: prose; `check:changelog` and `docs-audit` run)
  - Blast radius: none
  - Test skills: update-docs

## Assumptions

- The skill format follows Anthropic's `SKILL.md`: YAML frontmatter `name` and
  `description`, a markdown body, and sibling resource files. Scripts inside a skill are
  stored as plain files and never executed.
- "Nano Banana" means Google's Gemini image-output models (`gemini-3-pro-image`, already
  in example-backend). We call it through `generateText` + `result.files` instead of
  `generateImage`, because chatTurn already handles `result.files` from `streamText`, and
  message parts can carry reference images. Live-model support for reference-image input
  is unverified until T8 runs against Vertex.
- The default system prompt is plain text. It has no template variables.
- `promptName` admin overrides keep replacing the whole assembled prompt, as today.
- Skill files and generated images use the existing GCS `FileStorageService`. Nothing
  adds a new storage backend.

## Open questions (recommendation assumed)

| ID | Question | Recommendation | Why | If answered differently | Tasks affected |
| --- | --- | --- | --- | --- | --- |
| Q1 | Where do admins edit the default system prompt? | A new `ai` section on the existing **Configuration** screen | `ConfigurationApp` already has a markdown widget, and its docs use `ai.systemPrompt` as the example | Versioned prompt store: wire `defaultSystemPrompt` to `ObsPrompt` `production` instead, and T8/T11 change | T2, T8, T11 |
| Q3 | What happens when a user skill and a global skill share a name? | A user can't create the duplicate (409). If an admin later makes a global with that name, the global wins, and the user's skill is marked hidden. | Keeps `/name` and `load_skill` unambiguous. Admins can't see users' skill names, so blocking them would be arbitrary. | The user skill wins for its owner instead (catalog dedupe flips) | T3, T5, T9 |
| Q4 | How are generated images limited? | 1 image per call, 4 calls per turn, configurable `maxCallsPerTurn` | Cost control; there is no per-user image budget today | Add a per-user daily quota tied to the AI cost limits | T6 |
| Q5 | Does `generate_image` replace example-backend's `x-ai-api-key` `generate_image`? | Yes. Remove the old one, and have the new `model` function honor the header key. | Two tools with one name would conflict, and bring-your-own-key users keep image generation. | Keep both under different names | T8 |

## Expansions (follow up later)

| ID | Idea | Why it came up | Rough size | Depends on |
| --- | --- | --- | --- | --- |
| X1 | Org-scoped skills managed by org admins | "so teams could all generate similar ones"; deferred in your answer | M | T3 |
| X2 | Skill picker / `/` autocomplete in the GPTChat composer | Discovering skills without leaving chat | S | T5 |
| X3 | Version history and rollback for the default prompt and global skills (auditing is in T3) | The Elephant: one edit changes every chat | M | T2, T3 |
| X4 | Per-user image generation quota and cost tracking | Image calls are paid | M | T6 |
| X5 | Image editing (iterate on a previous generated image as a reference) | A natural next step for Nano Banana | S | T6 |

## Decisions

| ID | Question asked | Answer | What it changes |
| --- | --- | --- | --- |
| D1 (durable) | What is a GPT skill? | Anthropic-style `SKILL.md` + files, uploaded or written in-app. The model loads it by description via `load_skill`, and the user can force it with `/name`. | `GptSkill` model, upload parser, catalog + `load_skill` (T3–T5) |
| D2 | Who shares skills? | Personal + global. Org scope goes to Expansions. | Two scopes only (T3, X1) |
| D3 (durable) | How does image generation use skills and default prompts? | A built-in `generate_image` library tool that the chat model calls, with skill reference images and an admin image style prompt | T6 replaces example-backend's tool (T8) |
| D4 | Q7: Should the admin default prompt come first or last in the system prompt? | First (recommended) | None; plan unchanged |
| D5 | Q2: Can a user turn off a global skill? | No: global skills are always installed (recommended) | None; plan unchanged |
| D6 | Q6: Are generated images deleted when their conversation is deleted? | Keep them, the same as chat attachments (recommended) | None; plan unchanged |

## Sign-off

Status: approved 2026-10-30
Cut: 2 rounds, 22 findings: 21 fixed, 1 moved to questions (Q7 prompt order), 0 rebutted. The round 2 "couldn't assess" note on multipart SDK upload was checked: `ai.tsx` already posts multipart through the generated `usePostFilesUploadMutation`.
