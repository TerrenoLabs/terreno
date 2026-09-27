import {type AskValidationError, finalizeAskErrors, issuesToAskErrors} from "./errors";
import {type AskKind, type AskSurface, askInputSchemaFor} from "./schema";

/**
 * Checks a model's ask input against its kind's schema and semantic rules (unique option ids,
 * defaults among the options). Returns no errors when the ask is valid. Semantic rules run once
 * the input's shape and types are valid. With `surface: "compact"`, the ask must also fit a
 * simple card: at most 3 options, labels that fit a button uncut, and no two labels alike.
 */
export const validateAskInput = ({
  input,
  kind,
  surface = "full",
}: {
  input: unknown;
  kind: AskKind;
  surface?: AskSurface;
}): AskValidationError[] => {
  const result = askInputSchemaFor({kind, surface}).safeParse(input);
  if (result.success) {
    return [];
  }
  return finalizeAskErrors(issuesToAskErrors({issues: result.error.issues, root: input}));
};
