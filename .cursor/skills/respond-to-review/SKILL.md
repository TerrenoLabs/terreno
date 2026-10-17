---
name: respond-to-review
description: 'Resolve and classify Terreno PR comments, plan focused fixes, and implement addressed items without owning submission or CI waiting. Every review-bot thread ends fixed, declined with a reply, or raised as a decision. Lifecycle composition: Taste.'
disable-model-invocation: true
---
# PR Review Response Workflow

Review comments on a PR resolved from `$ARGUMENTS` or the current branch, then plan and
implement focused fixes. If a human decision is required, return it as a blocker. Taste
owns commit/push/result emission; the outer loop owns later observation. Invoked directly
by a human, hand the verified diff to `terreno-5-taste` in standalone entry so the push
is watched until green or escalated, per push ownership (`plugins/terreno-planning/references/push-ownership.md`).

## Step 0: Validate Input

Resolve the PR number once at the start and store it in `PR_NUMBER`. All later shell and `gh` commands must use `PR_NUMBER`, not `$ARGUMENTS` directly.

- If `$ARGUMENTS` contains digits only: use it as `PR_NUMBER`.
  ```bash
  PR_NUMBER="$ARGUMENTS"
  ```
- If `$ARGUMENTS` is empty: try to find the PR for the current branch:
  ```bash
  BRANCH_NAME="$(git branch --show-current)"
  if [ -z "$BRANCH_NAME" ]; then
    echo "No PR number was provided and the current checkout is detached. Ask the user which PR to review."
    exit 1
  fi

  if ! PR_NUMBER="$(gh pr view "$BRANCH_NAME" --json number --jq '.number' 2>/dev/null)"; then
    echo "No PR was found for branch: $BRANCH_NAME"
    gh pr list --head "$BRANCH_NAME" --json number,title,url
    echo "Ask the user which PR to review."
    exit 1
  fi
  ```
- If `$ARGUMENTS` contains anything other than digits (whitespace, shell metacharacters, quotes, `..`, etc.): refuse to substitute it. Ask the user to re-invoke with a numeric PR number or no argument while checked out on the PR branch, then stop.

After resolving `PR_NUMBER`, confirm it is a positive integer before using it:

```bash
case "$PR_NUMBER" in
  ""|*[!0-9]*)
    echo "Resolved PR number is invalid: $PR_NUMBER"
    exit 1
    ;;
esac
```

Do not attempt to "clean up" or quote a non-numeric PR number — reject it.

## Step 1: Setup Working Directory

1. Check if we're already in a git worktree:
   ```bash
   git rev-parse --show-toplevel
   git worktree list
   ```

2. **If already in a worktree**, use the current directory — skip to Step 2.

3. **If NOT in a worktree**, set one up:

   a. Get the repo name:
      ```bash
      basename $(git rev-parse --show-toplevel)
      ```

   b. Fetch PR details and branch name:
      ```bash
      gh pr view "$PR_NUMBER" --json headRefName,number,title,url,author
      ```

   c. Fetch the PR branch:
      ```bash
      git fetch origin pull/$PR_NUMBER/head
      ```

   d. Create worktree at `~/.claude-worktrees/<repo-name>/pr-$PR_NUMBER`:
      ```bash
      git worktree add ~/.claude-worktrees/<repo-name>/pr-$PR_NUMBER FETCH_HEAD
      ```

   e. Change to the worktree directory:
      ```bash
      cd ~/.claude-worktrees/<repo-name>/pr-$PR_NUMBER
      ```

   f. Set up tracking for the PR branch:
      ```bash
      git checkout -B <branch-name> FETCH_HEAD
      git branch --set-upstream-to=origin/<branch-name>
      ```

**Important**: All subsequent work happens in the working directory (worktree or current).

## Step 2: Find the Reviews

1. Get review threads with resolution status using GraphQL. **Important**: capture the thread `id` for each unresolved thread so you can resolve them later.
   ```bash
   gh api graphql -f query='
     query($owner: String!, $repo: String!, $pr: Int!) {
       repository(owner: $owner, name: $repo) {
         pullRequest(number: $pr) {
           reviewThreads(first: 100) {
             nodes {
               id
               isResolved
               comments(first: 50) {
                 nodes {
                   author { login }
                   body
                   path
                   line
                   createdAt
                 }
               }
             }
           }
           reviews(first: 50) {
             nodes {
               author { login }
               state
               body
             }
           }
         }
       }
     }' -F owner=':owner' -F repo=':repo' -F pr="$PR_NUMBER"
   ```

