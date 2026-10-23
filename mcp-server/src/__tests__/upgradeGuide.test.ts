import {afterEach, describe, expect, test} from "bun:test";
import {existsSync, mkdirSync, writeFileSync} from "node:fs";
import {join} from "node:path";

import {askUpdateHelp, getUpdateNote, searchUpdateNotes} from "../help/updateNotes.js";
import {getUpgradeGuideMarkdown} from "../upgradeGuide.js";

describe("getUpgradeGuideMarkdown", () => {
  test("returns bundled notes for a semver range when upgrade files exist", () => {
    const text = getUpgradeGuideMarkdown("0.19.0", "0.20.0");
    expect(text).toContain("0.20.0");
    expect(text).toMatch(/Upgrade to 0\.20\.0/i);
  });

  test("returns a single-version note when from and to match an existing file", () => {
    const text = getUpgradeGuideMarkdown("0.20.0", "0.20.0");
    expect(text).toContain("0.20.0");
  });

  test("range fully covered lists recorded notes and concatenates them", () => {
    const text = getUpgradeGuideMarkdown("0.19.0", "0.20.0");
    expect(text).toContain("Recorded notes in 0.19.0 → 0.20.0: 0.20.0");
    expect(text).toMatch(/Upgrade to 0\.20\.0/i);
    expect(text).not.toContain("No bundled notes for");
  });

  test("range partially covered lists recorded notes and names missing minors", () => {
    const text = getUpgradeGuideMarkdown("0.21.0", "0.31.0");
    expect(text).toContain("Recorded notes in 0.21.0 → 0.31.0: 0.30.0, 0.31.0");
    expect(text).toContain(
      "No bundled notes for 0.22.0, 0.23.0, 0.24.0, 0.25.0, 0.26.0, 0.27.0, 0.28.0, 0.29.0"
    );
    expect(text).toContain("Upgrade to 0.30.0");
    expect(text).toContain("Upgrade to 0.31.0");
  });

  test("range with no notes names the versions and warns against assuming no changes", () => {
    const text = getUpgradeGuideMarkdown("99.0.0", "99.1.0");
    expect(text).toContain("No upgrade notes recorded for 99.0.0 → 99.1.0");
    expect(text).toContain("No bundled notes for 99.1.0");
    expect(text).toContain("Recorded notes in 99.0.0 → 99.1.0: none");
    expect(text).toContain("Do not conclude that nothing changed");
  });

  test("invalid range is rejected when fromVersion is after toVersion", () => {
    const text = getUpgradeGuideMarkdown("0.21.0", "0.20.0");
    expect(text).toContain("Invalid version range");
    expect(text).toContain("0.21.0");
    expect(text).toContain("0.20.0");
  });

  test("returns the 0.21.0 to 0.30.0 backfill note for that range", () => {
    const text = getUpgradeGuideMarkdown("0.21.0", "0.30.0");
    expect(text).toContain("Upgrade to 0.30.0");
    expect(text).toContain("OpenFeature");
    expect(text).toContain("flagConfiguration");
    expect(text).toContain("disableSearch");
    expect(text).toContain("APIError");
  });

  test("includes the 0.30.0 backfill when jumping 0.21.0 to current 57.2.0", () => {
    const text = getUpgradeGuideMarkdown("0.21.0", "57.2.0");
    expect(text).toContain("Upgrade to 0.30.0");
    expect(text).toContain("OpenFeature");
    expect(text).toContain("Upgrade to 57.2.0");
  });
});

