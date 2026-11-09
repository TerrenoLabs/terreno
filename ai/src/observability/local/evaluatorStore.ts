import {APIError} from "@terreno/api";

import type {
  EvaluatorDimension,
  EvaluatorRunModes,
  ObsEvaluatorDocument,
  ObsExperimentDocument,
} from "../../types/observability";
import {judgeSchemaMissingDimensions} from "../evaluate";
import {getEvaluatorTemplate} from "../evaluatorTemplates";
import {questionSetFingerprint} from "../questionFingerprint";
import {registerObsDataset} from "./models/obsDataset";
import {registerObsEvaluator} from "./models/obsEvaluator";
import {registerObsExperiment} from "./models/obsExperiment";
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

/** How well an llm-judge agreed with human answers in its latest judge calibration experiment. */
export interface EvaluatorCalibration {
  datasetName?: string;
  experimentId: string;
  experimentName: string;
  passed: boolean;
  questionSetName?: string;
  /** Agreement rate (0–1) of `version`; unset when nothing could be compared. */
  rate?: number;
  /** True when the question set's questions changed since the experiment ran. */
  stale: boolean;
  targetAgreement?: number;
  /** The judge prompt's production version when it was compared, else the best version. */
  version: number;
}

export interface EvaluatorView {
  assertion?: {constraint: string; path: string};
  calibration?: EvaluatorCalibration;
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
    const calibrations = await this.loadCalibrations(rows);
    return rows.map((row) => {
      return {...toView(row), calibration: calibrations.get(String(row._id))};
    });
  }

  async get(id: string): Promise<EvaluatorView> {
    const doc = await registerObsEvaluator().findOneOrNone({_id: id});
    if (!doc) {
      throw new APIError({status: 404, title: `Unknown evaluator "${id}"`});
    }
    const calibrations = await this.loadCalibrations([doc]);
    return {...toView(doc), calibration: calibrations.get(String(doc._id))};
  }

  // Latest completed judge experiment per llm-judge evaluator, summarized for display.
  private async loadCalibrations(
    evaluators: ObsEvaluatorDocument[]
  ): Promise<Map<string, EvaluatorCalibration>> {
    const result = new Map<string, EvaluatorCalibration>();
    const judges = evaluators.filter((row) => row.type === "llm-judge");
    if (judges.length === 0) {
      return result;
    }
    const experiments = await registerObsExperiment()
      .find({
        judgeEvaluatorId: {$in: judges.map((row) => row._id)},
        kind: "judge",
        status: "completed",
      })
      .sort({created: -1});
    const latest = new Map<string, ObsExperimentDocument>();
    for (const experiment of experiments) {
      const key = String(experiment.judgeEvaluatorId);
      if (!latest.has(key)) {
        latest.set(key, experiment);
      }
    }
    if (latest.size === 0) {
      return result;
    }
    const rows = [...latest.values()];
    const datasets = await registerObsDataset().find({
      _id: {$in: rows.map((row) => row.datasetId)},
    });
    const questionSets = await registerObsEvaluator().find({
      _id: {$in: rows.flatMap((row) => (row.questionSetId ? [row.questionSetId] : []))},
    });
    for (const judge of judges) {
      const experiment = latest.get(String(judge._id));
      if (!experiment) {
        continue;
      }
      const production = judge.judgePromptName
        ? (await this.promptStore.getVersionByLabel(judge.judgePromptName, "production"))?.version
        : undefined;
      const agreement = experiment.results?.agreement ?? {};
      const best = [...experiment.versions].sort((left, right) => {
        return (agreement[String(right)]?.rate ?? -1) - (agreement[String(left)]?.rate ?? -1);
      })[0];
      const version =
        production !== undefined && experiment.versions.includes(production) ? production : best;
      if (version === undefined) {
        continue;
      }
      const questionSet = questionSets.find((row) => {
        return String(row._id) === String(experiment.questionSetId);
      });
      const gate = experiment.results?.gates.find((row) => row.version === version);
      result.set(String(judge._id), {
        datasetName: datasets.find((row) => String(row._id) === String(experiment.datasetId))?.name,
        experimentId: String(experiment._id),
        experimentName: experiment.name,
        passed: gate?.passed ?? false,
        questionSetName: questionSet?.name,
        rate: agreement[String(version)]?.rate,
        stale:
          !questionSet ||
          questionSetFingerprint(questionSet.dimensions) !== experiment.questionsFingerprint,
        targetAgreement: experiment.targetAgreement,
        version,
      });
    }
    return result;
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
