# Stage: ai — GPT chat and AI tooling

You are continuing the todo app in the current directory (`backend/` and `frontend/`,
scaffolded by the previous stage and committed as the baseline). This stage needs no human input:
do not ask questions, pick the sensible default, and record the choice in a short comment.

Read first: skill `terreno:ai-prompt-governance`, `docs/how-to/ai-feature-development.md`, `docs/reference/ai.md`, `docs/how-to/debug-with-mcp.md`

## Do

1. Wire `AIService` with the Gemini model, `addGptRoutes` and `addGptHistoryRoutes` on the backend, reading `GOOGLE_GENERATIVE_AI_API_KEY` from env, and add a chat screen using `GPTChat`.
2. Add one AI tool that lists the signed-in user's todos.
3. Keep the AI tooling for coding agents wired: `.rulesync/` sources, generated `CLAUDE.md`/`AGENTS.md`, and a `.mcp.json` naming `terreno-local`. Run `bun run rules` after any edit to the sources and confirm `terreno info` runs in the app.

## Done when

The GPT routes and chat screen exist, `.mcp.json` exists, and both packages type-check.

Run `bun run compile`/type-check in `backend/` and `frontend/` and fix what you broke
before finishing. Never commit secrets; real values go in untracked `.env` files and
placeholders in `.env.example`.
