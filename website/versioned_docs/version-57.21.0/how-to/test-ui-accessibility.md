# Test UI accessibility

Run the WCAG scanner against every changed rendered state:

```bash
bun run accessibility:scan \
  "http://localhost:8085/dev/Theme?story=ThemeComponent&theme=light" \
  "http://localhost:8085/dev/Theme?story=ThemeComponent&theme=dark"
```

The scanner applies axe rules tagged WCAG 2.0 A/AA, WCAG 2.1 A/AA, and WCAG
2.2 AA. It writes a JSON report and full-page screenshots under
`/opt/cursor/artifacts/accessibility/` and exits nonzero when any violation is
found.

## Verify what automation cannot

1. Use only the keyboard to reach and operate each changed control.
2. Confirm focus order and the visible focus indicator match the visual order.
3. Inspect each control's accessible name, role, state, and error relationship.
4. Check light and dark modes, plus loading, empty, disabled, and error states
   affected by the change.
5. At 200% browser zoom, confirm content remains usable without clipping or
   losing actions.

Automated scans do not prove keyboard behavior, announcement quality, reading
order, or whether alternative text conveys the intended meaning. Record those
manual checks with the automated report in the pull request Verification table.

## Fixing findings

Fix violations in the changed feature before submission. If a finding is
pre-existing and outside the changed path, capture a baseline on an unaffected
route and name both routes in the pull request. Do not suppress an axe rule
without a linked issue and a documented reason.
