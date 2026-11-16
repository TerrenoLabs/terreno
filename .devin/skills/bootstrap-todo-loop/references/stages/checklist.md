# Stage: checklist — CHECKLIST.md for the owner

You are continuing the todo app in the current directory (`backend/` and `frontend/`,
scaffolded by the previous stage and committed as the baseline). This stage needs no human input:
do not ask questions, pick the sensible default, and record the choice in a short comment.

Read first: `docs/how-to/deploy-to-vercel.md`

## Do

Write `CHECKLIST.md` at the app root: a list of unchecked `- [ ]` items for the human owner covering at least: every secret to set and where, the deploy and its URL, changing the admin password, reviewing the consent text, and the CI repo settings. One line per item, concrete commands where there are any.

## Done when

`CHECKLIST.md` exists with at least five unchecked items.

Run `bun run compile`/type-check in `backend/` and `frontend/` and fix what you broke
before finishing. Never commit secrets; real values go in untracked `.env` files and
placeholders in `.env.example`.
