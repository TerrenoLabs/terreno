# Grilling — interactive design interview

Use this during Grow instead of dumping every unknown in one list.

Goal: shared understanding with the user, then write. Do not write the IP, task list, or
code until the user confirms the last round left no open questions.

Adapted from [grilling](https://github.com/mattpocock/skills/blob/main/skills/productivity/grilling/SKILL.md).
Do not copy tracker setup from that skill. Follow the consuming repository's artifact and
tracking conventions.

## Map a design tree, not a questionnaire

Every request has a tree:

- **Root:** the destination (what exists when this is done)
- **Branches:** decisions that change the design
- **Leaves:** facts (how the repo already works)

Work in **rounds**. Each round asks only the current **frontier**: questions whose
prerequisites are already settled. Deeper questions wait until their parent is decided.

Example: do not ask "which tracker project?" before "do we track this externally?".
Do not ask "which test double?" before "which public seam is the tracer bullet?".

## Agent vs user

| Kind | Who | How |
| ---- | --- | ---- |
| **Fact** | Agent | Look it up. Spawn explore/generalPurpose sub-agents. Read the repo. |
| **Decision** | User | Ask. Never invent product, scope, or UX choices. |

Do not ask the user anything a sub-agent can answer from the repo, docs, or git history.
If a lookup fails, say what you searched and ask one targeted question.

## Get to the bottom

A reply is not done until Pick can execute it without guessing.

After each user message:

1. Record what was actually chosen, not the wording of the reply.
2. If the answer is vague, partial, "sure", "yes", "whatever you think", or only restates
   the question, stay on that decision. Ask the missing concrete: who, which API, which
   UX, which data owner, which compatibility promise, what is out of scope.
3. If two answers conflict, name the conflict and re-ask the parent before unlocking
   children.
4. If a recommendation had sub-choices and they accepted it without picking one, grill
   the sub-choices.
5. Unlock children only when the parent is executable.

Do not treat a recommended answer as accepted unless the user confirmed it. Do not write
from inferred agreement.

## Round loop

1. Research in parallel (sub-agents). Update the tree.
2. Compute the frontier (undecided questions whose parents are settled).
3. If the frontier is empty, state shared understanding in one short block and wait for
   confirmation. Then write.
4. If the frontier is not empty, ask **every frontier question in this round**, in one
   message. Number them. Recommend an answer for each. Then **stop and wait**.

Never ask only the first question when three are unblocked. Never proceed to the next
round from inferred answers. The user may answer a subset; unanswered items stay on the
frontier.

### Ask with selectable options, not typed replies

Every frontier round must be answerable by clicking, not by typing `Q1: xyz`.

If the harness has a structured question tool that renders selectable choices
(Cursor `AskQuestion`, Claude Code `AskUserQuestion`, or equivalent), use it for the whole
round instead of listing the questions in prose:

- One tool question per frontier decision; send the round in a single call.
- Cap a structured-tool round at **four** questions. Claude Code `AskUserQuestion` rejects
  calls with more than four, so the fifth frontier question waits for the next round
  instead of being appended. Do not split one round across two calls.
- Put the recommended option **first** and suffix its label with `(Recommended)`.
- Give every question 2–4 concrete, mutually exclusive options. Option labels are the
  actual choice ("Better Auth session cookie", "Existing JWT middleware"), never "Yes"/
  "Option A"/"Your call". The harness always offers a free-text escape, so do not add an
  "Other" option yourself.
- Set multi-select only when the decision genuinely accepts several answers at once.
- Keep the shaping context in the question prompt, one or two sentences, so the option
  labels stay short.
- Do not also repeat the same questions as numbered prose; the tool is the round.

Only when no such tool exists, fall back to the markdown shape below.

### Fallback message shape (no structured question tool)

Lead with one line: what this round is deciding.

Then for each frontier question:

```markdown
❓ **Q1** — **<short title>**: <context in one or two sentences>
Options (if they help): A / B / C
➡️ Recommend: <your answer, with one-line why>
---
```

Rules for the body:

- One decision per question.
- Recommend a default every time. The user can override in a word.
- Do not ask for facts you already looked up. Cite the finding in the question if it
  informs the decision.
- Cap the round at **five** questions. Park the rest as "later, after these".
- End the message. Do not write files, do not start Pick, do not summarize the whole
  plan yet. If this branch already has a PR with GitHub Deployments, the last visible
  section is Demo (see the PR deployments procedure).

Round caps, one decision per question: **four** with a structured question tool (the
Claude Code `AskUserQuestion` limit), **five** for the markdown fallback. Anything past the
cap stays on the frontier for the next round.

### After the user replies

1. Record answers on the tree.
2. Get to the bottom of each answered item before treating it as settled.
3. Unlock children. Drop questions the answers made irrelevant.
4. Research any new facts those answers created.
5. Next round, or confirm-and-write if the frontier is empty.

## Confirm-and-write

When the frontier is empty, send **only** this, then wait:

```markdown
Shared understanding:
- Destination: <one sentence>
- In: <comma-separated>
- Out: <comma-separated>
- Tracer: <collection / route / hook / CLI>
- Open risks: <none | one line>

Confirm and I will write the plan. Change any bullet if I have it wrong.
```

When the harness has a structured question tool, send that block and pair it with one
selectable question ("Confirm this understanding?") offering `Write the plan
(Recommended)` and `Change something` so confirmation is a click too.

If a PR on this branch has GitHub Deployments, print those Demo URLs after this block,
then wait. Do not write the IP until they confirm.

## Approval brief

After writing the IP and task list, post one **approval brief**. It is a standalone
document: a reviewer who never saw the grilling rounds, the ticket, or the repository
can read it top to bottom and approve or push back without opening another file.

Write it in this order. Orientation first, then the proposal, then the plan, then the
decisions that shaped them, then the pointers.

```markdown
# <Change title>

<Orientation paragraph. Three to five sentences covering where the repository is today,
where this change takes it, and why that is worth doing now. Name the user or operator
who feels the difference. No file paths, no task IDs, no lifecycle jargon.>

## Background

<Current state a reviewer needs before the proposal makes sense: how the affected area
works today, the constraint or gap driving the change, and any research finding that
overturned an obvious approach. Cite the code, docs, or history you read. Omit this
whole section when the orientation paragraph already carries the reader.>

## The idea

<The shape of the solution in a short paragraph or a few bullets: the contract, model,
API, or seam that changes, and what is observably different afterwards. State the
alternative you rejected and why in one line when a reviewer would otherwise ask.>

## The plan

| # | Task | Lands in | Proves it |
| --- | --- | --- | --- |
| T1 | <task title> | <files or seam> | <test, probe, artifact, or UI exercise> |

Tracer: <public seam the first task cuts through>
E2E: <planned specs and layers, e.g. "2 specs (browser, http)"; or "None — reason">
Regression: <provisional case IDs and destination suite; or "None — reason">
Order: <frontier task IDs; blocked task IDs and what unblocks them>
Out of scope: <short tags>
Open risks: <none, or one line each>

## Decisions

| ID | Question asked | Answer | What it changes |
| --- | --- | --- | --- |
| Q1 | <the question as it was asked> | <the settled choice, not a paraphrase of the reply> | <the design consequence a reviewer should check> |

## Artifacts

- Plan: <path>
- Tasks: <path>
- Supporting skills: <names, or none found>

Next: approve → Pick
```

Rules for the brief:

- The first paragraph is the whole change in prose. A reviewer who reads only that
  paragraph should know the destination and the reason.
- Background is optional; everything else is required. Drop Background when the change
  is self-explanatory rather than padding it.
- The idea and the plan come **before** the Decisions table. Decisions justify the plan;
  they are not the pitch.
- The Decisions table has **no row limit**. List every settled human decision with the
  question that prompted it, so the reviewer can see what was asked and what was chosen.
  Skip the table entirely when grilling settled none; do not mention decisions, an empty
  table, or "none".
- Every acceptance criterion in the plan table names how it is proved. "Manual check" is
  not a verification method.
- The `E2E:` and `Regression:` lines summarize the IP's `## E2E tests` and
  `## Regression cases` sections. They stay lines under the plan table, not new headings.
- Do not restate the IP. The brief orients and points; the IP holds the detail.
- If a PR has GitHub Deployments, print those Demo URLs after the brief.

## Anti-patterns

- One giant question dump at the start
- Prose-only rounds that force typed replies like `Q1: xyz` when the harness can render
  selectable options
- Selectable options that are not real choices ("Yes"/"No"/"Your call") or that duplicate
  the harness's built-in free-text escape
- Asking repository facts ("where is this route defined?")
- Acting on a recommended answer the user has not accepted
- Accepting a vague "yes" as a finished decision
- Recapping the entire interview at the end of every round
- Writing the IP in the same turn as unanswered questions
- Hiding decisions in a one-line `Q#=choice` summary
- An approval brief that opens with file paths or task IDs instead of the destination
- A Decisions table that lists choices without the questions that prompted them
- A brief a reviewer cannot act on without opening the IP
