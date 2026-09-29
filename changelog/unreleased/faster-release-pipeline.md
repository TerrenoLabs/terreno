---
category: Changed
---

- CircleCI `publish-release` compiles every lockstep package once and publishes them in parallel instead of recompiling and retesting each package in turn. Tagged commits already passed CI on master. Releases drop from 25+ minutes to about 4.
- `deploy-demo` runs alongside `publish-release` instead of after it.
- `scripts/ci/netlify-deploy.sh` passes `--no-build`, so Netlify deploys no longer rerun the root `netlify.toml` docs build (about 3.5 minutes per demo and frontend deploy).
