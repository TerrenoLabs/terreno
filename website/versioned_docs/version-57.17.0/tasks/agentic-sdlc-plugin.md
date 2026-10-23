# Task List: Loop-Engineering Lifecycle Plugin

See: [`docs/implementationPlans/agentic-sdlc-plugin.md`](../implementationPlans/agentic-sdlc-plugin.md)

## Phase 1: Audit and contracts

- [x] **Task 1.1**: Audit five lifecycle skills, metadata, references, repo skills, state conventions, sync tooling, and long-lived-context assumptions
  - Blocked by: none
  - Acceptance: Findings identify duplicated repository knowledge, missing handoffs, generated sources, and orchestration owned by stages.
- [x] **Task 1.2**: Define shared stage result and execution-state schemas
  - Blocked by: Task 1.1
  - Acceptance: Stable schemas use only `PASS`/`FAIL`/`BLOCKED`/`PENDING`, preserve evidence/attempts, and contain no reasoning transcript.
- [x] **Task 1.3**: Document loop ownership, retries, human gates, state transport, and supporting-skill discovery
  - Blocked by: Task 1.2
  - Acceptance: A fresh invocation packet and fallback execution-state location are explicit.

## Phase 2: Bounded lifecycle stages

- [x] **Task 2.1**: Refactor Grow as an approved-artifact transition
  - Blocked by: Task 1.3
  - Acceptance: Grow classifies uncertainty, researches facts, grills decisions, maps acceptance to verification, and emits Pick-ready state.
- [x] **Task 2.2**: Refactor Pick as one-slice TDD implementation
  - Blocked by: Task 1.3
  - Acceptance: Pick consumes retry evidence, preserves verified behavior, runs independent implementation/test-quality review, and delegates repository detail.
- [x] **Task 2.3**: Refactor Roast as independent authoritative verification
  - Blocked by: Task 2.2
  - Acceptance: Roast executes a requirement/evidence matrix, does not trust Pick claims, and returns exact failures to Pick.
- [x] **Task 2.4**: Refactor Brew to terminate after PR setup
  - Blocked by: Task 2.3
  - Acceptance: Brew records PR/current head and recommends Taste without executing or waiting for it.
- [x] **Task 2.5**: Refactor Taste as one reactive iteration
  - Blocked by: Task 2.4
  - Acceptance: Taste observes current head once, handles current actionable work, emits state, exits, and contains no internal waiting loop.

## Phase 3: Plugin boundary and composition

- [x] **Task 3.1**: Remove Terreno package commands/patterns from lifecycle control surfaces
  - Blocked by: Task 2.5
  - Acceptance: Exact repo knowledge remains under `.rulesync/skills/`; lifecycle stages discover applicable skills.
- [x] **Task 3.2**: Convert plugin utility/orchestration skills to shared references
  - Blocked by: Task 2.5
  - Acceptance: Plugin exposes exactly five lifecycle skill directories; independent review and feature-loop behavior remain documented once.
- [x] **Task 3.3**: Document backend, UI, and multi-invocation CI/review compositions
  - Blocked by: Task 3.2
  - Acceptance: Each scenario shows lifecycle + project skills + durable evidence.

## Phase 4: Validation and documentation

- [x] **Task 4.1**: Add lifecycle architecture validator and unit tests
  - Blocked by: Task 3.2
  - Acceptance: Validator enforces names/directories, required contracts, status/transition values, portability, Brew/Taste boundaries, and migration docs.
- [x] **Task 4.2**: Update plugin/docs/metadata/changelog and regenerate integrations
  - Blocked by: Task 4.1
  - Acceptance: Plugin is `2.0.0`; docs describe the bounded loop; generated rules are current; retired names appear only in intentional migration/history.
- [x] **Task 4.3**: Run static tests, rulesync validation, lint/type checks, and independent review
  - Blocked by: Task 4.2
  - Acceptance: All checks pass and no material standards/spec findings remain.
