# Contributing to Terreno

Thank you for helping make Terreno better. This guide covers how to set up the
repo, run checks, and open a pull request.

Please read our [Code of Conduct](CODE_OF_CONDUCT.md) before participating.

## Ways to contribute

- **Report a bug** — open a [bug report](.github/ISSUE_TEMPLATE/bug_report.yml) issue
- **Suggest a feature** — open a [feature request](.github/ISSUE_TEMPLATE/feature_request.yml) issue or start a GitHub Discussion
- **Fix documentation** — open a [docs issue](.github/ISSUE_TEMPLATE/docs_issue.yml) or send a PR with doc edits
- **File pick-ready work** — open a [lifecycle work item](.github/ISSUE_TEMPLATE/work_item.yml) (see [GitHub issue lifecycle](docs/how-to/github-issue-lifecycle.md))
- **Submit code** — fork, branch, test, and open a draft PR (see below)

## Development setup

### Prerequisites

- [Bun](https://bun.sh/) 1.4 or newer — CI pins `bun-version: 1.4.0` (via `.github/actions/setup-bun-workspace` on the hot workflows). EAS build profiles keep their own Bun pin: `eas.json` feeds the Expo fingerprint, so bumping it changes the native runtime version and forces a rebuild.
- **MongoDB replica set** — required to run `example-backend` locally (change streams power realtime and feature-flag sync). A single-node replica set is enough for development.

### Bootstrap

From the repository root:

```bash
bun run bootstrap
```

This runs `bun install` and compiles all workspace packages.

### Example full stack

Terminal 1 — backend (needs MongoDB + auth secrets):

```bash
MONGO_URI="mongodb://127.0.0.1:27017/terreno-example?replicaSet=rs0" \
  TOKEN_SECRET=dev-token-secret TOKEN_ISSUER=terreno-dev \
  REFRESH_TOKEN_SECRET=dev-refresh-secret SESSION_SECRET=dev-session-secret \
  PORT=4000 bun run backend:dev
```

Terminal 2 — frontend:

```bash
EXPO_PUBLIC_API_URL=http://localhost:4000 bun run frontend:web
```

Seed test users (same env vars as the backend):

```bash
bun run backend:seed
```

Seeded accounts (from `example-backend/src/scripts/seed-test-data.ts`):

| Email | Password | Notes |
| ----- | -------- | ----- |
| `test@example.com` | `testpassword123` | Regular user |
| `admin@example.com` | `testpassword123` | Admin user |

Health check: `curl localhost:4000/health` should return `"healthy": true`.

See [AGENTS.md](AGENTS.md) for Cloud VM MongoDB setup details.

## Common commands

Run these from the repository root:

| Command | Purpose |
| ------- | ------- |
| `bun run compile` | Compile all packages |
| `bun run lint` | Lint all packages |
| `bun run lint:fix` | Auto-fix lint issues where possible |
| `bun run api:test` | Run `@terreno/api` tests |
| `bun run ui:test` | Run `@terreno/ui` tests |
| `bun run test` | Run all package test suites |
| `bun run test:agent` | Run all package tests with passing cases suppressed (failures and summaries remain visible) |
| `bun run check:no-barrel-imports` | Enforce no internal barrel imports |
| `bun run check:source-rules` | Fail production sources that use `function`, `Date`, `throw new Error`, `console.log`, `findOne`, or `as any` |
| `bun run check:changelog` | Validate `changelog/unreleased/` fragment files |
| `bun run skills:sync` | Regenerate installable `skills/` and `skills.sh.json` |
| `bun run changelog:preview` | Preview assembled unreleased notes |
| `bun run check:licenses` | Verify published packages ship a LICENSE |
| `bun run backend:dev` | Start example backend |
| `bun run frontend:web` | Start example frontend (web) |
| `bun run demo:start` | Start UI component demo |

## Testing and coverage

Published packages must stay at **95% function coverage and 95% line coverage**.
Pull requests must not drop either metric. CI runs `scripts/check-coverage.ts`
(`bun run test:coverage` in the package directory) as the live gate.

Run coverage locally from a package directory:

```bash
cd ui && bun run test:coverage
```

Replace `ui` with any published package (`api`, `rtk`, `syncdb`, `ai`, `comms`,
`mcp-server`, `admin-backend`, `admin-frontend`, `admin-spa`, `api-health`,
`feature-flags`, `test`). The script writes `coverage/lcov.info` for Codecov.
Isolated `*.isolated.ts(x)` suites are merged into that report.

Codecov uploads per-package flags from CircleCI (and retained GitHub Actions
twins). The README badge reflects the merged project. Maintainers set
`CODECOV_TOKEN` in CircleCI project env and as a GitHub Actions secret. Public
repos still need a token unless the Codecov org disables token authentication
for public repositories.

When you add a framework capability, exercise it in `example-backend` and/or
`example-frontend` and update
[docs/explanation/example-coverage.md](docs/explanation/example-coverage.md).

Package-specific commands are listed in [AGENTS.md](AGENTS.md). You can also use Bun's filter syntax:

```bash
bun run --filter '@terreno/ui' compile
bun run --filter '@terreno/api' test
```

## Dependency management

This monorepo uses [Bun Catalogs](https://bun.sh/docs/install/catalogs). Shared versions live in the root `package.json` `catalog` field. Workspace packages reference them with `"catalog:"`. Change a shared version once in the catalog, then run `bun install`.

## Linking Terreno packages in another repo

Consumers can develop against local copies of published packages using Bun's `link` protocol.

### Which package goes where

- **@terreno/api** — Link in the consumer's backend. Restart the server after changes; run `bun run api:compile` or `bun run api:dev` in Terreno so the consumer uses the built output.
- **@terreno/ui** — Link in the consumer's frontend. When the app uses Metro/Expo, update Metro config (see step 5). Run `bun run ui:compile` or `bun run ui:dev` so the consumer uses `ui/dist/`.
- **@terreno/rtk** — Link in the consumer's frontend. Metro apps that link rtk may need the same resolution tweaks as ui.

### One-time setup in the consumer repo

1. Clone both repos as siblings (adjust paths if your layout differs).
2. In the workspace that depends on the package, set the dependency to the link protocol, for example when Terreno is at `../terreno`:

   ```json
   "@terreno/api": "link:../../terreno/api",
   "@terreno/ui": "link:../../terreno/ui",
   "@terreno/rtk": "link:../../terreno/rtk"
   ```

3. Register and link each package from the consumer repo:

   ```bash
   cd ../terreno/<package-dir> && bun link && cd - && cd <consumer-dir> && bun link @terreno/<name>
   ```

4. If Bun creates a bad relative symlink, replace it with an absolute path from the consumer workspace that contains `node_modules`:

   ```bash
   rm node_modules/@terreno/<name>
   ln -s /absolute/path/to/terreno/<package-dir> node_modules/@terreno/<name>
   ```

5. When linking **@terreno/ui** (and optionally **@terreno/rtk**) in an Expo/Metro app, the consumer's Metro config must add the linked package directory to `watchFolders` and resolve that package's dependencies from the app's `node_modules` so there is only one copy of React.

6. Restart the bundler with a clean cache (for example `bun start --clear`). Restart the API server so it picks up a linked `@terreno/api`.

In the Terreno repo, run the compile or watch command for each linked package. To revert, set each dependency back to a published version and run `bun install`.

## Releasing

Packages are published to npm automatically when a semantic-version tag is pushed. The published packages listed in the root [README.md](README.md) are kept in lockstep at the same version.

1. Open the [Releases page](../../releases) on GitHub
2. Draft a new release
3. Create a new tag with the version number (for example `1.0.0`) — no `v` prefix
4. Fill in the release title and notes
5. Publish the release

The GitHub Action validates upgrade documentation, publishes packages in dependency order, commits version bumps to `master` for non-prerelease tags, and notifies Zoom Chat.

Version format: semantic versioning (`1.0.0`, `1.2.3`, `2.0.0-beta.1`). No `v` prefix.

Required repository secrets: `NPM_TOKEN`, `REPO_ADMIN_TOKEN`, `ZOOM_WEBHOOK_URL`, `ZOOM_WEBHOOK_TOKEN`.

GCP infrastructure and static-site hosting live in [terraform/README.md](terraform/README.md).

## AI rules management

This project uses [rulesync](https://github.com/dyoshikawa/rulesync) to keep AI assistant rules consistent.

1. Edit source files in `.rulesync/rules/`
2. Run `bun run rules` to regenerate tool-specific files (`AGENTS.md`, `CLAUDE.md`, Cursor rules, Copilot instructions)
3. Commit both the source and generated files

`bun run rules:check` verifies generated files are up to date (also run in CI).

## Code style

Follow the conventions in [AGENTS.md](AGENTS.md). Highlights:

- **No barrel imports** — import concrete module files, not directory `index` re-exports. See [docs/explanation/no-barrel-imports.md](docs/explanation/no-barrel-imports.md). Enforced by Biome and `bun run check:no-barrel-imports`.
- **Production source rules** — const arrows, Luxon, `APIError`, no `console.log`, no Mongoose `findOne`, no unsuppressed `as any`. See [docs/explanation/source-rules.md](docs/explanation/source-rules.md). Enforced by `bun run check:source-rules`.
- **Dates** — use [Luxon](https://moment.github.io/luxon/), not `Date` or dayjs.
- **Logging** — backend: `logger.info/warn/error/debug` from `@terreno/api`; frontend: `console.info/debug/warn/error` for permanent logs. Do not leave `console.log` in committed code.
- **TypeScript** — prefer interfaces over types; const arrow functions; explicit return types.

## Tests

- New features and bug fixes should include tests. Coverage must not drop across a PR.
- Backend: `bun test` with `expect` (see package `test` scripts).
- Run the relevant package tests before opening a PR (`bun run api:test`, `bun run ui:test`, etc.).

## How work gets planned

1. **Ideas** — start in [GitHub Discussions → Ideas](https://github.com/TerrenoLabs/terreno/discussions/new?category=ideas); do not open a tracking issue yourself.
2. **Promotion** — a maintainer promotes an accepted idea to a `Shaping` tracking issue on the [Terreno Roadmap](https://github.com/TerrenoLabs/terreno/blob/master/ROADMAP.md) board (`roadmap-promote`).
3. **Design** — substantial work gets an [implementation plan](docs/implementationPlans/README.md) (IP) plus a task list before large coding begins. When the IP is approved, the tracking issue moves to `Planned` and gets its `IP` field set (`roadmap-item` — it updates the promoted issue, it does not open a second one).
4. **Build** — the [`terreno-planning` plugin](plugins/README.md) provides bounded transitions: Grow (shape) → Pick (build) ⇄ Roast (prove) until tasks are done → Brew (submit) → Taste (react once). Pick and Roast loop one task at a time. Brew and Taste wait in-process for review bots such as Bugbot and CodeQL. Taste then waits in a loop for product CI using GitHub CLI or CircleCI CLI, and before any push fetches latest `master` (merging it only when needed), records last-run failed tests and re-verifies them locally, then runs the repository root's `prepush` package script when present (otherwise affected-package lint, typecheck, and tests) using a no-context subagent, then pushes and watches CI. Taste observes product CI on every discovered host (GitHub Actions, CircleCI, Buildkite, and similar), not only GitHub checks. Waits prefer provider CLI watch hooks over timer polling. Outer loops `/terreno-planning-loop` (task list; pass `phases=` to restrict) and `/terreno-taste-sweep` (broken PRs) reinvoke those stages. Read architecture docs first and update them in the same slice. Install skills with `npx skills add TerrenoLabs/terreno`, the Cursor plugin `terreno-planning` from `.cursor-plugin/marketplace.json`, the Codex plugin `terreno-planning` from `.agents/plugins/marketplace.json` (`$terreno-1-grow`), or the Claude Code plugin `terreno` from `.claude-plugin/marketplace.json` (`/terreno:1-grow`). Regenerate `skills/` and the generated Claude plugin with `bun run skills:sync`.
5. **RFC path** — API or package changes that affect consumers start in [RFCs](https://github.com/TerrenoLabs/terreno/discussions/new?category=rfcs); accepted RFCs become IPs.

See the [roadmap process](docs/explanation/roadmap-process.md) for the full IP ↔ roadmap lifecycle, the promote-vs-item split, maintainer setup, and the Linear bridge.

## When to write an implementation plan (IP)

Substantial work should be planned before coding:

| Needs an IP | Does not need an IP |
| ----------- | ------------------- |
| New published package | Bug fix in one package |
| New public API surface | Documentation-only change |
| Cross-package architectural change | Small internal refactor |
| Breaking change | Test or CI fix |

Process:

1. Read [docs/implementationPlans/README.md](docs/implementationPlans/README.md)
2. Copy [docs/implementationPlans/IP_TEMPLATE.md](docs/implementationPlans/IP_TEMPLATE.md) into `docs/implementationPlans/<slug>.md`
3. Add a companion task list in `docs/tasks/<slug>.md`
4. Get the IP reviewed before large implementation begins

## Developer Certificate of Origin (DCO)

We use the [Developer Certificate of Origin](https://developercertificate.org/) (DCO). Every commit in a pull request from an external fork must include a `Signed-off-by` line that matches the commit author.

Sign off when you commit:

```bash
git commit -s -m "fix(api): handle empty query filter"
```

This appends a line like `Signed-off-by: Your Name <you@example.com>` to the commit message. CI enforces DCO on external PRs (see `.github/workflows/dco.yml`).

## Changelog

Do not edit `CHANGELOG.md` `## [Unreleased]`. That shared section caused
constant merge conflicts.

For user-facing work, add **one file per feature** under
[`changelog/unreleased/`](changelog/unreleased/) using this header:

```markdown
---
category: Added
---

User-facing description of the change.
```

`category` must be `Breaking`, `Added`, `Changed`, `Deprecated`, `Removed`, or
`Fixed`. Name the file in kebab-case (`sendgrid-mail-provider.md`). Preview with
`bun run changelog:preview`. Maintainers fold the files into `CHANGELOG.md` at
release time with `bun run changelog:assemble <version>`.

## Pull requests

1. **Branch** — create a feature branch from `master`
2. **Draft PR** — open as a draft until CI is green and you are ready for review
3. **CI** — `bun run lint`, relevant tests, and repo policy checks must pass
4. **UI changes** — if you touch frontend packages (`ui/`, `demo/`, `example-frontend/`, `admin-frontend/`, `admin-spa/`, or frontend-integrated `rtk/`), include screenshots or a screen recording in the PR body showing the change
5. **Changelog** — add `changelog/unreleased/<feature>.md` for user-facing changes (do not edit `CHANGELOG.md`)
6. **Description** — explain what changed and why; link related issues or IPs

## Security

Report vulnerabilities privately — see [SECURITY.md](SECURITY.md). Do not file public issues for security problems.

## Maintainer repository settings

GitHub settings that cannot be committed (Discussions categories, branch
protection, vulnerability reporting) are documented in
[docs/explanation/repository-settings.md](docs/explanation/repository-settings.md).

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](LICENSE) that covers the project.
