---
category: Added
---

`fix-code-scanning-alerts` skill: clears every open CodeQL alert on one PR. Fixes close on the master rescan; reviewed false positives go in `.github/code-scanning/dismissals.json` and a workflow dismisses them after merge. CodeQL now also scans pull requests and ignores test files. See `docs/how-to/fix-code-scanning-alerts.md`.
