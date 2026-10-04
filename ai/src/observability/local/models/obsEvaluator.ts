import {createdUpdatedPlugin, findExactlyOne, findOneOrNone, isDeletedPlugin} from "@terreno/api";
import mongoose from "mongoose";

import type {ObsEvaluatorDocument, ObsEvaluatorModel} from "../../../types/observability";

const obsEvaluatorSchema = new mongoose.Schema<ObsEvaluatorDocument, ObsEvaluatorModel>(
  {
    assertion: {
      description: "json-assert path and constraint when type is json-assert",
      type: mongoose.Schema.Types.Mixed,
    },
    confidenceAlertBelow: {
      default: 0.7,
      description: "Flag low-confidence scores below this threshold (0–1)",
      type: Number,
    },
    description: {description: "Operator-facing evaluator description", type: String},
    dimensions: {
      default: [],
      description: "Typed score dimensions written by this evaluator",
      type: [
        {
          dataType: {
            description: "How the dimension value is interpreted",
            enum: ["boolean", "categorical", "numeric"],
            required: true,
            type: String,
          },
          key: {description: "Dimension key written onto scores", required: true, type: String},
          range: {
            description: "Numeric bounds, categorical values, or a free-text hint",
            type: String,
          },
          required: {
            default: true,
            description: "Whether a review submit must include this dimension",
            type: Boolean,
          },
        },
      ],
    },
    instructions: {
      description: "Human-reviewer instructions shown above the score form",
      type: String,
    },
    judgePromptName: {
      description: "Named judge prompt when type is llm-judge",
      type: String,
    },
    name: {description: "Unique evaluator name", required: true, type: String},
    runModes: {
      description: "Where this evaluator may run",
      required: true,
      type: {
        allowManualRun: {
          default: true,
          description: "When true, operators may run this evaluator on demand",
          type: Boolean,
        },
        availableInExperiments: {
          default: true,
          description: "When true, this evaluator can be attached to an experiment",
          type: Boolean,
        },
        liveSampleRate: {
          default: 0,
          description: "Percent of live traces to sample (0–100). Must be 0 for human evaluators",
          type: Number,
        },
      },
    },
    target: {
      description: "What the evaluator scores",
      enum: ["dataset item", "full trace", "generation span"],
      required: true,
      type: String,
    },
    type: {
      description: "Evaluator implementation",
      enum: ["human", "json-assert", "llm-judge"],
      required: true,
      type: String,
    },
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

obsEvaluatorSchema.plugin(createdUpdatedPlugin);
obsEvaluatorSchema.plugin(isDeletedPlugin);
obsEvaluatorSchema.plugin(findOneOrNone);
obsEvaluatorSchema.plugin(findExactlyOne);
obsEvaluatorSchema.index({name: 1}, {unique: true});

export const registerObsEvaluator = (): ObsEvaluatorModel => {
  if (mongoose.models.ObsEvaluator) {
    return mongoose.models.ObsEvaluator as ObsEvaluatorModel;
  }
  return mongoose.model<ObsEvaluatorDocument, ObsEvaluatorModel>(
    "ObsEvaluator",
    obsEvaluatorSchema
  );
};
