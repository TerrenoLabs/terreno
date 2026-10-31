# Task List: Dogfooding Run and Launch Blog Post

See: [`docs/implementationPlans/build-terreno-app-validation.md`](../implementationPlans/build-terreno-app-validation.md)

**RTK deprecation flag:** **Blocked.** The run must target syncdb + Better Auth. Do not start until PR #869 has merged and [`rtk-to-syncdb-migration-docs`](rtk-to-syncdb-migration-docs.md), [`docs-reference-coverage`](docs-reference-coverage.md), and [`docs-tutorials-ai-first`](docs-tutorials-ai-first.md) are complete — the run tests those documents, so running earlier tests nothing.

## Instructions for the implementing agent

- **The public-sources-only rule is the experiment.** Read the [`build-terreno-app`](../../.rulesync/skills/build-terreno-app/SKILL.md) skill and follow its restrictions exactly. Reading `.rulesync/`, `docs/implementationPlans/`, or Terreno source to unblock yourself invalidates the run. If you do it accidentally, say so in the friction log — a disclosed contamination is recoverable, a hidden one is not.
- Work outside the Terreno monorepo. Fresh directory, fresh environment.
- Log friction as it happens, with timestamps. Do not reconstruct the log at the end.
- Do not fix Terreno during a run. Record the gap, work around it, keep going. Fixes happen between runs, in the owning IPs.
- Never claim a step succeeded without evidence.

## Phase 1: Run 1

- [ ] **Task 1.1**: Confirm the concept and prerequisites
  - Description: Confirm which app concept to build (IP question B1 — **Pantry**). Record the environment: OS, Bun version, editor and agent model with version (required per IP question B6), installed Terreno version, and the resolved stack mode. Confirm the stack mode is syncdb + Better Auth; if it is not, stop — the run is premature.
  - Files: `FRICTION_LOG.md` in the working directory (outside this repo)
  - Depends on: PR #869 merged; the three prerequisite IPs complete
  - Acceptance: the log header is complete including the agent model and version; the stack mode is confirmed as syncdb + Better Auth; the working directory is outside the Terreno monorepo.

- [ ] **Task 1.2**: Execute run 1
  - Description: Run the `build-terreno-app` skill through all seven of its phases: learn the framework as a newcomer, scaffold, build the slices in the concept's order, exercise the six differentiators, use the AI debug loop on a deliberate bug, deploy, and report. Log every gap with severity, phase, what was missing, the workaround, and a suggested fix. Capture the required artifacts as you go rather than at the end.
  - Files: `FRICTION_LOG.md`, the demo app source, artifacts in `/opt/cursor/artifacts/`
  - Depends on: Task 1.1
  - Acceptance: all seven skill phases attempted; every gap logged with all five fields; the artifact checklist from the blog outline is complete or each missing item has a logged reason.

- [ ] **Task 1.3**: Record the debug-loop measurement
  - Description: The deliberate bug in skill phase 5 is the most important single measurement in this IP. Record: the bug introduced, the symptom observed, which tools were called in what order, the elapsed time from symptom to fix, and — critically — whether framework source had to be read or print statements added. Quote the `last_error` output verbatim.
  - Files: `FRICTION_LOG.md`
  - Depends on: Task 1.2
  - Acceptance: elapsed time recorded; the tool call sequence recorded; the source-reading question answered explicitly yes or no; `last_error` output quoted verbatim.

## Phase 2: Triage

- [ ] **Task 2.1**: Classify and route every gap
  - Description: For each gap in the run 1 log, assign a severity (blocking / major / minor) and route it to the owning IP using the routing table in the IP. Produce a triage table: gap, severity, owning IP, proposed issue title, proposed labels. Flag any gap that does not fit an existing IP — it may indicate a missing IP.
  - Files: `FRICTION_LOG.md`, a triage section in the run report
  - Depends on: Task 1.3
  - Acceptance: every gap has a severity and an owning IP or is flagged as unrouted; the routing matches the IP's table; unrouted gaps are called out with a recommendation.

- [ ] **Task 2.2**: Prepare the issue set
  - Description: Write ready-to-file issue bodies for every blocking and major gap, following the repo's issue-form fields from [`oss-governance-baseline`](../implementationPlans/oss-governance-baseline.md). Each must be understandable by someone who did not do the run: the expected behavior, what actually happened, the exact step in the exact document, and the suggested fix. Do not file them unless explicitly asked — list them for a maintainer.
  - Files: a section in the run report
  - Depends on: Task 2.1
  - Acceptance: one issue body per blocking and major gap; each names the specific document and step; each is comprehensible without the friction log.

- [ ] **Task 2.3**: Update the owning IPs' task lists
  - Description: For each routed gap, add a task to the owning IP's task file in `docs/tasks/` describing the fix, referencing the run's finding. This is the only writing this IP does inside the Terreno repo during the fix cycle — the fixes themselves belong to the owning IPs.
  - Files: `docs/tasks/*.md` for the owning IPs
  - Depends on: Task 2.2
  - Acceptance: every blocking and major gap has a corresponding task in an owning IP's task file; each new task cites the run finding.

## Phase 3: Fix cycle

- [ ] **Task 3.1**: Track fix completion
  - Description: Wait for the owning IPs to land the fixes. Maintain a tracking table in the run report: gap, owning IP, fix status, PR link. Do not perform the fixes here — doing so scatters ownership and means the fix is not covered by the owning IP's acceptance criteria.
  - Files: the run report
  - Depends on: Task 2.3
  - Acceptance: every blocking and major gap shows a landed fix with a PR link, or an explicit decision to accept it with reasoning.

