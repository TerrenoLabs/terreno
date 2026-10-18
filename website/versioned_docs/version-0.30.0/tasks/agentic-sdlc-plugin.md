# Task List: Publish and Document the Agentic SDLC Plugin

See: [`docs/implementationPlans/agentic-sdlc-plugin.md`](../implementationPlans/agentic-sdlc-plugin.md)

**RTK deprecation flag:** **Partial.** Tasks marked `[RTK]` update the frontend-verification path lists, which name `rtk/` today and must name `syncdb/` after PR #869. Everything else is safe to implement now.

## Instructions for the implementing agent

- Read all five skill files under `plugins/terreno-planning/skills/` before changing any of them. The stages reference each other's scope boundaries, so an edit to one often requires a matching edit elsewhere.
- Do not change what a stage *does*. This IP is packaging, portability, and documentation. If you believe a stage's procedure is wrong, note it and propose it separately.
- When you remove Flourish-specific content, do not remove the underlying judgment. "Apply PHI minimum-necessary handling" becomes a rule about sensitive data, not nothing.
- Test portability claims by actually running the pipeline outside this repository. A portability fix you did not exercise in a consumer app is unverified.
- Run `bun run rules:check` after touching `.rulesync/`, and `bun run check` before each commit.

## Phase 1: Decide and sanitize

- [ ] **Task 1.1**: Audit the plugin for repo- and org-specific content
  - Description: Grep all five skills for Flourish-specific and monorepo-specific content: `rg -n -i "phi|hipaa|flourish|dcb3|example-frontend|admin-spa|bun run|docs/implementationPlans"` across `plugins/`. Produce a table: file, line, category (org-specific / repo-path / hardcoded value / tool assumption), and the proposed replacement. Include the `.cursor-plugin/*.json` files (owner email, marketplace description). Do not change anything yet.
  - Files: none (findings in the PR body)
  - Depends on: none
  - Acceptance: every hit is categorized with a proposed replacement; the table covers all five skills plus both JSON files.

- [ ] **Task 1.2**: Generalize sensitive-data handling
  - Description: Per IP question AP2, replace PHI/HIPAA-specific language with generalized sensitive-data language across `terreno-1-blend`, `terreno-4-pour`, and `terreno-5-dialin`. The rule must survive the rewrite: PR text, review replies, and attached evidence media must not contain sensitive data (PHI, PII, credentials, customer data). Keep it concrete — a vague "be careful with data" is not a usable instruction for an agent.
  - Files: `plugins/terreno-planning/skills/terreno-1-blend/SKILL.md`, `terreno-4-pour/SKILL.md`, `terreno-5-dialin/SKILL.md`
  - Depends on: Task 1.1
  - Acceptance: `rg -n -i "phi|hipaa" plugins/` returns nothing; each rewritten rule names the specific artifacts it applies to (PR body, comments, screenshots, recordings) and the data categories.

- [ ] **Task 1.3**: Fix the hardcoded branch suffix
  - Description: `terreno-4-pour` documents the branch convention as `cursor/<descriptive-name>-dcb3`. The suffix is per-agent-run, not a fixed literal, so this will produce wrong branch names. Replace it with a description of the convention (a `cursor/` prefix plus the run-specific suffix the agent was given) and instruct the agent to use the suffix from its own run instructions rather than any literal in the skill.
  - Files: `plugins/terreno-planning/skills/terreno-4-pour/SKILL.md`
  - Depends on: Task 1.1
  - Acceptance: no literal run suffix appears anywhere in `plugins/`; the convention is described such that an agent in any run produces a correctly-suffixed branch.

