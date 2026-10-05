---
name: prd
description: Interview the app owner and write a full product requirements document (problem, why now, solution, user stories, measurable success metrics, constraints, rollout, out of scope), then publish it where the repository tracks work. Sized for one owner and one or two developers. Runs ahead of Grow; explicit invocation only.
disable-model-invocation: true
---

# PRD — seed

Interview the person who owns the app, then write a full product PRD that Grow can shape
into an implementation plan without re-asking product questions.

Assume a small team: one owner who is also PM, designer, and final approver, plus one or
two developers. Skip ceremony a team that size does not need (stakeholder sign-off, RACI,
persona decks). Keep what it does need: a clear problem, measurable success, and the
constraints a developer would otherwise discover mid-build.

Adapted from [to-spec](https://github.com/mattpocock/skills/blob/main/skills/engineering/to-spec/SKILL.md)
(MIT, © Matt Pocock), keeping only the product half. The interview and the success-metric
rule are adapted from the [awesome-copilot prd skill](https://github.com/github/awesome-copilot/blob/main/skills/prd/SKILL.md)
(MIT). Implementation decisions, test seams, and testing decisions belong to Grow.

## Process

1. **Gather before asking.** Read the conversation, any linked prototype, demo, mock, or
   ticket, and enough of the repository to know how the product behaves today in the
   affected area. Use the project's domain vocabulary. Never ask what you can look up.
   If a prototype exists, it is the source for the solution; link it instead of
   re-describing it.
2. **Interview.** Follow Grow's [grilling procedure](../1-grow/references/grilling.md)
   for the mechanics: frontier rounds, selectable options with a recommended default, the
   structured question tool when the harness has one, get to the bottom of every vague
   answer, and confirm shared understanding before writing. Use the product tree below
   instead of Grow's design tree. Ask at least one round even when the conversation looks
   complete; confirm what you inferred instead of assuming it.
3. **Write the PRD** with the template below, from the user's perspective. No file paths,
   modules, schemas, or code.
4. **Apply the success-metric rule.** Every success metric and guardrail is concrete and
   measurable: a quantity, a threshold, and how it is measured. Replace adjectives
   ("fast", "easy", "intuitive", "better") with numbers. If the owner cannot set a target
   after you pressed once, write `TBD` and name what decides it. Never invent a number.
5. **Publish.** Follow the repository's existing tracking convention (issue tracker,
   planning directory, or spec folder). If none exists, open an issue in the repository's
   tracker. Do not apply readiness labels; Grow owns approval.
6. **Hand off.** Return the PRD link and any `TBD` items. Recommend Grow with the PRD as
   its input.

## Product tree

Work the frontier in this order of parents. Children unlock when the parent is
executable.

| Branch | Settle before writing |
| --- | --- |
| **Problem** | Who hits it, how often, what they do today instead, and what it costs them |
| **Why now** | What makes this worth doing before the rest of the backlog, and what it pushes back |
| **Solution** | The user-visible behavior and main flows; which prototype, if any, is the reference |
| **Success** | Metrics with targets, how and when they are measured, and guardrails that would make you turn it off |
| **Constraints** | Data, privacy, safety, performance, cost (including AI model cost), platforms, and the people who must learn the change |
| **Rollout** | Behind a flag or experiment, or straight to everyone; who to tell or train; whether a developer must review it or agent review is enough |
| **Scope** | What is explicitly out, and what is deferred to a later version |

Push hardest on **Success**. "Users like it" is not done. Ask what number would make the
owner call it a win, what number would make them roll it back, and where the number comes
from.

<prd-template>

## Problem Statement

The problem the user faces, from the user's perspective: who, how often, today's
workaround, and its cost.

## Why Now

Why this beats the rest of the backlog, and what it displaces.

## Solution

The solution, from the user's perspective: the behavior and the main flows. Link the
reference prototype or demo when one exists.

## User Stories

A LONG, numbered list of user stories. Each story uses the format:

1. As an <actor>, I want a <feature>, so that <benefit>

<user-story-example>
1. As a mobile bank customer, I want to see balance on my accounts, so that I can make better informed decisions about my spending
</user-story-example>

The list is extensive and covers every aspect of the feature, including edge cases and
error states.

## Success Metrics

A numbered list. Each metric states what is measured, the target, how it is measured, and
when it is evaluated.

<success-metric-example>
1. Search returns results within 200 ms at p95 for a 10k-record dataset, measured by the load test before launch.
2. At least 85% of new users finish onboarding within 3 minutes, measured by the analytics funnel 30 days after launch.
3. Weekly active editors: TBD — owner sets the target after two weeks of baseline data.
</success-metric-example>

**Guardrails.** Measurable thresholds that mean turn it off or roll it back.

<guardrail-example>
1. Support tickets about checkout rise above 5 per week, measured in the help desk.
</guardrail-example>

## Constraints

Limits the solution must respect: data and privacy, safety, performance, cost, platforms,
and the change load on the people who use it.

## Rollout

Flag or experiment versus full launch, who must be told or trained, and the review level:
developer review required, or low-risk enough for agent review.

## Out of Scope

What this PRD does not cover, and what is deferred to a later version.

</prd-template>

## Success conditions

- The owner confirmed shared understanding before the PRD was written.
- The PRD has every template section and no implementation detail.
- Every success metric and guardrail is measurable or `TBD` with its decider.
- The PRD is published and its link is returned.

## Blocked conditions

- The owner cannot state the problem or who has it. Stop after that round; do not write a
  PRD around a guessed problem.
