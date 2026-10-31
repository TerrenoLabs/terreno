import {APIError} from "@terreno/api";
import {strFromU8, unzipSync} from "fflate";
import {parse as parseYaml} from "yaml";

export interface SkillPackageFile {
  data: Uint8Array;
  filename: string;
  mimeType: string;
}

export interface SkillPackage {
  description: string;
  files: SkillPackageFile[];
  instructions: string;
  name: string;
}

const SKILL_FILENAME = "SKILL.md";
const MAX_FILES = 20;
const MAX_FILES_BYTES = 10 * 1024 * 1024;
const MAX_SKILL_MD_BYTES = 1024 * 1024;
/** Longest `instructions` a skill may store; an upload past it is a 400 before any file is saved. */
export const SKILL_MAX_INSTRUCTIONS_LENGTH = 50000;

const MIME_TYPES_BY_EXTENSION: Record<string, string> = {
  csv: "text/csv",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  json: "application/json",
  md: "text/markdown",
  pdf: "application/pdf",
  png: "image/png",
  txt: "text/plain",
  webp: "image/webp",
};

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/;

const frontmatterError = (): APIError =>
  new APIError({status: 400, title: "SKILL.md frontmatter needs name and description"});

const parseSkillMarkdown = (
  text: string
): {description: string; instructions: string; name: string} => {
  const match = FRONTMATTER_PATTERN.exec(text.replace(/^﻿/, ""));
  if (!match) {
    throw frontmatterError();
  }
  let frontmatter: unknown;
  try {
    frontmatter = parseYaml(match[1]);
  } catch {
    throw frontmatterError();
  }
  const {description, name} = (frontmatter ?? {}) as {description?: unknown; name?: unknown};
  if (typeof name !== "string" || !name.trim()) {
    throw frontmatterError();
  }
  if (typeof description !== "string" || !description.trim()) {
    throw frontmatterError();
  }
  const instructions = match[2].trim();
  if (instructions.length > SKILL_MAX_INSTRUCTIONS_LENGTH) {
    throw new APIError({
      status: 400,
      title: `SKILL.md instructions may be at most ${SKILL_MAX_INSTRUCTIONS_LENGTH} characters`,
    });
  }
  return {description: description.trim(), instructions, name: name.trim()};
};

// Archive metadata that zip tools add and nobody means to upload.
const isJunkEntry = (path: string): boolean =>
  path.endsWith("/") ||
  path.startsWith("__MACOSX/") ||
  (path.split("/").pop() ?? "").startsWith(".");

const isUnsafePath = (path: string): boolean =>
  path.startsWith("/") || path.includes("\\") || path.split("/").some((part) => part === "..");

const unzipPackage = (buffer: Buffer): Record<string, Uint8Array> => {
  let fileCount = 0;
  let declaredBytes = 0;
  try {
    // Limits are enforced on declared sizes before inflating, so a zip bomb is never expanded.
    return unzipSync(new Uint8Array(buffer), {
      filter: (file) => {
        if (isUnsafePath(file.name)) {
          throw new APIError({status: 400, title: `Invalid file path: ${file.name}`});
        }
        if (isJunkEntry(file.name)) {
          return false;
        }
        // Every kept entry counts, so no entry name escapes the declared-size limits.
        fileCount += 1;
        declaredBytes += file.originalSize;
        if (
          file.name.split("/").pop() === SKILL_FILENAME &&
          file.originalSize > MAX_SKILL_MD_BYTES
        ) {
          throw new APIError({status: 400, title: "SKILL.md may be at most 1 MB"});
        }
        if (fileCount > MAX_FILES + 1) {
          throw new APIError({status: 400, title: `A skill can hold at most ${MAX_FILES} files`});
        }
        if (declaredBytes > MAX_FILES_BYTES + MAX_SKILL_MD_BYTES) {
          throw new APIError({status: 400, title: "A skill's files may total at most 10 MB"});
        }
        return true;
      },
    });
  } catch (error) {
    if (error instanceof APIError) {
      throw error;
    }
    throw new APIError({status: 400, title: "The skill package is not a valid zip file"});
  }
};

const parseZipPackage = (buffer: Buffer): SkillPackage => {
  const entries = unzipPackage(buffer);
  const paths = Object.keys(entries);

  // SKILL.md may sit at the root or inside one top-level folder; the shallowest one wins.
  const skillPath = paths
    .filter((path) => path.split("/").pop() === SKILL_FILENAME && path.split("/").length <= 2)
    .sort((a, b) => a.length - b.length)[0];
  if (!skillPath) {
    throw new APIError({status: 400, title: "No SKILL.md found in the package"});
  }
  const root = skillPath.slice(0, -SKILL_FILENAME.length);
  const skill = parseSkillMarkdown(strFromU8(entries[skillPath]));

  const files: SkillPackageFile[] = [];
  let totalBytes = 0;
  for (const path of paths) {
    if (path === skillPath) {
      continue;
    }
    if (!path.startsWith(root)) {
      throw new APIError({status: 400, title: `Files must sit in the SKILL.md folder: ${path}`});
    }
    const filename = path.slice(root.length);
    const extension = filename.includes(".") ? filename.split(".").pop()?.toLowerCase() : "";
    const mimeType = MIME_TYPES_BY_EXTENSION[extension ?? ""];
    if (!mimeType) {
      throw new APIError({status: 400, title: `Unsupported file type: ${filename}`});
    }
    totalBytes += entries[path].length;
    files.push({data: entries[path], filename, mimeType});
  }

  if (files.length > MAX_FILES) {
    throw new APIError({status: 400, title: `A skill can hold at most ${MAX_FILES} files`});
  }
  if (totalBytes > MAX_FILES_BYTES) {
    throw new APIError({status: 400, title: "A skill's files may total at most 10 MB"});
  }
  return {...skill, files};
};

/** Reads an uploaded `SKILL.md` or `.zip` skill package; throws a 400 `APIError` when invalid. */
export const parseSkillPackage = async ({
  buffer,
  filename,
}: {
  buffer: Buffer;
  filename: string;
}): Promise<SkillPackage> => {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".md")) {
    return {...parseSkillMarkdown(buffer.toString("utf8")), files: []};
  }
  if (lower.endsWith(".zip")) {
    return parseZipPackage(buffer);
  }
  throw new APIError({status: 400, title: "Upload a SKILL.md file or a .zip skill package"});
};
