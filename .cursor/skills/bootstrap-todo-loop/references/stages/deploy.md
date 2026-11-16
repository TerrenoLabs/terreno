# Stage: deploy — deploy

You are continuing the todo app in the current directory (`backend/` and `frontend/`,
scaffolded by the previous stage and committed as the baseline). This stage needs no human input:
do not ask questions, pick the sensible default, and record the choice in a short comment.

Read first: skill `terreno:deploy-vercel`, `docs/how-to/deploy-to-vercel.md`

## Do

1. Deploy the web app and backend with the Vercel project token and database URI in your env. Set `ADMIN_PASSWORD` to a newly generated value in the deploy environment so the seeded `admin@example.com` / `testpassword123` login no longer works.
2. Make the CORS and Better Auth origin settings match the deployed URL.
3. Write `deploy.json` at the app root as `{"url": "https://..."}` (the web URL) and confirm the root URL, a deep link refresh and login all work.

## Done when

`deploy.json` has an http(s) URL that returns 200.

Run `bun run compile`/type-check in `backend/` and `frontend/` and fix what you broke
before finishing. Never commit secrets; real values go in untracked `.env` files and
placeholders in `.env.example`.
