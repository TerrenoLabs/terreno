import {readFileSync} from "node:fs";
import {join} from "node:path";
import type * as Preset from "@docusaurus/preset-classic";
import type {Config} from "@docusaurus/types";
import {themes as prismThemes} from "prism-react-renderer";

const demoUrl = process.env.DEMO_URL ?? "https://terreno-demo.netlify.app";
const docsUrl = process.env.DOCS_URL ?? "https://terreno-docs.netlify.app";
// Search is skipped on PR previews to keep them fast.
const isPreview = process.env.DOCS_PREVIEW === "true";
// Set when building one released version once, at release time, from its
// website/versioned_docs snapshot. Production deploys unpack those prebuilt sites
// under /<version>/ instead of rebuilding every version (see scripts/ci/docs-archive.sh).
const archiveVersion = process.env.DOCS_ARCHIVE_VERSION?.trim() || undefined;
// Newest first; the release job keeps this list pruned.
const releasedVersions: string[] = JSON.parse(
  readFileSync(join(__dirname, "versions.json"), "utf8")
);

// pathname:// links skip baseUrl, so the same hrefs work from the root site and
// from every archived site.
const versionDropdown = {
  items: [
    {label: "Latest (master)", target: "_self", to: "pathname:///"},
    ...releasedVersions.map((version) => ({
      label: version,
      target: "_self",
      to: `pathname:///${version}/`,
    })),
  ],
  label: archiveVersion ?? "Latest",
  position: "right" as const,
  type: "dropdown" as const,
};

const docsSource = archiveVersion
  ? {
      path: `versioned_docs/version-${archiveVersion}`,
      sidebarPath: `./versioned_sidebars/version-${archiveVersion}-sidebars.json`,
    }
  : {
      editUrl: "https://github.com/TerrenoLabs/terreno/tree/master/docs/",
      path: "../docs",
      sidebarPath: "./sidebars.ts",
    };

const searchTheme: [string, Record<string, unknown>] = [
  require.resolve("@easyops-cn/docusaurus-search-local"),
  {
    docsRouteBasePath: "/",
    hashed: true,
    indexBlog: false,
    language: ["en"],
  },
];

const config: Config = {
  baseUrl: archiveVersion ? `/${archiveVersion}/` : "/",
  favicon: "img/favicon.png",
  future: {
    faster: true,
    v4: {
      removeLegacyPostBuildHeadAttribute: true,
    },
  },
  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },
  markdown: {
    format: "detect",
  },
  onBrokenLinks: "warn",
  onBrokenMarkdownLinks: "warn",
  organizationName: "TerrenoLabs",
  plugins: archiveVersion
    ? []
    : [
        [
          "@docusaurus/plugin-client-redirects",
          {
            // The site used to serve unreleased docs under /next; keep those links working.
            createRedirects: (existingPath: string): string[] => [`/next${existingPath}`],
            redirects: [{from: "/next/reference/rtk", to: "/how-to/migrate-rtk-to-syncdb"}],
          },
        ],
      ],
  presets: [
    [
      "classic",
      {
        blog: false,
        docs: {
          ...docsSource,
          // Every build holds one docs tree. Building all versions together put ~4,300
          // pages in one rspack bundle and pushed builds past 8 GB.
          disableVersioning: true,
          exclude: ["**/implementationPlans/**", "**/tasks/**"],
          routeBasePath: "/",
          showLastUpdateAuthor: false,
          showLastUpdateTime: false,
        },
        theme: {
          customCss: "./src/css/custom.css",
        },
      } satisfies Preset.Options,
    ],
  ],
  projectName: "terreno",
  tagline: "Terreno is Django/Rails for TypeScript — with universal app support.",
  themeConfig: {
    ...(archiveVersion
      ? {
          announcementBar: {
            content: `These docs are for Terreno ${archiveVersion}. <a href="/">Read the latest docs</a>.`,
            id: `archived-${archiveVersion}`,
            isCloseable: false,
          },
        }
      : {}),
    customFields: {
      demoUrl,
    },
    footer: {
      copyright: `Copyright © ${new Date().getFullYear()} Flourish Health.`,
      links: [
        {
          items: [
            {label: "Getting started", to: "/tutorials/getting-started"},
            {label: "API reference", to: "/reference/api"},
            {label: "UI components", to: "/reference/components/button"},
          ],
          title: "Docs",
        },
        {
          items: [
            {href: "https://github.com/TerrenoLabs/terreno", label: "GitHub"},
            {
              href: "https://github.com/TerrenoLabs/terreno/blob/master/ROADMAP.md",
              label: "Roadmap",
            },
            {
              href: "https://github.com/TerrenoLabs/terreno/discussions",
              label: "Discussions",
            },
            {
              href: "https://github.com/TerrenoLabs/terreno/discussions/categories/docs-feedback",
              label: "Docs feedback",
            },
            {href: demoUrl, label: "Component demo"},
          ],
          title: "Community",
        },
      ],
      style: "dark",
    },
    metadata: [
      {
        content: "Terreno is Django/Rails for TypeScript — with universal app support.",
        name: "description",
      },
      {
        content: "Terreno is Django/Rails for TypeScript — with universal app support.",
        property: "og:description",
      },
    ],
    navbar: {
      items: [
        versionDropdown,
        {
          href: "https://github.com/TerrenoLabs/terreno",
          label: "GitHub",
          position: "right",
        },
        {
          href: demoUrl,
          label: "Component Demo",
          position: "right",
        },
      ],
      logo: {
        alt: "Terreno",
        src: "img/terreno-docs-icon.png",
      },
      title: "Terreno",
    },
    prism: {
      additionalLanguages: ["bash", "diff", "json", "typescript", "tsx"],
      darkTheme: prismThemes.dracula,
      theme: prismThemes.github,
    },
  } satisfies Preset.ThemeConfig,
  // Local search indexes every MDX page. Skip it on PR previews — the lunr
  // pass is a large fraction of `docusaurus build` and reviewers use in-page
  // find. Production `master` still ships the search index.
  themes: isPreview ? [] : [searchTheme],
  title: "Terreno",
  url: docsUrl,
};

export default config;
