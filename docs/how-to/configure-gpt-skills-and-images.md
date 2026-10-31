# Configure GPT skills and image generation

Turn on three `AiApp` features: an admin-edited default system prompt, skills, and skill-driven
image generation with Nano Banana (`gemini-3-pro-image`). Why they work this way:
[Skills, the default prompt, and image generation](../explanation/ai-skills.md). Every option:
[AI reference](../reference/ai.md#default-system-prompt).

PHI app? Read [HIPAA and PHI](#hipaa-and-phi) before step 3.

## 1. Mount the AI settings on your configuration model

Add `aiConfigurationSchema` as the `ai` section of the model that uses `configurationPlugin`:

```typescript
import {aiConfigurationSchema} from "@terreno/ai";
import {type ConfigurationModel, configurationPlugin} from "@terreno/api";
import mongoose from "mongoose";

interface AppConfigDocument {
  ai: {imageStylePrompt: string; systemPrompt: string};
  // ...other sections
}

const appConfigSchema = new mongoose.Schema<AppConfigDocument>({
  ai: {description: "AI assistant settings", type: aiConfigurationSchema},
  // ...other sections
});
appConfigSchema.plugin(configurationPlugin);
export const AppConfiguration = mongoose.model<
  AppConfigDocument,
  ConfigurationModel<AppConfigDocument>
>("AppConfiguration", appConfigSchema);
```

Give both fields the markdown widget on the Configuration screen:

```typescript
new TerrenoApp({userModel: User}).configure(AppConfiguration, {
  fieldOverrides: {
    "ai.imageStylePrompt": {widget: "markdown"},
    "ai.systemPrompt": {widget: "markdown"},
  },
});
```

Admins now see **System Prompt** and **Image Style Prompt** in the **Ai** section of Admin →
Configuration (the section title comes from the `ai` key). To audit edits, add a `postUpdate` hook to `configure` that records the change.

## 2. Use the default prompt and turn on skills

```typescript
import {AiApp, configurationPromptGetter} from "@terreno/ai";

new AiApp({
  aiService,
  defaultSystemPrompt: configurationPromptGetter(AppConfiguration, "ai.systemPrompt"),
  fileStorageService, // needed for skill packages with files, and for stored images
  gcsBucket,
  skills: true,
}).register(app);
```

- The default prompt is read on every turn, so an admin edit applies to the next message.
- `skills: true` mounts `/gpt/skills` and adds the skill catalog, `load_skill`, and `/name` to chat
  turns on tool-capable models.
- Without `fileStorageService` and `gcsBucket`, `SKILL.md` uploads still work, but a `.zip` with
  files returns 400 `File storage is not configured`.

To let admins manage global skills in the admin panel, register `AIAdminApp` from
`@terreno/ai/admin`. It adds **AI → Skills**, which lists and creates global skills only.
If `AdminApp` gets an RBAC `accessControl`, declare `adminGptSkill: ADMIN_MODEL_ACCESS` in your
statements (as `example-backend/src/access.ts` does). Without it, RBAC hides Skills from every admin.

## 3. Configure Nano Banana

`imageGeneration.model` returns an image-output **language model** for each request, or
`undefined` to leave `generate_image` out of that turn:

```typescript
import {AiApp, configurationPromptGetter, createVertexProvider} from "@terreno/ai";

const vertex = createVertexProvider(); // reads GOOGLE_VERTEX_PROJECT
const IMAGE_MODEL_ID = "gemini-3-pro-image";

new AiApp({
  // ...step 2 options
  imageGeneration: {
    model: ({modelId}) =>
      vertex?.isModelAllowed(modelId) ? vertex.languageModel(modelId) : undefined,
    modelId: IMAGE_MODEL_ID,
    stylePrompt: configurationPromptGetter(AppConfiguration, "ai.imageStylePrompt"),
  },
}).register(app);
```

- Enable `gemini-3-pro-image` in the Vertex project. If you set an allow-list
  (`createVertexProvider({allowedModels})`), add the model id to it.
- `maxCallsPerTurn` (default 4) caps image calls per turn. Each call makes one image and costs money.
- With both `fileStorageService` and `gcsBucket`, images are stored under `generated/<userId>/` and survive reload.
  Without them, they are saved as `data:` URLs in the chat history.

A non-PHI app can also accept a user's own key, by reading `req.headers["x-ai-api-key"]` and
returning `createGoogleGenerativeAI({apiKey})(modelId)` (from `@ai-sdk/google`). Never do this in a PHI app (below).

## 4. Check it

1. As an admin, set **System prompt** to `Answer as Terreno Bot` and save.
2. Upload a skill: `curl -H "Authorization: Bearer $TOKEN" -F file=@SKILL.md http://localhost:4000/gpt/skills/upload` returns 201.
3. Send `/<skill-name> make a poster for a bake sale` in the chat. You see a `load_skill` or
   `generate_image` tool row, then the image.

`bun test` route tests use scripted models. Only a real call (step 3) proves the live model honors
reference images.

## HIPAA and PHI

Prompts, the style prompt, skill instructions, and reference images go to the image model's
provider. For an app that handles PHI:

- **Use the Vertex provider under Google's BAA.** Build `imageGeneration.model` (and the chat
  model) from `createVertexProvider` on a project covered by your BAA, as in step 3.
- **Do not honor `x-ai-api-key` in `imageGeneration.model`.** A user-supplied key calls the Gemini
  Developer API, which has no BAA. Ignore the header and return the Vertex model or `undefined`.
  Do the same in `createModelFn` and `createRequestTools`, or leave them unset.
- **Storage is the same as chat attachments.** Skill files and generated images go to the
  `FileStorageService` bucket, each with a `FileAttachment` row owned by the uploader or chat user.
  Generated images reach clients through 1-hour signed URLs; skill files are only read by the
  server. Keep that bucket under the same BAA, access controls, and retention as attachments.
- **Global skills and the default prompt reach every chat.** Keep PHI out of them. Register
  `AuditApp` so skill changes are audited, and audit configuration edits with a `postUpdate` hook.
