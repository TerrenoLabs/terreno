---
name: build-terreno-app
description: 'Build a complete Terreno application end to end using only public documentation and published skills, recording every point of friction. This is Terreno''s dogfooding harness: it validates that the docs, skills, and MCP server are sufficient to ship a real app, and it produces the artifacts for a build-in-public blog post. Use when asked to "test the developer experience", "dogfood Terreno", "build a demo app end to end", "validate the docs by building something", or to produce material for a Terreno blog post. Do not use for routine feature work inside the Terreno monorepo.'
---
# Build a Terreno App (Dogfooding Harness)

Build a complete, deployed Terreno application from nothing, using **only** what a member of the public can see. Record every place the experience breaks. The application is the visible output; the friction log is the valuable one.

## Why this skill exists

Terreno's positioning is that it is the fastest way to build a universal app with AI assistance. That claim is only true if an agent with no insider knowledge can actually do it. This skill is the test. It fails loudly when the documentation, skills, or MCP tools are insufficient — which is the point.

Run it before any launch, after any significant framework change, and whenever the docs have drifted.

## The one rule that matters

**Use only public sources.** You may read and use:

- The published docs site and the `docs/` tree of the public repository
- Package READMEs as published to npm
- The hosted MCP server and `terreno-mcp-local`
- Published skills (`deploy-vercel`, `deploy-gcp`, `generate-sdk`, `upgrading-terreno`, `verify-ui-changes`, the Expo skills)
- The `/terreno-*` SDLC plugin, if its marketplace is public — install it and use the pipeline rather than working ad hoc, since exercising it is part of the test
- Published npm packages

You may **not** read or use:

- `.rulesync/`, `.cursor/rules/`, `.claude/`, `.devin/`, or `.github/instructions/` from the Terreno monorepo
- `docs/implementationPlans/` or `docs/tasks/`
- The Terreno monorepo source as a reference for how to call an API
- `infra/flourish/`
- Anything you happen to remember about Terreno's internals from other sessions

When you hit a wall, the correct response is to **record the gap and find a public path around it** — not to read the framework source. Reading the source to unblock yourself destroys the experiment's value. If there is genuinely no public path forward, record it as a blocking gap and stop that step.

## Inputs

| Input | Required | Default |
|-------|----------|---------|
| App concept | no | `pantry` (see [`references/app-concepts.md`](references/app-concepts.md); launch dogfood app per [`build-terreno-app-validation`](../docs/implementationPlans/build-terreno-app-validation.md)) |
| Deploy target | no | Vercel for web, per the app concept's guide |
| Time budget | no | none — completeness beats speed |
| Stack mode | no | detect from the installed Terreno version |

### Stack mode

Detect which applies before writing any client code:

- **syncdb + Better Auth** — the supported platform and the only option on Terreno 58+. Use `@terreno/syncdb` for data, requests, and session, and Better Auth for auth.
- **RTK Query + JWT** — legacy. Only if the installed Terreno version is 57.x or older (`@terreno/rtk` was removed in 58).

Determine this from the installed version and the public reference docs, not from memory. Record which mode you used in the friction log, because the log's findings are only valid for that stack.

## Procedure

### Phase 0 — Set up the record

Create a working directory outside the Terreno monorepo. Start `FRICTION_LOG.md` immediately, before doing anything else, with this structure:

```markdown
# Friction log: <app name>
**Started:** <ISO timestamp>
**Terreno version:** <version>
**Stack mode:** syncdb+BetterAuth | rtk+jwt
**Environment:** <OS, Bun version, editor/agent>

## Timeline
| Time | Phase | What happened |

## Gaps
| # | Severity | Phase | What was missing | What I did instead | Suggested fix |

## Pipeline gaps
Only when the `/terreno-*` plugin was used. Log separately — the pipeline is
process tooling and its failures have a different owner than doc gaps.
| # | Severity | Stage | What broke | Was it a monorepo assumption? |

## Wins
| # | What worked better than expected |
```

Severity scale: **blocking** (no public path forward), **major** (cost more than 15 minutes or required guessing), **minor** (annoyance, wrong detail, broken link).

Log entries as you go. A log reconstructed at the end is worthless — you will have forgotten the small frictions, and the small frictions are what drive people away.

### Phase 1 — Learn the framework the way a newcomer would

