---
name: backfill-regression
description: >-
  Backfill a repository's manual regression suites. Survey the app for behavior that only a
  developer or QA can check by hand (push notifications and other hardware or OS behavior,
  real email or SMS delivery, full cross-device flows, how the app feels) plus a short check
  that the app works as intended, propose candidate cases one area at a time, and have the
  human approve, edit, or deny each set before anything is written. Loops until no
  candidates remain or the human stops. Use when asked to backfill, seed, or audit regression
  tests or a manual QA checklist; not for planning a feature (Grow writes those cases) or for
  writing automated tests.
---
# Backfill regression

Build the minimal manual pass a developer or QA walks before a release. Every case is
approved by the human before it is written. The suites stay small: fewer, sharper cases
beat coverage.

Read [`testing-plan`](references/testing-plan.md) first. Its "Keep regression
minimal" section decides what may be a case, its suite file format decides how a case is
written, and its regression-step bar decides whether a case is good enough.

## Inputs

- The resolved `E2E guide`, `Regression suites`, and `Smoke command` per the testing plan
- Every existing suite file, its `Area:` prefix, and its highest ID
- The ledger at `.terreno/regression-backfill.json`, when present (see Ledger)
- Optional scope from the human: an area, a package, or a list of features

## Procedure

When `Regression suites` resolves to `none` (the testing-plan opt-out), stop: report that
the repository opted out of manual regression suites, and write nothing.

1. **Survey.** Use explore subagents in parallel. Collect evidence of behavior automation
   cannot reach, each with a file and line:
   - hardware and OS: push registration and delivery, notification permission, camera,
     photo library, location, biometrics, secure storage across reinstall, deep and
     universal links from outside the app, background and resume
   - delivery outside the app: email, SMS, and push that must reach a real inbox or device
   - full flows across apps, devices, or channels: a change on one device showing on
     another, an admin action reaching a user's phone, offline then online
   - feel: gestures, drawing, keyboard avoidance, animation, layout on small screens
   - the app works: sign in, the main screen loads, the core action succeeds, on each
     shipped platform. One short case per platform, not per screen.
2. **Filter.** Drop a candidate when an existing suite case already covers it, when an
   e2e spec, smoke, or unit test already proves it, when a guide layer could drive and
   assert it (note it as an automation gap in the final report instead), or when the
   ledger records it as denied. Merge near-duplicates into one case.
3. **Group into sets.** One set per area, at most five cases, highest risk first. A
   set names its destination suite file, existing or new, with its `Area:` prefix.
   Write each case in the suite table format with a provisional `<AREA>-new-<n>` ID,
   `Automated by: manual`, and `Added: regression-backfill`. Every case meets the
   regression-step bar, and its evidence line explains why it cannot be automated.
4. **Ask, one set at a time.** Show the set as a table with each case's evidence, and
   ask the human, using the structured question tool when available:
   - **Approve all**: write every case in the set.
   - **Approve some**: the human names the case IDs to keep; deny the rest.
   - **Edit**: the human's changes are applied, and the set is shown again.
   - **Deny all**: write nothing for this set.
   - **Stop**: end the loop now.
   Never write a case the human has not approved.
5. **Write approved cases.** Append them to the suite file with real IDs: one past the
   highest ID the file has ever held, never reused. A new suite file follows the suite
   file format, with `Last full run: never` and `Owner:` from the human or `unassigned`.
   Add a new area to the suite index when the repository keeps one. Run the repository's
   suite check when it has one, and fix any failure before the next set.
6. **Record.** Append each case to the ledger as approved or denied, then go to the next
   set. When every set is answered, survey once more for areas the answers opened up;
   stop when a pass yields no new candidate.

## Ledger

`.terreno/regression-backfill.json` stays out of version control: add `.terreno/` to
`.gitignore` when it is missing. It keeps a denied case from being proposed again:

```json
{"cases": [{"area": "TODO", "case": "A todo shows on a second device", "decision": "denied", "date": "2026-01-15"}]}
```

Match a candidate against the ledger by area and meaning, not exact wording.

## Report

When the loop ends, report once:

- cases written, per suite file, with their real IDs
- sets and cases denied
- automation gaps: candidates a guide layer could cover, each with the layer and the
  spec path the guide prescribes, offered as follow-up work, not built
- the suite check result

Do not commit or push unless the human asks. A commit message says which suites gained
cases.

## Never

- write a case the human did not approve, or re-propose one the ledger records as denied
- add a case for something an automated test can prove
- walk a case or change `Last full run`; only a developer or QA does that
- renumber or delete an existing case
