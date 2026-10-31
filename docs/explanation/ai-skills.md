# Skills, the default prompt, and image generation

`@terreno/ai` lets three parties shape a GPT chat: the operator (an app-wide default system
prompt and image style), admins (skills installed for everyone), and each user (their own
skills). Images come from a built-in `generate_image` tool that the chat model drives, so skills
can steer images too. Options, routes, and errors: [AI reference](../reference/ai.md#skills-in-chat).
Setup: [Configure GPT skills and image generation](../how-to/configure-gpt-skills-and-images.md).

## The system prompt is layered

Each layer has one owner, and the broadest comes first:

| # | Layer | Owner |
| --- | --- | --- |
| 1 | Default system prompt (`defaultSystemPrompt`) | App operator, edited on Admin → Configuration |
| 2 | Langfuse prompt | Prompt engineer |
| 3 | Project context and memories | The user's project |
| 4 | Request `systemPrompt` | The client screen |
| 5 | `## Skills` catalog | Visible skills |
| 6 | `## Active skill: <name>` sections | The user's `/name` tokens |
| 7 | Asks, blocks, and compact sections | Framework |

The default comes first so it reads as the house rules for every chat. Skills sit after the
request prompt because they are opt-in tools the model reaches for, not identity. The framework
sections come last because the client's protocol depends on them. An admin `promptName` override
still replaces layers 1–6: it exists to test a prompt in isolation.

The default lives in the app's `configurationPlugin` model (`aiConfigurationSchema`), not in a
versioned prompt store. Admins already edit settings on the Configuration screen, and a prompt
store would require observability to be on. The cost is that there is no version history or rollback.
Skill edits write audit events when `AuditApp` is registered. Default-prompt edits are audited
only when the app's configuration hooks record them.

## Why skills use the `SKILL.md` format

A skill is Anthropic's `SKILL.md` shape: YAML frontmatter `name` and `description`, a markdown
body, and sibling files. Teams can write a skill once for Claude, other agents, and a Terreno app.
A `.zip` of a skill folder uploads as is when its files are images, PDF, text, CSV, JSON, or
markdown. Scripts and other file types are refused at upload, which is how the server guarantees
it never runs anything a user uploads. A skill that ships a `scripts/` folder needs that folder
removed first.

## Progressive loading

Full instructions for every skill would bloat every turn. So a turn carries only a catalog:
one `name: description` line per skill, at most 50. The model calls `load_skill` when a request
matches, and gets the instructions and file refs only then. That is why `description` is short
(at most 1024 characters) and written as "when to use this".

A user who knows which skill they want types `/name` at the start of the prompt. The server
resolves it before the turn starts and puts the instructions in the system prompt, so the model
does not have to guess. An unknown name fails with 400 before anything is saved, so a typo never
becomes a stored message.

Only models that can call tools get skills. An image-output model picked directly in the chat
cannot call `load_skill`, so it gets neither the catalog nor the tool.

## Scopes

| Scope | Created by | Visible to | Edited by |
| --- | --- | --- | --- |
| `user` | Any signed-in user | The owner | The owner |
| `global` | Admins, with `POST /gpt/skills` `scope: "global"` or Admin → AI → Skills | Every user | Admins |

Global skills are installed for everyone, with no opt-in, so a team gets one shared voice or
style. There are no org or team scopes yet.

Names stay unambiguous: `/name` and `load_skill` must resolve to exactly one skill. A user cannot
create a skill with a global skill's name. If an admin later creates a global skill whose name a
user skill already has, the global one wins in the catalog, `/name`, and `load_skill`, and the
user's skill stays on their list, hidden. Admins cannot see users' skill names, so refusing the
admin would be arbitrary. The admin panel shows only global skills, so admins never read users'
personal instructions there.

These rules live on the model, not the routes, so `/gpt/skills` and the admin panel enforce the
same ones.

## The image tool flow

```
user prompt ─▶ chat model ─▶ load_skill("team-poster")        (instructions + skill:team-poster/ref.png)
                         └─▶ generate_image({prompt, references: ["skill:team-poster/ref.png"]})
                                 │ style prompt + "\n\n" + prompt + reference image bytes
                                 ▼
                           image-output model (Nano Banana) ─▶ result.files[0]
                                 │ stored under generated/<userId>/ (or a data: URL)
                                 ▼
                           SSE {image} + image part on the assistant reply
```

The chat model writes the image prompt, not the user. It can load a skill, follow its
instructions, and pass the skill's reference images, so a team using one global style skill gets
images in one style. Picking an image model directly still works, but that model gets no tools.

The model sees refs (`skill:<name>/<file>`, `attachment:<key>`) and ids, never base64. Bytes stay
on the server, which keeps tokens down and keeps files out of the transcript. The server resolves
a ref only to a skill the caller can see or an upload the caller owns, and never fetches a URL.
Stored history is owner-editable, so fetching URLs would let a user point the server at internal
addresses.

The image model is a `LanguageModel` called with `generateText`, not an AI SDK `ImageModel`. It
has to accept reference images as message parts, and chat already handles `result.files`.

Each call costs money, so a turn is capped at 4 calls by default (`maxCallsPerTurn`), and each
call makes one image.

## PHI and storage

Prompts, the style prompt, and reference images go to the image model's provider. Skill files and
generated images are stored like chat attachments: in the app's `FileStorageService` bucket, each
with a `FileAttachment` row. Generated images reach the client through 1-hour signed URLs. Skill
files are never signed for a client; only the server reads them. HIPAA apps must use the
Vertex provider under Google's BAA. The steps are in the how-to's
[HIPAA section](../how-to/configure-gpt-skills-and-images.md#hipaa-and-phi).
