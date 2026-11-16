# Stage: consent — consent forms

You are continuing the todo app in the current directory (`backend/` and `frontend/`,
scaffolded by the previous stage and committed as the baseline). This stage needs no human input:
do not ask questions, pick the sensible default, and record the choice in a short comment.

Read first: `docs/how-to/sign-consent-on-behalf.md`, skill `terreno:building-terreno-apps`

## Do

1. Add a Terms of Service and a Privacy consent form using the template's consent support, with short placeholder text that the CHECKLIST stage later tells the owner to review.
2. A fresh user must see the form before the todo screen; accepting it records a consent response.
3. Add a backend test that a response is recorded.

## Done when

A consent form exists, is gated before the todo screen, and both packages type-check.

Run `bun run compile`/type-check in `backend/` and `frontend/` and fix what you broke
before finishing. Never commit secrets; real values go in untracked `.env` files and
placeholders in `.env.example`.
