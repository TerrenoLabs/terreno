import {scaffoldStage} from "./stages/scaffold";
import type {StageDefinition} from "./types";

/** Registry of stages in run order. Later tasks append the remaining stages. */
export const STAGES: StageDefinition[] = [scaffoldStage];

export const stageIds = (): string[] => STAGES.map((stage) => stage.id);

export const findStage = (id: string): StageDefinition | undefined =>
  STAGES.find((stage) => stage.id === id);
