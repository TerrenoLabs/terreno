---
trigger: glob
globs: >-
  ui/**,demo/**,example-frontend/**,admin-frontend/**,admin-spa/**,syncdb/src/react/**,syncdb/src/auth/**
---
# Frontend Feature Verification (Mandatory)

Any feature, fix, or PR that touches the frontend MUST be verified in a running app before the PR is opened or updated.

This applies to work in `ui/`, `demo/`, `example-frontend/`, `admin-frontend/`, `admin-spa/`, and frontend-integrated changes in `syncdb/` (React hooks, auth session, request client), including full-stack features where only part of the diff is backend.

## Required workflow

1. **Launch the correct app** for the package that changed (see `verify-ui-changes` skill for package-specific commands).
2. **Log in** when the app requires authentication — use seeded test accounts from `AGENTS.md` / `00-root.md`.
3. **Attempt to use the changed feature** — navigate to the affected screen and exercise the primary user flow end to end. App start or page load alone is not sufficient.
4. **Save evidence** — store screenshots and screen recordings under `/opt/cursor/artifacts/` (e.g. `/opt/cursor/artifacts/screenshots/`, `/opt/cursor/artifacts/` for videos).
5. **Post evidence to the PR** — add the minimum decisive artifacts to the
   `Verification` table using HTML tags with absolute paths. Do not create a separate
   evidence heading. The PR management tool uploads and rewrites URLs automatically.

## When this applies

- New or changed screens, components, navigation, forms, tables, modals, or user-visible copy
- Full-stack features with any frontend surface area
- `terreno-2-pick` (before handoff to Roast) and `terreno-4-brew` when the branch includes frontend paths
- `terreno-5-taste` when a fix cycle changes frontend files — re-verify and update PR evidence

## Skill reference

Follow the `verify-ui-changes` skill for package-specific app URLs, credentials, and capture guidance. Delegate GUI work to the `ui-verifier` subagent when available.

## Blockers

If environment setup prevents verification, add one `⚠️ Not tested` row naming the
blocked behavior and exact reviewer action. Put only decisive error detail in an optional
`<details>` block. Do not claim verification passed when it was not run.