1. Find the docs site. Read the landing page and the tutorials index.
2. Follow the "run the examples" tutorial to completion. Log every step that failed or was ambiguous.
3. Set up both MCP servers per the public setup guide. Verify with `application_info`.
4. If the `/terreno-*` plugin marketplace is public, install it and read the five stage descriptions. Use the pipeline for the build in phase 3 — a consumer running it outside the Terreno monorepo is the exact case it has historically not been tested against, so log every stage that assumes a monorepo layout.
5. Skim the reference pages for the packages the app will use.

Do not skip this phase because you think you know Terreno. Following the newcomer path *is* the test.

### Phase 2 — Scaffold

1. Scaffold with `bunx create-terreno-app <appName> --display-name "<App Name>"` (or `npm create terreno-app`). Follow the CLI's next-step hints; the CLI does not run install or seed — those are your steps below.
2. Get it running: backend, web, and one native target (simulator or device).
3. Log in with the seeded credentials.
4. Log what the scaffold got right and what it left for you.

If the scaffold does not run, that is a **blocking** gap. Record it, then fall back to cloning the public example apps as a starting point and continue.

### Phase 3 — Build the app

Work in vertical slices, one feature at a time. For each slice: model, route, typed client regeneration, screen, then verify on both web and native.

Use the MCP generators and `terreno_search_docs` rather than writing from memory. When you need a component, call `terreno_get_component_docs` instead of guessing at props — and log it when the returned props do not match reality.

After each slice:

- Run the app on web and native, exercise the feature, and capture a screenshot.
- Log the slice's duration and any friction.

Build the slices in the order given by the app concept. Do not add features beyond the concept — scope creep destroys comparability between runs.

### Phase 4 — Exercise the differentiators

The app concept specifies which Terreno capabilities it must demonstrate. Verify each one explicitly and capture evidence:

- **AI**: a structured-output call and a streaming chat call, with the request visible in the `AIRequest` log.
- **Offline / local-first**: turn off the network, mutate data, confirm the UI updates, reload the page, confirm the change survived, restore the network, confirm it synced.
- **Realtime**: two clients, a change in one appearing in the other without a refresh.
- **Admin**: a curated model editable by an admin and not by a normal user.
- **Universal**: the same screen on iOS or Android and on web, side by side.
- **Feature flags**: one capability gated by a flag, toggled at runtime.

Capture a screenshot or short recording for each. These are the blog post's evidence.

### Phase 5 — Use the AI debugging loop deliberately

Introduce a realistic bug — a missing owner assignment on create, a permission that is too strict, a schema field without a description. Then find and fix it using only `last_error`, `read_logs`, `database_query`, and `get_client_state`.

Log how long it took and whether the tools were sufficient. If you needed to read source or add print statements, that is a **major** gap in the AI story and the single most important finding this skill can produce.

### Phase 6 — Deploy

Deploy using the published deployment skill and how-to guide for the chosen target. Verify all four checks: the app loads, a deep link loads on refresh, login works against the deployed backend, and the websocket connects.

Log every gap. Deployment guides rot faster than any other documentation.

### Phase 7 — Report

Produce three artifacts:

1. **`FRICTION_LOG.md`** — complete, with every gap classified and a suggested fix.
2. **`BLOG_DRAFT.md`** — see [`references/blog-post-outline.md`](references/blog-post-outline.md). Honest about the friction; a build-in-public post that hides the rough edges is not credible and is less useful to readers.
3. **Artifacts** — screenshots and recordings in `/opt/cursor/artifacts/` with descriptive names, including the six differentiator demonstrations and the deployed app.

Then summarize for the maintainers: total gaps by severity, the three worst, and the three things that worked best.

## Turning gaps into work

Every **blocking** and **major** gap should become a GitHub issue on the Terreno repository, labeled `area:docs` or the relevant area plus `type:docs` or `type:bug`. Do not open the issues yourself unless explicitly asked — list them in the report with proposed titles, bodies, and labels so a maintainer can file them.

If the same gap appears in two consecutive runs of this skill, say so prominently. A repeat gap means the previous run's findings were not acted on, which is worth more attention than any individual gap.

## Failure handling

- A step that cannot be completed from public sources is a finding, not a reason to abandon the run. Record it, work around it, continue.
- If the app cannot be finished at all, the run still succeeded: write the friction log and the report explaining where it stopped and why. That is the most actionable result this skill can produce.
- Never fabricate a completed step. An unverified claim in the friction log makes every other entry untrustworthy.

## References

- [`references/app-concepts.md`](references/app-concepts.md) — the app specs, including the default
- [`references/blog-post-outline.md`](references/blog-post-outline.md) — blog draft structure
