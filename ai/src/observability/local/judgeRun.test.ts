import {describe, expect, it} from "bun:test";

import type {EvaluatorDimension} from "../../types/observability";
import type {EvaluatorAiClient} from "../evaluate";
import {type JudgeRunItemResult, runJudgeAgainstHumans} from "./judgeRun";

const DIMENSIONS: EvaluatorDimension[] = [
  {dataType: "boolean", key: "faithful", question: "Is it faithful?", required: true},
  {dataType: "boolean", key: "complete", question: "Is it complete?", required: true},
];

const JUDGE = {
  dimensions: DIMENSIONS,
  judgePromptName: "summary-judge",
  name: "summary-judge",
  type: "llm-judge" as const,
};

const SCHEMA = {
  properties: {complete: {type: "boolean"}, faithful: {type: "boolean"}},
  required: ["faithful", "complete"],
  type: "object",
};

interface RecordedCall {
  prompt: string;
  promptName?: string;
  systemPrompt?: string;
}

// Says "faithful" unless the output contains "bad"; throws for outputs containing "boom".
const makeClient = (): {
  calls: RecordedCall[];
  client: EvaluatorAiClient;
  maxInFlight: () => number;
} => {
  const calls: RecordedCall[] = [];
  let inFlight = 0;
  let peak = 0;
  const client: EvaluatorAiClient = {
    generateJsonObject: async <OBJECT>(options: {
      prompt: string;
      promptName?: string;
      systemPrompt?: string;
    }): Promise<OBJECT> => {
      calls.push({
        prompt: options.prompt,
        promptName: options.promptName,
        systemPrompt: options.systemPrompt,
      });
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await Bun.sleep(5);
      inFlight -= 1;
      if (options.prompt.includes("boom")) {
        throw new Error("judge exploded");
      }
      return {complete: true, faithful: !options.prompt.includes("bad")} as OBJECT;
    },
  };
  return {calls, client, maxInFlight: () => peak};
};

describe("runJudgeAgainstHumans", () => {
  it("judges every subject with bounded concurrency and returns results in input order", async () => {
    const {client, maxInFlight} = makeClient();
    const subjects = Array.from({length: 7}, (_, index) => {
      return {datasetItemId: `item-${index}`, input: "q", output: `answer ${index}`};
    });
    const run = await runJudgeAgainstHumans({
      ai: client,
      concurrency: 3,
      dimensions: DIMENSIONS,
      humanAnswers: [],
      judge: JUDGE,
      prompt: {outputSchema: SCHEMA},
      subjects,
    });
    expect(maxInFlight()).toBeLessThanOrEqual(3);
    expect(maxInFlight()).toBeGreaterThan(1);
    expect(run.results.map((row) => row.datasetItemId)).toEqual(
      subjects.map((row) => row.datasetItemId)
    );
  });

  it("scores errors and wrong answers as disagreements in both item results and agreement", async () => {
    const {client} = makeClient();
    const subjects = [
      {output: "good", traceId: "t-good"},
      {output: "bad", traceId: "t-bad"},
      {output: "boom", traceId: "t-boom"},
      {output: "good", traceId: "t-unreviewed"},
    ];
    const humanAnswers = [
      {scores: {complete: true, faithful: true}, traceId: "t-good"},
      {scores: {complete: true, faithful: true}, traceId: "t-bad"},
      {scores: {complete: true, faithful: true}, traceId: "t-boom"},
    ];
    const run = await runJudgeAgainstHumans({
      ai: client,
      dimensions: DIMENSIONS,
      humanAnswers,
      judge: JUDGE,
      prompt: {outputSchema: SCHEMA},
      subjects,
    });
    const byTrace = new Map<string, JudgeRunItemResult>(
      run.results.map((row) => [row.traceId ?? "", row])
    );
    expect(byTrace.get("t-good")?.disagrees).toBe(false);
    expect(byTrace.get("t-bad")?.disagrees).toBe(true);
    expect(byTrace.get("t-boom")?.disagrees).toBe(true);
    expect(byTrace.get("t-boom")?.error).toBe("judge exploded");
    expect(byTrace.get("t-unreviewed")?.disagrees).toBe(false);
    expect(run.agreement.errors).toBe(1);
    expect(run.agreement.itemsCompared).toBe(3);
    expect(run.agreement.compared).toBe(6);
    expect(run.agreement.matches).toBe(3);
    expect(run.agreement.disagreements.map((row) => `${row.traceId}:${row.key}`)).toEqual([
      "t-bad:faithful",
      "t-boom:faithful",
      "t-boom:complete",
    ]);
  });

  it("uses the version body as the system prompt when given, else the prompt name", async () => {
    const withSystem = makeClient();
    await runJudgeAgainstHumans({
      ai: withSystem.client,
      dimensions: DIMENSIONS,
      humanAnswers: [],
      judge: JUDGE,
      prompt: {outputSchema: SCHEMA, system: "STRICT"},
      subjects: [{datasetItemId: "a", output: "x"}],
    });
    expect(withSystem.calls[0]?.systemPrompt).toBe("STRICT");
    expect(withSystem.calls[0]?.promptName).toBeUndefined();

    const byName = makeClient();
    await runJudgeAgainstHumans({
      ai: byName.client,
      dimensions: DIMENSIONS,
      humanAnswers: [],
      judge: JUDGE,
      prompt: {outputSchema: SCHEMA},
      subjects: [{datasetItemId: "a", output: "x"}],
    });
    expect(byName.calls[0]?.promptName).toBe("summary-judge");
  });

  it("reports each result to onResult in input order, one at a time", async () => {
    const {client} = makeClient();
    const seen: string[] = [];
    let active = 0;
    await runJudgeAgainstHumans({
      ai: client,
      concurrency: 4,
      dimensions: DIMENSIONS,
      humanAnswers: [],
      judge: JUDGE,
      onResult: async (result) => {
        active += 1;
        expect(active).toBe(1);
        await Bun.sleep(1);
        seen.push(result.datasetItemId ?? "");
        active -= 1;
      },
      prompt: {outputSchema: SCHEMA},
      subjects: ["a", "b", "c", "d", "e"].map((id) => ({datasetItemId: id, output: id})),
    });
    expect(seen).toEqual(["a", "b", "c", "d", "e"]);
  });
});
