/**
 * Map a docs-relative path to Terreno package tags used by `terreno_search_docs` filters.
 * Tags are lowercase short names: api, ui, syncdb, admin-backend, admin-frontend, mcp-server, docs.
 */
export const inferPackageTags = (relativePath: string): string[] => {
  const norm = relativePath.replace(/\\/g, "/").toLowerCase();
  const tags = new Set<string>();

  const base = norm.split("/").pop() ?? norm;

  if (base === "api.md" || norm.includes("/resources/api.md")) {
    tags.add("api");
  }
  if (base === "ui.md" || norm.includes("/resources/ui.md")) {
    tags.add("ui");
  }
  if (base === "syncdb.md" || norm.includes("/resources/syncdb.md")) {
    tags.add("syncdb");
  }

  if (norm.includes("admin-backend")) {
    tags.add("admin-backend");
  }
  if (norm.includes("admin-frontend")) {
    tags.add("admin-frontend");
  }
  if (norm.includes("mcp-server")) {
    tags.add("mcp-server");
  }

  if (norm.includes("/reference/generated/api/")) {
    tags.add("api");
  }
  if (norm.includes("/reference/components/") || norm.includes("/components/")) {
    tags.add("ui");
  }

  if (norm.includes("/api/") && !norm.includes("admin-backend")) {
    tags.add("api");
  }
  if (norm.includes("/ui/") && !norm.includes("admin-frontend")) {
    tags.add("ui");
  }
  if (norm.includes("/syncdb/")) {
    tags.add("syncdb");
  }

  if (norm.includes("ui-types") || norm.includes("component")) {
    tags.add("ui");
  }

  if (tags.size === 0) {
    tags.add("docs");
  }

  return [...tags];
};

export const normalizePackageFilter = (pkg: string): string => {
  return pkg
    .trim()
    .replace(/^@terreno\//i, "")
    .toLowerCase();
};
