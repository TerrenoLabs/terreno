---
name: accessibility-testing
description: >-
  Test changed frontend features for WCAG 2.0/2.1/2.2 AA, keyboard access,
  focus, and accessible semantics. Trigger for every frontend behavior or visual
  change, dark-mode/theme change, or explicit accessibility audit request.
---
# Accessibility testing

Use with `verify-ui-changes`; this workflow proves accessibility while that
workflow proves the rendered user flow. Human steps and command reference:
[Test UI accessibility](../../../docs/how-to/test-ui-accessibility.md).

## Workflow

1. **Choose exact changed states.** List the rendered URLs and include every
   affected light/dark, responsive, loading, empty, disabled, and error state.
   The list is complete when every changed visual or interaction branch has a
   URL or a reproducible action.

2. **Run WCAG automation.**

   ```bash
   bun run accessibility:scan "<url-1>" "<url-2>"
   ```

   Read `/opt/cursor/artifacts/accessibility/wcag-report.json`. Fix every
   violation whose node is in the changed feature, then rerun until those
   states report zero violations. Do not infer a pass from the process exit
   alone; inspect the report's URL list.

3. **Operate by keyboard.** Tab through the changed controls, activate each with
   its expected Enter/Space/arrow keys, and verify a visible focus indicator.
   The step passes only when focus order follows the visual order and no action
   requires a pointer.

4. **Inspect semantics.** Verify accessible name, role, state, descriptions,
   field errors, headings, landmarks, and live announcements in the rendered
   accessibility tree. The step passes only when the non-visual state matches
   the visible state.

5. **Check reflow and contrast.** Test at 200% browser zoom and inspect the
   scanner screenshots. For custom state indicators or canvas/SVG content,
   calculate rendered color contrast: 4.5:1 normal text, 3:1 large text and
   essential UI boundaries.

6. **Attach evidence.** Add the JSON report and decisive light/dark screenshots
   to the PR Verification table. Name any pre-existing out-of-scope finding
   with an unaffected-route baseline and a linked issue; never suppress it
   silently.

The accessibility gate is complete only when the changed states have zero
automated violations and keyboard, semantics, reflow, and contrast checks are
recorded.
