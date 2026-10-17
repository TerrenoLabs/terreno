---
name: fix-conflicts
description: 'Integrate the latest base, resolve Terreno conflicts without dropping either side, and run affected validation. Lifecycle composition: Brew for PR-update conflicts; Taste for current-PR conflicts.'
disable-model-invocation: true
---
# Fix Conflicts

Pull the latest base, resolve merge conflicts, and validate the affected areas. The push
follows push ownership (`plugins/terreno-planning/references/push-ownership.md`): someone must watch the new head until it is green or
escalated.

## Instructions

1. Ensure the working tree is clean before starting:
   ```
   git status
   ```
   - If there are uncommitted changes, ask the user whether to stash them or abort

2. Resolve the PR/default base branch, then fetch and merge it into the current branch:
   ```
   BASE_BRANCH="$(gh pr view --json baseRefName --jq .baseRefName 2>/dev/null || git remote show origin | awk '/HEAD branch/ {print $NF}')"
   git fetch origin "$BASE_BRANCH"
   git merge "origin/$BASE_BRANCH"
   ```
   - If `BASE_BRANCH` is empty, stop and ask for the base; never guess `master`/`main`.
   - If the fetch or merge fails, check network connectivity and repository access permissions. Notify the user if the issue persists.

3. Check for merge conflicts:
   ```
   git diff --name-only --diff-filter=U
   ```
   - If there are no conflicts, skip to step 5

4. For each conflicted file:
    - Read the file and understand both sides of the conflict
    - Resolve the conflict by combining changes in a way that retains the functionality and purpose of both sets of changes, ensuring no critical information is lost.
    - If the conflict cannot be resolved automatically, notify the user and provide a summary of the conflicting changes.
    - After resolving all conflicts in a file, stage it:
       ```
       git add <file>
       ```
    - After all conflicts are resolved, complete the merge:
       ```
       git commit --no-edit
       ```

## Running Checks

5. Run lint and compile checks at the project root:
    ```
    git rev-parse --show-toplevel
    ```
    - Run linting:
       ```
       cd <project-root> && bun run lint
       ```
       - If linting fails, fix the issues and re-run until passing
    - Run type compilation/checking:
       ```
       cd <project-root> && bun run compile
       ```
       - If compilation fails, fix the type errors and re-run until passing
    - If linting or compilation fails repeatedly and cannot be resolved, notify the user with the error details and suggest seeking assistance.

## Handling Fixes and Commits

6. If any fixes were needed in step 5, stage and commit them:
   - Review the changes made
   - Create a commit with a clear message describing what was fixed
   - In step 6, do not use prefix commit format (feat:, fix:, chore:, etc.) for the commit message.
   - Do not mention AI, Claude, or any AI assistant

7. Push the changes:
   ```
   git push origin HEAD
   ```

8. Return the pushed head and validation evidence.
   - Called from Brew or Taste: return. That stage watches CI on the new head.
   - Invoked directly by a human: start `terreno-5-taste` on the PR in standalone entry.
     It waits for CI and review bots, fixes what the merge broke for up to three fix
     rounds, answers bot comments, and escalates if the PR is still red. Never end with
     a pushed head that nothing is watching.

## Arguments

None