- [ ] **Task 1.4**: Clean up plugin metadata
  - Description: Update `.cursor-plugin/marketplace.json` and `plugins/terreno-planning/.cursor-plugin/plugin.json`: adjust the marketplace description per the AP1 decision (it currently says "Team marketplace"), review whether a personal email is the right contact for a public plugin versus a role address, and add a field or README note declaring which Terreno versions the plugin targets (IP question AP7). Add `plugins/terreno-planning/LICENSE` matching the root license.
  - Files: `.cursor-plugin/marketplace.json`, `plugins/terreno-planning/.cursor-plugin/plugin.json`, `plugins/terreno-planning/LICENSE` (new)
  - Depends on: Task 1.1
  - Acceptance: both JSON files are valid and consistent with the AP1 decision; the contact address is a deliberate choice; the targeted Terreno version range is declared; the LICENSE matches the root license.

## Phase 2: Portability

- [ ] **Task 2.1**: Remove repo-root-relative sibling-skill paths
  - Description: `terreno-4-pour` step 6 instructs reading `plugins/terreno-planning/skills/terreno-5-dialin/SKILL.md` "from the repository root", and `terreno-5-dialin` does the same for Pour. That path only resolves when the workspace happens to be this repository — an installed plugin lives in the agent's plugin cache. Replace with guidance that resolves in both cases: reference the sibling skill relative to the current skill's own location, and keep the existing note that Cursor may not resolve plugin skill names alone. Verify the replacement actually works by running Pour's handoff from a workspace that is not this repo.
  - Files: `plugins/terreno-planning/skills/terreno-4-pour/SKILL.md`, `terreno-5-dialin/SKILL.md`
  - Depends on: Task 1.3
  - Acceptance: the handoff resolves both inside this repo and in a consumer app; no absolute or repo-root-relative path to a sibling skill remains; the fix was exercised in a non-Terreno workspace.

- [ ] **Task 2.2**: Resolve the `verify-ui-changes` dependency
  - Description: Four stages invoke `verify-ui-changes` by name, but that skill lives in this repo's `.rulesync/skills/` and a consumer installing the plugin does not get it. Choose and implement one resolution: bundle a consumer-appropriate copy inside the plugin, or declare it as a prerequisite with installation instructions, or have `terreno_bootstrap_app` generate it into consumer apps. Whichever is chosen, a consumer running the pipeline must end up with a working frontend-verification step rather than a reference to a skill they do not have.
  - Files: `plugins/terreno-planning/skills/*/SKILL.md`, plus the bundled skill or the bootstrap template
  - Depends on: Task 2.1
  - Acceptance: a consumer app that installed only the plugin can execute the frontend-verification step; the resolution is documented in `plugins/README.md`; no stage references a skill the user cannot obtain.

- [ ] **Task 2.3**: `[RTK]` Derive frontend paths from project layout
  - Description: The frontend gates in Roast, Pour, and Dial In hardcode Terreno monorepo package names (`ui/`, `demo/`, `example-frontend/`, `admin-frontend/`, `admin-spa/`, `rtk/`). Replace with layout detection: describe how to identify frontend paths in the two shapes that matter — this monorepo, and a bootstrapped consumer app (which uses `frontend/`/`backend/`) — and instruct the agent to determine the set rather than assume it. Update the path list to name `syncdb/` instead of `rtk/` per PR #869, keeping `rtk/` for the deprecation window.
  - Files: `plugins/terreno-planning/skills/terreno-2-roast/SKILL.md`, `terreno-4-pour/SKILL.md`, `terreno-5-dialin/SKILL.md`
  - Depends on: Task 2.2, PR #869 merged
  - Acceptance: the gates fire correctly in both a bootstrapped consumer app and this monorepo, verified by running Roast on a frontend change in each; `syncdb/` is included and `rtk/` retained.

