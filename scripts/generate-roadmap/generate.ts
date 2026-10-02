import {existsSync, readdirSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {DateTime} from "luxon";

import {type RoadmapItem, renderRoadmapMarkdown} from "./lib";

const PROJECT_ITEMS_QUERY = `
query($owner: String!, $projectNumber: Int!, $cursor: String) {
  organization(login: $owner) {
    projectV2(number: $projectNumber) {
      url
      items(first: 100, after: $cursor) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          content {
            ... on Issue {
              title
              url
            }
          }
          fieldValues(first: 20) {
            nodes {
              ... on ProjectV2ItemFieldSingleSelectValue {
                name
                field {
                  ... on ProjectV2SingleSelectField {
                    name
                  }
                }
              }
              ... on ProjectV2ItemFieldTextValue {
                text
                field {
                  ... on ProjectV2FieldCommon {
                    name
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
`;

interface GraphQlFieldValue {
  field?: {name?: string};
  name?: string;
  text?: string;
}

interface GraphQlItem {
  content?: {title?: string; url?: string} | null;
  fieldValues?: {nodes?: GraphQlFieldValue[]};
}

const getRequiredEnvironmentVariable = (name: string): string => {
  const value = process.env[name]?.trim() ?? "";
  if (value === "") {
    return "";
  }

  return value;
};

const parseFieldValues = (nodes: GraphQlFieldValue[] | undefined): Record<string, string> => {
  const values: Record<string, string> = {};

  for (const node of nodes ?? []) {
    const fieldName = node.field?.name;
    if (fieldName === undefined || fieldName === "") {
      continue;
    }

    if (node.name !== undefined && node.name !== "") {
      values[fieldName] = node.name;
    } else if (node.text !== undefined) {
      values[fieldName] = node.text;
    }
  }

  return values;
};

const toRoadmapItem = (item: GraphQlItem): RoadmapItem | null => {
  const title = item.content?.title?.trim() ?? "";
  const url = item.content?.url?.trim() ?? "";
  if (title === "" || url === "") {
    return null;
  }

  const fields = parseFieldValues(item.fieldValues?.nodes);
  return {
    area: fields.Area ?? "dx",
    impact: fields.Impact ?? "Improvement",
    ipSlug: fields.IP?.trim() === "" ? null : (fields.IP ?? null),
    status: fields.Status ?? "Inbox",
    target: fields.Target ?? "Future",
    title,
    url,
  };
};

const fetchProjectItems = async ({
  owner,
  projectNumber,
  token,
}: {
  owner: string;
  projectNumber: number;
  token: string;
}): Promise<{items: RoadmapItem[]; projectFound: boolean; projectUrl: string}> => {
  const items: RoadmapItem[] = [];
  let cursor: string | null = null;
  let projectFound = false;
  let projectUrl = `https://github.com/orgs/${owner}/projects/${projectNumber}`;

  for (;;) {
    const response = await fetch("https://api.github.com/graphql", {
      body: JSON.stringify({
        query: PROJECT_ITEMS_QUERY,
        variables: {cursor, owner, projectNumber},
      }),
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "terreno-roadmap-generate",
      },
      method: "POST",
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`GitHub GraphQL request failed: ${response.status} ${body}`);
    }

    const payload = (await response.json()) as {
      data?: {
        organization?: {
          projectV2?: {
            items?: {nodes?: GraphQlItem[]; pageInfo?: {endCursor?: string; hasNextPage?: boolean}};
            url?: string;
          };
        };
      };
      errors?: {message: string}[];
    };

    if (payload.errors !== undefined && payload.errors.length > 0) {
      throw new Error(payload.errors.map((error) => error.message).join("; "));
    }

    const project = payload.data?.organization?.projectV2;
    if (project !== undefined && project !== null) {
      projectFound = true;
    }
    if (project?.url !== undefined) {
      projectUrl = project.url;
    }

    for (const node of project?.items?.nodes ?? []) {
      const roadmapItem = toRoadmapItem(node);
      if (roadmapItem !== null) {
        items.push(roadmapItem);
      }
    }

    if (project?.items?.pageInfo?.hasNextPage !== true) {
      break;
    }

    cursor = project.items.pageInfo.endCursor ?? null;
  }

  return {items, projectFound, projectUrl};
};

export const main = async (): Promise<void> => {
  const missing: string[] = [];
  const token = getRequiredEnvironmentVariable("GITHUB_TOKEN");
  const projectNumberRaw = getRequiredEnvironmentVariable("TERRENO_PROJECT_NUMBER");
  const owner = getRequiredEnvironmentVariable("GITHUB_REPOSITORY_OWNER") || "TerrenoLabs";

  if (token === "") {
    missing.push("GITHUB_TOKEN");
  }
  if (projectNumberRaw === "") {
    missing.push("TERRENO_PROJECT_NUMBER");
  }

  if (missing.length > 0) {
    console.error(
      `generate-roadmap: missing required environment variables: ${missing.join(", ")}`
    );
    process.exit(1);
  }

  const projectNumber = Number.parseInt(projectNumberRaw, 10);
  if (Number.isNaN(projectNumber)) {
    console.error(
      `generate-roadmap: TERRENO_PROJECT_NUMBER must be an integer, got "${projectNumberRaw}"`
    );
    process.exit(1);
  }

  const {items, projectFound, projectUrl} = await fetchProjectItems({owner, projectNumber, token});

  // A missing project resolves to an empty item list, which would otherwise
  // overwrite a good ROADMAP.md with an empty one and commit the result.
  if (!projectFound) {
    console.error(
      `generate-roadmap: project ${projectNumber} was not found for owner "${owner}". ` +
        "Check TERRENO_PROJECT_NUMBER and that the token has read:project scope. " +
        "Refusing to overwrite ROADMAP.md."
    );
    process.exit(1);
  }

  const tasksDirectory = join(process.cwd(), "docs/tasks");
  const taskSlugs = new Set(
    existsSync(tasksDirectory)
      ? readdirSync(tasksDirectory)
          .filter((file) => file.endsWith(".md") && file !== "README.md")
          .map((file) => file.slice(0, -".md".length))
      : []
  );

  const markdown = renderRoadmapMarkdown({
    generatedAtIso: DateTime.utc().toISO() ?? DateTime.utc().toISODate(),
    items,
    projectUrl,
    taskSlugs,
  });

  const outputPath = join(process.cwd(), "ROADMAP.md");
  writeFileSync(outputPath, markdown, "utf8");
  console.info(`Wrote ${outputPath} (${items.length} project items)`);
};

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
