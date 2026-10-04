import {jsonSchema} from "ai";

import type {
  ObsTestMultiStageCall1Output,
  ObsTestMultiStageCall2Output,
  ObsTestMultiStageFinalOutput,
} from "../types";

export const OBS_TEST_MULTI_STAGE_CALL_1_SCHEMA_NAME = "obs-test-multi-stage-call-1";
export const OBS_TEST_MULTI_STAGE_CALL_2_SCHEMA_NAME = "obs-test-multi-stage-call-2";
export const OBS_TEST_MULTI_STAGE_FINAL_SCHEMA_NAME = "obs-test-multi-stage-final";

export const OBS_TEST_MULTI_STAGE_CALL_1_OUTPUT_SCHEMA: Record<string, unknown> = {
  additionalProperties: false,
  properties: {
    phrase: {
      description: "One short phrase summarizing the user input",
      type: "string",
    },
  },
  required: ["phrase"],
  type: "object",
};

export const OBS_TEST_MULTI_STAGE_CALL_2_OUTPUT_SCHEMA: Record<string, unknown> = {
  additionalProperties: false,
  properties: {
    keywords: {
      description: "Exactly two keywords taken from the user input",
      items: {type: "string"},
      maxItems: 2,
      minItems: 2,
      type: "array",
    },
  },
  required: ["keywords"],
  type: "object",
};

export const OBS_TEST_MULTI_STAGE_FINAL_OUTPUT_SCHEMA: Record<string, unknown> = {
  additionalProperties: false,
  properties: {
    keywords: {
      description: "The two keywords from stage two",
      items: {type: "string"},
      type: "array",
    },
    metrics: {
      description: "Character and word counts from the text-metrics tool",
      properties: {
        call1: {
          properties: {
            charCount: {type: "number"},
            wordCount: {type: "number"},
          },
          required: ["charCount", "wordCount"],
          type: "object",
        },
        call2: {
          properties: {
            charCount: {type: "number"},
            wordCount: {type: "number"},
          },
          required: ["charCount", "wordCount"],
          type: "object",
        },
        combinedCharCount: {type: "number"},
      },
      required: ["call1", "call2", "combinedCharCount"],
      type: "object",
    },
    phrase: {
      description: "The short phrase from stage one",
      type: "string",
    },
    sentence: {
      description: "One concise sentence combining phrase, keywords, and metrics",
      type: "string",
    },
  },
  required: ["keywords", "metrics", "phrase", "sentence"],
  type: "object",
};

export const obsTestMultiStageCall1Schema = jsonSchema<ObsTestMultiStageCall1Output>(
  OBS_TEST_MULTI_STAGE_CALL_1_OUTPUT_SCHEMA
);

export const obsTestMultiStageCall2Schema = jsonSchema<ObsTestMultiStageCall2Output>(
  OBS_TEST_MULTI_STAGE_CALL_2_OUTPUT_SCHEMA
);

export const obsTestMultiStageFinalSchema = jsonSchema<ObsTestMultiStageFinalOutput>(
  OBS_TEST_MULTI_STAGE_FINAL_OUTPUT_SCHEMA
);