- [ ] **Task 2.4**: Make Blend's conventions portable
  - Description: `terreno-1-blend` assumes `docs/implementationPlans/` and `docs/tasks/`, a project registry containing only `TerrenoLabs/terreno`, and this repo's `bun run` command set. Generalize: describe where planning artifacts go with a documented default and a way to detect an existing convention, replace the hardcoded registry with a resolution procedure, and describe the command set as "the project's lint/compile/test commands" discovered from `package.json`. Keep the question-first behavior exactly as it is — that is the stage's most valuable property.
  - Files: `plugins/terreno-planning/skills/terreno-1-blend/SKILL.md`
  - Depends on: Task 2.1
  - Acceptance: Blend produces an IP in a consumer app with no Terreno-specific directory assumptions; the question-first clarification gate is unchanged; the registry is a procedure rather than a fixed list.

- [ ] **Task 2.5**: Verify the pipeline in a consumer app
  - Description: Scaffold an app with `terreno_bootstrap_app`, install the plugin, and take one small feature from request to open PR through all five stages. Record every place the pipeline assumed something untrue about the project. Fix each. This task is the actual acceptance test for Phase 2 — the previous tasks are hypotheses until this passes.
  - Files: any plugin skill needing correction
  - Depends on: Task 2.3, Task 2.4
  - Acceptance: all five stages complete in a consumer app; a PR is opened with evidence attached; every assumption failure found is fixed; the run is summarized in the PR body.

## Phase 3: Resolve overlap with repo skills

- [ ] **Task 3.1**: Map the overlap precisely
  - Description: For each plugin stage, read its repo-skill counterparts (`submit`, `commit`, `create-pr`, `check-watcher`, `respond-to-review`, `autobot`, `ip`, `design-blend`, `implement`) and produce a table: plugin stage, overlapping skill, rules that agree, rules that **disagree**. The disagreements matter most — two documented processes with different rules is worse than either alone. Report in the PR body.
  - Files: none (findings in the PR body)
  - Depends on: none
  - Acceptance: every stage is mapped to its counterparts; all rule disagreements are listed explicitly with both wordings.

- [ ] **Task 3.2**: Make Brew self-contained; inline Taste review loop per AP5
  - Description: Per IP question AP5, rewrite **Taste** (`terreno-5-taste`) to inline the full submit → CI → review loop (former `autobot` behavior) rather than delegating to repo skills — delegation has been unreliable inside the plugin. **Brew** (`terreno-4-brew`) may orchestrate `commit`/`create-pr` where those resolve from the plugin cache, but must not depend on monorepo-only paths. Resolve every disagreement from Task 3.1 in favor of one wording, in one place. Deprecate `submit` and `autobot` repo skills once Taste ships.
  - Files: `plugins/terreno-planning/skills/terreno-4-brew/SKILL.md`, `terreno-5-taste/SKILL.md`, and deprecated `.rulesync/skills/submit/`, `autobot/`
  - Depends on: Task 3.1, Task 2.5
  - Acceptance: Taste completes a full review loop without delegating to repo skills; no rule appears in both a plugin stage and a repo skill with different wording; `submit`/`autobot` are marked deprecated; `bun run rules:check` exits 0.

- [ ] **Task 3.3**: Cross-reference deprecated repo skills
  - Description: Add a short deprecation note to `.rulesync/skills/submit/SKILL.md` and `autobot/SKILL.md` pointing to the plugin pipeline (Brew/Taste) as the supported path. Regenerate mirrors. Document in `plugins/README.md` that the individual repo skills are legacy once the plugin is public.
  - Files: `.rulesync/skills/submit/SKILL.md`, `.rulesync/skills/autobot/SKILL.md`, generated mirrors, `plugins/README.md`
  - Depends on: Task 3.2, Task 4.1
  - Acceptance: both skills state they are deprecated in favor of Brew/Taste; the plugin README references them as legacy; `bun run rules:check` exits 0.

## Phase 4: Documentation

