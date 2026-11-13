---
name: improve-rulesync
description: Invoke at the end of a session to evaluate whether any skills or rules were misleading, incorrect, or missing — and fix or create them. Trigger with /improve-rulesync.
---
# Improve Rulesync

### Trigger
Invoke explicitly at the end of a session with `/improve-rulesync`.

### Behavior
Review the current conversation session and evaluate the skills and rules in `.rulesync/`. Identify any that:
- Gave misleading or incorrect guidance that caused errors or rework
- Were missing and would have prevented incorrect behavior
- Need to be updated to reflect decisions or patterns established in this session

Then make the changes directly.

### Step 1 — Session Review
Scan the session for:
- Moments where a skill or rule was followed but produced a wrong or suboptimal result
- User corrections or decisions about AI model behavior (these indicate a gap or error in the rules)
- New patterns, decisions, or constraints established that should be codified

### Step 2 — Rules Audit
Check `.rulesync/` for relevant existing rules and skills. Evaluate:
- Are trigger conditions accurate?
- Is the guidance still correct given what happened this session?
- Are there gaps that caused confusion?

### Step 3 — Make Changes
For each issue found:
- **Incorrect/misleading**: Edit the existing file to fix it
- **Missing**: Create a new skill or rule file in `.rulesync/skills/` or `.rulesync/rules/`
- **Outdated**: Update or remove the stale content

Always edit `.rulesync/` as the source of truth.

User-facing guidance belongs in `docs/` (the published site). Agent-facing
guidance belongs in `.ai/` (per package) or `.rulesync/` rules/skills. Cross-link
those homes; do not duplicate the same architecture into both.

When the guidance belongs to a published Terreno package (`@terreno/api`, `@terreno/ui`, `@terreno/syncdb`, admin packages), prefer updating that package’s **`.ai/guidelines/`** or **`.ai/skills/`** (see `docs/implementationPlans/mcp-boost-parity.md` Phase 2). The MCP server copies those trees at build time; keep monorepo-wide rulesync files for cross-cutting or repo-only concerns. If the same fact is already on a `docs/` page, link it instead of copying.

### Step 4 — Sync
After all changes, run `bun run rules` to sync to all AI tool directories, then
`bun run skills:sync` so the installable `skills/` tree matches.

### Step 5 — Summary
Output a brief summary of what was changed and why. Format:
- **Fixed**: [file] — [what was wrong and what was corrected]
- **Created**: [file] — [what gap it fills]
- **No changes needed**: [reason]