2. **Ignore resolved threads entirely** — only process threads where `isResolved` is `false`

3. Filter to comments from other users (not the PR author)

4. Identify which remaining comments are:
   - Blocking (CHANGES_REQUESTED) vs suggestions
   - Inline code comments vs general comments

## Step 3: Decide What To Do & Show the Minimum Plan

Human attention is the limiting resource. Collapse all unresolved comments into one table.
Paraphrase; do not quote comments unless exact wording changes the decision.

```
| Priority | Thread | Action |
| --- | --- | --- |
| Blocker | `file:line` | <smallest fix> |
| Decision | `file:line` | <one exact question> |
| Skip | `file:line` | <one-sentence reply to post> |
```

Omit categories with no rows. Do not add a preamble, recap, suggested thanks, or a
separate reply section.

A bot thread is never silently skipped. `Skip` on a bot thread means: post the
one-sentence reply (false positive, intended behavior, or out of scope with a follow-up
link), then resolve the thread. Only `Decision` rows may stay open.

## Step 4: Confirmation (only if there are open questions)

**If the plan has any `Decision` rows:**
Ask: **"Need your input on the decisions above. Anything else to change before I implement?"**
- Wait for explicit approval before making any changes
- Incorporate any feedback
- Re-present plan if significant changes requested

**If there are no `Decision` rows:** skip confirmation entirely. Proceed directly to Step
5 and return the verified diff to Taste. Do not ask for redundant plan approval.

## Step 5: Make the Fix

After approval, implement fixes one at a time in priority order. Do not emit progress
updates between fixes.

## Step 6: Show the diff

Return the diff stat plus only the relevant hunks. Put a long complete diff in one
expandable block when the caller cannot inspect it directly:
```bash
git diff
git diff --stat
```

Do **not** commit here. Return the verified diff and addressed-thread identifiers to the
calling Taste invocation, which owns commit/push and structured state.

## Step 7: Return to Taste

Return one compact table of changed files, targeted verification, addressed comments,
unresolved blockers, and thread identifiers. Do not invoke Brew or a CI watcher.

If the fix is user-facing, note the required changelog update for Taste/Brew to apply
under repository policy.

## Step 8: Resolve Addressed Threads

The calling Taste invocation resolves each thread only after it commits/pushes the
verified fix. Return the thread `id` captured in Step 2.

Default to resolving addressed threads silently. Post a reply only when the diff cannot
preserve a non-obvious decision or when a human must act. Never post progress, thanks,
test summaries, CI status, or a restatement of the PR body. Keep a necessary reply to at
most three short sentences:

```markdown
Fixed in `<sha>`: <what changed and why this approach>.
```

For a required decision:

```markdown
**Action needed:** <one decision and why it blocks>.

<details>
<summary>Evidence</summary>

<only the detail needed to decide>

</details>
```

For each thread that was fixed or addressed (`Blocker` rows, `Skip` rows on bot
threads after their reply, and any `Decision` row the human already answered in code):
```bash
gh api graphql -f query='
  mutation($threadId: ID!) {
    resolveReviewThread(input: {threadId: $threadId}) {
      thread { isResolved }
    }
  }' -f threadId="<thread_id>"
```

Do NOT resolve threads that were:
- `Skip` (N/A or out of scope)
- `Decision` rows still waiting on a human answer
- Threads where the user decided not to take action

Report which threads were resolved and which were left open.

---

## Error Handling

- If worktree already exists, ask if user wants to reset it or use existing
- If PR not found, show error and available PRs: `gh pr list`
- If no comments found, inform user and ask if they want to proceed anyway
- If merge conflicts occur during implementation, pause and ask for guidance

## Cleanup Reminder

If a new worktree was created, remind user:
```
To remove this worktree later:
  git worktree remove ~/.claude-worktrees/<repo>/pr-$PR_NUMBER

Or to keep working on it, you can open a new Claude session in:
  cd ~/.claude-worktrees/<repo>/pr-$PR_NUMBER
```
