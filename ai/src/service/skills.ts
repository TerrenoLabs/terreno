import {APIError} from "@terreno/api";
import {jsonSchema, type Tool, tool} from "ai";
import type mongoose from "mongoose";

import {GptSkill} from "../models/gptSkill";
import type {GptSkillDocument} from "../types/skills";
import {
  activeSkillFilesLine,
  activeSkillHeading,
  LOAD_SKILL_TOOL_DESCRIPTION,
  SKILLS_CATALOG_SYSTEM_PROMPT,
} from "./prompts";

const SKILL_CATALOG_LIMIT = 50;
const MAX_SKILL_COMMANDS = 3;
const LOAD_SKILL_TOOL_NAME = "load_skill";

const SKILL_COMMAND_PATTERN = /^\/([a-z0-9-]{1,64})(?:\s+|$)/;

interface SkillFileRef {
  filename: string;
  mimeType: string;
  ref: string;
}

export interface LoadedSkill {
  description: string;
  files: SkillFileRef[];
  instructions: string;
  name: string;
}

interface SkillSummary {
  description: string;
  name: string;
}

/** Enabled, non-deleted skills: every global one plus the caller's own. */
const visibleSkillFilter = (userId: mongoose.Types.ObjectId): Record<string, unknown> => ({
  $or: [{scope: "global"}, {scope: "user", userId}],
  deleted: {$ne: true},
  enabled: {$ne: false},
});

/**
 * The skills offered in the catalog: globals by name, then the caller's skills by most recently
 * updated, capped at `SKILL_CATALOG_LIMIT`. A user skill with a global skill's name is hidden.
 */
const listCatalogSkills = async (userId: mongoose.Types.ObjectId): Promise<SkillSummary[]> => {
  const filter = {deleted: {$ne: true}, enabled: {$ne: false}};
  const globals = await GptSkill.find({...filter, scope: "global"})
    .select("name description")
    .sort({name: 1})
    .limit(SKILL_CATALOG_LIMIT)
    .lean<SkillSummary[]>();
  const remaining = SKILL_CATALOG_LIMIT - globals.length;
  if (remaining <= 0) {
    return globals;
  }
  const allGlobalNames = await GptSkill.distinct("name", {...filter, scope: "global"});
  const userSkills = await GptSkill.find({
    ...filter,
    name: {$nin: allGlobalNames},
    scope: "user",
    userId,
  })
    .select("name description")
    .sort("-updated -_id")
    .limit(remaining)
    .lean<SkillSummary[]>();
  return [...globals, ...userSkills];
};

/** The visible skill with this name; a global skill wins over the caller's skill of the same name. */
const findVisibleSkill = async ({
  name,
  userId,
}: {
  name: string;
  userId: mongoose.Types.ObjectId;
}): Promise<GptSkillDocument | undefined> => {
  const matches = await GptSkill.find({...visibleSkillFilter(userId), name});
  return matches.find((skill) => skill.scope === "global") ?? matches[0];
};

const toLoadedSkill = (skill: GptSkillDocument): LoadedSkill => ({
  description: skill.description,
  files: (skill.files ?? []).map((file) => ({
    filename: file.filename,
    mimeType: file.mimeType,
    ref: `skill:${skill.name}/${file.filename}`,
  })),
  instructions: skill.instructions,
  name: skill.name,
});

/** The names in up to `MAX_SKILL_COMMANDS` leading `/name` tokens of a prompt. */
const parseSkillCommands = (prompt: string): string[] => {
  const names: string[] = [];
  let rest = prompt;
  while (names.length < MAX_SKILL_COMMANDS) {
    const match = SKILL_COMMAND_PATTERN.exec(rest);
    if (!match) {
      break;
    }
    names.push(match[1]);
    rest = rest.slice(match[0].length);
  }
  return names;
};

/** Resolves the prompt's leading `/name` tokens. An unknown name is a 400. */
const resolveSkillCommands = async ({
  prompt,
  userId,
}: {
  prompt: string;
  userId: mongoose.Types.ObjectId;
}): Promise<LoadedSkill[]> => {
  const resolved: LoadedSkill[] = [];
  for (const name of [...new Set(parseSkillCommands(prompt))]) {
    const skill = await findVisibleSkill({name, userId});
    if (!skill) {
      throw new APIError({status: 400, title: `Unknown skill: ${name}`});
    }
    resolved.push(toLoadedSkill(skill));
  }
  return resolved;
};

/** The `## Skills` catalog section, or undefined when no skill is visible. */
const skillsCatalogPrompt = (skills: SkillSummary[]): string | undefined => {
  if (skills.length === 0) {
    return undefined;
  }
  const lines = skills.map((skill) => `- ${skill.name}: ${skill.description}`);
  return [SKILLS_CATALOG_SYSTEM_PROMPT, ...lines].join("\n");
};

/** One `## Active skill: <name>` section with the skill's instructions and file refs. */
const activeSkillPrompt = (skill: LoadedSkill): string => {
  const parts = [activeSkillHeading(skill.name), skill.instructions];
  if (skill.files.length > 0) {
    parts.push(activeSkillFilesLine(skill.files.map((file) => file.ref)));
  }
  return parts.join("\n\n");
};

/** The built-in `load_skill` tool, scoped to the skills this user can see. */
const createLoadSkillTool = (userId: mongoose.Types.ObjectId): Tool =>
  tool({
    description: LOAD_SKILL_TOOL_DESCRIPTION,
    execute: async ({name}: {name: string}): Promise<LoadedSkill | {error: string}> => {
      const skill = typeof name === "string" ? await findVisibleSkill({name, userId}) : undefined;
      if (!skill) {
        return {error: `Unknown skill: ${name}`};
      }
      return toLoadedSkill(skill);
    },
    inputSchema: jsonSchema<{name: string}>({
      additionalProperties: false,
      properties: {name: {description: "The skill's name", type: "string"}},
      required: ["name"],
      type: "object",
    }),
  });

export interface TurnSkills {
  /** Catalog and active skill sections, appended after the request's system prompt. */
  systemPrompt?: string;
  tools?: Record<string, Tool>;
}

/**
 * Skills for one chat turn: the catalog, any `/name` skills the prompt starts with, and the
 * `load_skill` tool. Empty when skills are off, the model cannot call tools, or there is no user.
 */
export const resolveTurnSkills = async ({
  isEnabled,
  prompt,
  supportsTools,
  userId,
}: {
  isEnabled: boolean;
  prompt: unknown;
  supportsTools: boolean;
  userId: mongoose.Types.ObjectId | undefined;
}): Promise<TurnSkills> => {
  if (!isEnabled || !supportsTools || !userId) {
    return {};
  }
  const active = typeof prompt === "string" ? await resolveSkillCommands({prompt, userId}) : [];
  const catalog = skillsCatalogPrompt(await listCatalogSkills(userId));
  const sections = [catalog, ...active.map(activeSkillPrompt)].filter(Boolean);
  return {
    systemPrompt: sections.length > 0 ? sections.join("\n\n") : undefined,
    tools: catalog ? {[LOAD_SKILL_TOOL_NAME]: createLoadSkillTool(userId)} : undefined,
  };
};
