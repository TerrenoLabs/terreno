import type express from "express";
import mongoose from "mongoose";

/**
 * AI settings subschema for an app's `configurationPlugin` model, so admins edit the default
 * system prompt and image style on the Configuration screen. Mount it as a section, e.g.
 * `new Schema({ai: aiConfigurationSchema})`.
 */
export const aiConfigurationSchema = new mongoose.Schema(
  {
    imageStylePrompt: {
      default: "",
      description: "Style guidance added to every generated image prompt",
      type: String,
    },
    systemPrompt: {
      default: "",
      description: "Default system prompt for every GPT chat",
      type: String,
    },
  },
  {_id: false}
);

/** The part of a `configurationPlugin` model that the prompt getter reads. */
interface ConfigurationReader {
  getConfig: (key: string) => Promise<unknown>;
}

/**
 * A `defaultSystemPrompt`-compatible function that reads a string from a configuration model at
 * `path` (e.g. `"ai.systemPrompt"`) on every turn. Empty values return `undefined`.
 */
export const configurationPromptGetter = (
  model: ConfigurationReader,
  path: string
): ((args: {req: express.Request}) => Promise<string | undefined>) => {
  return async (): Promise<string | undefined> => {
    const value = await model.getConfig(path);
    if (typeof value !== "string" || !value.trim()) {
      return undefined;
    }
    return value;
  };
};
