import {existsSync, readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";

import {resolveTerrenoProjectRoot} from "../projectRoot.js";
import {withLocalMongoDb} from "./localMongo.js";

interface DatabaseSchemaArgs {
  collectionFilter?: string;
  summary?: boolean;
}

const readEnvValue = (envPath: string, key: string): string | undefined => {
  if (!existsSync(envPath)) {
    return undefined;
  }
  const text = readFileSync(envPath, "utf-8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq === -1) {
      continue;
    }
    const k = trimmed.slice(0, eq).trim();
    if (k !== key) {
      continue;
    }
    let v = trimmed.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    return v;
  }
  return undefined;
};

const parseModelFiles = (modelsDir: string): string[] => {
  if (!existsSync(modelsDir)) {
    return [];
  }
  const names = readdirSync(modelsDir).filter((f) => f.endsWith(".ts") && f !== "index.ts");
  const summaries: string[] = [];
  for (const name of names) {
    const content = readFileSync(join(modelsDir, name), "utf-8");
    const lines = content.split("\n").slice(0, 80);
    summaries.push(`### ${name}\n\`\`\`typescript\n${lines.join("\n")}\n\`\`\``);
  }
  return summaries;
};

export const databaseSchema = async (args: DatabaseSchemaArgs): Promise<string> => {
  const root = resolveTerrenoProjectRoot();
  const envPath = join(root, "backend", ".env");
  const mongoUri =
    process.env.MONGO_URI?.trim() ||
    readEnvValue(envPath, "MONGO_URI") ||
    readEnvValue(envPath, "MONGODB_URI");

  const lines: string[] = ["# Database schema", ""];
  const modelsDir = join(root, "backend", "src", "models");
  lines.push("## Declared models (static scan of `backend/src/models/*.ts`)");
  lines.push("");
  const modelBlocks = parseModelFiles(modelsDir);
  if (modelBlocks.length === 0) {
    lines.push("_(No model files found.)_");
  } else if (args.summary) {
    lines.push(
      `Found ${modelBlocks.length} model file(s). Re-run with \`summary: false\` for excerpts.`
    );
  } else {
    lines.push(...modelBlocks);
  }
  lines.push("");
  lines.push("## Live MongoDB");
  lines.push("");

  if (!mongoUri) {
    lines.push(
      "_Unavailable: set `MONGO_URI` in `backend/.env` or export `MONGO_URI` to include live collections._"
    );
    return lines.join("\n");
  }

  return withLocalMongoDb(mongoUri, async (db) => {
    const filter = args.collectionFilter?.toLowerCase().trim();
    const names = (await db.listCollections().toArray())
      .map((c) => c.name)
      .filter((n) => !filter || n.toLowerCase().includes(filter));

    for (const name of names.sort()) {
      const coll = db.collection(name);
      const indexes = await coll.indexes();
      let count = 0;
      try {
        count = await coll.estimatedDocumentCount();
      } catch {
        count = -1;
      }
      lines.push(`### ${name}`);
      lines.push(`- **estimatedCount**: ${count}`);
      lines.push(`- **indexes**: \`${JSON.stringify(indexes)}\``);
      lines.push("");
    }

    return lines.join("\n");
  });
};