- [ ] **Task 4.1**: Write `plugins/README.md`
  - Description: Under 150 lines. Cover: what the pipeline is in two sentences; the five stages in a table with the plain-language meaning of each coffee name per IP question AP3; installation (marketplace, per the AP1 decision); a quickstart showing one feature going through all five stages; prerequisites (the skill dependency from Task 2.2, the Terreno version range from Task 1.4); how it relates to the individual repo skills; and how to use a single stage without the full pipeline. Every command must be one you ran.
  - Files: `plugins/README.md` (new)
  - Depends on: Task 2.5
  - Acceptance: under 150 lines; every coffee name is glossed; the installation steps were performed from a fresh state; the quickstart matches a run you completed.

- [ ] **Task 4.2**: Write `docs/explanation/agentic-sdlc.md`
  - Description: The conceptual case, no commands. Cover: the process layer versus the MCP tool layer, and why both are needed; why planning is a separate stage with a question-first gate (agents confidently plan the wrong thing); why review happens in a **fresh context** rather than by asking the implementing agent to check its own work; why verification is a separate stage from implementation; why the frontend gate demands evidence rather than a claim; and why flaky CI must be classified rather than guessed at. Then an honest limits section: what the pipeline does not do, where a human must decide, and the 15-minute review timeout. Reuse the mermaid diagram from the IP.
  - Files: `docs/explanation/agentic-sdlc.md` (new), `docs/explanation/README.md`
  - Depends on: Task 4.1
  - Acceptance: no commands; all six design rationales explained; a limits section naming at least three things the pipeline will not do; linked from the explanation index.

