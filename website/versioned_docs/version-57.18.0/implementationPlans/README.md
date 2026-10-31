# Implementation Plans

Forward-looking design docs for significant features and architectural changes to
Terreno packages, written **before implementation**.

An implementation plan (IP) is one half of a two-file pair:

| File | Holds | Path |
| ---- | ----- | ---- |
| **IP** | Design goals, architecture, models/APIs, testing decisions, phases, acceptance criteria | `docs/implementationPlans/<slug>.md` |
| **Task list** | The bot-consumable execution checklist for that IP | `docs/tasks/<slug>.md` |

The IP is the source of truth for *what and why*; the task list is the source of truth
for *the concrete steps*. External trackers (a GitHub roadmap issue, a Linear issue, a
discussion thread) link **to** these files — they never replace them. See
[`docs/tasks/README.md`](../tasks/README.md) for the task-file shape.

## Status lives on each IP

There is no shared `PLAN_INDEX.md`. That file caused merge conflicts the same way a
shared changelog Unreleased section did. Status is the `**Status:**` line in each
`docs/implementationPlans/<slug>.md` (and in `archive/` after close). List those
directories to see what exists; this README explains the process.

## When to write an IP

Substantial work is planned before coding. Quick rule (full table in
[CONTRIBUTING.md](../../CONTRIBUTING.md#when-to-write-an-implementation-plan-ip)):

| Needs an IP | Does not need an IP |
| ----------- | ------------------- |
| New published package | Bug fix in one package |
| New public API surface | Documentation-only change |
| Cross-package architectural change | Small internal refactor |
| Breaking change | Test or CI fix |

## How a plan gets written and built

The [`terreno-planning` plugin](../../plugins/README.md) drives the pipeline.

**Grow** interviews in grilling rounds (one frontier of decisions per message, recommended
answers, then wait). It stays on a question until the answer is executable. After the user
confirms shared understanding it writes the two files and ends with a **standalone
approval brief**: an orientation paragraph on where the repository is and where the change
takes it, optional background on current state, the idea, then the plan (tasks, tracer,
verification, risks). When grilling produced human decisions, a Decisions table with no
row cap follows the plan, pairing each settled choice with the question that prompted it.
If there were none, that table is omitted. The brief must stand on its own — a reviewer
should not need the IP, the ticket, or the interview history to approve it.

For a small feature, the plugin's **feature profile** uses a compact approved task
contract: invoke Pick once; it implements one frontier task, roasts it, then picks the
next until the list is done, then Brew and bounded Taste iterations.

1. **Grow** (`terreno-1-grow`) — grill until answers are executable, then write the IP + tracer-bullet task list; end with the standalone approval brief (summary, background, idea, plan) and a full Decisions table when any exist.
2. **Pick** (`terreno-2-pick`) — implement one approved slice via TDD, then continue the pick-roast inner loop.
3. **Roast** (`terreno-3-roast`) — independently verify the current task, then return (`next: pick` or `next: brew`).
4. **Brew** (`terreno-4-brew`) — commit, push, open the PR after every in-scope task has Roast `PASS`.
5. **Taste** (`terreno-5-taste`) — react once to current CI, mergeability, and review state.

The outer loop owns Grow/Brew/Taste selection, execution-state persistence, waiting,
retries, and human/external escalation. Pick owns the inner task loop. Roast never
invokes Pick. Each stage emits the compact machine-readable result described
in [`plugins/terreno-planning/references/lifecycle-contract.md`](../../plugins/terreno-planning/references/lifecycle-contract.md)
(collapsed behind a Details toggle in chat and on the PR).

You can also author an IP directly with the `ip` skill; both produce the same two files.

### Roadmap handoff (roadmap-enabled repos only)

In repos that run a public roadmap (Discussions + a roadmap Project — currently Terreno),
Grow hands off to `roadmap-item` once the IP is **Approved** to create or update the
public tracking issue, and the IP header records the `Discussion:` and `Roadmap issue:`
links. See [`docs/explanation/roadmap-process.md`](../explanation/roadmap-process.md) for
the full IP ↔ roadmap lifecycle.

In repos with **no** roadmap board (Flourish, most consumer apps), the pipeline is
identical minus that handoff: the IP + task list are the source of truth, and Linear
tracks execution via the IP header `Linear:` link.

## Lifecycle

1. **Draft** → **Approved** — IP written and reviewed (status lives in the IP header).
2. **In progress** → **Complete** — implemented, verified, merged.
3. **Archive** — completed IPs move to `docs/implementationPlans/archive/`.

Plans that are fully implemented and now describe shipped architecture should be migrated
to `docs/explanation/` as reference documentation.
