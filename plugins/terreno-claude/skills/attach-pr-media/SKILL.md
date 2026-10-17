---
name: attach-pr-media
description: >-
  Upload screenshots or videos from a local path to GitHub and embed them in a pull
  request comment or body, using only the gh CLI token (no browser). Use after
  verify-ui-changes captures evidence, or when asked to "attach screenshots to the PR",
  "upload images to GitHub", or "put the recording on the PR". Also use when
  /opt/cursor/artifacts/ is missing or read-only.
---

# Attach PR media

Put local screenshots and videos on a pull request so reviewers see them inline.

## Why a gist

GitHub's drag-and-drop comment attachments (`github.com/user-attachments/...`) are
uploaded through `github.com/upload/policies/assets`. That endpoint needs a browser
session cookie, so it rejects a `gh` token with 422. The REST API has no image upload.

A gist is GitHub-hosted storage that a `gh` token with the `gist` scope can write.
Gists are git repositories, so `git push` accepts binary files. Their raw URLs render
in PR comments. Every PR shares one secret gist described `PR media`. The script creates
it on first use and names each file `<owner>-<repo>-<pr>-<file>`, so PRs never collide.

Other options are worse. An orphan branch shows up in the repo's branch list and must
be deleted later. Release assets clutter the Releases page.

## Privacy

A secret gist is unlisted, not private: anyone with the URL can view it. Only upload
media from demo apps, seeded test accounts, or fixtures. Never upload screenshots that
show PHI, production data, credentials, or tokens. The script refuses non-public repos
unless you pass `--allow-private`. Pass it only when you have looked at every file and
it holds nothing sensitive.

## Procedure

1. Check the token has the `gist` scope:

   ```bash
   gh auth status
   ```

   If `gist` is missing, ask the user to run `! gh auth refresh -s gist`.

2. Look at every file you will upload. Remove or crop anything sensitive.

3. Upload and post. From inside the repo, on the PR's branch:

   ```bash
   bash <skill-dir>/scripts/upload-pr-media.sh --comment --title "Screenshots" path/to/*.png
   ```

   - Without `--comment`, the script prints the Markdown to stdout. Use that to build a
     custom comment (for example a loading vs loaded table) or to edit the PR body's
     `Verification` table.
   - `--pr N` and `--repo OWNER/REPO` override the PR found from the current branch.
   - The gist URL is printed to stderr.

4. Confirm the images render. The script already checks that each raw URL returns 200.
   For a final check, open the comment, or load it in Playwright and assert that each
   `img` in `#issuecomment-<id>` has `naturalWidth > 0`.

## What the script outputs

- Images (`png`, `jpg`, `jpeg`, `gif`, `webp`) become `<img alt="name" src="..." width="800">`.
  For side-by-side states, put two of them in a Markdown table cell with `width="400"`.
- Any other file, such as `mp4` or `webm`, becomes a link. GitHub embeds video only when
  it was uploaded as a comment attachment, so a link is the best a token can do. Keep
  recordings short and under 10 MB.
- URLs are pinned to the gist commit, so uploading a new file with the same name later
  does not change older comments.

## Cleanup

Leave files in place after merge. Comments link to a pinned gist commit, so removing a
file from the gist's latest version does not break older comments. To remove a file
uploaded by mistake, clone the gist, `git rm <owner>-<repo>-<pr>-<file>`, and push. Never
delete the shared gist: every PR's images live in it.

The gist's web page slows down after a few hundred files. Raw URLs, and the script,
are unaffected because it clones with `--depth 1`.

## Supporting skills

- `verify-ui-changes` captures the evidence this skill uploads.
