import {agentStage} from "./stages/agentStage";
import {scaffoldStage} from "./stages/scaffold";
import type {StageDefinition} from "./types";

const LATER_STAGE_IDS = [
  "auth",
  "admin",
  "theming",
  "features",
  "roles",
  "consent",
  "ai",
  "ci",
  "deploy",
  "checklist",
];

/** Registry of the eleven stages in run order. */
export const STAGES: StageDefinition[] = [scaffoldStage, ...LATER_STAGE_IDS.map(agentStage)];

export const stageIds = (): string[] => STAGES.map((stage) => stage.id);

export const findStage = (id: string): StageDefinition | undefined =>
  STAGES.find((stage) => stage.id === id);
