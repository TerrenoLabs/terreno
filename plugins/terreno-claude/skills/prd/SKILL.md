---
name: prd
description: Turn the current conversation into a product requirements document (problem, solution, user stories, measurable success metrics, out of scope) and publish it where the repository tracks work. Synthesis only, no interview. Runs ahead of Grow; explicit invocation only.
disable-model-invocation: true
---

# PRD — seed

Turn what the conversation already established into a product-only PRD that Grow can
shape into an implementation plan. Do not interview the user; synthesize what you know.

Adapted from [to-spec](https://github.com/mattpocock/skills/blob/main/skills/engineering/to-spec/SKILL.md)
(MIT, © Matt Pocock), keeping only the product half. The success-metric rule is adapted
from the [awesome-copilot prd skill](https://github.com/github/awesome-copilot/blob/main/skills/prd/SKILL.md)
(MIT). Implementation decisions, test seams, and testing decisions belong to Grow, not here.

## Process

1. **Read the domain.** Explore the repository enough to understand the current product
   behavior in the affected area. Use the project's domain vocabulary throughout. Do not
   read implementation detail you will not cite.
2. **Write the PRD** with the template below. Describe everything from the user's
   perspective. No file paths, modules, schemas, or code.
3. **Apply the success-metric rule.** Every success metric is concrete and measurable: a
   quantity, a threshold, and how it is measured. Replace adjectives ("fast", "easy",
   "intuitive", "better") with numbers. When the conversation did not settle a target,
   write `TBD` and name what decides it. Never invent a number. Grow treats each metric as
   an acceptance criterion and each `TBD` as a human decision to grill.
4. **Publish.** Follow the repository's existing tracking convention (issue tracker,
   planning directory, or spec folder). If none exists, open an issue in the repository's
   tracker. Do not apply readiness labels; Grow owns approval.
5. **Hand off.** Return the PRD link and the list of `TBD` metrics. Recommend Grow with the
   PRD as its input.

<prd-template>

## Problem Statement

The problem the user faces, from the user's perspective.

## Solution

The solution to the problem, from the user's perspective.

## User Stories

A LONG, numbered list of user stories. Each story uses the format:

1. As an <actor>, I want a <feature>, so that <benefit>

<user-story-example>
1. As a mobile bank customer, I want to see balance on my accounts, so that I can make better informed decisions about my spending
</user-story-example>

The list is extensive and covers every aspect of the feature.

## Success Metrics

A numbered list. Each metric states what is measured, the target, and how it is measured.

<success-metric-example>
1. Search returns results within 200 ms at p95 for a 10k-record dataset, measured by the load test.
2. At least 85% of new users finish onboarding within 3 minutes, measured by product analytics funnel.
3. Weekly active editors: TBD — product owner sets the target after the baseline is measured.
</success-metric-example>

## Out of Scope

What this PRD does not cover.

</prd-template>

## Success conditions

- The PRD has all five sections and no implementation detail.
- Every success metric is measurable or explicitly `TBD` with its decider.
- The PRD is published and its link is returned.

## Failure conditions

- The conversation holds too little to state the problem. Say what is missing in one
  line; do not interview.