## Phase 4: Run 2

- [ ] **Task 4.1**: Execute run 2 in a fresh environment
  - Description: Repeat Task 1.2 in a genuinely fresh session and environment — no cached dependencies, no carried-over context, ideally a different agent session with no memory of run 1. Build the same concept so the runs are comparable. Produce a second independent friction log.
  - Files: `FRICTION_LOG_2.md`, the demo app source, artifacts
  - Depends on: Task 3.1
  - Acceptance: run 2 was performed in a fresh environment with no carried context; the same concept was built; a second complete friction log exists.

- [ ] **Task 4.2**: Repeat-gap analysis
  - Description: Compare both logs. Produce three lists: gaps fixed (present in run 1, absent in run 2), gaps that survived (present in both — for each, explain why the fix did not work), and new gaps (only in run 2, which often means a fix introduced a problem). Report the total counts by severity for each run.
  - Files: a comparison section in the run report
  - Depends on: Task 4.1
  - Acceptance: all three lists produced; every surviving gap has an explanation; severity counts for both runs are stated.

- [ ] **Task 4.3**: Evaluate the launch gate
  - Description: Check run 2 against the pass thresholds in the IP: zero blocking gaps, zero major gaps, every concept slice working on web and one native target, all six differentiators with artifacts, deployment with all four checks passing, and the debug loop completed without reading framework source. State pass or fail per gate. If any gate fails, return to Phase 3 — do not proceed to the blog post.
  - Files: the run report
  - Depends on: Task 4.2
  - Acceptance: every gate has an explicit pass or fail with evidence; a failure sends the work back to Phase 3 rather than proceeding.

## Phase 5: Blog post

- [ ] **Task 5.1**: Draft the post
  - Description: Write `BLOG_DRAFT.md` following the nine-section outline in the skill's blog reference. Use real elapsed times, real code from the built app, and real artifacts. The "what did not work" section takes the three most instructive gaps from the logs — pick genuinely instructive ones, not three trivial gaps chosen to look candid. Name the agent model and version. Include the debug-loop measurement from Task 1.3 (and its run 2 equivalent) as a concrete number.
  - Files: `BLOG_DRAFT.md`
  - Depends on: Task 4.3
  - Acceptance: all nine sections present; 1,800–2,500 words; every superlative quantified; three real gaps in the "what did not work" section with their fixes and PR links; the model and version named.

- [ ] **Task 5.2**: Artifact and fact review
  - Description: Have someone who did not perform the run verify every claim in the draft against an artifact. Produce a checklist: claim, backing artifact, verified yes/no. Remove or correct any claim without backing. Also verify no claim describes an unshipped feature by checking each against the public docs.
  - Files: `BLOG_DRAFT.md`, a review checklist
  - Depends on: Task 5.1
  - Acceptance: every claim has a verified backing artifact; the reviewer is not the person who did the build; no claim references an unshipped feature.

- [ ] **Task 5.3**: Publish the demo app repository
  - Description: Per IP question B2, publish the demo app to its own repository with a README stating what it is, which Terreno version it was built against, that it is a blog-post artifact rather than a maintained example, and a link to the post. Include the app's own setup instructions so a reader can run it. Do not add it to the Terreno monorepo.
  - Files: a new repository (outside this repo)
  - Depends on: Task 5.2
  - Acceptance: the repository is public with a complete README; the app runs from a fresh clone following its README; the unmaintained status is stated; it is not added to the monorepo.

- [ ] **Task 5.4**: Publish the dogfooding results
  - Description: Create `docs/explanation/dogfooding-results.md` in the Terreno repo summarizing both runs publicly: what was tested, gap counts by severity per run, what changed between them, and what remains known-imperfect. This is the durable, honest artifact — the blog post is marketing that happens to be true, this is the engineering record. Link it from `CONTRIBUTING.md` as evidence of how the project evaluates its own developer experience.
  - Files: `docs/explanation/dogfooding-results.md` (new), `docs/explanation/README.md`, `CONTRIBUTING.md`
  - Depends on: Task 4.2
  - Acceptance: both runs' counts published; remaining known gaps listed rather than omitted; linked from the explanation index and `CONTRIBUTING.md`.

## Phase 6: Retrospective

- [ ] **Task 6.1**: Improve the harness
  - Description: Record what the `build-terreno-app` skill itself got wrong: steps that were ambiguous, phases that were mis-scoped, artifacts that turned out not to be worth capturing, and measurements that should have been taken but were not. Update the skill and its references, then regenerate mirrors with `bun run rules`.
  - Files: `.rulesync/skills/build-terreno-app/SKILL.md`, `.rulesync/skills/build-terreno-app/references/*`, generated mirrors
  - Depends on: Task 4.2
  - Acceptance: at least three concrete skill improvements landed from real experience; `bun run rules:check` exits 0.

- [ ] **Task 6.2**: Recommend a cadence
  - Description: Based on the actual effort of both runs, recommend how often this should be repeated and what triggers an unscheduled run (a major version, a data-layer change, a docs restructure). Add the recommendation to `docs/explanation/dogfooding-results.md`. Do not create a recurring commitment the team cannot keep — an abandoned cadence is worse than no cadence.
  - Files: `docs/explanation/dogfooding-results.md`
  - Depends on: Task 6.1
  - Acceptance: the recommendation states an interval and the unscheduled triggers, and is justified by the measured effort of the two runs.
