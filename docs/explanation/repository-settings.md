# Repository settings (maintainers)

Some GitHub settings cannot be committed to the repo. Enable these manually in
the [Terreno repository settings](https://github.com/TerrenoLabs/terreno/settings).

## Discussions

**Path:** Settings → General → Features → Discussions

Enable Discussions and create these categories (see
[public roadmap IP](../implementationPlans/public-roadmap-github.md) for
descriptions):

1. Announcements (maintainers only)
2. Q&A
3. Ideas
4. Agents & AI
5. RFCs
6. Show and tell
7. Docs feedback

## Security

**Path:** Settings → Security → Code security and analysis

- Enable **Private vulnerability reporting** (GitHub PVR as the primary channel;
  `security@terreno.app` is the email fallback — see [SECURITY.md](../../SECURITY.md))

## Branch protection (`master`)

**Path:** Settings → Branches → Branch protection rules → `master`

- Require a pull request before merging
- Require status checks to pass (include CircleCI `repo-policies`, package CI,
  and Rulesync Check jobs relevant to the change — see the check name map in
  [how-to/circleci.md](../how-to/circleci.md))
- Require branches to be up to date before merging
- Do not allow bypassing the above settings

### CircleCI checks

Package CI, policy, Playwright, Maestro web, architectural review, deploy, and
release workflows run under `.circleci/` (see
[how-to/circleci.md](../how-to/circleci.md)). Require the path-filtered CircleCI
check names. Remove required GitHub Action checks for workflow files whose
trigger is `push.branches-ignore: ["**"]`; those checks cannot report anymore. Do not require the
config-only `circleci-config` workflow. Keep Cursor Approval / Security / Bugbot
as GitHub App checks; they are not CircleCI jobs.

## GitHub Environments (GCP preview)

**Path:** Settings → Environments

`cd.yml` is disabled; CircleCI `gcp-cd-preview` performs GCP previews and
halts on fork PRs. While the GitHub WIF provider still exists, keep the
`gcp-cd-preview` environment restricted with a **deployment branch policy** or
**required reviewers** so a fork that re-enables `cd.yml` cannot mint a prod
WIF token.

### Actions secrets for CircleCI hooks

`preview-cleanup.yml` (PR close) and `publish-on-tag.yml` (manual publish demo
redeploy) start CircleCI pipelines. Set the secret `CIRCLECI_TOKEN` and the
variable `CIRCLECI_PIPELINE_DEFINITION_ID` under Settings → Secrets and
variables → Actions.

## Merge settings

**Path:** Settings → General → Pull Requests

- Allow **squash merging** only (disable merge commits and rebase merging)
- Enable **Automatically delete head branches** after merge
