import type {LanguageModel} from "ai";

import {normalizeLlmJsonTextForStructuredOutput} from "./parseAiJson";

/**
 * Wraps a language model so non-streaming `doGenerate` text parts are normalized via
 * {@link normalizeLlmJsonTextForStructuredOutput} (fences, preamble, balanced slice, light repairs)
 * before Vercel `Output.*` parsing.
 */
export const withStrippedJsonFencesModel = (model: LanguageModel): LanguageModel => {
  if (typeof model === "string") {
    return model;
  }

  return new Proxy(model, {
    get(target, prop, receiver) {
      if (prop === "doGenerate") {
        const original = Reflect.get(target, prop, receiver);
        if (typeof original !== "function") {
          return original;
        }

        const boundGenerate = original as (options: unknown) => PromiseLike<{
          content: Array<{text?: string; type: string; [key: string]: unknown}>;
          [key: string]: unknown;
        }>;

        return async (options: unknown) => {
          const result = await Promise.resolve(boundGenerate.call(target, options));
          if (!result?.content || !Array.isArray(result.content)) {
            return result;
          }

          return {
            ...result,
            content: result.content.map((part) => {
              if (part.type !== "text" || typeof part.text !== "string") {
                return part;
              }

              return {
                ...part,
                text: normalizeLlmJsonTextForStructuredOutput(part.text),
              };
            }),
          };
        };
      }

      return Reflect.get(target, prop, receiver);
    },
  }) as LanguageModel;
};
