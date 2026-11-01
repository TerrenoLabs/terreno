# Charter template

One file per goal. Keep it readable by someone who was not in the grilling conversation.

```markdown
# Scan charter — <goal statement>

- Slug: <goal-slug>
- Status: draft | approved (<date>)
- Owner: <human>

## Goal

<One paragraph: where the repository is today, where this campaign takes it, and why now.>

## Metric

| Field | Value |
| --- | --- |
| Name | <what is measured> |
| Command | `<command that prints the number>` |
| Unit | s / ms / count / percent / bytes |
| Direction | down / up |
| Protocol | <cold vs warm, best of three, machine class> |
| Baseline | <value> (measured <date>) |
| Target | <value> |
| Horizon | <rounds or date> |

Baseline evidence:

```text
<quoted command output>
```

## Scope

- In scope: <packages, directories, layers>
- Out of scope: <areas the campaign must not touch>
- Unacceptable trade-offs: <for example, no public API breaks, no new dependencies>

## Detection rules

| Rule | Query | Matches | Why it moves the metric | Hits |
| --- | --- | --- | --- | --- |
| <slug> | `<command>` | <one sentence> | <one sentence> | <n> |

## Exclusions

<Globs never reported on, beyond the defaults in the map-reduce reference.>

## Validity rule

A finding is valid only when <one sentence>.

## Severity rubric

| Severity | Threshold |
| --- | --- |
| high | <concrete threshold> |
| medium | <concrete threshold> |
| low | <concrete threshold> |

Effort: S = under an hour, M = under a day, L = more than a day or needs design.

## Slice policy

- Maximum <n> files and <n> findings per slice
- Never mix: <combinations that make review unsafe>
- Always its own slice: <risky or reviewer-heavy categories>

## Review routing

| Field | Value |
| --- | --- |
| Mode | fixed / codeowners / blame / round-robin / none |
| Reviewers | <@handle, @handle> |
| Assignee | <@handle> |
| Teams | <org/team> |
| Draft | yes / no |
| Labels | <goal-slug, ...> |
| Merge policy | human / agent-after-approval (<conditions>) |
| Notify | PR body mention / none / <channel> |

## Budget

- Rounds: <n>
- Slices per round: <n>
- Open PRs at once (`wipLimit`): <n>
- Minimum metric step per round before reporting diminishing returns: <value>

## Decisions

| Decision | Question that prompted it |
| --- | --- |
| <settled decision> | <the exact question asked> |
```
