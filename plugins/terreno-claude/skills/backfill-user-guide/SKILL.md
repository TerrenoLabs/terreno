---
name: backfill-user-guide
description: >-
  Backfill a repository's end-user guide. Survey the shipped app for user-facing features
  (screens, navigation, forms, settings, admin tools) that have no guide page, draft pages in
  the user-guide format one area at a time, and have the human approve, edit, or deny each set
  before anything is written. Loops until every shipped feature has a page or a recorded
  denial, or the human stops. Use when asked to backfill, seed, or audit the user guide, help
  pages, or "how do I" docs for chat agents; not for planning a feature (Grow plans those
  pages) or for developer docs.
---
# Backfill user guide

Write the pages a user, or a chat agent answering for one, needs to use the features the
app already ships. Every page is approved by the human before it is written.

Read [`user guide`](../../references/user-guide.md) first. Its page format decides how a
page is written, its guide-entry bar decides whether a page is good enough, and its opt-out
rule decides whether to run at all: when the repository's resolved `User guide` is `none`,
report that the guide is off and stop.

## Inputs

- The resolved `User guide` path per the user-guide contract, its `README.md` index, and
  every existing page with its `area` and `questions`
- The ledger at `.terreno/user-guide-backfill.json`, when present (see Ledger)
- The repository's guide check command, when it has one
- Optional scope from the human: an area, an app, or a list of features

## Procedure

1. **Survey.** Use explore subagents in parallel, one per app or top-level area. Collect
   each shipped user-facing feature with evidence (a file and line):
   - every routed screen and tab, and how a user reaches it
   - every action a user takes there: create, edit, delete, search, filter, share, export
   - account flows: sign up, sign in, sign out, password reset, profile, settings,
     consent, notifications, deleting an account
   - staff and admin tools, recorded with `audience: admin` or `staff`
   - feature flags and platform checks that hide a feature from some users or platforms
   Read the on-screen labels from the source (button text, titles, headings), never from
   memory, and note which platforms render each screen. When the repository has an
   inventory command for the guide, run it to list screens no page covers.
2. **Filter.** Drop a feature when an existing page already covers it, when it is not
   reachable by any user (dead code, a flag that is off everywhere, a developer-only
   screen), or when the ledger records it as denied. Merge features a user thinks of as
   one task into one page.
3. **Group into sets.** One set per area, at most five pages, most-used features first.
   Draft each page in full in the page format, with `added: user-guide-backfill`. Every
   page meets the guide-entry bar: user words only, every step names a real on-screen
   label, and nothing a chat agent must not repeat (personal data, secrets, internal
   URLs, staff procedures on a `user` page).
4. **Ask, one set at a time.** Show each page's title, audience, platforms, questions, and
   steps, with the evidence for its labels, and ask the human, using the structured
   question tool when available:
   - **Approve all**: write every page in the set.
   - **Approve some**: the human names the pages to keep; deny the rest.
   - **Edit**: the human's changes are applied, and the set is shown again.
   - **Deny all**: write nothing for this set.
   - **Stop**: end the loop now.
   Never write a page the human has not approved.
5. **Write approved pages.** Write each page at `<User guide>/<area>/<feature>.md` and add
   it to the index table. A missing guide directory gets its `README.md` index first. Run
   the repository's guide check when it has one, and fix any failure before the next set.
6. **Record.** Append each page to the ledger as approved or denied, then go to the next
   set. When every set is answered, survey once more for features the answers opened up;
   stop when a pass yields no new candidate.

## Ledger

`.terreno/user-guide-backfill.json` stays out of version control: add `.terreno/` to
`.gitignore` when it is missing. It keeps a denied page from being proposed again:

```json
{"pages": [{"area": "todos", "title": "Export todos as CSV", "decision": "denied", "date": "2026-01-15"}]}
```

Match a candidate against the ledger by area and meaning, not exact wording.

## Report

When the loop ends, report once:

- pages written, per area, with their paths
- sets and pages denied
- features left without a page, and why
- the guide check result

Do not commit or push unless the human asks. A commit message says which areas gained
pages.

## Never

- write a page the human did not approve, or re-propose one the ledger records as denied
- describe a feature that does not ship, or a label you did not read in the source
- put personal or health information, real accounts, secrets, or internal URLs in a page
- run when the repository opts out of the user guide
