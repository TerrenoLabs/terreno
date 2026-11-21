import {existsSync, mkdirSync, readFileSync} from "node:fs";
import {join} from "node:path";

import {builderEnv, runBuilder, tailLines} from "../agent";
import {CHECKOUT_ROOT, NAIVE_PROMPT} from "../bootstrapPrompt";
import {collectEnvFileValues, redact} from "../redact";
import type {StageCheck, StageContext, StageDefinition, StageOutcome} from "../types";
import {stageChecks} from "./checks";

const TAIL_LINES = 200;

export const stagePromptPath = (stageId: string): string =>
  join(
    CHECKOUT_ROOT,
    ".rulesync",
    "skills",
    "bootstrap-todo-loop",
    "references",
    "stages",
    `${stageId}.md`
  );

/** `<naive prompt> + <stage prompt> + <prior failures>`, the whole input of a later stage. */
const renderStagePrompt = (stageId: string, failures: string[]): string => {
  const path = stagePromptPath(stageId);
  if (!existsSync(path)) {
    throw new Error(`stage prompt missing: ${path}`);
  }
  const failureSection =
    failures.length > 0
      ? `\n\n## Fix these failures\n\n${failures.map((failure) => `- ${failure}`).join("\n")}`
      : "";
  return `${NAIVE_PROMPT}\n\n${readFileSync(path, "utf8")}${failureSection}\n`;
};

/** A later stage: the builder follows the stage prompt, then deterministic checks decide. */
export const agentStage = (id: string): StageDefinition => ({
  id,
  kind: "agent",
  run: async (context: StageContext): Promise<StageOutcome> => {
    mkdirSync(context.appDir, {recursive: true});
    const prompt = renderStagePrompt(id, context.failures);
    const builder = await runBuilder({
      cwd: context.appDir,
      env: builderEnv(id, context.env),
      prompt,
    });
    const log = tailLines(
      redact(builder.output, context.env, collectEnvFileValues(context.appDir)),
      TAIL_LINES
    );
    const builderCheck: StageCheck = {
      ev: `builder exited ${String(builder.exitCode)}`,
      name: "builder",
      status: builder.exitCode === 0 ? "PASS" : "FAIL",
    };
    if (builder.exitCode !== 0) {
      return {checks: [builderCheck], log};
    }
    return {checks: [builderCheck, ...stageChecks[id](context.appDir)], log};
  },
});
