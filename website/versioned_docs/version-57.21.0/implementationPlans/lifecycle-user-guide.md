# An end-user guide that grows with every feature

**Status:** Proposed
**Roadmap:** Area=`dx`, Target=`Next`, Impact=`Feature`
**Branch:** user-guide
**Roadmap issue:** https://github.com/TerrenoLabs/terreno/issues/1642
**Owner:** Josh Gachnang
**Created:** 2026-10-26
**Depends on:** [e2e-and-regression-testing](e2e-and-regression-testing.md)

Chat agents cannot answer "how do I…" questions about an app today, because no text
describes its features in the words users see. Developer docs explain APIs, not how to
reset a password or what a screen is for, and a guide written once at the end drifts
from the app the first time a label changes. This plan makes the end-user guide a
required part of every IP, written by the same task that ships the feature, so the guide
stays true and a chat agent can be pointed at it.

## The idea

- One plain-text page per feature at `docs/user-guide/<area>/<feature>.md`, with
  frontmatter a retriever can use: `title`, `area`, `audience` (`user`, `admin`, or
  `staff`), `platforms`, one to five `questions` users would ask, optional `screens`,
  and `added`. The body has three fixed sections: What it does, How to use it, Intended
  use.
- Every IP gains a required `## User guide` section (rows or `None — <reason>`). Grow
  plans the rows, Pick writes each page with its feature, Roast checks the steps against
  the shipped screens, Brew gates on pages and the index, and Taste updates pages after
  fixes.
- A repository with no end users opts out with `| User guide | none — <reason> |` under
  `## User guide conventions` in AGENTS.md or CLAUDE.md.
- `backfill-user-guide` drafts pages for features that shipped before the contract and
  writes only the pages a human approves. `bun run check:user-guide` validates the pages
  and index in CI.
- Terreno keeps a guide for the example app; brewery mirrors the contract and opts out.

Contract: [`user-guide.md`](../../plugins/terreno-planning/references/user-guide.md).
Implementation: [#1633](https://github.com/TerrenoLabs/terreno/pull/1633), stacked on
[#1628](https://github.com/TerrenoLabs/terreno/pull/1628).

## Open questions for discussion

| ID | Question | Recommendation |
| --- | --- | --- |
| Q1 | [support-agent](support-agent.md) plans AI-authored docs in `support/kb/**/*.md` with its own frontmatter. Is the user guide that corpus, a source it ingests, or separate? | Make the user guide one `KnowledgeSource` the support agent ingests, and align the frontmatter (`audience`, `questions`) so one page serves both. |
| Q2 | Should guide pages ship inside the app bundle, or be served by the backend? | Serve from the backend through the support agent, so pages update without an app release. |
| Q3 | Who reviews guide wording: developers in the PR, or product? | Developers in the PR; product reviews the backfill sets. |

## E2E tests

None — tooling and documentation contract; `bun test scripts/userGuide` and
`bun run check:lifecycle-skills` prove it.

## Regression cases

None — no hard-to-automate change.

## User guide

None — the guide contract itself; the seeded example-app pages are listed in
`docs/user-guide/README.md`.
