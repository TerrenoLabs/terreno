import {readFile} from "node:fs/promises";
import {join, resolve} from "node:path";
import {
  type AnnouncementReleaseImportInput,
  announcementReleaseImportSchema,
} from "@terreno/announcements";
import {APIError, logger} from "@terreno/api";

const PACK_SCHEMA = "terreno.announcement-pack/v1";
const DEFAULT_UPLOAD_TOKEN = "terreno-example-announcement-upload";
const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

interface PackManifest {
  announcements?: unknown;
  defaults?: unknown;
  release?: unknown;
  schema?: unknown;
}

const parseAnnouncementFile = ({
  contents,
  fileName,
}: {
  contents: string;
  fileName: string;
}): Record<string, unknown> => {
  const match = FRONTMATTER_PATTERN.exec(contents);
  if (!match) {
    throw new APIError({
      status: 400,
      title: `${fileName} must start with YAML frontmatter delimited by ---`,
    });
  }
  const frontmatter = Bun.YAML.parse(match[1] ?? "");
  if (!frontmatter || typeof frontmatter !== "object" || Array.isArray(frontmatter)) {
    throw new APIError({status: 400, title: `${fileName} frontmatter must be a YAML object`});
  }
  return {...(frontmatter as Record<string, unknown>), body: (match[2] ?? "").trim()};
};

export const loadAnnouncementPack = async ({
  directory,
  publish = false,
}: {
  directory: string;
  publish?: boolean;
}): Promise<AnnouncementReleaseImportInput> => {
  const manifest = Bun.YAML.parse(
    await readFile(join(directory, "pack.yaml"), "utf8")
  ) as PackManifest;
  if (manifest?.schema !== PACK_SCHEMA) {
    throw new APIError({status: 400, title: `pack.yaml schema must be ${PACK_SCHEMA}`});
  }
  if (
    !Array.isArray(manifest.announcements) ||
    !manifest.announcements.every((file) => typeof file === "string")
  ) {
    throw new APIError({
      status: 400,
      title: "pack.yaml announcements must be a list of Markdown file names",
    });
  }

  const announcements = await Promise.all(
    (manifest.announcements as string[]).map(async (fileName) =>
      parseAnnouncementFile({
        contents: await readFile(join(directory, fileName), "utf8"),
        fileName,
      })
    )
  );

  return announcementReleaseImportSchema.parse({
    announcements,
    defaults: manifest.defaults,
    publish,
    release: manifest.release,
  });
};

const uploadAnnouncementPack = async ({
  apiUrl,
  body,
}: {
  apiUrl: string;
  body: AnnouncementReleaseImportInput;
}): Promise<unknown> => {
  const token = process.env.ANNOUNCEMENTS_UPLOAD_TOKEN ?? DEFAULT_UPLOAD_TOKEN;
  const response = await fetch(`${apiUrl.replace(/\/$/, "")}/announcements/import-release`, {
    body: JSON.stringify(body),
    headers: {Authorization: `Bearer ${token}`, "Content-Type": "application/json"},
    method: "POST",
  });
  const result = await response.json();
  if (!response.ok) {
    throw new APIError({
      detail: JSON.stringify(result),
      status: 502,
      title: `Upload failed with ${response.status}`,
    });
  }
  return result;
};

export const runAnnouncementPackCli = async ({
  args,
  write,
}: {
  args: string[];
  write: (output: string) => void;
}): Promise<void> => {
  const uploadIndex = args.indexOf("--upload");
  const apiUrl = uploadIndex === -1 ? undefined : args[uploadIndex + 1];
  const directory = args.find(
    (arg, index) => !arg.startsWith("--") && (uploadIndex === -1 || index !== uploadIndex + 1)
  );
  if (!directory || (uploadIndex !== -1 && !apiUrl)) {
    throw new APIError({
      status: 400,
      title: "Usage: bun run announcements:pack <pack-directory> [--publish] [--upload <api-url>]",
    });
  }

  const body = await loadAnnouncementPack({
    directory: resolve(directory),
    publish: args.includes("--publish"),
  });
  if (!apiUrl) {
    write(`${JSON.stringify(body, null, 2)}\n`);
    return;
  }

  const result = await uploadAnnouncementPack({apiUrl, body});
  logger.info("Announcement pack uploaded", {apiUrl, publish: body.publish});
  write(`${JSON.stringify(result, null, 2)}\n`);
};

if (import.meta.main) {
  try {
    await runAnnouncementPackCli({
      args: process.argv.slice(2),
      write: process.stdout.write.bind(process.stdout),
    });
  } catch (error: unknown) {
    logger.error("Announcement pack failed", {
      detail: error instanceof APIError ? error.detail : undefined,
      error: String(error),
    });
    process.exitCode = 1;
  }
}