describe("updateNotes help", () => {
  const previousDocsDir = process.env.TERRENO_MCP_DOCS_DIR;

  afterEach(() => {
    if (previousDocsDir) {
      process.env.TERRENO_MCP_DOCS_DIR = previousDocsDir;
    } else {
      delete process.env.TERRENO_MCP_DOCS_DIR;
    }
    delete process.env.TERRENO_HELP_API_URL;
    delete process.env.TERRENO_HELP_API_TOKEN;
  });

  test("searches bundled upgrade notes", async () => {
    const tmpDir = join("/tmp", `terreno-mcp-help-search-${Date.now()}`);
    mkdirSync(join(tmpDir, "upgrades"), {recursive: true});
    writeFileSync(
      join(tmpDir, "upgrades", "57.3.0.md"),
      "# Billing\n\nStripe webhook validation changed."
    );
    process.env.TERRENO_MCP_DOCS_DIR = tmpDir;

    const {hits, sources} = await searchUpdateNotes({
      queries: ["billing"],
      source: "bundled",
    });

    expect(sources).toContain("bundled-upgrades");
    expect(hits[0]?.id).toBe("upgrade:57.3.0");
    expect(hits[0]?.excerpt).toContain("Stripe webhook");
  });

  test("returns a bundled upgrade note in full", async () => {
    const tmpDir = join("/tmp", `terreno-mcp-help-detail-${Date.now()}`);
    mkdirSync(join(tmpDir, "upgrades"), {recursive: true});
    const body = "Full upgrade body for syncdb.";
    writeFileSync(join(tmpDir, "upgrades", "57.2.0.md"), body);
    process.env.TERRENO_MCP_DOCS_DIR = tmpDir;

    const detail = await getUpdateNote({id: "upgrade:57.2.0"});
    expect(detail.kind).toBe("upgrade");
    expect(detail.body).toContain("Full upgrade body");
  });

  test("formats askUpdateHelp responses with match list", async () => {
    const tmpDir = join("/tmp", `terreno-mcp-help-ask-${Date.now()}`);
    mkdirSync(join(tmpDir, "upgrades"), {recursive: true});
    writeFileSync(join(tmpDir, "upgrades", "57.1.0.md"), "Popover component added.");
    process.env.TERRENO_MCP_DOCS_DIR = tmpDir;

    const answer = await askUpdateHelp({question: "popover"});
    expect(answer).toContain("Top matches");
    expect(answer).toContain("upgrade:57.1.0");
  });

  test("reports when bundled docs directory is missing", async () => {
    const tmpDir = join("/tmp", `terreno-mcp-help-missing-${Date.now()}`);
    process.env.TERRENO_MCP_DOCS_DIR = join(tmpDir, "missing-docs");
    expect(existsSync(join(tmpDir, "missing-docs", "upgrades"))).toBe(false);

    const {hits} = await searchUpdateNotes({queries: ["anything"], source: "bundled"});
    expect(hits).toEqual([]);
  });

  test("lists recent bundled upgrades when no query is provided", async () => {
    const tmpDir = join("/tmp", `terreno-mcp-help-recent-${Date.now()}`);
    mkdirSync(join(tmpDir, "upgrades"), {recursive: true});
    writeFileSync(join(tmpDir, "upgrades", "57.0.0.md"), "Older release.");
    writeFileSync(join(tmpDir, "upgrades", "57.1.0.md"), "Newer release.");
    process.env.TERRENO_MCP_DOCS_DIR = tmpDir;

    const {hits} = await searchUpdateNotes({limit: 1, queries: [], source: "bundled"});
    expect(hits[0]?.id).toBe("upgrade:57.1.0");
  });

  test("searches announcement help API with separate q params", async () => {
    const tmpDir = join("/tmp", `terreno-mcp-help-api-${Date.now()}`);
    mkdirSync(join(tmpDir, "upgrades"), {recursive: true});
    process.env.TERRENO_MCP_DOCS_DIR = tmpDir;
    process.env.TERRENO_HELP_API_URL = "http://localhost:4000";
    process.env.TERRENO_HELP_API_TOKEN = "test-token";

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      expect(url).toContain("q=billing");
      expect(url).toContain("q=webhooks");
      expect(init?.headers).toEqual({
        Accept: "application/json",
        Authorization: "Bearer test-token",
      });
      return new Response(
        JSON.stringify({
          data: [
            {
              excerpt: "Billing webhook update",
              id: "abc123",
              status: "published",
              title: "Billing changes",
            },
          ],
        }),
        {status: 200}
      );
    };

    const {hits, sources} = await searchUpdateNotes({
      queries: ["billing", "webhooks"],
      source: "announcement",
    });

    globalThis.fetch = originalFetch;
    expect(sources).toContain("announcements-api");
    expect(hits[0]?.id).toBe("announcement:abc123");
    expect(hits[0]?.kind).toBe("announcement");
  });

  test("prefers announcement hits before bundled upgrades in auto mode", async () => {
    const tmpDir = join("/tmp", `terreno-mcp-help-auto-${Date.now()}`);
    mkdirSync(join(tmpDir, "upgrades"), {recursive: true});
    for (let index = 0; index < 12; index += 1) {
      writeFileSync(join(tmpDir, "upgrades", `57.${index}.0.md`), `Billing update ${index}`);
    }
    process.env.TERRENO_MCP_DOCS_DIR = tmpDir;
    process.env.TERRENO_HELP_API_URL = "http://localhost:4000";

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          data: [
            {excerpt: "Product note", id: "live1", status: "published", title: "Billing update"},
          ],
        }),
        {status: 200}
      );

    const {hits} = await searchUpdateNotes({limit: 5, queries: ["billing"], source: "auto"});
    globalThis.fetch = originalFetch;

    expect(hits[0]?.id).toBe("announcement:live1");
    expect(hits.some((hit) => hit.kind === "upgrade")).toBe(true);
  });

  test("returns announcement detail from help API", async () => {
    process.env.TERRENO_HELP_API_URL = "http://localhost:4000";

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      expect(String(input)).toContain("/announcements/help/abc123");
      return new Response(
        JSON.stringify({
          data: {
            body: "Full announcement body",
            id: "abc123",
            status: "published",
            title: "Live update",
          },
        }),
        {status: 200}
      );
    };

    const detail = await getUpdateNote({id: "announcement:abc123"});
    globalThis.fetch = originalFetch;
    expect(detail.body).toContain("Full announcement body");
    expect(detail.kind).toBe("announcement");
  });

  test("reports missing help API config for announcement detail", async () => {
    await expect(getUpdateNote({id: "announcement:missing"})).rejects.toThrow(
      "TERRENO_HELP_API_URL"
    );
  });

  test("formats empty askUpdateHelp questions", async () => {
    const answer = await askUpdateHelp({question: "   "});
    expect(answer).toContain("non-empty");
  });

  test("keeps bundled hits and reports the error when the help API fails", async () => {
    const tmpDir = join("/tmp", `terreno-mcp-help-api-error-${Date.now()}`);
    mkdirSync(join(tmpDir, "upgrades"), {recursive: true});
    writeFileSync(join(tmpDir, "upgrades", "57.5.0.md"), "Billing portal moved.");
    process.env.TERRENO_MCP_DOCS_DIR = tmpDir;
    process.env.TERRENO_HELP_API_URL = "http://localhost:4000/";

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      expect(String(input)).toStartWith("http://localhost:4000/announcements/help/search?");
      return new Response("help api unavailable", {status: 503});
    };
    try {
      const {hits, sources} = await searchUpdateNotes({queries: ["billing"], source: "auto"});
      expect(sources).toEqual([
        "bundled-upgrades",
        "announcements-api-error:Help API 503: help api unavailable",
      ]);
      expect(hits.map((hit) => hit.id)).toEqual(["upgrade:57.5.0"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("passes includeArchived to the help API and keeps typed announcement fields", async () => {
    process.env.TERRENO_HELP_API_URL = "http://localhost:4000";

    const originalFetch = globalThis.fetch;
    const requested: string[] = [];
    globalThis.fetch = async (input) => {
      const url = String(input);
      requested.push(url);
      if (url.includes("/announcements/help/search")) {
        return new Response(
          JSON.stringify({
            data: [{archivedAt: "2026-01-02", excerpt: 3, id: "old1", version: 4}],
          }),
          {status: 200}
        );
      }
      return new Response(
        JSON.stringify({
          data: {
            archivedAt: "2026-01-02",
            expiresAt: "2026-02-01",
            id: "old1",
            platforms: ["web", 7, "ios"],
            publishedAt: "2026-01-01",
            version: 4,
          },
        }),
        {status: 200}
      );
    };
    try {
      const {hits, sources} = await searchUpdateNotes({
        includeArchived: true,
        queries: ["billing"],
        source: "announcement",
      });
      expect(sources).toEqual(["announcements-api"]);
      expect(hits).toEqual([
        {
          archivedAt: "2026-01-02",
          excerpt: "",
          id: "announcement:old1",
          kind: "announcement",
          publishedAt: undefined,
          status: undefined,
          title: "Announcement",
          version: "4",
        },
      ]);

      const detail = await getUpdateNote({id: "old1", includeArchived: true});
      expect(detail).toEqual({
        archivedAt: "2026-01-02",
        body: "",
        expiresAt: "2026-02-01",
        id: "announcement:old1",
        kind: "announcement",
        platforms: ["web", "ios"],
        publishedAt: "2026-01-01",
        status: undefined,
        title: "Announcement",
        version: "4",
      });
      expect(requested).toEqual([
        "http://localhost:4000/announcements/help/search?limit=10&includeArchived=true&q=billing",
        "http://localhost:4000/announcements/help/old1?includeArchived=true",
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
