# Regression suites

Run `bun run check:regression-suites` after you edit any file here. CI runs the same check in
the `repo-policies` job.

These files hold a minimal manual pass a developer or QA walks before a release: a short check
that the app works as intended, plus the behavior no unit test, smoke, or e2e spec can reach,
such as push notifications, real email delivery, other hardware or operating-system behavior,
full flows across devices, and how the app feels. Keep them small. Most features add no case
here, and anything an e2e spec can drive and assert belongs in an e2e spec instead. Each area
has one living file. Implementation plans
propose cases under `## Regression cases`, and Brew writes them here with real IDs before it
opens the pull request. See [Where regression suites live](../testing/e2e.md#where-regression-suites-live)
for how this tier fits with the automated ones.

## Areas

| File | Area | Covers |
| --- | --- | --- |
| [planning.md](planning.md) | `PLAN` | The planning plugin's Grow, Pick, Roast, Brew, and Taste stages, walked in a scratch repo |
| [auth.md](auth.md) | `AUTH` | Email delivery for password reset and verification, and native session storage |
| [admin.md](admin.md) | `ADMIN` | Admin edits and announcements seen live on a phone |
| [syncdb.md](syncdb.md) | `SYNC` | Offline writes, persistence across an app kill, and account switches on a device |
| [ui-native.md](ui-native.md) | `NATIVE` | Notification permission prompts, finger-drawn signatures, and keyboard behavior on iOS and Android |

## Suite format

Every file follows the same shape:

```markdown
# Auth regression suite

Area: AUTH
Owner: <team or person>
Last full run: 2026-01-15 (<who>, <short sha>)

| ID | Case | Steps | Expected | Platforms | Automated by | Added |
| --- | --- | --- | --- | --- | --- | --- |
| AUTH-001 | ... | ... | ... | ... | manual | <IP slug> |
```

- **Title** is the first line, a `#` heading.
- **`Area:`** declares the ID prefix: uppercase letters and digits. Find a suite by this line,
  not by its file name. No two files declare the same area.
- **`Owner:`** names the team or person who keeps the file current.
- **`Last full run:`** is `never`, or the date, who walked it, and the short commit SHA. Change
  it only after a person walks every case in the file.
- **IDs** are `<AREA>-NNN`, zero-padded to three digits, and never reused. The next free ID is
  one past the highest the file has ever held. A retired case keeps its row with `Retired` in
  `Expected`. Provisional IP IDs such as `AUTH-new-1` never appear here.
- **Steps** name a concrete starting state (who is signed in, what data exists, which build or
  device), then an action a person can follow without guessing.
- **Expected** is observable: what is on screen, in the inbox, or in the response. "It works"
  or a restatement of the action does not count.
- **Automated by** is `manual` or the path of the spec that covers the case. It never names an
  IP-local `E<n>` row.
- **Added** is the slug of the implementation plan that added the case.

Escape a literal pipe inside a cell as `\|`.

## What the check enforces

`scripts/regression/checkSuites.ts` reads every `.md` file here except this README and fails
when a file:

- lacks the title, `Area:`, `Owner:`, or `Last full run:` line, or one of them is malformed
- has a table whose columns differ from the seven above, or more than one table
- has a row with the wrong number of cells, an ID that is not `<AREA>-NNN`, a `-new-` ID, or a
  duplicate ID
- has an empty cell, including Steps and Expected
- names an `E<n>` row in Automated by

It also fails when two files declare the same area. It does not judge whether a step meets the
bar above; reviewers do.

## Add a case

1. Open the area's file, or create `<area>.md` with `Last full run: never` and an `Owner:`.
2. Add a row with the next free ID.
3. Run `bun run check:regression-suites`.

## Backfill the suites

To find cases an older feature should have had, run the `backfill-regression` skill. It
surveys the app for behavior automation cannot reach, proposes cases one area at a time, and
writes only the sets you approve. It records denied cases in
`.terreno/regression-backfill.json` (not committed) so it never proposes them again.
