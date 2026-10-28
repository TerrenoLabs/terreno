---
name: update-docs
description: >-
  Keep Terreno docs in sync whenever behavior, public API, architecture, or
  operator workflow changes. Read architecture docs first; write Diátaxis pages
  in the same slice; regenerate generated docs. Lifecycle composition: Pick when
  behavior and docs change together; Roast proves docs; Brew is the final docs
  gate.
---
# Update Docs

Use whenever behavior, public API, architecture, or operator workflow changes. Docs are
the architecture source. Code implements them.

## When to run

Always run in the same slice as the change. Skip only a pure internal refactor that does
not change APIs, UI, architecture, data flow, env/config, or operator steps. Record that
skip. Missing docs for a user-visible or architectural change is a failed slice.

## Workflow

1. **Read the current architecture**
   - Open explanation and reference docs for the affected area before editing code or docs.
   - If docs and code disagree, resolve both in this slice.

2. **Map the change to Diátaxis**

   | Change | Page |
   | --- | --- |
   | First-run path | `docs/tutorials/` |
   | Operator task | `docs/how-to/` |
   | API, props, env, commands | `docs/reference/` |
   | Why the system is shaped this way | `docs/explanation/` |
   | UI component | generated `docs/reference/components/` plus a demo story |

   The one exception to this layout is the
   [`testing plan`](references/testing-plan.md) spots. The e2e guide stays at
   `docs/testing/e2e.md` (with any pages it links) and the manual
   regression suites stay in `docs/regression/<area>.md`, or wherever the repository's
   `## Testing conventions` table points. Never move them into a Diátaxis directory.

3. **Write the page**
   - Update the existing section in place.
   - Lead with the next action or canonical fact.
   - Use the page's standard headings. Prefer tables.
   - One minimal current example. No implementation chronology.
   - Never hand-edit generated output.

4. **Regenerate generated docs** when UI types or OpenAPI-derived pages change:

   ```bash
   cd ui && bun run compile && bun run types
   bun run website:generate
   ```

5. **Verify**

   ```bash
   bun run website:build
   ```

6. **Sync agent copies** when agent-facing guidance changed:

   ```bash
   bun run rules
   bun run skills:sync
   ```

7. **Record** every docs file created or updated in the PR `Verification` table.

## Integration

Pick, Roast, and Brew require this skill for user-visible or architectural work.
Brew does not open or update the PR until the docs in this slice match the shipped
behavior.
