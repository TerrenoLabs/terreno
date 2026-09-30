/**
 * Single source of truth for mapping an issue form's "Affected package"
 * dropdown onto an `area:*` label and its "Kind" dropdown onto a `type:*`
 * label.
 *
 * `.github/workflows/triage.yml` runs this module rather than carrying its own
 * copy of the tables, so the two cannot drift. GitHub issue forms cannot set
 * labels from a dropdown, so triage applies `type:*` from Kind.
 */
export const AREA_BY_PACKAGE: Record<string, string> = {
  "@terreno/admin-backend": "area:admin",
  "@terreno/admin-frontend": "area:admin",
  "@terreno/admin-spa": "area:admin",
  "@terreno/ai": "area:ai",
  "@terreno/api": "area:api",
  "@terreno/api-health": "area:api",
  "@terreno/cli": "area:mcp",
  "@terreno/comms": "area:api",
  "@terreno/feature-flags": "area:api",
  "@terreno/jobs": "area:api",
  "@terreno/mcp": "area:mcp",
  "@terreno/rtk": "area:syncdb",
  "@terreno/syncdb": "area:syncdb",
  "@terreno/test": "area:api",
  "@terreno/ui": "area:ui",
  docs: "area:docs",
  examples: "area:examples",
  mcp: "area:mcp",
  plugins: "area:dx",
};

export const KIND_BY_VALUE: Record<string, string> = {
  Bug: "type:bug",
  Chore: "type:chore",
  Docs: "type:docs",
  Feature: "type:feature",
};

export const parsePackageAreaFromIssueBody = (body: string): string | null => {
  const packageSection = body.match(/### Affected package\s*\n+([^\n#]+)/i);
  if (packageSection === null) {
    return null;
  }

  const value = packageSection[1]?.trim() ?? "";
  return AREA_BY_PACKAGE[value] ?? null;
};

export const parseKindTypeFromIssueBody = (body: string): string | null => {
  const kindSection = body.match(/### Kind\s*\n+([^\n#]+)/i);
  if (kindSection === null) {
    return null;
  }

  const value = kindSection[1]?.trim() ?? "";
  return KIND_BY_VALUE[value] ?? null;
};

/**
 * Labels already on the issue win over the body. Issues opened by
 * `roadmap:sync` (and anyone using `gh issue create --label`) carry their
 * `area:*` / `type:*` at creation and have no issue-form body to parse, so
 * reading only the body made triage ask for an area the issue already had.
 */
export const resolveTriageLabels = ({
  body,
  existingLabels,
}: {
  body: string;
  existingLabels: string[];
}): {area: string; type: string} => {
  const existingArea = existingLabels.find((label) => label.startsWith("area:"));
  const existingType = existingLabels.find((label) => label.startsWith("type:"));
  return {
    area: existingArea ?? parsePackageAreaFromIssueBody(body) ?? "",
    type: existingType ?? parseKindTypeFromIssueBody(body) ?? "",
  };
};

/** Reads the `ISSUE_LABELS` JSON array of names; anything malformed is no labels. */
export const parseIssueLabels = (raw: string | undefined): string[] => {
  if (raw === undefined || raw.trim() === "") {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((label): label is string => typeof label === "string")
      : [];
  } catch {
    return [];
  }
};

/**
 * Writes `area=<label>` to the file named by GITHUB_OUTPUT so the triage
 * workflow can read it in a later step. An unrecognized package yields an
 * empty value, which the workflow treats as "ask the reporter".
 */
export const main = async (): Promise<void> => {
  const body = process.env.ISSUE_BODY ?? "";
  const outputPath = process.env.GITHUB_OUTPUT;
  const {area, type} = resolveTriageLabels({
    body,
    existingLabels: parseIssueLabels(process.env.ISSUE_LABELS),
  });

  if (outputPath === undefined || outputPath === "") {
    console.info(area);
    return;
  }

  await Bun.write(
    Bun.file(outputPath),
    `${await readExisting(outputPath)}area=${area}\ntype=${type}\n`
  );
  console.info(`Resolved area label: ${area === "" ? "(none)" : area}`);
  console.info(`Resolved type label: ${type === "" ? "(none)" : type}`);
};

const readExisting = async (path: string): Promise<string> => {
  const file = Bun.file(path);
  return (await file.exists()) ? file.text() : "";
};

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
