# Stage: theming — theme and polish

You are continuing the todo app in the current directory (`backend/` and `frontend/`,
scaffolded by the previous stage and committed as the baseline). This stage needs no human input:
do not ask questions, pick the sensible default, and record the choice in a short comment.

Read first: skill `terreno:terreno-ui`, `docs/explanation/responsive-design.md`

## Do

1. Replace the template's default palette in `frontend/constants/theme.ts` with a distinct, readable brand palette (primary, secondary, accent) that has accessible contrast in light and dark mode.
2. Polish login, the todo list and the admin screens: spacing from the Terreno scale, an empty state, loading states, and a layout that works at 1280x800 and 390x844 with no horizontal scroll.
3. Use `@terreno/ui` components only; add a `testID` to every screen root and every button and input.

## Done when

`frontend/constants/theme.ts` differs from the scaffold's, and the frontend type-checks.

Run `bun run compile`/type-check in `backend/` and `frontend/` and fix what you broke
before finishing. Never commit secrets; real values go in untracked `.env` files and
placeholders in `.env.example`.
