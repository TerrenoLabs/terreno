import {type AskValidationError, finalizeAskErrors, issuesToAskErrors} from "./errors";
import {type AskKind, askInputSchemas} from "./schema";

/**
 * Checks a model's ask input against its kind's schema and semantic rules (unique option ids,
 * defaults among the options). Returns no errors when the ask is valid. Semantic rules run once
 * the input's shape and types are valid.
 */
export const validateAskInput = ({
  input,
  kind,
}: {
  input: unknown;
  kind: AskKind;
}): AskValidationError[] => {
  if (!Object.hasOwn(askInputSchemas, kind)) {
    throw new Error(`Unknown ask kind "${String(kind)}".`);
  }
  const result = askInputSchemas[kind].safeParse(input);
  if (result.success) {
    return [];
  }
  return finalizeAskErrors(issuesToAskErrors({issues: result.error.issues, root: input}));
};
