# Planning plugins

Terreno ships its agentic workflows as **two host plugins**. They divide along one line:
the lifecycle plugin knows *how to build one approved thing correctly*, and the scan
plugin knows *what is worth building next and whether it worked*.

```text
terreno-scan                            terreno (lifecycle)
------------                            -------------------
Aim     charter a measurable goal
Sweep   shard + map the repository
Sift    reduce to verified findings
Plot    slice findings into briefs ───►  Grow    shape IP + tasks
                                         Pick ⇄ Roast  build and prove
                                         Brew    submit the PR
                                         Taste   react to CI and review
Track   re-measure, close findings  ◄───  (merged)
```

A scan never edits product code. The lifecycle never decides what the repository should
become. Every slice crosses that boundary exactly once, as an approved IP and task list.

## terreno (lifecycle plugin)

Five bounded transitions plus three outer loops. Canonical source:
`plugins/terreno-planning/`; Claude Code consumes the generated `plugins/terreno-claude/`.

| Stage | Owns | PASS next |
| --- | --- | --- |
| Grow | Research, grilling, approved IP and dependency-aware task list, criterion → verification map | Pick |
| Pick | Implement one task, then Roast it, then take the next until the list is done | Roast, or Brew when done |
| Roast | Independently prove the current task against its criteria | Pick if tasks remain, else Brew |
| Brew | Final checks, commit, push, PR, evidence, CI trigger, wait for review bots | Taste |
| Taste | One reaction to the current head: bots, CI on every host, conflicts, comments | null or fresh Taste |

| Outer loop | Walks |
| --- | --- |
| `pick-roast-loop` | An approved plan through every Pick/Roast retry, one ledger, stop only at completion or a genuine human gate |
| `planning-loop` | Grow/Pick/Brew/Taste, restrictable with `phases=` |
| `taste-sweep` | Every open PR of yours that is conflicting or failing, until each is mergeable |

Full contract: [lifecycle plugin reference](../reference/lifecycle-plugin.md) and
[loop engineering](loop-engineering.md).

## terreno-scan (scan plugin)

Five bounded transitions plus two outer loops. Canonical source: `plugins/terreno-scan/`;
Claude Code consumes the generated `plugins/terreno-scan-claude/`. It depends on the
lifecycle plugin — Plot hands every slice to Grow.

| Stage | Owns | PASS next |
| --- | --- | --- |
| Aim | Charter: metric with a command, measured baseline, dry-run detection rules, exclusions, validity rule, severity rubric, slice policy, review routing, budget | Sweep |
| Sweep | Run the rules, shard hits deterministically, map fresh workers into candidate findings | Sift |
| Sift | Dedupe, adversarially verify, drop what does not reproduce, rank, write the findings report | Plot, or Track when dry |
| Plot | Slice findings into PR-sized units with standalone Grow briefs | Track, handing off to Grow |
| Track | Re-measure the metric, close or reopen findings with evidence, record the round, choose the next move | Plot, Sweep, or null |

| Outer loop | Walks |
| --- | --- |
| `campaign` | Bounded rounds: Aim → Sweep → Sift → Plot → lifecycle → Track. Stops at every gate. |
| `loop` | Resident session: the same rounds, plus a heartbeat over open campaign PRs — route, answer review through Taste, fix red CI, Track merges — refilling work up to `wipLimit`. |

Full contract: [scan plugin reference](../reference/scan-plugin.md).

## Which one to invoke

| Situation | Start with |
| --- | --- |
| You know what to build | `1-grow` |
| You have an approved plan and want it built | `pick-roast-loop` |
| A PR of yours is red or conflicting | `5-taste`, or `taste-sweep` for all of them |
| You know the outcome you want, not the work | `scan 1-aim` |
| You want that outcome pursued unattended | `scan loop` |

## What each plugin persists

| Artifact | Owner | Committed |
| --- | --- | --- |
| IP and task list | Grow | yes |
| Execution state (`.terreno/pipeline/<slug>.json`) | Lifecycle outer loops | no |
| Charter (`docs/scans/<goal>/charter.md`) | Aim | yes |
| Findings report (`docs/scans/<goal>/round-<n>-findings.md`) | Sift | yes |
| Campaign state (`.terreno/scan/<goal>.json`) | Scan outer loops | no |

Both plugins emit the same shaped result — `v: 2`, `status` of `PASS` / `FAIL` /
`BLOCKED` / `PENDING`, a `next`, and a concrete `action` — in a collapsed details block,
with `status` / `next` / `action` as the visible lines. Neither persists
chain-of-thought.

## Why the split

Three properties fall out of keeping discovery and delivery in separate plugins:

- **A finding must earn its slice.** Sift drops anything that cannot be tied to the
  goal metric, so the lifecycle only ever receives work with a stated payoff.
- **Delivery rules stay in one place.** Review response, CI waiting, the pre-push gate,
  and documentation obligations live in the lifecycle, so a scan cannot invent a
  shortcut around them.
- **Progress is measured, not asserted.** Track re-runs the metric command after the
  work merges, so "we improved it" is always a number with its command output.

## Hosts

| Host | Lifecycle | Scan |
| --- | --- | --- |
| Cursor | `terreno-planning`, `/terreno-1-grow` | `terreno-scan`, `/terreno-scan-1-aim` |
| Codex | `terreno-planning`, `$terreno-1-grow` | `terreno-scan`, `$terreno-scan-1-aim` |
| Claude Code | `terreno`, `/terreno:1-grow` | `terreno-scan`, `/terreno-scan:1-aim` |

Install both from the marketplaces described in
[install agent skills](../how-to/install-agent-skills.md). Claude Code resolves a plugin
skill's command from its frontmatter `name`, which is why the two `*-claude/` trees are
generated with shortened names by `bun run skills:sync`.