- [ ] **Task 4.3**: Write `docs/how-to/use-the-terreno-plugin.md`
  - Description: Task-focused: install the plugin, take a small feature from request to merged PR through all five stages, with the real output of each stage. Include what to do when a stage stops and asks a question (Blend's clarification gate), when Roast's review sub-agent flags something, and when Dial In reports blocked. Include a "using one stage on its own" section — most people will start with Pour or Dial In on existing work rather than adopting the whole pipeline at once.
  - Files: `docs/how-to/use-the-terreno-plugin.md` (new), `docs/how-to/README.md`
  - Depends on: Task 4.2
  - Acceptance: the walkthrough was performed and the outputs shown are real; all three interruption cases documented; the single-stage section is present; listed in the how-to index.

- [ ] **Task 4.4**: Write `docs/reference/sdlc-plugin.md`
  - Description: Per-stage reference: name, slash command, plain-language purpose, preconditions, inputs, outputs, scope boundary (what it explicitly does not own), handoff target, and failure/exit conditions. Include the `disable-model-invocation` behavior — several stages are deliberately not auto-invocable and must be called explicitly — and explain why. Add the plugin to `docs/reference/README.md`.
  - Files: `docs/reference/sdlc-plugin.md` (new), `docs/reference/README.md`
  - Depends on: Task 4.1
  - Acceptance: all five stages documented with all eight fields; the auto-invocation behavior matches each skill's frontmatter; listed in the reference index.

## Phase 5: Positioning

- [ ] **Task 5.1**: Add the pipeline to the positioning copy
  - Description: Update `docs/explanation/positioning.md` (from [`positioning-django-rails-universal`](../implementationPlans/positioning-django-rails-universal.md)): name the pipeline in the AI-native pillar's `pillars` block, and rewrite the comparison table's generator row so it credits the pipeline — Django gives you `manage.py startapp`, Terreno gives you a reviewed path from request to mergeable PR. Add the tool-layer/process-layer distinction to the `pitch` block. Keep the copy blocks internally consistent, since every other surface copies them verbatim.
  - Files: `docs/explanation/positioning.md`
  - Depends on: Task 4.2
  - Acceptance: the pipeline appears in the pillars block and the comparison table; the tool/process distinction is in the pitch; the blocks remain consistent with each other.

- [ ] **Task 5.2**: Surface the pipeline in the README and docs landing
  - Description: Add the pipeline to `README.md`'s AI section (currently only describes the MCP server) and to `docs/README.md`'s pillars, each with a link to the explainer and the how-to. Keep it to a short paragraph in each — the detail lives in the docs. Make sure the AI section names both layers so a reader understands they are complementary rather than alternatives.
  - Files: `README.md`, `docs/README.md`
  - Depends on: Task 5.1
  - Acceptance: both surfaces name the pipeline and the MCP server as the two halves of the AI story; both link the explainer; neither exceeds a paragraph.

- [ ] **Task 5.3**: Make agents aware of the pipeline
  - Description: Add the pipeline to `.rulesync/rules/00-root.md` (source for `AGENTS.md`, `CLAUDE.md`, and the copilot instructions) and to `CLAUDE-consumer.md`, so an agent working in this repo or in a consumer app knows the pipeline exists and when to use it. Currently no root agent file mentions `plugins/` at all. Regenerate mirrors.
  - Files: `.rulesync/rules/00-root.md`, `CLAUDE-consumer.md`, generated mirrors
  - Depends on: Task 5.2
  - Acceptance: `AGENTS.md` and `CLAUDE.md` both describe the pipeline and when to use it; `bun run rules:check` exits 0.

- [ ] **Task 5.4**: Use the pipeline in the dogfooding harness
  - Description: If AP1 made the plugin public, update `.rulesync/skills/build-terreno-app/SKILL.md` to install and use the pipeline during the dogfooding run — it is exactly the kind of public tooling that harness is meant to exercise, and the run will find portability problems that Task 2.5 missed. Add the plugin to the skill's list of permitted public sources, and add a friction-log section for pipeline-specific gaps. Regenerate mirrors.
  - Files: `.rulesync/skills/build-terreno-app/SKILL.md`, generated mirrors
  - Depends on: Task 5.3
  - Acceptance: the harness installs and uses the pipeline; the plugin is listed among permitted sources; the friction log has a pipeline section; `bun run rules:check` exits 0.

## Phase 6: Distribution

- [ ] **Task 6.1**: Verify a fresh install
  - Description: From a clean agent environment with no plugin cache, install the plugin per `plugins/README.md` and confirm all five stages are available and invocable. Record what the install experience actually looks like, including whether the stages appear as slash commands and whether the sibling-skill handoff from Task 2.1 resolves from the cache rather than the workspace.
  - Files: `plugins/README.md` (corrections)
  - Depends on: Task 4.1, Task 1.4
  - Acceptance: a fresh install exposes all five stages; the handoff resolves from the plugin cache; every install-guide inaccuracy is fixed.

- [ ] **Task 6.2**: Generate non-Cursor variants
  - Description: Per IP question AP6, make the pipeline available outside Cursor by routing it through `.rulesync/`, which already generates skills for cursor, claude, devin, copilot, and agents targets. Decide whether the plugin skills become rulesync sources (generated into the plugin directory) or whether a parallel rulesync copy is maintained — prefer one source of truth. Document which runtimes are supported and any behavioral differences (notably that the `disable-model-invocation` and slash-command behavior is Cursor-specific).
  - Files: `.rulesync/skills/` or the plugin skills, `plugins/README.md`, `docs/reference/sdlc-plugin.md`, generated mirrors
  - Depends on: Task 6.1
  - Acceptance: the pipeline is invocable in at least one non-Cursor runtime; there is a single source of truth per skill, not two divergent copies; runtime differences are documented; `bun run rules:check` exits 0.

- [ ] **Task 6.3**: Extend license coverage to `plugins/`
  - Description: Update `scripts/check-license-coverage.ts` (from [`oss-governance-baseline`](../implementationPlans/oss-governance-baseline.md)) so `plugins/terreno-planning/` is covered by the license check. Confirm the plugin ships a LICENSE and that its declared license matches the root license.
  - Files: `scripts/check-license-coverage.ts`
  - Depends on: Task 1.4, `oss-governance-baseline` Task 1.6
  - Acceptance: `bun run check:licenses` covers the plugin; deleting `plugins/terreno-planning/LICENSE` makes it fail and name the plugin.
