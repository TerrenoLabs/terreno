import {mkdirSync, writeFileSync} from "node:fs";
import {join} from "node:path";
import {askJsonSchemas} from "../src/asks/jsonSchema";

const SCHEMAS_DIR = join(import.meta.dir, "..", "schemas");

mkdirSync(SCHEMAS_DIR, {recursive: true});
for (const [fileName, document] of Object.entries(askJsonSchemas())) {
  writeFileSync(join(SCHEMAS_DIR, fileName), `${JSON.stringify(document, null, 2)}\n`);
  console.info(`Wrote schemas/${fileName}`);
}
