import {describe, expect, test} from "bun:test";

import {inferPackageTags, normalizePackageFilter} from "../search/inferPackages.js";

describe("normalizePackageFilter", () => {
  test("strips @terreno/ prefix case-insensitively", () => {
    expect(normalizePackageFilter("  @terreno/API  ")).toBe("api");
    expect(normalizePackageFilter("@Terreno/UI")).toBe("ui");
  });
});

describe("inferPackageTags", () => {
  test("tags bundled resource markdown files", () => {
    expect(inferPackageTags("resources/api.md")).toContain("api");
    expect(inferPackageTags("resources/ui.md")).toContain("ui");
    expect(inferPackageTags("resources/syncdb.md")).toContain("syncdb");
    expect(inferPackageTags("resources/rtk.md")).not.toContain("rtk");
  });

  test("tags admin and mcp paths", () => {
    expect(inferPackageTags("versioned/0.20.0/explanation/admin-backend/foo.md")).toContain(
      "admin-backend"
    );
    expect(inferPackageTags("docs/explanation/admin-frontend/screens.md")).toContain(
      "admin-frontend"
    );
    expect(inferPackageTags("docs/reference/mcp-server.md")).toContain("mcp-server");
  });

  test("tags generated api reference paths", () => {
    expect(inferPackageTags("versioned/next/reference/generated/api/foo.md")).toContain("api");
  });

  test("tags ui reference and component paths", () => {
    expect(inferPackageTags("versioned/next/reference/components/button.mdx")).toContain("ui");
    expect(inferPackageTags("resources/ui-types-component/Button.md")).toContain("ui");
  });

  test("tags segment-based api and syncdb paths", () => {
    expect(inferPackageTags("docs/explanation/api/model-router.md")).toContain("api");
    expect(inferPackageTags("docs/how-to/syncdb/setup.md")).toContain("syncdb");
  });

  test("defaults to docs when no rule matches", () => {
    expect(inferPackageTags("versioned/next/explanation/random-topic.md")).toEqual(["docs"]);
  });
});
