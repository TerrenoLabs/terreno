# Stage: auth — secure authentication

You are continuing the todo app in the current directory (`backend/` and `frontend/`,
scaffolded by the previous stage and committed as the baseline). This stage needs no human input:
do not ask questions, pick the sensible default, and record the choice in a short comment.

Read first: skill `terreno:building-terreno-apps`, `docs/how-to/configure-better-auth.md`, `docs/how-to/rate-limiting.md`

## Do

1. Make Better Auth the sign-in path (`BetterAuthApp` on the backend, `SessionProvider` on the frontend). Email/password with a minimum password length of 8.
2. Generate real values for `BETTER_AUTH_SECRET`, `TOKEN_SECRET`, `REFRESH_TOKEN_SECRET` and `SESSION_SECRET` into the untracked `backend/.env`; list the names with placeholder values in `backend/.env.example`.
3. Keep the default rate limit on and make every non-auth route require a signed-in user (`GET /todos` without a session returns 401).
4. Do not leave the template's seeded `admin@example.com` / `testpassword123` login usable outside local development: read the admin password from an env var (`ADMIN_PASSWORD`) in the seed script.

## Done when

Better Auth is configured, `.env` is untracked, `.env.example` holds placeholders only, and both packages type-check.

Run `bun run compile`/type-check in `backend/` and `frontend/` and fix what you broke
before finishing. Never commit secrets; real values go in untracked `.env` files and
placeholders in `.env.example`.
