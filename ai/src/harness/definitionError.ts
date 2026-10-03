/** A misuse of the task API; retrying the phase cannot fix it, so the task fails at once. */
export class HarnessDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HarnessDefinitionError";
  }
}
