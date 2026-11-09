import {readFile} from "node:fs/promises";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";

const packageDir = dirname(fileURLToPath(import.meta.url));

export const readCliVersion = async (): Promise<string> => {
  const pkgPath = join(packageDir, "..", "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as {version?: string};
  return pkg.version ?? "0.0.0";
};
