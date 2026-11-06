import {existsSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface GetDocsRootOptions {
  /** Override filesystem checks (for unit tests). */
  existsSyncFn?: (path: string) => boolean;
  /** Override Bun/Node binary path used for the exec-adjacent `docs/` fallback. */
  execPath?: string | null;
}

/**
 * Root directory for bundled markdown and ui-types-documentation.json.
 * Honours TERRENO_MCP_DOCS_DIR for tests and custom deployments.
 */
export const getDocsRoot = (options?: GetDocsRootOptions): string => {
  if (process.env.TERRENO_MCP_DOCS_DIR) {
    return process.env.TERRENO_MCP_DOCS_DIR;
  }

  const existsFn = options?.existsSyncFn ?? existsSync;
  const execPathValue = options?.execPath !== undefined ? options.execPath : process.execPath;

  const bundledDocsRoot = join(__dirname, "docs");
  if (existsFn(bundledDocsRoot)) {
    return bundledDocsRoot;
  }

  if (execPathValue) {
    const execDocsRoot = join(dirname(execPathValue), "docs");
    if (existsFn(execDocsRoot)) {
      return execDocsRoot;
    }
  }

  const sourceDocsRoot = join(__dirname, "..", "src", "docs");
  if (existsFn(sourceDocsRoot)) {
    return sourceDocsRoot;
  }

  return bundledDocsRoot;
};
