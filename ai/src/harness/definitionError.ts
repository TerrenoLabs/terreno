import {APIError} from "@terreno/api";

import {HARNESS_ERRORS} from "./errors";

/**
 * A misuse of the task API; retrying the phase cannot fix it, so the task fails at once.
 * An `APIError` (500, `harness-definition-invalid`); the specific problem is in `detail`.
 */
export class HarnessDefinitionError extends APIError {
  constructor(detail: string) {
    super({...HARNESS_ERRORS.definitionInvalid, detail});
  }
}
