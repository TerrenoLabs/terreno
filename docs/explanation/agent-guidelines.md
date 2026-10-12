# Agent guidelines

An agent writes Terreno-shaped code only when Terreno's conventions are in its context.
Those conventions reach it through four channels. Each one has a single source of truth,
and every other copy is generated from it.

| Channel | Source of truth | How the agent gets it | Status |
| --- | --- | --- | --- |
| Hosted MCP docs | `docs/`, `website/versioned_docs/`, `mcp-server/src/docs/resources/` | `terreno_search_docs`, `terreno_get_component_docs`, `terreno://docs/*` resources | Shipped |
| Per-package guidelines | `<package>/.ai/guidelines/core.md` | Merged into the files `terreno_bootstrap_ai_rules` returns | Shipped |
| App rule files | The app's `.rulesync/rules/` | Generated per editor by `rulesync generate` | Shipped |
| Agent skills | `plugins/terreno-planning/skills/`, `plugins/terreno-scan/skills/`, `.rulesync/skills/` | `npx skills add TerrenoLabs/terreno` or a host plugin | Shipped |

The runtime side of the loop, meaning what the agent can see in a running app, is covered
in [AI development loop](ai-development-loop.md). This page covers only conventions.

## Hosted docs and search

The hosted server (`terreno-mcp`) bundles the docs at build time. `sync-versioned-docs`
copies `docs/` as the `next` version and each `website/versioned_docs/version-*` tree as a
released version. `sync-ui-docs` copies the component type data.

`terreno_search_docs` runs BM25 over that corpus and the resource pages. It takes several
queries in one call, an optional package filter, and an optional lockstep `version`. With a
version, it answers from the nearest retained snapshot, so an app on an older release gets
that release's guidance.

Resources are the fixed entry points: `terreno://docs/overview`, `api`, `ui`, `syncdb`,
`rtk`, `patterns`, plus one page per `@terreno/ui` component. A client can read them
without a tool call.

Search is pull-based. The agent sees nothing until it asks. That is why the search tool's
own description tells the agent to call it before guessing at Terreno APIs.

## Per-package `.ai/` guidelines

Each core package keeps a short `.ai/guidelines/core.md` next to its code, so a change to
the package and a change to its guidance land in the same PR. Two packages also carry skill
copies under `.ai/skills/`.

| Package | `.ai/` contents | In the npm tarball |
| --- | --- | --- |
| `@terreno/api` | `guidelines/core.md`, `skills/mongoose-schema-safety/` | Yes (no `files` field) |
| `@terreno/ui` | `guidelines/core.md` | Yes (`.ai/**/*` in `files`) |
| `@terreno/rtk` | `guidelines/core.md` | Yes (`.ai/**/*` in `files`) |
| `@terreno/syncdb` | `guidelines/core.md`, `skills/debug-syncdb-with-mcp/` | No (`files` is `dist` and `src` only) |
| `@terreno/admin-backend` | `guidelines/core.md` | Yes (no `files` field) |
| `@terreno/admin-frontend` | `guidelines/core.md` | Yes (`.ai/**/*` in `files`) |

The path that matters today runs through the MCP server, not `node_modules`.
`mcp-server/scripts/sync-package-guidelines.ts` copies every `.ai/` tree into
`mcp-server/src/docs/guidelines/<package>/`. `@terreno/mcp` publishes that directory, and
`terreno_bootstrap_ai_rules` reads it.

Nothing in Terreno reads `node_modules/@terreno/*/.ai/` in a consumer project yet; the
tarball copies are available to any tool that looks for vendor guidelines there.

Planned (from the per-package guidelines phase of the MCP parity plan, not built):

- Versioned guidelines (`.ai/guidelines/<major>/core.md`) picked by the app's installed
  version. Guidelines are a single flat `core.md` per package today.
- Shipping `@terreno/syncdb`'s `.ai/` in its tarball. Its `files` field leaves it out.

## `terreno_bootstrap_ai_rules`

This hosted tool turns the package guidelines into rule files for one app. It does not
write files. It returns their contents and instructions, and the agent writes them.

| File | Contents |
| --- | --- |
| `.rulesync/rules/00-root.md` | The one root rule, for Cursor, Claude Code, Copilot, and `AGENTS.md`: app description, code style, and the merged `core.md` of `api`, `ui`, `rtk`, `syncdb` |
| `backend/AGENTS.md`, `backend/CLAUDE.md` | Backend conventions, plus the `admin-backend` guidelines when requested |
| `frontend/AGENTS.md`, `frontend/CLAUDE.md` | Frontend conventions, the MCP servers to use, plus the `admin-frontend` guidelines when requested |
| `rulesync.jsonc` | rulesync config: `rules` feature, targets `cursor`, `claudecode`, `copilot`, `agentsmd`, `delete: true` |

`packages` narrows the merge. Pass the app's `@terreno/*` dependencies so a project without
the admin panel gets no admin guidance. Unknown ids are dropped, and an empty result falls
back to all six packages.

The root rules go through rulesync. The `backend/` and `frontend/` files do not: they are
direct output, written as-is.

