# Stage: admin — admin panel and seeded admin user

You are continuing the todo app in the current directory (`backend/` and `frontend/`,
scaffolded by the previous stage and committed as the baseline). This stage needs no human input:
do not ask questions, pick the sensible default, and record the choice in a short comment.

Read first: skill `terreno:building-admin-interfaces`, `docs/how-to/build-admin-screens.md`, `docs/how-to/seed-a-database.md`

## Do

1. Register `AdminApp` on the backend with the users and todos models (`IsAdmin` only) and mount the admin screens in the frontend under `/admin`.
2. Add a `seed` script (`bun run seed` in `backend/`) that creates one admin user (`admin: true`) and one ordinary member user, reading both passwords from env vars with documented dev defaults. It must be safe to run twice.
3. Show an Admin link to admin users only.

## Done when

`backend/package.json` has a `seed` script, `AdminApp` is registered, and both packages type-check.

Run `bun run compile`/type-check in `backend/` and `frontend/` and fix what you broke
before finishing. Never commit secrets; real values go in untracked `.env` files and
placeholders in `.env.example`.
