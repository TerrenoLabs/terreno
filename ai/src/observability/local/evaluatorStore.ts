import {APIError} from "@terreno/api";

import type {
  EvaluatorDimension,
  EvaluatorRunModes,
  ObsEvaluatorDocument,
} from "../../types/observability";
import {judgeSchemaMissingDimensions} from "../evaluate";
import {getEvaluatorTemplate} from "../evaluatorTemplates";
import {registerObsEvaluator} from "./models/obsEvaluator";
import {LocalPromptStore} from "./promptStore";

export interface EvaluatorWriteInput {
  assertion?: {constraint: string; path: string};
  confidenceAlertBelow?: number;
  description?: string;
  dimensions: EvaluatorDimension[];
  instructions?: string;
  judgePromptName?: string;
  name: string;
  runModes?: Partial<EvaluatorRunModes>;
  target: "dataset item" | "full trace" | "generation span";
  type: "human" | "json-assert" | "llm-judge";
}

export interface EvaluatorView {
  assertion?: {constraint: string; path: string};
  confidenceAlertBelow: number;
  description?: string;
  dimensions: EvaluatorDimension[];
  id: string;
  instructions?: string;
  judgePromptName?: string;
  name: string;
  runModes: EvaluatorRunModes;
  target: "dataset item" | "full trace" | "generation span";
  type: "human" | "json-assert" | "llm-judge";
}

const defaultRunModes = (partial?: Partial<EvaluatorRunModes>): EvaluatorRunModes => {
  return {
    allowManualRun: partial?.allowManualRun ?? true,
    availableInExperiments: partial?.availableInExperiments ?? true,
    liveSampleRate: partial?.liveSampleRate ?? 0,
  };
};

const rejectHumanLiveSampling = (type: string, liveSampleRate: number): void => {
  if (type === "human" && liveSampleRate > 0) {
    throw new APIError({
      status: 400,
      title: "human evaluators cannot set liveSampleRate above 0",
    });
  }
};

const validateEvaluatorShape = async (
  input: EvaluatorWriteInput,
  promptStore: LocalPromptStore
): Promise<void> => {
  if (!input.name || input.dimensions.length === 0) {
    throw new APIError({status: 400, title: "name and dimensions are required"});
  }
  if (input.type === "llm-judge") {
    if (!input.judgePromptName) {
      throw new APIError({status: 400, title: "llm-judge evaluators require judgePromptName"});
    }
    const judgeVersion = await promptStore.getVersionByLabel(input.judgePromptName, "production");
    if (!judgeVersion) {
      throw new APIError({
        status: 400,
        title: `Unknown judge prompt "${input.judgePromptName}"`,
      });
    }
    const missing = judgeSchemaMissingDimensions(input.dimensions, judgeVersion.outputSchema);
    if (missing.length > 0) {
      throw new APIError({
        status: 400,
        title: `Judge prompt output schema missing required dimension "${missing[0]}"`,
      });
    }
  }
  if (input.type === "json-assert" && input.name !== "schema-assert" && !input.assertion?.path) {
    throw new APIError({
      status: 400,
      title: "json-assert evaluators require assertion.path unless using schema-assert mode",
    });
  }
};

const toView = (doc: ObsEvaluatorDocument): EvaluatorView => {
  return {
    assertion: doc.assertion,
    confidenceAlertBelow: doc.confidenceAlertBelow,
    description: doc.description,
    dimensions: doc.dimensions,
    id: String(doc._id),
    instructions: doc.instructions,
    judgePromptName: doc.judgePromptName,
    name: doc.name,
    runModes: doc.runModes,
    target: doc.target,
    type: doc.type,
  };
};

export class LocalEvaluatorStore {
  constructor(private readonly promptStore = new LocalPromptStore()) {}

  async create(input: EvaluatorWriteInput): Promise<EvaluatorView> {
    const runModes = defaultRunModes(input.runModes);
    rejectHumanLiveSampling(input.type, runModes.liveSampleRate);
    await validateEvaluatorShape(input, this.promptStore);
    try {
      const created = await registerObsEvaluator().create({
        assertion: input.assertion,
        confidenceAlertBelow: input.confidenceAlertBelow ?? 0.7,
        description: input.description,
        dimensions: input.dimensions,
        instructions: input.instructions,
        judgePromptName: input.judgePromptName,
        name: input.name,
        runModes,
        target: input.target,
        type: input.type,
      });
      return toView(created);
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error as {code?: number}).code === 11000
      ) {
        throw new APIError({status: 409, title: `Evaluator "${input.name}" already exists`});
      }
      throw error;
    }
  }

  async list(): Promise<EvaluatorView[]> {
    const rows = await registerObsEvaluator().find({}).sort({name: 1});
    return rows.map((row) => {
      return toView(row);
    });
  }

  async get(id: string): Promise<EvaluatorView> {
    const doc = await registerObsEvaluator().findOneOrNone({_id: id});
    if (!doc) {
      throw new APIError({status: 404, title: `Unknown evaluator "${id}"`});
    }
    return toView(doc);
  }

  async getByName(name: string): Promise<EvaluatorView | undefined> {
    const doc = await registerObsEvaluator().findOneOrNone({name});
    if (!doc) {
      return undefined;
    }
    return toView(doc);
  }

  async update(id: string, input: Partial<EvaluatorWriteInput>): Promise<EvaluatorView> {
    const doc = await registerObsEvaluator().findOneOrNone({_id: id});
    if (!doc) {
      throw new APIError({status: 404, title: `Unknown evaluator "${id}"`});
    }
    const runModes = defaultRunModes({...doc.runModes, ...input.runModes});
    const merged = {
      assertion: input.assertion ?? doc.assertion,
      confidenceAlertBelow: input.confidenceAlertBelow ?? doc.confidenceAlertBelow,
      description: input.description ?? doc.description,
      dimensions: input.dimensions ?? doc.dimensions,
      instructions: input.instructions ?? doc.instructions,
      judgePromptName: input.judgePromptName ?? doc.judgePromptName,
      name: input.name ?? doc.name,
      runModes,
      target: input.target ?? doc.target,
      type: input.type ?? doc.type,
    } satisfies EvaluatorWriteInput;
    rejectHumanLiveSampling(merged.type, merged.runModes.liveSampleRate);
    await validateEvaluatorShape(merged, this.promptStore);
    doc.assertion = merged.assertion;
    doc.confidenceAlertBelow = merged.confidenceAlertBelow;
    doc.description = merged.description;
    doc.dimensions = merged.dimensions;
    doc.instructions = merged.instructions;
    doc.judgePromptName = merged.judgePromptName;
    doc.name = merged.name;
    doc.runModes = merged.runModes;
    doc.target = merged.target;
    doc.type = merged.type;
    await doc.save();
    return toView(doc);
  }

  async remove(id: string): Promise<void> {
    const doc = await registerObsEvaluator().findOneOrNone({_id: id});
    if (!doc) {
      throw new APIError({status: 404, title: `Unknown evaluator "${id}"`});
    }
    doc.deleted = true;
    await doc.save();
  }

  async installTemplate(name: string): Promise<EvaluatorView> {
    const template = getEvaluatorTemplate(name);
    if (!template) {
      throw new APIError({status: 404, title: `Unknown evaluator template "${name}"`});
    }
    return this.create({
      assertion: template.assertion,
      description: template.description,
      dimensions: template.dimensions,
      instructions: template.instructions,
      judgePromptName: template.judgePromptName,
      name: template.name,
      runModes: template.runModes,
      target: template.target,
      type: template.type,
    });
  }
}