`bunx create-terreno-app` writes its own `.cursorrules` and `CLAUDE.md`. The
`terreno_bootstrap` prompt tells the agent to run `create-terreno-app` first and this tool
second.

The returned instructions run `bunx rulesync@9 generate`, the major this repository pins.
A test in `mcp-server` runs `rulesync generate` on the returned files. From `00-root.md`,
rulesync writes `.cursor/rules/00-root.mdc`, `CLAUDE.md`, `.github/copilot-instructions.md`,
and `AGENTS.md`. Windsurf, Codex, and other agents read
`AGENTS.md`; rulesync 9 has no `windsurf` target. The generated `CLAUDE.md` replaces the
one `create-terreno-app` wrote, and `.cursor/rules/00-root.mdc` supersedes its
`.cursorrules`, so delete that file. The root rule contains everything both files said,
including the "Adding Features" steps.

Earlier versions of the tool also returned `.rulesync/rules/01-claudecode-root.md`, a
`localRoot` rule that rulesync 9 rejects without a Claude Code `root` rule. Delete that file
when you re-bootstrap. The root rule now covers Claude Code.

## The `.rulesync/` pattern

This repository and the apps the tool bootstraps follow the same rule. Agent instructions
are written once under `.rulesync/`, and every editor-specific file is generated from them.

In this repository:

| Source | Generated targets |
| --- | --- |
| `.rulesync/rules/**` | `CLAUDE.md`, `.claude/rules/`, `AGENTS.md`, `.cursor/rules/`, `.github/copilot-instructions.md`, `.github/instructions/`, `.devin/rules/` |
| `.rulesync/skills/`, `.rulesync/subagents/`, `.rulesync/hooks.json` | Per-host skill, subagent, and hook directories (`.claude/`, `.cursor/`, `.github/`, `.devin/`, `.agents/`) |
| `plugins/terreno-planning/skills/`, `plugins/terreno-scan/skills/`, plus `.rulesync/skills/` | `skills/` (installable set), `plugins/terreno-claude/` and `plugins/terreno-scan-claude/` (Claude Code plugins) |

`rulesync.jsonc` maps each target to its features. `bun run rules` regenerates the rulesync
targets. `bun run skills:sync` regenerates `skills/` and the Claude plugin. The
`rulesync-check` workflow regenerates and fails on any diff, and `bun run skills:check` does
the same for skills.

The config sets `delete: true`. rulesync removes stale generated files before it writes, so
a generated file holds only what its source says. A hand edit to a generated file is lost
on the next run.

## Extending the rules in your app

Regeneration replaces two kinds of file. rulesync replaces every generated editor file. A
re-run of `terreno_bootstrap_ai_rules` returns fresh copies of everything in its table,
including `00-root.md`, `rulesync.jsonc`, and the `backend/`/`frontend/` agent files. Anything you add to those files is lost.

`rulesync generate` runs with `delete: true`. It overwrites the root `CLAUDE.md`,
`AGENTS.md`, and `.github/copilot-instructions.md`. It deletes every file under
`.claude/rules/`, `.cursor/rules/`, `.github/instructions/`, and `.agents/memories/` that
it did not generate. Before the first `rulesync generate`, and before every later one,
move any edits to those root files and any hand-written files in those directories into
`.rulesync/rules/10-project.md` or another `.rulesync/rules/*.md` source. Otherwise they
are lost.

Keep your conventions in rulesync sources the tool never emits:

1. Leave `00-root.md` untouched. Treat it as Terreno-owned.
2. Add one or more files such as `.rulesync/rules/10-project.md`. Use a number above `00`
   and a name the tool does not use.
3. Scope with `globs` instead of editing `backend/AGENTS.md` or `frontend/AGENTS.md`. A rule
   with `globs: ["backend/**"]` applies to backend files in every editor.
4. Run `bunx rulesync@9 generate` and commit the sources and the output together.

```markdown
---
targets: ["*"]
description: "Acme backend conventions"
globs: ["backend/**"]
---

# Acme backend

- Store money as integer cents in fields named `*Cents`.
- Every tenant-scoped model has an `orgId` index.
```

From one source, rulesync 9 writes `.cursor/rules/10-project.mdc` (`globs`),
`.claude/rules/10-project.md` (`paths`), `.github/instructions/10-project.instructions.md`
(`applyTo`), and `.agents/memories/10-project.md` (linked from `AGENTS.md`). A re-bootstrap
followed by `rulesync generate` leaves these files in place and
replaces only the Terreno-owned ones.

If you changed `rulesync.jsonc`, for example to add a target, reapply that change after a
re-bootstrap. The tool returns the default config.

## Related

- [AI development loop](ai-development-loop.md): what the agent sees at runtime
- [Set up Terreno MCP](../how-to/set-up-terreno-mcp.md): connect both servers to your editor
- [MCP server reference](../reference/mcp-server.md#terreno_bootstrap_ai_rules): tool parameters
- [Install agent skills](../how-to/install-agent-skills.md): the skills channel
- [Planning plugins](planning-plugins.md): how the lifecycle skills are packaged
