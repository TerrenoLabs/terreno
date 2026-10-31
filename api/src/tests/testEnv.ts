/** Use in-memory MongoDB when no external test URI is configured (local / CI without mongod). */
if (!process.env.TERRENO_TEST_MONGODB_URI?.trim()) {
  process.env.TERRENO_TEST_USE_MEMORY_MONGO = "true";
}

/**
 * Builds a sparse env for code that accepts an injected `NodeJS.ProcessEnv`. The global
 * augmentation in `src/types.d.ts` marks server settings required, which test inputs omit.
 */
export const partialEnv = (vars: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv =>
  vars as NodeJS.ProcessEnv;
