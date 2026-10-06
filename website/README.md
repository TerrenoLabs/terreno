# @terreno/website

Docusaurus site for Terreno documentation. Private workspace package — not published to npm. Docs content lives in `../docs` (the monorepo `docs/` tree), not inside this package.

## Install

From the monorepo root:

```bash
bun bootstrap
```

## Quick start

From the repo root:

```bash
bun run --filter '@terreno/website' start
```

Or from this directory:

```bash
bun run start
```

The site runs on **port 3001**. Generated API and component pages are produced by `bun run generate` before start/build.

## What's included

- `docusaurus.config.ts` — site config; `docs.path` is `../docs`
- `sidebars.ts` — navigation
- `scripts/generate-component-docs.ts` / `generate-api-reference.ts` — generated reference
- `scripts/docs-audit.ts` — drift checks for READMEs, reference pages, and leakage
- `static/img/terreno-docs-icon.png` and `favicon.png` — docs sprout branding
- `versioned_docs/` — frozen markdown for published versions. The MCP server's versioned doc search reads it, and each version's archived site is built from it

`docs/implementationPlans/` and `docs/tasks/` are excluded from the site (`exclude` in `docusaurus.config.ts`).

## Versioning and deploys

Every build holds one docs tree. Building all versions together put ~4,300 pages in
one bundle and needed more than 8 GB.

- `/` is the current docs from `master`. Old `/next/*` URLs redirect there.
- `/<version>/` is a prebuilt site for each release in `versions.json`. The navbar
  "Versions" dropdown lists them.
- On each `X.Y.0` tag, the CircleCI `archive-docs-version` job snapshots the docs,
  builds that version once with `baseUrl: /<version>/`, uploads it as
  `docs-site.tar.gz` on the GitHub release, and commits the snapshot to `master`.
  The release keeps the newest four versions (`bun run prune-versions`).
- The production deploy builds `/`, then `scripts/ci/docs-archive.sh fetch` unpacks
  every listed version's archive. A missing archive logs a warning, and that
  version's URL 404s.
- Rebuild or backfill one version's archive (needs `GITHUB_TOKEN` with release write):

  ```bash
  scripts/ci/docs-archive.sh build 57.2.0 /tmp/docs-site.tar.gz
  scripts/ci/docs-archive.sh upload 57.2.0 /tmp/docs-site.tar.gz
  ```

- Preview one archived version locally: `DOCS_ARCHIVE_VERSION=57.2.0 bunx docusaurus build`
- Production build: `bun run build` or root `bun run website:build`
- Hosting is Netlify (see the site's Netlify config in the repo). Set `DOCS_PREVIEW=true` for PR preview builds that skip the search index.

## Documentation

Docs index: [docs/README.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/README.md)

## License and Contributing

Licensed under the [MIT License](https://github.com/TerrenoLabs/terreno/blob/master/LICENSE). See [CONTRIBUTING.md](https://github.com/TerrenoLabs/terreno/blob/master/CONTRIBUTING.md) for contribution guidelines.
