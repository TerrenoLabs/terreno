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
- Require status checks to pass (include Repository policies, package CI, and
  Rulesync Check jobs relevant to the change)
- Require branches to be up to date before merging
- Do not allow bypassing the above settings

### CircleCI dual-run (in progress)

Package CI / policy / Playwright twins live under `.circleci/` (see
[how-to/circleci.md](../how-to/circleci.md)). **Keep requiring the existing GitHub
Actions check names** until a twin is trusted; then add the CircleCI job name and
remove the GHA workflow. Do not require CircleCI deploy jobs yet (deploys not
ported).

## Merge settings

**Path:** Settings → General → Pull Requests

- Allow **squash merging** only (disable merge commits and rebase merging)
- Enable **Automatically delete head branches** after merge
